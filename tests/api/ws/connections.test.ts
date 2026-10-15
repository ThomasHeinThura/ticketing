import { afterEach, describe, expect, it, vi } from "vitest";

// We need to mock the events module to prevent side effects from the
// top-level subscribeToEvent calls in ws/index.ts
vi.mock("../../../apps/api/src/events", () => ({
  subscribeToEvent: vi.fn(),
  publishEvent: vi.fn(),
}));

import {
  addConnection,
  addConnectionWithinLimit,
  removeConnection,
} from "../../../apps/api/src/ws/index";
import { MAX_REALTIME_CONNECTIONS_PER_PERSON } from "../../../apps/api/src/ws/limits";

function makeFakeWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    raw: undefined,
    url: null,
    protocol: null,
  } as never;
}

// We access projectConnections indirectly through the exported functions.
// After each test we clean up by removing all connections we added.
const tracked: Array<{
  projectId: string;
  conn: ReturnType<typeof addConnection>;
}> = [];

afterEach(() => {
  for (const { projectId, conn } of tracked) {
    removeConnection(projectId, conn);
  }
  tracked.length = 0;
});

function trackAdd(projectId: string, userId: string, initiatorId: string) {
  const conn = addConnection(
    projectId,
    makeFakeWs(),
    userId,
    initiatorId,
    async () => true,
  );
  tracked.push({ projectId, conn });
  return conn;
}

describe("addConnection / removeConnection", () => {
  it("returns a ProjectConnection object with the provided values", () => {
    const ws = makeFakeWs();
    const conn = addConnection(
      "proj-1",
      ws,
      "user-1",
      "init-1",
      async () => true,
    );
    tracked.push({ projectId: "proj-1", conn });

    expect(conn).toEqual({
      ws,
      userId: "user-1",
      initiatorId: "init-1",
      authorization: {
        check: expect.any(Function),
        dispose: expect.any(Function),
      },
    });
  });

  it("allows multiple connections for the same project", () => {
    const c1 = trackAdd("proj-1", "user-1", "init-1");
    const c2 = trackAdd("proj-1", "user-2", "init-2");

    expect(c1).not.toBe(c2);
    // Both should be removable without error
    removeConnection("proj-1", c1);
    removeConnection("proj-1", c2);
    // Remove from tracked since we manually cleaned up
    tracked.length = 0;
  });

  it("allows connections to different projects", () => {
    const c1 = trackAdd("proj-1", "user-1", "init-1");
    const c2 = trackAdd("proj-2", "user-1", "init-1");

    expect(c1).not.toBe(c2);
  });

  it("removeConnection does not throw for unknown project", () => {
    const conn = trackAdd("proj-1", "user-1", "init-1");
    // Remove from a project that doesn't match; it should not throw
    expect(() => removeConnection("nonexistent", conn)).not.toThrow();
  });

  it("removeConnection does not throw for already-removed connection", () => {
    const conn = trackAdd("proj-1", "user-1", "init-1");
    removeConnection("proj-1", conn);
    tracked.length = 0;
    // Second removal should be a no-op
    expect(() => removeConnection("proj-1", conn)).not.toThrow();
  });
});

describe("addConnectionWithinLimit (#748)", () => {
  const open = (projectId: string, userId: string) => {
    const conn = addConnectionWithinLimit(
      projectId,
      makeFakeWs(),
      userId,
      userId,
      async () => true,
    );
    if (conn) tracked.push({ projectId, conn });
    return conn;
  };

  it("matches the native limit and counts a person across projects", () => {
    expect(MAX_REALTIME_CONNECTIONS_PER_PERSON).toBe(5);
    for (let i = 0; i < 5; i++)
      expect(open(`proj-${i}`, "limit-user")).not.toBeNull();
    expect(open("proj-0", "limit-user")).toBeNull();
    expect(open("proj-9", "limit-user")).toBeNull();
    expect(open("proj-0", "someone-else")).not.toBeNull();
  });

  it("releases a slot exactly once, however often a socket is removed", () => {
    // All on one project, so the repeated removal reaches a set that still has members.
    const held = Array.from({ length: 5 }, () => open("proj-0", "slot-user"));
    expect(open("proj-0", "slot-user")).toBeNull();
    const [first] = held;
    if (!first) throw new Error("no connection");
    removeConnection("proj-0", first);
    removeConnection("proj-0", first);
    expect(open("proj-0", "slot-user")).not.toBeNull();
    // Only ONE slot was freed: the repeated removal did not free a second.
    expect(open("proj-0", "slot-user")).toBeNull();
  });
});
