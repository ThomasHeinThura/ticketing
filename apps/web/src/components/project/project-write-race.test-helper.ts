import { expect, vi } from "vitest";
import { updateProjectForSession } from "@/fetchers/project/update-project";

export const race = {
  server: {} as Record<string, unknown>,
  writes: vi.fn(),
  release: undefined as (() => void) | undefined,
};

function releaseWrite() {
  if (!race.release) throw new Error("write did not start");
  race.release();
}

export async function exerciseCallerRace(
  order: string,
  id: string,
  triggerSibling: () => void,
  update: ReturnType<typeof vi.fn>,
  expected: Record<string, unknown>,
) {
  race.server = {
    id,
    name: "Original",
    slug: "OLD",
    icon: "Layout",
    description: "old",
  };
  race.release = undefined;
  race.writes
    .mockReset()
    .mockImplementation(async ({ json }: { json: Record<string, unknown> }) => {
      await new Promise<void>((resolve) => {
        race.release = resolve;
      });
      race.server = { ...race.server, ...json };
      return { ok: true, json: async () => ({ ...race.server }) };
    });
  update.mockImplementation((request) =>
    updateProjectForSession(request, "session-1"),
  );
  const rename = () =>
    updateProjectForSession({ id, slug: "NEW" }, "session-1");
  let renameResult: Promise<unknown> | undefined;
  if (order === "rename first") renameResult = rename();
  else triggerSibling();
  await vi.waitFor(() => expect(race.writes).toHaveBeenCalledTimes(1));
  if (order === "rename first") triggerSibling();
  else renameResult = rename();
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(race.writes).toHaveBeenCalledTimes(1);
  releaseWrite();
  await vi.waitFor(() => expect(race.writes).toHaveBeenCalledTimes(2));
  // The two writes keep their call order, the rename carries the key and the sibling save
  // carries none of the four base fields, so it cannot restore the old key (PTM-04).
  const renameCall = order === "rename first" ? 0 : 1;
  expect(race.writes.mock.calls[renameCall][0].json.slug).toBe("NEW");
  const siblingJson = race.writes.mock.calls[1 - renameCall][0].json;
  for (const field of ["name", "icon", "slug", "description"])
    expect(siblingJson).not.toHaveProperty(field);
  releaseWrite();
  await renameResult;
  await vi.waitFor(() =>
    expect(race.server).toMatchObject({ slug: "NEW", ...expected }),
  );
}
