import { afterEach, describe, expect, it, vi } from "vitest";

const logTaskDeskMock = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/api/src/instance/observability/runtime", () => ({
  logTaskDesk: logTaskDeskMock,
}));

import {
  addNativeConnection,
  deliverNativeBroadcast,
  handleNativeAuthorizationInvalidation,
  handleNativeFrame,
  reauthorizeNativeConnection,
  removeNativeConnection,
} from "../../../apps/api/src/ws/native-work-item-realtime";

function mockSocket(send = vi.fn()) {
  const closes: Array<[number | undefined, string | undefined]> = [];
  return {
    closes,
    ws: {
      send,
      close: (code?: number, reason?: string) => closes.push([code, reason]),
    } as never,
  };
}

describe("native realtime session re-authorization", () => {
  const connections: NonNullable<ReturnType<typeof addNativeConnection>>[] = [];

  afterEach(() => {
    logTaskDeskMock.mockReset();
    for (const connection of connections.splice(0)) {
      removeNativeConnection(connection);
    }
  });

  it("excludes only the authenticated initiating window and never exposes its identity", () => {
    const sockets = [
      mockSocket(),
      mockSocket(),
      mockSocket(),
      mockSocket(),
      mockSocket(),
      mockSocket(),
    ];
    const identities = [
      ["person-1", "window-1"],
      ["person-1", "window-2"],
      ["person-2", "window-3"],
      ["person-2", "window-1"],
      ["person-1", undefined],
      ["person-1", "window-1"],
    ] as const;
    for (const [index, [userId, windowId]] of identities.entries()) {
      const socket = sockets[index];
      if (!socket) throw new Error("missing test socket");
      const connection = addNativeConnection(
        socket.ws,
        {
          userId,
          portal: "agent",
          ...(index === 5 ? { apiKeyId: "key-1" } : {}),
        },
        async () => ({ userId, portal: "agent" }),
        windowId,
      );
      if (!connection) throw new Error("connection limit unexpectedly reached");
      connections.push(connection);
      connection.topics.set("project:project-1", {
        projectId: "project-1",
        workspaceId: "workspace-1",
        customerVisible: true,
      });
    }
    const message = {
      projectId: "project-1",
      topics: ["project:project-1"],
      eventId: "event-1",
      eventType: "work_item.updated",
      at: "2026-11-12T00:00:00Z",
      key: "WI-1",
      customerVisible: true,
    };
    deliverNativeBroadcast({
      ...message,
      initiator: { userId: "person-1", windowId: "window-1" },
    });
    expect(
      sockets.map(
        ({ ws }) =>
          (ws as { send: ReturnType<typeof vi.fn> }).send.mock.calls.length,
      ),
    ).toEqual([0, 1, 1, 1, 1, 1]);
    const secondSocket = sockets[1];
    if (!secondSocket) throw new Error("missing test socket");
    const payload = JSON.stringify(
      (secondSocket.ws as { send: ReturnType<typeof vi.fn> }).send.mock.calls,
    );
    expect(payload).not.toContain("window-1");
    expect(payload).not.toContain("person-1");
    deliverNativeBroadcast(message);
    expect(
      sockets.map(
        ({ ws }) =>
          (ws as { send: ReturnType<typeof vi.fn> }).send.mock.calls.length,
      ),
    ).toEqual([1, 2, 2, 2, 2, 2]);
  });

  it("reauthenticates only the identity targeted by a control invalidation", async () => {
    const firstSocket = mockSocket();
    const secondSocket = mockSocket();
    const firstReauthenticate = vi.fn(async () => null);
    const secondReauthenticate = vi.fn(async () => ({
      userId: "person-2",
      portal: "agent" as const,
    }));
    const first = addNativeConnection(
      firstSocket.ws,
      { userId: "person-1", portal: "agent" },
      firstReauthenticate,
    );
    const second = addNativeConnection(
      secondSocket.ws,
      { userId: "person-2", portal: "agent" },
      secondReauthenticate,
    );
    if (!first || !second)
      throw new Error("native connection limit unexpectedly reached");
    connections.push(first, second);

    await handleNativeAuthorizationInvalidation({
      type: "identity.invalidate",
      userId: "person-1",
    });

    expect(firstReauthenticate).toHaveBeenCalledOnce();
    expect(secondReauthenticate).not.toHaveBeenCalled();
    expect(firstSocket.closes).toEqual([[1008, "session expired"]]);
    expect(secondSocket.closes).toEqual([]);
  });

  it("ignores malformed or untargeted private invalidation frames", async () => {
    const reauthenticate = vi.fn(async () => ({
      userId: "person-1",
      portal: "agent" as const,
    }));
    const socket = mockSocket();
    const connection = addNativeConnection(
      socket.ws,
      { userId: "person-1", portal: "agent" },
      reauthenticate,
    );
    if (!connection) throw new Error("connection limit unexpectedly reached");
    connections.push(connection);

    await handleNativeAuthorizationInvalidation({
      type: "identity.invalidate",
    });
    await handleNativeAuthorizationInvalidation({
      type: "identity.invalidate",
      userId: "person-1",
      unexpected: "private-control-data",
    });

    expect(reauthenticate).not.toHaveBeenCalled();
    expect(socket.closes).toEqual([]);
  });

  it("logs send failures through the finite event without exception contents", async () => {
    const secret = "realtime-error-secret-should-not-be-logged";
    const send = vi.fn(() => {
      throw new Error(secret);
    });
    const socket = mockSocket(send);
    const connection = addNativeConnection(
      socket.ws,
      { userId: "person-1", portal: "agent" },
      async () => ({ userId: "person-1", portal: "agent" }),
    );
    if (!connection) throw new Error("connection limit unexpectedly reached");
    connections.push(connection);

    await handleNativeFrame(connection, JSON.stringify({ type: "ping" }));

    expect(socket.closes).toEqual([[1011, "realtime delivery failed"]]);
    expect(logTaskDeskMock).toHaveBeenCalledWith({
      module: "realtime",
      message: "realtime.failure",
      level: "error",
      result: "failed",
    });
    expect(JSON.stringify(logTaskDeskMock.mock.calls)).not.toContain(secret);
  });

  it("closes the socket when its session is revoked", async () => {
    const socket = mockSocket();
    const connection = addNativeConnection(
      socket.ws,
      { userId: "person-1", portal: "agent" },
      async () => null,
    );
    if (!connection) throw new Error("connection limit unexpectedly reached");
    connections.push(connection);

    await reauthorizeNativeConnection(connection);

    expect(socket.closes).toEqual([[1008, "session expired"]]);
  });

  it("closes the socket when re-authentication changes portal identity", async () => {
    const socket = mockSocket();
    const connection = addNativeConnection(
      socket.ws,
      { userId: "person-1", portal: "agent" },
      async () => ({ userId: "person-1", portal: "customer" }),
    );
    if (!connection) throw new Error("connection limit unexpectedly reached");
    connections.push(connection);

    await reauthorizeNativeConnection(connection);

    expect(socket.closes).toEqual([[1008, "session expired"]]);
  });
});
