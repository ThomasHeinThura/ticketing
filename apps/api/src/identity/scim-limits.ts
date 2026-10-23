import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { trustProxyDepth } from "../utils/auth-request";
import { resolveClientIp } from "../utils/resolve-client-ip";

/**
 * `IP-14`: oversized bodies are rejected with a SCIM error, and requests are rate-limited per
 * connection, with anonymous-class limits applying to failed authentication. Both limits are
 * in-memory, per process and bounded; the bucket key is the authenticated connection id (never
 * a caller-supplied header) or, for failures, the trusted client address.
 */

/** Largest accepted request body. `/Bulk` is unsupported, so only a full group reconciliation is large. */
export const SCIM_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Authenticated requests allowed per connection per window. */
export const SCIM_CONNECTION_LIMIT = 600;
export const SCIM_CONNECTION_WINDOW_MS = 60_000;
/** Failed authentications allowed per client address per window (the anonymous class). */
export const SCIM_FAILURE_LIMIT = 20;
export const SCIM_FAILURE_WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

export function scimErrorBody(
  status: number,
  detail: string,
  scimType?: string,
) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

export function scimErrorResponse(
  c: Context,
  status: 401 | 413 | 429,
  detail: string,
  scimType?: string,
  headers: Record<string, string> = {},
): Response {
  const response = c.json(scimErrorBody(status, detail, scimType), status);
  response.headers.set("Content-Type", "application/scim+json; charset=utf-8");
  response.headers.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(headers))
    response.headers.set(name, value);
  return response;
}

/** A fixed-window counter keyed by string, bounded in size; the clock is injectable for tests. */
export class WindowCounter {
  private readonly buckets = new Map<
    string,
    { started: number; count: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(at: number): void {
    if (this.buckets.size < MAX_TRACKED_KEYS) return;
    for (const [key, bucket] of this.buckets)
      if (at - bucket.started >= this.windowMs) this.buckets.delete(key);
  }

  /** Whether another hit would exceed the limit, without recording one. */
  isExhausted(key: string): boolean {
    const at = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || at - bucket.started >= this.windowMs) return false;
    return bucket.count >= this.limit;
  }

  /** Records a hit; returns false when the limit was already reached (the hit is not counted). */
  hit(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const at = this.now();
    this.prune(at);
    const bucket = this.buckets.get(key);
    if (!bucket || at - bucket.started >= this.windowMs) {
      // A full table of live buckets refuses new keys rather than growing without bound.
      if (!bucket && this.buckets.size >= MAX_TRACKED_KEYS)
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(this.windowMs / 1000),
        };
      this.buckets.set(key, { started: at, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.count >= this.limit)
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.started + this.windowMs - at) / 1000),
        ),
      };
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function scimClientKey(c: Context): string {
  let socketAddress: string | null = null;
  try {
    socketAddress = getConnInfo(c).remote.address ?? null;
  } catch {
    // In-process tests expose no socket; resolveClientIp copes with a null peer.
  }
  return (
    resolveClientIp({
      forwardedFor: c.req.header("x-forwarded-for") ?? null,
      socketAddress,
      trustDepth: trustProxyDepth(),
    }) ?? "no-trusted-ip"
  );
}

/** Per-connection limiter for AUTHENTICATED requests; reads the connection id the auth step set. */
export function scimConnectionRateLimit(
  connectionIdOf: (c: Context) => string | undefined,
  counter: WindowCounter = new WindowCounter(
    SCIM_CONNECTION_LIMIT,
    SCIM_CONNECTION_WINDOW_MS,
  ),
): MiddlewareHandler {
  return async (c, next) => {
    const connectionId = connectionIdOf(c);
    if (!connectionId) return scimErrorResponse(c, 401, "Unauthorized");
    const result = counter.hit(connectionId);
    if (!result.allowed)
      return scimErrorResponse(c, 429, "Too many requests", undefined, {
        "Retry-After": String(result.retryAfterSeconds),
      });
    await next();
  };
}

/** Rejects a body above `SCIM_MAX_BODY_BYTES` (declared or streamed) with a SCIM `413 tooLarge`. */
export function scimBodyLimit(
  maxSize = SCIM_MAX_BODY_BYTES,
): MiddlewareHandler {
  return bodyLimit({
    maxSize,
    onError: (c) =>
      scimErrorResponse(c, 413, "Request body is too large", "tooLarge"),
  });
}
