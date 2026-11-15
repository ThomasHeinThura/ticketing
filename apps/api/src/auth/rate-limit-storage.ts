import { createHash } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import {
  logTaskDesk,
  setAuthRateLimitUnshared,
} from "../instance/observability/runtime";
import { getRedisPub, isRedisConfigured } from "../redis";

type BetterAuthRateLimitStorage = NonNullable<
  NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]
>;

export type AuthRateLimitScope = "agent" | "customer" | "invite";

export type AuthRateLimitRule = {
  window: number;
  max: number;
};

export type AuthRateLimitDecision = {
  allowed: boolean;
  retryAfter: number | null;
};

export const UNSHARED_AUTH_RATE_LIMIT_WARNING =
  "[auth] WARNING: Shared Valkey storage is not active for auth rate limiting; enforcing per-replica in-memory limits. Multi-replica deployments require TASKDESK_VALKEY_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES.";

const DEFAULT_MAX_MEMORY_ENTRIES = 100_000;

/**
 * Atomically increments the counter for `KEYS[1]`, sets or heals its millisecond TTL when created
 * or missing, and returns `{ count, pttlMs }` in a single round-trip. Denied requests above `max`
 * do not reset the TTL, preventing flood traffic from extending lockout indefinitely.
 */
const VALKEY_CONSUME_LUA = `
local n = redis.call('INCR', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
if n == 1 or pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return { n, pttl }
`;

type MemoryBucket = {
  count: number;
  expiresAt: number;
};

export type ValkeyEvalClient = {
  eval(
    script: string,
    numKeys: number,
    key: string,
    windowMs: number,
  ): Promise<unknown>;
};

export type AuthRateLimitCoordinatorDependencies = {
  isDistributedConfigured?: () => boolean;
  getDistributedClient?: () => ValkeyEvalClient;
  setUnsharedMetric?: (unshared: boolean) => void;
  emitWarning?: () => void;
  now?: () => number;
  maxMemoryEntries?: number;
  distributedTimeoutMs?: number;
};

export type AuthRateLimitCoordinator = {
  initialize(): void;
  resetWarningForTest(): void;
  storageFor(scope: AuthRateLimitScope): BetterAuthRateLimitStorage;
  consume(
    scope: AuthRateLimitScope,
    key: string,
    rule: AuthRateLimitRule,
  ): Promise<AuthRateLimitDecision>;
};

