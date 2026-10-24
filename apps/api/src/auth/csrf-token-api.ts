import { and, eq, gt, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import {
  issueCsrfToken,
  requireSameOriginIssuer,
} from "../utils/csrf-protection";
import { dbNowUtc } from "../utils/db-time";
import { requireSessionOnly } from "../utils/require-session-only";

const csrfTokenResponse = z.object({
  token: z.string().min(1).max(2048),
  expiresAt: z.string().datetime(),
});

function csrfTokenApi(audience: "agent" | "customer") {
  const route = createRoute({
    method: "get",
    operationId:
      audience === "agent"
        ? "getSessionCsrfToken"
        : "getPortalSessionCsrfToken",
    path: "/csrf-token",
    tags: ["Authentication"],
    summary: "Get the current session's CSRF token",
    description:
      "Returns a short-lived session- and origin-bound token for same-origin unsafe API requests. The matching token is also stored in an HttpOnly cookie.",
    // GM-11: the agent issuer also serves an impersonation session, which needs a token for its
    // ordinary writes and its always-allowed exit control (bound to that session's own id).
    middleware: [
      requireSessionOnly({ allowImpersonation: audience === "agent" }),
    ] as const,
    responses: {
      200: jsonResponse("Current session CSRF token", csrfTokenResponse),
      401: jsonResponse("Unauthorized", z.object({ message: z.string() })),
      403: jsonResponse(
        "Issuer origin rejected",
        z.object({ message: z.literal("csrf_origin_invalid") }),
      ),
    },
  });

  return apiRouter().openapi(route, async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    // Validate request provenance before the issuer can create or refresh a cookie.
    let origin: string;
    try {
      origin = requireSameOriginIssuer(c, audience);
    } catch {
      c.header("Cache-Control", "no-store");
      return c.json({ message: "csrf_origin_invalid" as const }, 403);
    }
    const session = c.get("session") as {
      id?: string;
      userId?: string;
      portal?: unknown;
      impersonatedBy?: string | null;
    } | null;
    const userId = c.get("userId");
    if (
      !session?.id ||
      !session.userId ||
      session.userId !== userId ||
      session.portal !== audience ||
      // GM-9/GM-11: an agent impersonation session performs ordinary writes and must be able
      // to call its own exit control, so it may hold a CSRF token bound to its own session id.
      // Customer-portal sessions are never impersonated.
      (session.impersonatedBy && audience !== "agent")
    ) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    const [active] = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable)
      .where(
        and(
          eq(schema.sessionTable.id, session.id),
          eq(schema.sessionTable.userId, userId),
          eq(schema.sessionTable.portal, audience),
          gt(schema.sessionTable.expiresAt, dbNowUtc()),
          audience === "agent"
            ? undefined
            : isNull(schema.sessionTable.impersonatedBy),
        ),
      )
      .limit(1);
    if (!active) throw new HTTPException(401, { message: "Unauthorized" });

    if (audience === "customer") {
      const identity = await resolveIdentity({ userId, credential: "session" });
      if (identity?.side !== "customer")
        throw new HTTPException(401, { message: "Unauthorized" });
    }
    setShadowLegacyAuthorization(c, "allowed");
    const result = issueCsrfToken(c, session.id, origin);
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    return c.json({ token: result.token, expiresAt: result.expiresAt }, 200);
  });
}
export const portalCsrfToken = csrfTokenApi("customer");
export default csrfTokenApi("agent");
