import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { consumeSharedAuthRateLimit } from "../auth/rate-limit-storage";
import { rateLimitClientAddress } from "../identity/home-realm-rate-limit";
import { trustProxyDepth } from "./auth-request";
import { resolveClientIp } from "./resolve-client-ip";

/**
 * The native equivalent of `auth.ts`'s `rateLimit.customRules["/organization/
 * invite-member"]` (`{ window: 60, max: 5 }`), moved onto
 * `POST /api/workspace/{id}/invitations` (retrofit plan §3, S6a row; R1).
 *
 * Uses the same Valkey-backed shared auth rate-limit coordinator as `auth.ts`
 * (`apps/api/src/auth/rate-limit-storage.ts`), falling back to bounded
 * per-replica memory (with the one-time warning and Prometheus metric) when
 * Valkey is not configured or unreachable, and keying on the same trusted
 * client address (`resolveClientIp`/`trustProxyDepth`).
 */
const INVITE_RATE_RULE = { window: 60, max: 5 } as const;

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

  const resolved = resolveClientIp({
    forwardedFor: c.req.raw.headers.get("x-forwarded-for"),
    socketAddress,
    trustDepth: trustProxyDepth(),
  });
  return resolved ? rateLimitClientAddress(resolved) : "no-trusted-ip";
}

export function requireInviteRateLimit() {
  return async (c: Context, next: Next) => {
    const key = resolveIp(c);
    const decision = await consumeSharedAuthRateLimit(
      "invite",
      key,
      INVITE_RATE_RULE,
    );
    if (!decision.allowed) {
      throw new HTTPException(429, {
        message: "Too many requests. Please try again later.",
      });
    }
    return next();
  };
}
