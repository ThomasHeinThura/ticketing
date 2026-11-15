import { describe, expect, it, vi } from "vitest";
import {
  createAuthRateLimitCoordinator,
  type ValkeyEvalClient,
} from "../../../apps/api/src/auth/rate-limit-storage";
import { createTaskDeskMetrics } from "../../../apps/api/src/observability/metrics";

/**
 * Faithful fake of the single-key atomic Valkey `INCR` + `PTTL` + `PEXPIRE` Lua script used by
 * `apps/api/src/auth/rate-limit-storage.ts`, shared across simulated API replicas.
 */
function createFakeValkey(now: () => number) {
  const store = new Map<string, { count: number; expiresAt: number }>();
  let shouldFail = false;

  const client: ValkeyEvalClient = {
    async eval(_script, numKeys, key, windowMs) {
      expect(numKeys).toBe(1);
      if (shouldFail) {
        throw new Error("ECONNREFUSED simulated Valkey outage");
      }
      const currentNow = now();
      const existing = store.get(key);
      if (!existing || currentNow >= existing.expiresAt) {
        store.set(key, { count: 1, expiresAt: currentNow + windowMs });
        return [1, windowMs];
      }
      existing.count += 1;
      const pttl = Math.max(1, existing.expiresAt - currentNow);
      return [existing.count, pttl];
    },
  };

  return {
    client,
    keys: () => [...store.keys()],
    setDown: (down: boolean) => {
      shouldFail = down;
    },
  };
}

