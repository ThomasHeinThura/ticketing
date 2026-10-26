import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import db, { schema } from "../database";
import { logTaskDesk } from "../instance/observability/runtime";
import { resolveAuthSecret } from "../utils/require-auth-secret";

export type ScimRateLimitBucket = "anonymous_scim_failure" | "scim_connection";

export type ScimRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const CLEANUP_EVERY = 128;
const CLEANUP_BATCH_SIZE = 100;
let cleanupTick = 0;

export function reportScimRateLimitUnavailable(): void {
  logTaskDesk({
    module: "database",
    message: "database.failure",
    level: "error",
    result: "failed",
  });
}

function authSecret(): string {
  const result = resolveAuthSecret(process.env.TASKDESK_AUTH_SECRET);
  if (!result.ok) throw new Error("SCIM rate limit secret unavailable");
  return result.secret;
}

/** Returns a scoped HMAC digest; raw IPs, connection ids and credentials are never persisted. */
export function scimRateLimitKeyHash(
  bucket: ScimRateLimitBucket,
  key: string,
): string {
  return createHmac("sha256", authSecret())
    .update(bucket)
    .update("\0")
    .update(key)
    .digest("hex");
}

function retryAfter(windowStartedAt: Date, windowMs: number, now = Date.now()) {
  return Math.max(
    1,
    Math.ceil((windowStartedAt.getTime() + windowMs - now) / 1000),
  );
}

type CounterRow = {
  count: number;
  window_started_at: Date | string;
  expires_at?: Date | string;
  now?: Date | string;
};

function dateValue(value: Date | string | undefined): Date {
  const parsed = value instanceof Date ? value : new Date(value ?? "");
  if (Number.isNaN(parsed.getTime()))
    throw new Error("SCIM rate limit counter unavailable");
  return parsed;
}

async function cleanupExpiredCounters(): Promise<void> {
  try {
    await db.execute(sql`
      WITH expired AS (
        SELECT bucket, key_hash
        FROM ${schema.requestRateLimitCounterTable}
        WHERE expires_at <= clock_timestamp()
        ORDER BY expires_at
        LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM ${schema.requestRateLimitCounterTable} AS counters
      USING expired
      WHERE counters.bucket = expired.bucket
        AND counters.key_hash = expired.key_hash
    `);
  } catch {
    logTaskDesk({
      module: "database",
      message: "database.failure",
      level: "error",
      result: "failed",
    });
  }
}

async function maybeCleanup() {
  cleanupTick = (cleanupTick + 1) % CLEANUP_EVERY;
  if (cleanupTick === 0) await cleanupExpiredCounters();
}

/** Checks a failed-auth bucket without incrementing it; must run before credential lookup. */
export async function checkScimRateLimit(input: {
  bucket: ScimRateLimitBucket;
  key: string;
  limit: number;
  windowMs: number;
}): Promise<ScimRateLimitDecision> {
  const keyHash = scimRateLimitKeyHash(input.bucket, input.key);
  const result = await db.execute(sql`
    SELECT count, window_started_at, clock_timestamp() AS now
    FROM ${schema.requestRateLimitCounterTable}
    WHERE bucket = ${input.bucket} AND key_hash = ${keyHash}
  `);
  const row = result.rows[0] as
    | (CounterRow & { now: Date | string })
    | undefined;
  await maybeCleanup();
  if (!row) return { allowed: true, retryAfterSeconds: 0 };

  const startedAt = dateValue(row.window_started_at);
  const now = dateValue(row.now);
  if (now.getTime() - startedAt.getTime() >= input.windowMs)
    return { allowed: true, retryAfterSeconds: 0 };
  if (row.count < input.limit) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: retryAfter(startedAt, input.windowMs, now.getTime()),
  };
}

/** Atomically records a request/failure and refuses increments beyond the configured ceiling. */
export async function hitScimRateLimit(input: {
  bucket: ScimRateLimitBucket;
  key: string;
  limit: number;
  windowMs: number;
}): Promise<ScimRateLimitDecision> {
  const keyHash = scimRateLimitKeyHash(input.bucket, input.key);
  const result = await db.execute(sql`
    WITH rate_clock AS (SELECT clock_timestamp() AS now)
    INSERT INTO ${schema.requestRateLimitCounterTable}
      (bucket, key_hash, window_started_at, count, expires_at, created_at, updated_at)
    SELECT ${input.bucket}, ${keyHash}, rate_clock.now, 1,
      rate_clock.now + (${input.windowMs} * interval '1 millisecond'),
      rate_clock.now, rate_clock.now
    FROM rate_clock
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${input.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN EXCLUDED.window_started_at
        ELSE ${schema.requestRateLimitCounterTable}.window_started_at
      END,
      count = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${input.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN 1
        WHEN ${schema.requestRateLimitCounterTable}.count < ${input.limit}
        THEN ${schema.requestRateLimitCounterTable}.count + 1
        ELSE LEAST(
          ${schema.requestRateLimitCounterTable}.count + 1,
          ${input.limit} + 1
        )
      END,
      expires_at = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${input.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN EXCLUDED.expires_at
        ELSE ${schema.requestRateLimitCounterTable}.expires_at
      END,
      updated_at = EXCLUDED.updated_at
    RETURNING count, window_started_at, expires_at, clock_timestamp() AS now
  `);
  const row = result.rows[0] as CounterRow | undefined;
  await maybeCleanup();
  if (!row) throw new Error("SCIM rate limit counter unavailable");
  const startedAt = dateValue(row.window_started_at);
  const now = row.now ? dateValue(row.now).getTime() : Date.now();
  return {
    allowed: row.count <= input.limit,
    retryAfterSeconds:
      row.count <= input.limit ? 0 : retryAfter(startedAt, input.windowMs, now),
  };
}

/** Shared consume for authenticated connections; every accepted request increments atomically. */
export async function consumeScimRateLimit(input: {
  bucket: "scim_connection";
  key: string;
  limit: number;
  windowMs: number;
}): Promise<ScimRateLimitDecision> {
  return hitScimRateLimit(input);
}
