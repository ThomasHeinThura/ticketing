import { beforeEach, expect, it, vi } from "vitest";
import { updateProjectForSession } from "./update-project";

const mocks = vi.hoisted(() => ({
  session: "session-1",
  server: {
    id: "p-1",
    name: "Help",
    icon: "Layout",
    slug: "HELP",
    description: "old",
    kind: "project",
  },
  reads: vi.fn(),
  writes: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: vi.fn(async () => ({
      data: { session: { id: mocks.session } },
      error: null,
    })),
  },
}));
vi.mock("./get-project", () => ({
  default: (...args: unknown[]) => mocks.reads(...args),
}));
vi.mock("@taskdesk/libs", () => ({
  client: {
    project: { ":id": { $put: (...args: unknown[]) => mocks.writes(...args) } },
  },
}));

let release: (() => void) | undefined;
beforeEach(() => {
  mocks.session = "session-1";
  mocks.server = {
    id: "p-1",
    name: "Help",
    icon: "Layout",
    slug: "HELP",
    description: "old",
    kind: "project",
  };
  mocks.reads.mockReset().mockImplementation(async () => ({ ...mocks.server }));
  mocks.writes
    .mockReset()
    .mockImplementation(async ({ json }: { json: typeof mocks.server }) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.server = { ...mocks.server, ...json };
      return { ok: true, json: async () => ({ ...mocks.server }) };
    });
  release = undefined;
});

async function started(count: number) {
  await vi.waitFor(() => expect(mocks.writes).toHaveBeenCalledTimes(count));
}

it.each(["sibling first", "rename first"])(
  "rebases %s without overlapping or reverting the key",
  async (order) => {
    const sibling = () =>
      updateProjectForSession(
        { id: "p-1", kind: "managed_service" },
        "session-1",
      );
    const rename = () =>
      updateProjectForSession({ id: "p-1", slug: "NEW" }, "session-1");
    const first = order === "sibling first" ? sibling() : rename();
    await started(1);
    const second = order === "sibling first" ? rename() : sibling();
    await Promise.resolve();
    expect(mocks.writes).toHaveBeenCalledTimes(1);
    release?.();
    await first;
    await started(2);
    release?.();
    await second;
    expect(mocks.server.slug).toBe("NEW");
    expect(mocks.server.kind).toBe("managed_service");
    expect(mocks.writes.mock.calls[1][0].json.slug).toBe("NEW");
  },
);

it("continues after rejection and cancels a queued draft after a session change", async () => {
  mocks.writes.mockRejectedValueOnce(new Error("failed"));
  await expect(
    updateProjectForSession({ id: "p-1", name: "One" }, "session-1"),
  ).rejects.toThrow("failed");
  const first = updateProjectForSession(
    { id: "p-1", name: "Two" },
    "session-1",
  );
  await started(2);
  const queued = updateProjectForSession(
    { id: "p-1", name: "Three" },
    "session-1",
  );
  mocks.session = "session-2";
  release?.();
  await first;
  await expect(queued).rejects.toThrow("session changed");
  expect(mocks.writes).toHaveBeenCalledTimes(2);
});

it("does not write when the fresh read fails", async () => {
  mocks.reads.mockRejectedValueOnce(new Error("read failed"));
  await expect(
    updateProjectForSession({ id: "p-1", slug: "NEW" }, "session-1"),
  ).rejects.toThrow("read failed");
  expect(mocks.writes).not.toHaveBeenCalled();
});
