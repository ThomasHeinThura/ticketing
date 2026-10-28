import { describe, expect, it } from "vitest";
import { generateApiKeySecret } from "../../../apps/api/src/api-key/service";
import {
  ArgonGate,
  FailureLimiter,
  looksLikeApiKey,
  VerificationOverloadedError,
} from "../../../apps/api/src/api-key/verify-guard";

describe("looksLikeApiKey (R7-03 cheap pre-check)", () => {
  it("accepts an issued key and rejects strings that cannot be one", () => {
    expect(looksLikeApiKey(generateApiKeySecret())).toBe(true);
    expect(looksLikeApiKey("tdk_short")).toBe(false);
    expect(looksLikeApiKey(`tdk_${"a".repeat(400)}`)).toBe(false);
    expect(looksLikeApiKey(`tdk_${"a".repeat(40)} ${"b".repeat(5)}`)).toBe(
      false,
    );
    expect(looksLikeApiKey(`tdk_${"é".repeat(43)}`)).toBe(false);
    expect(looksLikeApiKey("")).toBe(false);
  });
});

describe("ArgonGate", () => {
  it("bounds concurrency, queues a few and refuses the overflow at once", async () => {
    const gate = new ArgonGate(2, 1, 10);
    const a = await gate.acquire("s1");
    const b = await gate.acquire("s2");
    expect(gate.running).toBe(2);
    let queuedRan = false;
    const queued = gate.acquire("s3").then((release) => {
      queuedRan = true;
      return release;
    });
    await Promise.resolve();
    expect(gate.waiting).toBe(1);
    await expect(gate.acquire("s4")).rejects.toBeInstanceOf(
      VerificationOverloadedError,
    );
    expect(queuedRan).toBe(false);
    a();
    const c = await queued;
    expect(queuedRan).toBe(true);
    expect(gate.running).toBe(2);
    b();
    c();
    expect(gate.running).toBe(0);
    // Releasing twice is harmless.
    a();
    expect(gate.running).toBe(0);
  });

  it("caps in-flight work per selector without touching other selectors", async () => {
    const gate = new ArgonGate(10, 10, 2);
    const first = await gate.acquire("same");
    const second = await gate.acquire("same");
    await expect(gate.acquire("same")).rejects.toBeInstanceOf(
      VerificationOverloadedError,
    );
    const other = await gate.acquire("other");
    first();
    const third = await gate.acquire("same");
    for (const release of [second, other, third]) release();
    expect(gate.running).toBe(0);
  });
});

describe("FailureLimiter", () => {
  it("locks an address after the allowed failures, doubles on repeat, and forgives a refund", () => {
    let now = 1_000_000;
    const limiter = new FailureLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      baseLockoutMs: 60_000,
      maxLockoutMs: 240_000,
      now: () => now,
    });
    for (let i = 0; i < 3; i += 1) expect(limiter.reserve("1.1.1.1")).toBe(0);
    expect(limiter.blockedFor("1.1.1.1")).toBe(0);
    expect(limiter.reserve("1.1.1.1")).toBe(60);
    expect(limiter.blockedFor("1.1.1.1")).toBe(60);
    // Another address is untouched.
    expect(limiter.blockedFor("2.2.2.2")).toBe(0);
    now += 61_000;
    expect(limiter.blockedFor("1.1.1.1")).toBe(0);
    for (let i = 0; i < 3; i += 1) limiter.reserve("1.1.1.1");
    expect(limiter.reserve("1.1.1.1")).toBe(120);
    // A valid attempt is refunded, so a busy legitimate client never accumulates.
    const good = new FailureLimiter({ maxFailures: 2, now: () => now });
    for (let i = 0; i < 20; i += 1) {
      good.reserve("3.3.3.3");
      good.refund("3.3.3.3");
    }
    expect(good.blockedFor("3.3.3.3")).toBe(0);
  });
});