describe("P-14 shared auth rate-limit storage and unshared warning/metric", () => {
  it("shares rate-limit counters and window TTL across replicas via Valkey without storing raw IPs", async () => {
    let clock = 1_700_000_000_000;
    const valkey = createFakeValkey(() => clock);
    const metricsA = createTaskDeskMetrics([]);
    const metricsB = createTaskDeskMetrics([]);
    const warnA = vi.fn();
    const warnB = vi.fn();

    const replicaA = createAuthRateLimitCoordinator({
      isDistributedConfigured: () => true,
      getDistributedClient: () => valkey.client,
      setUnsharedMetric: (unshared) =>
        metricsA.setAuthRateLimitUnshared(unshared),
      emitWarning: warnA,
      now: () => clock,
    });
    const replicaB = createAuthRateLimitCoordinator({
      isDistributedConfigured: () => true,
      getDistributedClient: () => valkey.client,
      setUnsharedMetric: (unshared) =>
        metricsB.setAuthRateLimitUnshared(unshared),
      emitWarning: warnB,
      now: () => clock,
    });

    replicaA.initialize();
    replicaB.initialize();

    const signInKey = "198.51.100.42|/sign-in/email";
    const rule = { window: 10, max: 3 };

    expect(await replicaA.storageFor("agent").consume(signInKey, rule)).toEqual(
      { allowed: true, retryAfter: null },
    );
    clock += 2_000;
    expect(await replicaB.storageFor("agent").consume(signInKey, rule)).toEqual(
      { allowed: true, retryAfter: null },
    );
    clock += 1_000;
    expect(await replicaA.storageFor("agent").consume(signInKey, rule)).toEqual(
      { allowed: true, retryAfter: null },
    );

    // 4th attempt on replica B hits the shared Valkey ceiling with 7s remaining on the 10s window.
    expect(await replicaB.storageFor("agent").consume(signInKey, rule)).toEqual(
      { allowed: false, retryAfter: 7 },
    );

    // Denied flood traffic does not extend the window.
    clock += 4_000;
    expect(await replicaA.storageFor("agent").consume(signInKey, rule)).toEqual(
      { allowed: false, retryAfter: 3 },
    );

    // Customer portal traffic from the same NAT IP does not collide with the agent host bucket.
    expect(
      await replicaA.storageFor("customer").consume(signInKey, rule),
    ).toEqual({ allowed: true, retryAfter: null });

    // Once the 10s window expires, requests are admitted again.
    clock += 3_001;
    expect(await replicaB.storageFor("agent").consume(signInKey, rule)).toEqual(
      { allowed: true, retryAfter: null },
    );

    // Raw IP and route path never appear in Valkey keys.
    for (const storedKey of valkey.keys()) {
      expect(storedKey).toMatch(/^taskdesk:auth-rate-limit:v1:[0-9a-f]{64}$/);
      expect(storedKey).not.toContain("198.51.100.42");
      expect(storedKey).not.toContain("sign-in");
    }

    expect(warnA).not.toHaveBeenCalled();
    expect(warnB).not.toHaveBeenCalled();
    expect(await metricsA.metrics()).toContain(
      "taskdesk_auth_rate_limit_unshared 0",
    );
    expect(await metricsB.metrics()).toContain(
      "taskdesk_auth_rate_limit_unshared 0",
    );
  });

  it("emits a single prominent warning, sets the unshared metric to 1, and enforces bounded per-replica windows when Valkey is unconfigured", async () => {
    let clock = 1_700_000_000_000;
    const metrics = createTaskDeskMetrics([]);
    const emitWarning = vi.fn();

    const coordinator = createAuthRateLimitCoordinator({
      isDistributedConfigured: () => false,
      setUnsharedMetric: (unshared) =>
        metrics.setAuthRateLimitUnshared(unshared),
      emitWarning,
      now: () => clock,
      maxMemoryEntries: 2,
    });

    coordinator.initialize();
    coordinator.initialize();
    expect(emitWarning).toHaveBeenCalledTimes(1);
    expect(await metrics.metrics()).toContain(
      "taskdesk_auth_rate_limit_unshared 1",
    );

    const storage = coordinator.storageFor("agent");
    const rule = { window: 60, max: 2 };

    expect(await storage.consume("198.51.100.10|/sign-up/email", rule)).toEqual(
      { allowed: true, retryAfter: null },
    );
    clock += 15_000;
    expect(await storage.consume("198.51.100.10|/sign-up/email", rule)).toEqual(
      { allowed: true, retryAfter: null },
    );
    expect(await storage.consume("198.51.100.10|/sign-up/email", rule)).toEqual(
      { allowed: false, retryAfter: 45 },
    );

    // At capacity new keys are denied without evicting a live blocked bucket.
    expect(await storage.consume("198.51.100.11|/sign-up/email", rule)).toEqual(
      { allowed: true, retryAfter: null },
    );
    expect(await storage.consume("198.51.100.12|/sign-up/email", rule)).toEqual(
      { allowed: false, retryAfter: 60 },
    );

    // Still only one warning across initialization and all requests.
    expect(emitWarning).toHaveBeenCalledTimes(1);
  });

  it("keeps a blocked victim at capacity despite repeated new keys and admits keys after expiry", async () => {
    let now = 0;
    const coordinator = createAuthRateLimitCoordinator({
      isDistributedConfigured: () => false,
      emitWarning: vi.fn(),
      setUnsharedMetric: vi.fn(),
      maxMemoryEntries: 2,
      now: () => now,
    });
    const rule = { window: 10, max: 1 };
    expect((await coordinator.consume("agent", "victim", rule)).allowed).toBe(
      true,
    );
    expect((await coordinator.consume("agent", "victim", rule)).allowed).toBe(
      false,
    );
    expect((await coordinator.consume("agent", "other", rule)).allowed).toBe(
      true,
    );
    for (const key of ["new1", "new2", "new3"]) {
      const decision = await coordinator.consume("agent", key, rule);
      expect(decision.allowed).toBe(false);
      expect(decision.retryAfter).toBeGreaterThanOrEqual(1);
      expect((await coordinator.consume("agent", "victim", rule)).allowed).toBe(
        false,
      );
    }
    now = 10_001;
    expect((await coordinator.consume("agent", "new1", rule)).allowed).toBe(
      true,
    );
  });

  it.each([false, true])(
    "times out a hung eval and handles late rejection (%s)",
    async (lateReject) => {
      const metrics = createTaskDeskMetrics([]);
      const emitWarning = vi.fn();
      let rejectEval: ((error: Error) => void) | undefined;
      const evaluation = new Promise<unknown>((_, reject) => {
        rejectEval = reject;
      });
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const coordinator = createAuthRateLimitCoordinator({
          isDistributedConfigured: () => true,
          getDistributedClient: () => ({ eval: () => evaluation }),
          distributedTimeoutMs: 10,
          emitWarning,
          setUnsharedMetric: (value) => metrics.setAuthRateLimitUnshared(value),
        });
        const started = Date.now();
        expect(
          await coordinator.consume("agent", "victim", { window: 10, max: 1 }),
        ).toEqual({ allowed: true, retryAfter: null });
        expect(Date.now() - started).toBeLessThan(500);
        if (lateReject) rejectEval?.(new Error("late eval failure"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(
          (await coordinator.consume("agent", "victim", { window: 10, max: 1 }))
            .allowed,
        ).toBe(false);
        expect(await metrics.metrics()).toContain(
          "taskdesk_auth_rate_limit_unshared 1",
        );
        expect(emitWarning).toHaveBeenCalledTimes(1);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    },
  );

  it("degrades safely to per-replica memory with metric=1 and one-time warning during a Valkey outage, then clears metric=0 on recovery", async () => {
    let clock = 1_700_000_000_000;
    const valkey = createFakeValkey(() => clock);
    const metrics = createTaskDeskMetrics([]);
    const emitWarning = vi.fn();

    const coordinator = createAuthRateLimitCoordinator({
      isDistributedConfigured: () => true,
      getDistributedClient: () => valkey.client,
      setUnsharedMetric: (unshared) =>
        metrics.setAuthRateLimitUnshared(unshared),
      emitWarning,
      now: () => clock,
    });

    coordinator.initialize();
    expect(await metrics.metrics()).toContain(
      "taskdesk_auth_rate_limit_unshared 0",
    );
    expect(emitWarning).toHaveBeenCalledTimes(0);

    valkey.setDown(true);
    const storage = coordinator.storageFor("agent");
    const rule = { window: 10, max: 2 };

    expect(await storage.consume("198.51.100.77|/sign-in/email", rule)).toEqual(
      { allowed: true, retryAfter: null },
    );
    expect(await storage.consume("198.51.100.77|/sign-in/email", rule)).toEqual(
      { allowed: true, retryAfter: null },
    );
    expect(await storage.consume("198.51.100.77|/sign-in/email", rule)).toEqual(
      { allowed: false, retryAfter: 10 },
    );

    expect(emitWarning).toHaveBeenCalledTimes(1);
    expect(await metrics.metrics()).toContain(
      "taskdesk_auth_rate_limit_unshared 1",
    );

    // Once Valkey recovers, the unshared gauge returns to 0.
    valkey.setDown(false);
    clock += 11_000;
    expect(await storage.consume("198.51.100.77|/sign-in/email", rule)).toEqual(
      { allowed: true, retryAfter: null },
    );
    expect(await metrics.metrics()).toContain(
      "taskdesk_auth_rate_limit_unshared 0",
    );
    expect(emitWarning).toHaveBeenCalledTimes(1);
  });
});
