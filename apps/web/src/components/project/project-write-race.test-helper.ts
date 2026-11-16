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
  expect(race.writes.mock.calls[1][0].json.slug).toBe("NEW");
  releaseWrite();
  await renameResult;
  await vi.waitFor(() =>
    expect(race.server).toMatchObject({ slug: "NEW", ...expected }),
  );
}
