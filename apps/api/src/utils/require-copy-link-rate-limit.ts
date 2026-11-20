import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { consumeSharedAuthRateLimit } from "../auth/rate-limit-storage";

export const COPY_INVITATION_LINK_RATE_LIMIT = { window: 60, max: 30 } as const;

export function requireCopyInvitationLinkRateLimit() {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId") as string | undefined;
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
    const decision = await consumeSharedAuthRateLimit(
      "copy-link",
      userId,
      COPY_INVITATION_LINK_RATE_LIMIT,
    );
    if (!decision.allowed) {
      c.header("Retry-After", String(decision.retryAfter ?? 60));
      throw new HTTPException(429, { message: "Too many requests" });
    }
    return next();
  };
}
