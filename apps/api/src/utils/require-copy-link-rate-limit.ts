import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Shared per-actor rate limiter for both customer and staff invitation link copy endpoints across
 * all workspaces (owner decision D-N, contract CP-23).
 *
 * Keyed on the authenticated `userId` with a hard admission bound (`maxTrackedActors`):
 * - existing live buckets are never evicted or reset while unexpired;
 * - when the map reaches capacity, expired buckets are pruned first, and if capacity is still
 *   saturated with live actors, new actors are refused with `429` (`Retry-After`) so memory and
 *   per-request work stay strictly bounded.
 */
export const COPY_INVITATION_LINK_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 30,
  maxTrackedActors: 10_000,
} as const;

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();
let earliestLiveWindowStart: number | null = null;

function pruneExpired(now: number, windowMs: number): void {
  if (
    earliestLiveWindowStart !== null &&
    now >= earliestLiveWindowStart &&
    now - earliestLiveWindowStart < windowMs
  ) {
    return;
  }
  let minWindowStart: number | null = null;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    } else if (minWindowStart === null || bucket.windowStart < minWindowStart) {
      minWindowStart = bucket.windowStart;
    }
  }
  earliestLiveWindowStart = minWindowStart;
}

export function resetCopyInvitationLinkRateLimitBuckets(): void {
  buckets.clear();
  earliestLiveWindowStart = null;
}

export function copyInvitationLinkTrackedActorCount(): number {
  return buckets.size;
}

export function requireCopyInvitationLinkRateLimit(
  options: {
    now?: () => number;
    windowMs?: number;
    maxRequests?: number;
    maxTrackedActors?: number;
  } = {},
) {
  const getNow = options.now ?? Date.now;
  const windowMs = options.windowMs ?? COPY_INVITATION_LINK_RATE_LIMIT.windowMs;
  const maxRequests =
    options.maxRequests ?? COPY_INVITATION_LINK_RATE_LIMIT.maxRequests;
  const maxTrackedActors =
    options.maxTrackedActors ??
    COPY_INVITATION_LINK_RATE_LIMIT.maxTrackedActors;

  return async (c: Context, next: Next) => {
    const userId = c.get("userId") as string | undefined;
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const now = getNow();
    const existing = buckets.get(userId);

    if (existing) {
      if (now - existing.windowStart >= windowMs) {
        existing.count = 1;
        existing.windowStart = now;
        if (earliestLiveWindowStart === null || now < earliestLiveWindowStart) {
          earliestLiveWindowStart = now;
        }
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
    }

    if (buckets.size >= maxTrackedActors) {
      pruneExpired(now, windowMs);
      if (buckets.size >= maxTrackedActors) {
        const oldestStart = earliestLiveWindowStart ?? now;
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldestStart + windowMs - now) / 1000),
        );
        c.header("Retry-After", String(retryAfterSeconds));
        throw new HTTPException(429, { message: "Too many requests" });
      }
    }

    buckets.set(userId, { count: 1, windowStart: now });
    if (earliestLiveWindowStart === null || now < earliestLiveWindowStart) {
      earliestLiveWindowStart = now;
    }
    return next();
  };
}
