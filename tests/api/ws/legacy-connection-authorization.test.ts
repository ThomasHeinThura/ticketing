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

  describe("reusing a passing lookup for event deliveries (#748)", () => {
    it("never reuses by default", async () => {
      const ws = socket();
      const authorize = vi.fn(async () => true);
      const connection = createLegacyConnectionAuthorization(
        ws as unknown as SocketContext,
        authorize,
        vi.fn(),
      );
      await Promise.all([connection.check("a"), connection.check("b")]);
      expect(authorize).toHaveBeenCalledTimes(2);
      connection.dispose();
    });

    it("answers a burst from one lookup, then looks again once the window has passed", async () => {
      vi.useFakeTimers();
      const ws = socket();
      const authorize = vi.fn(async () => true);
      const connection = createLegacyConnectionAuthorization(
        ws as unknown as SocketContext,
        authorize,
        vi.fn(),
        1_500,
      );
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => connection.check(`e${i}`)),
      );
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(ws.send).toHaveBeenCalledTimes(20);
      await vi.advanceTimersByTimeAsync(1_499);
      await connection.check("still-reused");
      expect(authorize).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      await connection.check("after-window");
      expect(authorize).toHaveBeenCalledTimes(2);
      connection.dispose();
    });

    it("closes on the first delivery after the window when access was lost", async () => {
      vi.useFakeTimers();
      const ws = socket();
      const remove = vi.fn();
      let allowed = true;
      const connection = createLegacyConnectionAuthorization(
        ws as unknown as SocketContext,
        async () => allowed,
        remove,
        1_500,
      );
      await connection.check("before");
      allowed = false;
      await connection.check("inside-window");
      expect(ws.send.mock.calls).toEqual([["before"], ["inside-window"]]);
      await vi.advanceTimersByTimeAsync(1_501);
      await connection.check("after-window");
      expect(ws.send).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(ws.close).toHaveBeenCalledWith(1008, "authorization unavailable");
    });

    it("a fresh check always looks again, even inside the window", async () => {
      const ws = socket();
      let allowed = true;
      const authorize = vi.fn(async () => allowed);
      const remove = vi.fn();
      const connection = createLegacyConnectionAuthorization(
        ws as unknown as SocketContext,
        authorize,
        remove,
        60_000,
      );
      await connection.check("prime");
      allowed = false;
      await connection.check(undefined, { fresh: true });
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it("the 60-second floor looks again even while deliveries keep the window warm", async () => {
      vi.useFakeTimers();
      const ws = socket();
      let allowed = true;
      const authorize = vi.fn(async () => allowed);
      const remove = vi.fn();
      const connection = createLegacyConnectionAuthorization(
        ws as unknown as SocketContext,
        authorize,
        remove,
        120_000,
      );
      await connection.check("prime");
      allowed = false;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(1);
      connection.dispose();
    });

    it("a refused lookup is never reused", async () => {
      const ws = socket();
      const authorize = vi.fn(async () => false);
      const connection = createLegacyConnectionAuthorization(
        ws as unknown as SocketContext,
        authorize,
        vi.fn(),
        60_000,
      );
      await connection.check("denied");
      await connection.check("after-denial");
      expect(ws.send).not.toHaveBeenCalled();
    });
  });
});
