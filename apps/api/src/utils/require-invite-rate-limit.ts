import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { trustProxyDepth } from "./auth-request";
import { resolveClientIp } from "./resolve-client-ip";

/**
 * The native equivalent of `auth.ts`'s `rateLimit.customRules["/organization/
 * invite-member"]` (`{ window: 60, max: 5 }`), moved onto
 * `POST /api/workspace/{id}/invitations` (retrofit plan §3, S6a row; R1).
 *
 * better-auth's own limiter keys on `(resolved client ip, path)` and stores
 * its bucket in an in-memory `Map` when no `rateLimit.storage` is configured
 * -- this app configures none, so that IS the effective behaviour today (see
 * `better-auth/dist/api/rate-limiter/index.mjs`'s `getRateLimitStorage`).
 * This module reproduces exactly that: an in-memory, per-process, sliding
 * bucket keyed on the SAME trusted client address this app already resolves
 * for better-auth's own limiter
 * (`resolveClientIp`/`trustProxyDepth`, `apps/api/src/utils/
 * resolve-client-ip.ts` / `auth-request.ts`) -- never a caller-supplied
 * header, for the same forgeability reason those modules document.
 *
 * Deliberately its own small implementation rather than a shared "generic
 * rate limiter" abstraction: this app has exactly one native route that
 * needs one, and a one-caller abstraction is speculative generality this
 * repository's engine-boundary rule (`CLAUDE.md` §3) argues against.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

/** Keeps the in-memory map from growing unboundedly under sustained traffic
 * from many distinct addresses -- mirrors the intent (not the exact
 * mechanism) of better-auth's own `pruneMemoryStore`. */
const MAX_TRACKED_BUCKETS = 10_000;

function pruneExpired(now: number): void {
  if (buckets.size <= MAX_TRACKED_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

function resolveIp(c: Context): string {
  let socketAddress: string | null = null;
  try {
    socketAddress = getConnInfo(c).remote.address ?? null;
  } catch {
    // Some runtimes (and the integration test harness, which calls
    // app.request directly) expose no socket -- resolveClientIp handles a
    // null peer and returns null rather than inventing an address.
    socketAddress = null;
  }

  return (
    resolveClientIp({
      forwardedFor: c.req.raw.headers.get("x-forwarded-for"),
      socketAddress,
      trustDepth: trustProxyDepth(),
    }) ?? "no-trusted-ip"
  );
}

export function requireInviteRateLimit() {
  return async (c: Context, next: Next) => {
    const now = Date.now();
    const key = resolveIp(c);
    pruneExpired(now);

    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart > WINDOW_MS) {
      buckets.set(key, { count: 1, windowStart: now });
      return next();
    }

    if (bucket.count >= MAX_REQUESTS) {
      throw new HTTPException(429, {
        message: "Too many requests. Please try again later.",
      });
    }

    bucket.count += 1;
    return next();
  };
}
