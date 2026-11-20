import { beforeEach, expect, it, vi } from "vitest";
import type { UpdateProjectRequest } from "./update-project";

const mocks = vi.hoisted(() => ({
  session: "session-1",
  server: {
    id: "p-1",
    name: "Help",
    icon: "Layout",
    slug: "HELP",
    description: "old",
    kind: "project",
  } as Record<string, unknown>,
  reads: vi.fn(),
  writes: vi.fn(),
  holdWrites: false,
  // Holds exactly the next project read (the previous fetcher's GET-then-fill step).
  readGate: null as Promise<void> | null,
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
  mocks.holdWrites = false;
  mocks.readGate = null;
  mocks.server = {
    id: "p-1",
    name: "Help",
    icon: "Layout",
    slug: "HELP",
    description: "old",
    kind: "project",
  };
  // A read answers with the project as it was when the read was sent.
  mocks.reads.mockReset().mockImplementation(async () => {
    const snapshot = { ...mocks.server };
    const gate = mocks.readGate;
    mocks.readGate = null;
    await gate;
    return snapshot;
  });
  // The API applies only the fields a request carries (field-intent PUT).
  mocks.writes
    .mockReset()
    .mockImplementation(async ({ json }: { json: Record<string, unknown> }) => {
      if (mocks.holdWrites)
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

// Two browsers are two JavaScript modules: each has its own write queue, so nothing the
// fetcher does in memory can order them. The shared state is the server's row alone.
async function loadClient() {
  vi.resetModules();
  return (await import("./update-project")).updateProjectForSession;
}

const independentPairs: Array<
  [string, Partial<UpdateProjectRequest>, Partial<UpdateProjectRequest>]
> = [
  ["an optional setting", { kind: "managed_service" }, { slug: "NEW" }],
  ["a rename", { slug: "NEW" }, { description: "new text" }],
];
it.each(independentPairs)(
  "%s saved by an independent client never reverts the other client's confirmed change",
  async (_name, stale, committed) => {
    const tabA = await loadClient();
    const tabB = await loadClient();
    // Tab B opened the project before tab A saved: a read it sent then is still in flight
    // when tab A commits. (The fetcher no longer reads at all; the gate only keeps the old
    // read-then-fill behaviour observable.)
    let openGate: (() => void) | undefined;
    mocks.readGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const staleSave = tabB({ id: "p-1", ...stale }, "session-1");
    // Let tab B reach (and, before the fix, block on) its read before tab A starts.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await tabA({ id: "p-1", ...committed }, "session-1");
    openGate?.();
    await staleSave;
    expect(mocks.server).toMatchObject({ ...stale, ...committed });
  },
);

it("sends only the fields it was given, and never reads the project first", async () => {
  const save = await loadClient();
  await save({ id: "p-1", defaultCommentVisibility: "internal" }, "session-1");
  expect(mocks.reads).not.toHaveBeenCalled();
  expect(mocks.writes).toHaveBeenCalledTimes(1);
  expect(mocks.writes.mock.calls[0][0]).toEqual({
    param: { id: "p-1" },
    json: { defaultCommentVisibility: "internal" },
  });
});

it("sends an explicit null and an empty string, which clear a value, not drop them", async () => {
  const save = await loadClient();
  await save({ id: "p-1", description: "", managerId: null }, "session-1");
  expect(mocks.writes.mock.calls[0][0].json).toStrictEqual({
    description: "",
    managerId: null,
  });
});

it("serialises saves of one project made in the same tab, in call order", async () => {
  const save = await loadClient();
  mocks.holdWrites = true;
  const first = save({ id: "p-1", slug: "NEW" }, "session-1");
  await started(1);
  const second = save({ id: "p-1", kind: "managed_service" }, "session-1");
  await Promise.resolve();
  expect(mocks.writes).toHaveBeenCalledTimes(1);
  release?.();
  await first;
  await started(2);
  release?.();
  await second;
  expect(mocks.writes.mock.calls[0][0].json).toEqual({ slug: "NEW" });
  expect(mocks.writes.mock.calls[1][0].json).toEqual({
    kind: "managed_service",
  });
  expect(mocks.server).toMatchObject({ slug: "NEW", kind: "managed_service" });
});

it("continues after rejection and cancels a queued draft after a session change", async () => {
  const save = await loadClient();
  mocks.writes.mockRejectedValueOnce(new Error("failed"));
  await expect(save({ id: "p-1", name: "One" }, "session-1")).rejects.toThrow(
    "failed",
  );
  mocks.holdWrites = true;
  const first = save({ id: "p-1", name: "Two" }, "session-1");
  await started(2);
  const queued = save({ id: "p-1", name: "Three" }, "session-1");
  mocks.session = "session-2";
  release?.();
  await first;
  await expect(queued).rejects.toThrow("session changed");
  expect(mocks.writes).toHaveBeenCalledTimes(2);
});

it("does not write when the session changed before the save", async () => {
  const save = await loadClient();
  mocks.session = "session-2";
  await expect(save({ id: "p-1", slug: "NEW" }, "session-1")).rejects.toThrow(
    "session changed",
  );
  expect(mocks.writes).not.toHaveBeenCalled();
});
