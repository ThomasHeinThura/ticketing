import { describe, expect, it } from "vitest";
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
});