export function digestAuthRateLimitKey(
  scope: AuthRateLimitScope,
  key: string,
  rule: AuthRateLimitRule,
): string {
  const hash = createHash("sha256").update(
    "taskdesk:auth-rate-limit:v1\0",
    "utf8",
  );
  for (const part of [scope, String(rule.window), String(rule.max), key]) {
    const bytes = Buffer.from(part, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function defaultEmitWarning(): void {
  logTaskDesk({
    module: "auth",
    message: "auth.rate_limit_unshared",
    level: "warn",
    result: "degraded",
  });
  console.warn(UNSHARED_AUTH_RATE_LIMIT_WARNING);
}

export function createAuthRateLimitCoordinator(
  dependencies: AuthRateLimitCoordinatorDependencies = {},
): AuthRateLimitCoordinator {
  const isDistributedConfigured =
    dependencies.isDistributedConfigured ?? isRedisConfigured;
  const getDistributedClient =
    dependencies.getDistributedClient ??
    (() => getRedisPub() as unknown as ValkeyEvalClient);
  const setUnsharedMetric =
    dependencies.setUnsharedMetric ?? setAuthRateLimitUnshared;
  const emitWarning = dependencies.emitWarning ?? defaultEmitWarning;
  const nowFn = dependencies.now ?? Date.now;
  const maxMemoryEntries =
    dependencies.maxMemoryEntries ?? DEFAULT_MAX_MEMORY_ENTRIES;

  const memory = new Map<string, MemoryBucket>();
  let unsharedWarned = false;

  function markShared(): void {
    setUnsharedMetric(false);
  }

  function markUnshared(): void {
    setUnsharedMetric(true);
    if (!unsharedWarned) {
      unsharedWarned = true;
      emitWarning();
    }
  }

  function pruneMemory(now: number): void {
    if (memory.size < maxMemoryEntries) return;
    for (const [candidate, entry] of memory) {
      if (now >= entry.expiresAt) memory.delete(candidate);
    }
  }

  function consumeMemory(
    digest: string,
    windowMs: number,
    max: number,
    now: number,
  ): AuthRateLimitDecision {
    const current = memory.get(digest);
    if (!current || now >= current.expiresAt) {
      pruneMemory(now);
      if (memory.size >= maxMemoryEntries) {
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil(windowMs / 1000)),
        };
      }
      memory.set(digest, { count: 1, expiresAt: now + windowMs });
      return { allowed: true, retryAfter: null };
    }
    if (current.count >= max) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((current.expiresAt - now) / 1000)),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfter: null };
  }

  async function consumeDistributed(
    digest: string,
    windowMs: number,
    max: number,
  ): Promise<AuthRateLimitDecision> {
    const valkeyKey = `taskdesk:auth-rate-limit:v1:${digest}`;
    const evaluation = getDistributedClient().eval(
      VALKEY_CONSUME_LUA,
      1,
      valkeyKey,
      windowMs,
    );
    void evaluation.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw: unknown;
    try {
      raw = await Promise.race([
        evaluation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Valkey rate-limit timeout")),
            dependencies.distributedTimeoutMs ?? 500,
          );
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(raw) || raw.length < 2) {
      throw new Error("Unexpected Valkey rate-limit response");
    }
    const count = Number(raw[0]);
    const pttlMs = Number(raw[1]);
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error("Invalid Valkey rate-limit counter");
    }
    if (count <= max) {
      return { allowed: true, retryAfter: null };
    }
    const remainingMs =
      Number.isFinite(pttlMs) && pttlMs > 0 ? pttlMs : windowMs;
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  async function consume(
    scope: AuthRateLimitScope,
    key: string,
    rule: AuthRateLimitRule,
  ): Promise<AuthRateLimitDecision> {
    if (
      !Number.isFinite(rule.window) ||
      rule.window <= 0 ||
      !Number.isFinite(rule.max) ||
      rule.max < 1
    ) {
      return { allowed: false, retryAfter: 60 };
    }
    const windowMs = Math.max(1, Math.ceil(rule.window * 1000));
    const digest = digestAuthRateLimitKey(scope, key, rule);

    if (isDistributedConfigured()) {
      try {
        const decision = await consumeDistributed(digest, windowMs, rule.max);
        markShared();
        return decision;
      } catch {
        // `operations-and-distribution.md` / `feature-contracts-p4.md`: losing Valkey degrades
        // rate limiting to bounded in-memory per replica without breaking break-glass login,
        // while raising the unshared metric and emitting the one-time prominent warning.
        markUnshared();
        return consumeMemory(digest, windowMs, rule.max, nowFn());
      }
    }

    markUnshared();
    return consumeMemory(digest, windowMs, rule.max, nowFn());
  }

  return {
    resetWarningForTest() {
      unsharedWarned = false;
    },
    initialize() {
      if (isDistributedConfigured()) {
        markShared();
      } else {
        markUnshared();
      }
    },
    storageFor(scope) {
      return {
        consume: (key: string, rule: AuthRateLimitRule) =>
          consume(scope, key, rule),
      };
    },
    consume,
  };
}

const defaultAuthRateLimitCoordinator = createAuthRateLimitCoordinator();

export function initializeAuthRateLimitMode(): void {
  defaultAuthRateLimitCoordinator.initialize();
}

export function createAuthRateLimitStorage(
  portal: "agent" | "customer",
): BetterAuthRateLimitStorage {
  return defaultAuthRateLimitCoordinator.storageFor(portal);
}

export function consumeSharedAuthRateLimit(
  scope: AuthRateLimitScope,
  key: string,
  rule: AuthRateLimitRule,
): Promise<AuthRateLimitDecision> {
  return defaultAuthRateLimitCoordinator.consume(scope, key, rule);
}

export function resetAuthRateLimitWarningForTest(): void {
  defaultAuthRateLimitCoordinator.resetWarningForTest();
}
