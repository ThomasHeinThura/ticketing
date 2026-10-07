import { HTTPException } from "hono/http-exception";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import {
  issueCsrfToken,
  requireSameOriginIssuer,
} from "../utils/csrf-protection";
import { requireSessionOnly } from "../utils/require-session-only";
import { getActiveAgentSession } from "./repository";

const csrfTokenResponse = z.object({
  token: z.string().min(1).max(2048),
  expiresAt: z.string().datetime(),
});

const route = createRoute({
  method: "get",
  operationId: "getSessionCsrfToken",
  path: "/csrf-token",
  tags: ["Authentication"],
  summary: "Get the current session's CSRF token",
  description:
    "Returns a short-lived session- and origin-bound token for same-origin unsafe API requests. The matching token is also stored in an HttpOnly cookie.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("Current session CSRF token", csrfTokenResponse),
    401: jsonResponse("Unauthorized", z.object({ message: z.string() })),
    403: jsonResponse(
      "Issuer origin rejected",
      z.object({ message: z.literal("csrf_origin_invalid") }),
    ),
  },
});

export default apiRouter().openapi(route, async (c) => {
  // Validate request provenance before the issuer can create or refresh a cookie.
  let origin: string;
  try {
    origin = requireSameOriginIssuer(c);
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
    session.portal !== "agent" ||
    session.impersonatedBy
  ) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  const [active] = await getActiveAgentSession(session.id, userId, new Date());
  if (!active) throw new HTTPException(401, { message: "Unauthorized" });

  setShadowLegacyAuthorization(c, "allowed");
  const result = issueCsrfToken(c, session.id, origin);
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json({ token: result.token, expiresAt: result.expiresAt }, 200);
});
