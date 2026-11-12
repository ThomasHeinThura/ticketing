import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Per-actor rate limiter for invitation link copy endpoints (owner decision D-N, contract CP-23).
 * Keyed on the authenticated `userId` so one inviter cannot bulk-reconstruct pending links across
 * an organisation or workspace without hitting a bounded per-minute ceiling.
 */
export const COPY_INVITATION_LINK_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 30,
} as const;

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_BUCKETS = 10_000;

function pruneExpired(now: number, windowMs: number): void {
  if (buckets.size <= MAX_TRACKED_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}

export function resetCopyInvitationLinkRateLimitBuckets(): void {
  buckets.clear();
}

export function requireCopyInvitationLinkRateLimit(
  options: { now?: () => number; windowMs?: number; maxRequests?: number } = {},
) {
  const getNow = options.now ?? Date.now;
  const windowMs = options.windowMs ?? COPY_INVITATION_LINK_RATE_LIMIT.windowMs;
  const maxRequests =
    options.maxRequests ?? COPY_INVITATION_LINK_RATE_LIMIT.maxRequests;

  return async (c: Context, next: Next) => {
    const userId = c.get("userId") as string | undefined;
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const now = getNow();
    pruneExpired(now, windowMs);

    const existing = buckets.get(userId);
    if (!existing || now - existing.windowStart >= windowMs) {
      buckets.set(userId, { count: 1, windowStart: now });
      return next();
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.windowStart + windowMs - now) / 1000),
      );
      c.header("Retry-After", String(retryAfterSeconds));
      throw new HTTPException(429, { message: "Too many requests" });
    }

    existing.count += 1;
    return next();
  };
}
