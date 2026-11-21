import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { getDatabasePool } from "../../../apps/api/src/database";

describe("database pool error handling", () => {
  it("has an error listener, so an idle-client error does not crash the process", () => {
    const pool = getDatabasePool();

    expect(pool.listenerCount("error")).toBeGreaterThan(0);

    // node-postgres emits "error" on the pool when a pooled idle client dies
    // server-side. An EventEmitter with no listener THROWS on that event,
    // which is exactly the crash this handler exists to prevent — so the
    // real, non-vacuous assertion is that emitting one here does not throw.
    expect(() => {
      pool.emit("error", new Error("simulated idle client failure"));
    }).not.toThrow();
  });

  it("a checked-out client's error is logged, not thrown", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new EventEmitter();
    // pg's own pool emits "connect" for every new client; the pool's idle listener never covers a
    // checked-out one, so without this handler its socket failure would crash the process.
    getDatabasePool().emit("connect", client);
    expect(() => client.emit("error", new Error("socket reset"))).not.toThrow();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
