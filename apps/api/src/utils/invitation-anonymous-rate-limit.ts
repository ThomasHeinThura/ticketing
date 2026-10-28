import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../api-key/enforce";
import db, { schema } from "../database";
import { rateLimitClientAddress } from "../identity/home-realm-rate-limit";
import { resolveAuthSecret } from "./require-auth-secret";

const BUCKET = "anonymous_invitation" as const;
const MIN_WINDOW_MS = 60_000;
const MAX_WINDOW_MS = 86_400_000;
const MIN_MAX = 1;
const MAX_MAX = 10_000;

export type InvitationAnonymousRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function digestKey(clientIp: string | null, windowMs: number): string {
  const secret = resolveAuthSecret(process.env.TASKDESK_AUTH_SECRET);
  if (!secret.ok) throw new Error("Anonymous invitation limiter unavailable");
  return (
    createHmac("sha256", secret.secret)
      .update(BUCKET)
      .update("\0")
      .update(String(windowMs))
      .update("\0")
      // P3-R2-01: IPv6 clients are keyed on their /64 and IPv4-mapped clients on the embedded
      // IPv4 address, the same normalisation as the home-realm limiter.
      .update(
        clientIp ? rateLimitClientAddress(clientIp) : "no-trusted-client-ip",
      )
      .digest("hex")
  );
}

function dateValue(value: Date | string | undefined): Date {
  const parsed = value instanceof Date ? value : new Date(value ?? "");
  if (Number.isNaN(parsed.getTime()))
    throw new Error("Anonymous invitation limiter unavailable");
  return parsed;
}

/** Atomically consumes one configured anonymous invitation lookup/signup request. */
export async function consumeAnonymousInvitationRateLimit(
  clientIp: string | null,
): Promise<InvitationAnonymousRateLimitDecision> {
  const [settings] = await db
    .select({
      windowMs: schema.instanceSettingTable.anonymousRateLimitWindowMs,
      max: schema.instanceSettingTable.anonymousRateLimitMax,
    })
    .from(schema.instanceSettingTable)
    .where(sql`${schema.instanceSettingTable.id} = 'singleton'`)
    .limit(1);
  if (
    !settings ||
    !Number.isSafeInteger(settings.windowMs) ||
    settings.windowMs < MIN_WINDOW_MS ||
    settings.windowMs > MAX_WINDOW_MS ||
    !Number.isSafeInteger(settings.max) ||
    settings.max < MIN_MAX ||
    settings.max > MAX_MAX
  )
    throw new Error("Anonymous invitation limiter unavailable");

  const keyHash = digestKey(clientIp, settings.windowMs);
  const result = await db.execute(sql`
    WITH rate_clock AS (SELECT clock_timestamp() AS now)
    INSERT INTO ${schema.requestRateLimitCounterTable}
      (bucket, key_hash, window_started_at, count, expires_at, created_at, updated_at)
    SELECT ${BUCKET}, ${keyHash}, rate_clock.now, 1,
      rate_clock.now + (${settings.windowMs} * interval '1 millisecond'),
      rate_clock.now, rate_clock.now
    FROM rate_clock
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${settings.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN EXCLUDED.window_started_at
        ELSE ${schema.requestRateLimitCounterTable}.window_started_at
      END,
      count = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${settings.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN 1
        WHEN ${schema.requestRateLimitCounterTable}.count < ${settings.max}
        THEN ${schema.requestRateLimitCounterTable}.count + 1
        ELSE LEAST(${schema.requestRateLimitCounterTable}.count + 1, ${settings.max} + 1)
      END,
      expires_at = CASE
        WHEN ${schema.requestRateLimitCounterTable}.window_started_at +
          (${settings.windowMs} * interval '1 millisecond') <= EXCLUDED.window_started_at
        THEN EXCLUDED.expires_at
        ELSE ${schema.requestRateLimitCounterTable}.expires_at
      END,
      updated_at = EXCLUDED.updated_at
    RETURNING count, window_started_at, clock_timestamp() AS now
  `);
  const row = result.rows[0] as
    | { count: number; window_started_at: Date | string; now: Date | string }
    | undefined;
  if (!row) throw new Error("Anonymous invitation limiter unavailable");
  const startedAt = dateValue(row.window_started_at);
  const now = dateValue(row.now).getTime();
  return {
    allowed: row.count <= settings.max,
    retryAfterSeconds:
      row.count <= settings.max
        ? 0
        : Math.max(
            1,
            Math.ceil((startedAt.getTime() + settings.windowMs - now) / 1000),
          ),
  };
}

/** Hono guard for the public invitation-preview endpoint. */
export async function requireAnonymousInvitationRateLimit(
  context: Context,
): Promise<void> {
  let decision: InvitationAnonymousRateLimitDecision;
  try {
    decision = await consumeAnonymousInvitationRateLimit(
      clientIpForContext(context),
    );
  } catch {
    throw new HTTPException(503, {
      message: "Anonymous invitation limiter unavailable",
    });
  }
  if (!decision.allowed) {
    context.header("Retry-After", String(decision.retryAfterSeconds));
    throw new HTTPException(429, {
      message: "Too many requests. Please try again later.",
    });
  }
}
