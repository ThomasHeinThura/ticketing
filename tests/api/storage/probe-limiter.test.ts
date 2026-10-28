import { describe, expect, it } from "vitest";
import { StorageProbeLimiter } from "../../../apps/api/src/instance/storage/probe-limiter";

describe("storage probe limiter", () => {
  it("allows one in-flight probe and enforces an identity cooldown", () => {
    const limiter = new StorageProbeLimiter({ cooldownMs: 30_000 });
    const first = limiter.acquire("admin-a", 1_000);
    expect(first).toHaveProperty("release");
    expect(limiter.acquire("admin-b", 1_001)).toEqual({
      retryAfterSeconds: 30,
    });
    if ("release" in first) first.release();
    expect(limiter.acquire("admin-a", 1_002)).toEqual({
      retryAfterSeconds: 30,
    });
    const afterCooldown = limiter.acquire("admin-a", 31_000);
    expect(afterCooldown).toHaveProperty("release");
    if ("release" in afterCooldown) afterCooldown.release();
  });

  it("bounds remembered identities and evicts expired entries", () => {
    const limiter = new StorageProbeLimiter({
      cooldownMs: 1,
      entryTtlMs: 10,
      maxEntries: 2,
    });
    const first = limiter.acquire("admin-a", 0);
    if ("release" in first) first.release();
    const second = limiter.acquire("admin-b", 2);
    if ("release" in second) second.release();
    expect(limiter.size).toBe(2);
    expect(limiter.acquire("admin-c", 3)).toEqual({ retryAfterSeconds: 1 });
    const third = limiter.acquire("admin-c", 12);
    expect(third).toHaveProperty("release");
    expect(limiter.size).toBeLessThanOrEqual(2);
    if ("release" in third) third.release();
  });
});
