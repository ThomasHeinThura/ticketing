import { afterEach, describe, expect, it, vi } from "vitest";
import { createLegacyConnectionAuthorization } from "../../../apps/api/src/ws/legacy-connection-authorization";

type SocketContext = Parameters<typeof createLegacyConnectionAuthorization>[0];

function socket() {
  return { send: vi.fn(), close: vi.fn() };
}

afterEach(() => vi.useRealTimers());

describe("legacy socket live authority", () => {
  it("does not send an event after access is revoked and never revives that socket", async () => {
    const ws = socket();
    const remove = vi.fn();
    let allowed = true;
    const connection = createLegacyConnectionAuthorization(
      ws as unknown as SocketContext,
      async () => allowed,
      remove,
    );
    await connection.check("reachable");
    expect(ws.send).toHaveBeenCalledWith("reachable");
    allowed = false;
    await connection.check("private-after-revocation");
    allowed = true;
    await connection.check("private-after-restoration");
    expect(ws.send.mock.calls).toEqual([["reachable"]]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("closes an idle socket on the 60-second reauthorization floor", async () => {
    vi.useFakeTimers();
    const ws = socket();
    const remove = vi.fn();
    createLegacyConnectionAuthorization(
      ws as unknown as SocketContext,
      async () => false,
      remove,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(ws.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed when the authority lookup fails", async () => {
    const ws = socket();
    const remove = vi.fn();
    const connection = createLegacyConnectionAuthorization(
      ws as unknown as SocketContext,
      async () => {
        throw new Error("database unavailable");
      },
      remove,
    );
    await expect(connection.check("private")).resolves.toBeUndefined();
    expect(ws.send).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("does not leak an in-flight event after the client has disconnected", async () => {
    let release: (value: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const ws = socket();
    const connection = createLegacyConnectionAuthorization(
      ws as unknown as SocketContext,
      () => pending,
      vi.fn(),
    );
    const delivering = connection.check("private");
    await Promise.resolve();
    connection.dispose();
    release(true);
    await delivering;
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("orders event authorization and discards queued events after revocation", async () => {
    let release: (value: boolean) => void = () => {};
    const firstLookup = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const authorize = vi
      .fn()
      .mockReturnValueOnce(firstLookup)
      .mockResolvedValue(false);
    const ws = socket();
    const connection = createLegacyConnectionAuthorization(
      ws as unknown as SocketContext,
      authorize,
      vi.fn(),
    );
    const first = connection.check("first");
    const revoked = connection.check("second");
    const queued = connection.check("third");
    await Promise.resolve();
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(ws.send).not.toHaveBeenCalled();
    release(true);
    await Promise.all([first, revoked, queued]);
    expect(ws.send.mock.calls).toEqual([["first"]]);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("fails closed when stalled authorization exhausts the bounded event queue", async () => {
    let release: (value: boolean) => void = () => {};
    const lookup = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const ws = socket();
    const remove = vi.fn();
    const connection = createLegacyConnectionAuthorization(
      ws as unknown as SocketContext,
      () => lookup,
      remove,
    );
    const checks = [connection.check("in-flight")];
    await Promise.resolve();
    for (let i = 0; i < 64; i += 1)
      checks.push(connection.check("queued-private"));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(ws.close).toHaveBeenCalledTimes(1);
    release(true);
    await Promise.all(checks);
    expect(ws.send).not.toHaveBeenCalled();
  });
});
