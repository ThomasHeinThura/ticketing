import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredAgentOrigin,
  reloadAuthConfiguration,
  startAuthConfigRuntime,
  stopAuthConfigRuntime,
} from "../../apps/api/src/auth";
import { ACCOUNT_THROTTLE_RULE } from "../../apps/api/src/auth/account-throttle";
import {
  resetAuthRateLimitWarningForTest,
  UNSHARED_AUTH_RATE_LIMIT_WARNING,
} from "../../apps/api/src/auth/rate-limit-storage";
import { createApp } from "../../apps/api/src/index";
import { renderObservabilityMetrics } from "../../apps/api/src/instance/observability/runtime";
import * as redisModule from "../../apps/api/src/redis";
import { resetTestDatabase } from "./helpers/database";

describe("P-14 HTTP auth rate limiting, reload persistence, and Valkey shared backing", () => {
  const originalValkeyUrl = process.env.TASKDESK_VALKEY_URL;

  beforeEach(async () => {
    await resetTestDatabase();
    if (originalValkeyUrl === undefined) {
      delete process.env.TASKDESK_VALKEY_URL;
    } else {
      process.env.TASKDESK_VALKEY_URL = originalValkeyUrl;
    }
  });

  afterEach(() => {
    stopAuthConfigRuntime();
    vi.restoreAllMocks();
    if (originalValkeyUrl === undefined) {
      delete process.env.TASKDESK_VALKEY_URL;
    } else {
      process.env.TASKDESK_VALKEY_URL = originalValkeyUrl;
    }
  });

  it("enforces Better Auth sign-in rate limits across reloadAuthConfiguration() and exposes taskdesk_auth_rate_limit_unshared=1 without Valkey", async () => {
    delete process.env.TASKDESK_VALKEY_URL;
    const warnSpy = vi.spyOn(console, "warn");
    resetAuthRateLimitWarningForTest();

    await startAuthConfigRuntime();
    const { app } = createApp();
    const agentOrigin = getConfiguredAgentOrigin();
    const pinnedIp = "198.51.100.211";

    const sendSignIn = () =>
      app.request(`${agentOrigin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          origin: agentOrigin,
          "content-type": "application/json",
          "x-forwarded-for": pinnedIp,
        },
        body: JSON.stringify({
          email: "nobody@example.com",
          password: "wrong-password-12345",
        }),
      });

    expect((await sendSignIn()).status).toBe(401);
    expect((await sendSignIn()).status).toBe(401);

    // Reloading auth configuration mid-window must preserve existing rate-limit buckets.
    await reloadAuthConfiguration();

    expect((await sendSignIn()).status).toBe(401);
    const fourth = await sendSignIn();
    expect(fourth.status).toBe(429);
    expect(Number(fourth.headers.get("x-retry-after"))).toBeGreaterThanOrEqual(
      1,
    );

    const exposition = await renderObservabilityMetrics();
    expect(exposition).toContain("taskdesk_auth_rate_limit_unshared 1");

    const authWarnings = warnSpy.mock.calls.filter(
      (args) => args[0] === UNSHARED_AUTH_RATE_LIMIT_WARNING,
    );
    expect(authWarnings.length).toBe(1);
  });

  it("uses shared Valkey atomic storage across requests and flips taskdesk_auth_rate_limit_unshared to 0 when Valkey is configured", async () => {
    process.env.TASKDESK_VALKEY_URL = "redis://127.0.0.1:6379";

    const valkeyBuckets = new Map<
      string,
      { count: number; expiresAt: number }
    >();
    const evalSpy = vi.fn(
      async (
        _script: string,
        _numKeys: number,
        key: string,
        windowMs: number,
      ) => {
        const now = Date.now();
        const existing = valkeyBuckets.get(key);
        if (!existing || now >= existing.expiresAt) {
          valkeyBuckets.set(key, { count: 1, expiresAt: now + windowMs });
          return [1, windowMs];
        }
        existing.count += 1;
        return [existing.count, Math.max(1, existing.expiresAt - now)];
      },
    );

    vi.spyOn(redisModule, "getRedisPub").mockReturnValue({
      eval: evalSpy,
    } as unknown as redisModule.RedisClient);

    await startAuthConfigRuntime();
    const { app } = createApp();
    const agentOrigin = getConfiguredAgentOrigin();
    const pinnedIp = "198.51.100.212";

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await app.request(
        `${agentOrigin}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            origin: agentOrigin,
            "content-type": "application/json",
            "x-forwarded-for": pinnedIp,
          },
          body: JSON.stringify({
            email: "nobody@example.com",
            password: "wrong-password-12345",
          }),
        },
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([401, 401, 401, 429]);
    // The per-IP limiter makes one atomic call per request. The account throttle shares the store
    // with a 15-minute window: two calls (email+IP, email) for each of the three attempts that
    // reach the sign-in handler; the fourth is refused by the per-IP limiter first.
    const accountWindowMs = ACCOUNT_THROTTLE_RULE.window * 1000;
    const windows = evalSpy.mock.calls.map((call) => call[3]);
    expect(windows.filter((w) => w !== accountWindowMs)).toHaveLength(4);
    expect(windows.filter((w) => w === accountWindowMs)).toHaveLength(6);

    for (const key of valkeyBuckets.keys()) {
      expect(key).toMatch(/^taskdesk:auth-rate-limit:v1:[0-9a-f]{64}$/);
      expect(key).not.toContain(pinnedIp);
    }

    const exposition = await renderObservabilityMetrics();
    expect(exposition).toContain("taskdesk_auth_rate_limit_unshared 0");
  });
});
