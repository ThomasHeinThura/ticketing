import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { consumeSharedAuthRateLimit } from "../auth/rate-limit-storage";

/**
 * The native equivalent of `auth.ts`'s `rateLimit.customRules["/organization/
 * invite-member"]` (`{ window: 60, max: 5 }`), moved onto
 * `POST /api/workspace/{id}/invitations` (retrofit plan §3, S6a row; R1).
 *
 * Uses the same Valkey-backed shared auth rate-limit coordinator as `auth.ts`
 * (`apps/api/src/auth/rate-limit-storage.ts`), falling back to bounded
 * per-replica memory when Valkey is unavailable, keyed by the signed-in user.
 */
const INVITE_RATE_RULE = { window: 60, max: 5 } as const;

export function requireInviteRateLimit() {
  return async (c: Context, next: Next) => {
    const key = c.get("userId") as string | undefined;
    if (!key) throw new HTTPException(401, { message: "Unauthorized" });
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
