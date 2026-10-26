import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { clientIpForContext } from "../api-key/enforce";
import db, { schema } from "../database";
import { logTaskDesk } from "../instance/observability/runtime";
import { getRedisPub, isRedisConfigured } from "../redis";

export type AnonymousRateLimitConfig = {
  windowMs: number;
  max: number;
};

type Bucket = { window: string; count: number };
const MAX_MEMORY_KEYS = 10_000;
const memoryBuckets = new Map<string, Bucket>();
let memoryFallbackWarned = false;
let distributedFailureWarned = false;

function validConfig(value: AnonymousRateLimitConfig): boolean {
  return (
    Number.isSafeInteger(value.windowMs) &&
    value.windowMs >= 60_000 &&
    value.windowMs <= 86_400_000 &&
    Number.isSafeInteger(value.max) &&
    value.max >= 1 &&
    value.max <= 10_000
  );
}

function hashedClientKey(ip: string | null): string {
  return createHash("sha256")
    .update(ip ?? "no-trusted-client-ip", "utf8")
    .digest("hex");
}

function consumeMemory(
  key: string,
  config: AnonymousRateLimitConfig,
  now: number,
) {
  const window = `${config.windowMs}:${Math.floor(now / config.windowMs)}`;
  const current = memoryBuckets.get(key);
  if (current?.window === window) {
    if (current.count >= config.max) return false;
    current.count += 1;
    return true;
  }

  if (memoryBuckets.size >= MAX_MEMORY_KEYS) {
    for (const [candidate, bucket] of memoryBuckets) {
      if (bucket.window !== window) memoryBuckets.delete(candidate);
    }
    if (memoryBuckets.size >= MAX_MEMORY_KEYS) return false;
  }
  memoryBuckets.set(key, { window, count: 1 });
  return true;
}

async function consumeDistributed(
  key: string,
  config: AnonymousRateLimitConfig,
  now: number,
): Promise<boolean> {
  const window = Math.floor(now / config.windowMs);
  const counterKey = `taskdesk:anonymous-rate:${config.windowMs}:${window}:${key}`;
  const count = Number(
    await getRedisPub().eval(
      "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return n",
      1,
      counterKey,
      config.windowMs,
    ),
  );
  return Number.isSafeInteger(count) && count <= config.max;
}

/**
 * CP-26/IP-29 anonymous-class limit for the one typed-domain endpoint. The limit is
 * instance-configured; configured Valkey failures fail closed, while a single-instance
 * deployment uses a bounded in-memory fallback keyed only by trusted client IP digest.
 */
export async function consumeHomeRealmRateLimit(
  context: Context,
  dependencies: {
    readConfig?: () => Promise<AnonymousRateLimitConfig>;
    clientIp?: (context: Context) => string | null;
    distributedConfigured?: () => boolean;
    consumeDistributed?: (
      key: string,
      config: AnonymousRateLimitConfig,
      now: number,
    ) => Promise<boolean>;
    now?: () => number;
  } = {},
): Promise<boolean> {
  const readConfig =
    dependencies.readConfig ??
    (async () => {
      const [row] = await db
        .select({
          windowMs: schema.instanceSettingTable.anonymousRateLimitWindowMs,
          max: schema.instanceSettingTable.anonymousRateLimitMax,
        })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton"))
        .limit(1);
      if (!row) throw new Error("Anonymous rate limit settings unavailable");
      return { windowMs: row.windowMs, max: row.max };
    });

  let config: AnonymousRateLimitConfig;
  try {
    config = await readConfig();
  } catch {
    return false;
  }
  if (!validConfig(config)) return false;

  const ip = (dependencies.clientIp ?? clientIpForContext)(context);
  const key = hashedClientKey(ip);
  const now = (dependencies.now ?? Date.now)();
  const distributedConfigured =
    dependencies.distributedConfigured ?? isRedisConfigured;
  if (distributedConfigured()) {
    try {
      return await (dependencies.consumeDistributed ?? consumeDistributed)(
        key,
        config,
        now,
      );
    } catch {
      if (!distributedFailureWarned) {
        distributedFailureWarned = true;
        logTaskDesk({
          module: "auth",
          message: "auth.failure",
          level: "error",
          result: "failed",
        });
      }
      return false;
    }
  }

  if (!memoryFallbackWarned) {
    memoryFallbackWarned = true;
    logTaskDesk({
      module: "auth",
      message: "auth.failure",
      level: "warn",
      result: "degraded",
    });
  }
  return consumeMemory(key, config, now);
}
