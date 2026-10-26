/**
 * AK-4 / MC-10 / MC-14 / MC-22: per-key request limits.
 *
 * Pure limit calculations are shared by the PostgreSQL-backed production store and unit tests.
 * `KeyRateLimiter` is a deterministic test helper only; production enforcement cannot use a
 * process-local map because the API may run on multiple replicas.
 */

export const DEFAULT_KEY_RATE_LIMIT_PER_MINUTE = 100;
/** Default for the runtime-configurable `instance_setting.mcp_write_ceiling_per_minute`. */
export const DEFAULT_MCP_WRITE_CEILING_PER_MINUTE = 30;
/** MCP bulk requests have a separate, stricter ceiling (MC-10). */
export const DEFAULT_MCP_BULK_CEILING_PER_MINUTE = 5;
/** Auto-disable threshold for verified MCP write attempts in the fixed minute window. */
export const DEFAULT_API_KEY_BURST_THRESHOLD = 300;
export const MIN_API_KEY_BURST_THRESHOLD = 1;
export const MAX_API_KEY_BURST_THRESHOLD = 100_000;

const WINDOW_MS = 60_000;
const MAX_TRACKED_BUCKETS = 10_000;

export type RateLimitClass = "read" | "write" | "bulk";
export type RateLimitBucket = "total" | "mcp_write" | "mcp_bulk" | "mcp_burst";

export type RateLimitConstraint = {
  bucket: RateLimitBucket;
  limit: number;
};

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
 * The per-key rate applies to total requests. MCP writes additionally consume a write bucket;
 * MCP bulk requests also consume the separate, lower bulk bucket.
 */
export function effectiveLimit(
  config: KeyRateLimitConfig,
  requestClass: RateLimitClass,
): number {
  const own = config.keyLimitPerMinute ?? DEFAULT_KEY_RATE_LIMIT_PER_MINUTE;
  if (!config.isMcp || requestClass === "read") return own;
  const write = Math.min(
    own,
    config.mcpWriteCeilingPerMinute ?? DEFAULT_MCP_WRITE_CEILING_PER_MINUTE,
  );
  if (requestClass === "bulk")
    return Math.min(
      write,
      config.mcpBulkCeilingPerMinute ?? DEFAULT_MCP_BULK_CEILING_PER_MINUTE,
    );
  return write;
}

/** All request budgets that must admit together; bulk MCP calls consume all three. */
export function rateLimitConstraints(
  config: KeyRateLimitConfig,
  requestClass: RateLimitClass,
): RateLimitConstraint[] {
  const own = config.keyLimitPerMinute ?? DEFAULT_KEY_RATE_LIMIT_PER_MINUTE;
  const constraints: RateLimitConstraint[] = [{ bucket: "total", limit: own }];
  if (config.isMcp && requestClass !== "read") {
    constraints.push({
      bucket: "mcp_write",
      limit: Math.min(
        own,
        config.mcpWriteCeilingPerMinute ?? DEFAULT_MCP_WRITE_CEILING_PER_MINUTE,
      ),
    });
    if (requestClass === "bulk")
      constraints.push({
        bucket: "mcp_bulk",
        limit: Math.min(
          own,
          config.mcpBulkCeilingPerMinute ?? DEFAULT_MCP_BULK_CEILING_PER_MINUTE,
        ),
      });
  }
  return constraints;
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
 * POST routes outside business writes. Search and low-trust MCP telemetry use the ordinary
 * total key budget without consuming MCP write, bulk or auto-disable counters.
 */
const NON_WRITE_POST_PATHS: readonly string[] = [
  "/api/work-items/search",
  // Client-reported MCP statistics are operational telemetry, not a business write.
  "/api/mcp/tool-reports",
];
const BULK_WRITE_PATHS: readonly string[] = ["/api/work-items/bulk"];
const IMPORT_BULK_WRITE_PATH = /^\/api\/imports\/[^/]+\/(?:records|links)$/u;

/** Reports and queries consume the ordinary key budget; business writes use stricter MCP buckets. */
export function classifyRequest(
  method: string,
  options: { bulk?: boolean; path?: string } = {},
): RateLimitClass {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return "read";
  if (
    upper === "POST" &&
    options.path !== undefined &&
    NON_WRITE_POST_PATHS.includes(options.path.replace(/\/+$/, ""))
  )
    return "read";
  const path = options.path?.replace(/\/+$/, "");
  return options.bulk ||
    (path !== undefined &&
      (BULK_WRITE_PATHS.includes(path) ||
        (upper === "POST" && IMPORT_BULK_WRITE_PATH.test(path))))
    ? "bulk"
    : "write";
}
