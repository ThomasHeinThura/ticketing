import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addNativeConnection,
  reauthorizeNativeConnection,
  removeNativeConnection,
} from "../../../apps/api/src/ws/native-work-item-realtime";

function mockSocket() {
  const closes: Array<[number | undefined, string | undefined]> = [];
  return {
    closes,
    ws: {
      send: vi.fn(),
      close: (code?: number, reason?: string) => closes.push([code, reason]),
    } as never,
  };
}

describe("native realtime session re-authorization", () => {
  const connections: NonNullable<ReturnType<typeof addNativeConnection>>[] = [];

  afterEach(() => {
    for (const connection of connections.splice(0)) {
      removeNativeConnection(connection);
    }
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
