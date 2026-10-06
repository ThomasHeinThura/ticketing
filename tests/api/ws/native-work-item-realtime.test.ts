import { afterEach, describe, expect, it, vi } from "vitest";

const logTaskDeskMock = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/api/src/instance/observability/runtime", () => ({
  logTaskDesk: logTaskDeskMock,
}));

import {
  addNativeConnection,
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
