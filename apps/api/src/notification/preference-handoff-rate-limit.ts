import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { trustProxyDepth } from "../utils/auth-request";
import { resolveClientIp } from "../utils/resolve-client-ip";

/** Bounded per-process source-IP limiter; untrusted forwarding headers never pick a bucket. */
export function preferenceHandoffRateLimit() {
  const buckets = new Map<string, { started: number; count: number }>();
  return async (c: Context, next: Next) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.started >= 60_000) buckets.delete(key);
    }
    let socketAddress: string | null = null;
    try {
      socketAddress = getConnInfo(c).remote.address ?? null;
    } catch {
      /* In-process tests have no peer. */
    }
    const ip =
      (socketAddress
        ? resolveClientIp({
            socketAddress,
            forwardedFor: c.req.header("x-forwarded-for") ?? null,
            trustDepth: trustProxyDepth(),
          })
        : null) ?? "no-trusted-ip";
    const bucket = buckets.get(ip);
    if ((bucket?.count ?? 0) >= 20 || (!bucket && buckets.size >= 10_000)) {
      c.header("Retry-After", "60");
      throw new HTTPException(429, { message: "Too many requests" });
    }
    buckets.set(ip, {
      started: bucket?.started ?? now,
      count: (bucket?.count ?? 0) + 1,
    });
    return next();
  };
}
