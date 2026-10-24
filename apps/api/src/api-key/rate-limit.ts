/**
 * AK-4 / MC-10 / MC-14 / MC-22: per-key request limits.
 *
 * In-memory, per-process sliding buckets, the same mechanism (and the same documented
 * limitation) as `utils/require-invite-rate-limit.ts`: this app configures no shared limiter
 * storage. The limits themselves are pure functions so they can be unit tested, and the
 * ceilings are injected: `instance_setting.mcp_write_ceiling_per_minute` has no column yet
 * (decision needed), so the defaults below are the documented fallback, never a hidden policy.
 */

export const DEFAULT_KEY_RATE_LIMIT_PER_MINUTE = 100;
/** Fallback for `instance_setting.mcp_write_ceiling_per_minute` until the column exists. */
export const DEFAULT_MCP_WRITE_CEILING_PER_MINUTE = 30;
/** `bulk_create_work_items` is capped independently of the other tools (MC-10). */
export const DEFAULT_MCP_BULK_CEILING_PER_MINUTE = 5;

const WINDOW_MS = 60_000;
const MAX_TRACKED_BUCKETS = 10_000;

export type RateLimitClass = "read" | "write" | "bulk";

export type RateLimitDecision =
  | { allowed: true; limit: number; remaining: number }
  | { allowed: false; limit: number; retryAfterSeconds: number };

export type KeyRateLimitConfig = {
  isMcp: boolean;
  keyLimitPerMinute: number | null;
  mcpWriteCeilingPerMinute?: number;
  mcpBulkCeilingPerMinute?: number;
};

/**
 * `min(key.rate_limit_per_minute, instance mcp ceiling)` for MCP writes (MC-14); the key's
 * own limit (or the default) for everything else. Bulk is capped on its own, lower ceiling.
 */
export function effectiveLimit(
  config: KeyRateLimitConfig,
  requestClass: RateLimitClass,
): number {
  const own = config.keyLimitPerMinute ?? DEFAULT_KEY_RATE_LIMIT_PER_MINUTE;
  if (!config.isMcp || requestClass === "read") return own;
  if (requestClass === "bulk")
    return Math.min(
      own,
      config.mcpBulkCeilingPerMinute ?? DEFAULT_MCP_BULK_CEILING_PER_MINUTE,
    );
  return Math.min(
    own,
    config.mcpWriteCeilingPerMinute ?? DEFAULT_MCP_WRITE_CEILING_PER_MINUTE,
  );
}

type Bucket = { count: number; windowStart: number };

export class KeyRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(
    keyId: string,
    requestClass: RateLimitClass,
    limit: number,
    now = Date.now(),
  ): RateLimitDecision {
    if (this.buckets.size > MAX_TRACKED_BUCKETS) this.prune(now);
    const id = `${keyId}:${requestClass}`;
    const bucket = this.buckets.get(id);
    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      this.buckets.set(id, { count: 1, windowStart: now });
      return { allowed: true, limit, remaining: Math.max(0, limit - 1) };
    }
    if (bucket.count >= limit) {
      return {
        allowed: false,
        limit,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000),
        ),
      };
    }
    bucket.count += 1;
    return { allowed: true, limit, remaining: limit - bucket.count };
  }

  private prune(now: number): void {
    for (const [id, bucket] of this.buckets) {
      if (now - bucket.windowStart >= WINDOW_MS) this.buckets.delete(id);
    }
  }
}

/**
 * POST routes that only read: a search document is a request body, not a change. They count
 * against the read limit, never the (stricter) MCP write ceiling.
 */
const READ_ONLY_POST_PATHS: readonly string[] = ["/api/work-items/search"];

/** Reads are `GET`/`HEAD`/`OPTIONS` and the read-only POSTs; a bulk request is a write that touches many items. */
export function classifyRequest(
  method: string,
  options: { bulk?: boolean; path?: string } = {},
): RateLimitClass {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return "read";
  if (
    upper === "POST" &&
    options.path !== undefined &&
    READ_ONLY_POST_PATHS.includes(options.path.replace(/\/+$/, ""))
  )
    return "read";
  return options.bulk ? "bulk" : "write";
}
