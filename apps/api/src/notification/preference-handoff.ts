import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  portalForHost,
} from "../auth";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { requirePublicCookieSessionCsrf } from "../utils/csrf-protection";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  createPreferenceHandoff,
  readPreferenceHandoff,
} from "./preference-handoff.repository";
import { preferenceHandoffRateLimit } from "./preference-handoff-rate-limit";
import {
  preferenceSelectorSchema,
  verifyNotificationPreferenceLink,
} from "./preference-link";

const COOKIE = "__Host-tdk_notification_preference_handoff";
function audienceOrigin(audience: "agent" | "customer") {
  return audience === "agent"
    ? getConfiguredAgentOrigin()
    : getConfiguredCustomerOrigin();
}
/** Mounted before authentication; the signed token authorizes only this bounded selector exchange. */
export function publicPreferenceHandoff(audience: "agent" | "customer") {
  return apiRouter().openapi(
    createRoute({
      method: "post",
      path: "/",
      summary: "Exchange a notification preference link",
      operationId:
        audience === "agent"
          ? "exchangeAgentNotificationPreferenceLink"
          : "exchangePortalNotificationPreferenceLink",
      tags: ["Notification Preferences"],
      security: [],
      middleware: [
        requirePublicCookieSessionCsrf(audience),
        preferenceHandoffRateLimit(),
      ] as const,
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ token: z.string().max(4096) }).strict(),
            },
          },
        },
      },
      responses: {
        202: jsonResponse(
          "Link accepted",
          z.object({ accepted: z.literal(true) }),
        ),
        400: errorResponse("Invalid request body"),
        401: errorResponse(
          "An ambient session cookie is present but not a valid session for this audience",
        ),
        403: errorResponse("Origin, host or CSRF check failed"),
        429: errorResponse("Too many requests"),
      },
    }),
    async (c) => {
      const expected = audienceOrigin(audience);
      if (
        c.req.header("origin") !== expected ||
        portalForHost(c.req.header("host")) !== audience
      )
        throw new HTTPException(403, { message: "Forbidden" });
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      const claims = verifyNotificationPreferenceLink(
        c.req.valid("json").token,
        audience,
      );
      if (claims) {
        const handle = await createPreferenceHandoff(claims);
        setCookie(c, COOKIE, handle, {
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
          path: "/",
          maxAge: 600,
        });
      }
      return c.json({ accepted: true as const }, 202);
    },
  );
}
/** Mounted behind its audience's authentication. Never consumes or clears a valid handoff. */
export function authenticatedPreferenceHandoff(audience: "agent" | "customer") {
  return apiRouter().openapi(
    createRoute({
      method: "get",
      path: "/email-link-handoff",
      summary: "Read the verified notification preference selector",
      middleware: [requireSessionOnly()] as const,
      operationId:
        audience === "agent"
          ? "getAgentNotificationPreferenceHandoff"
          : "getPortalNotificationPreferenceHandoff",
      tags: ["Notification Preferences"],
      responses: {
        200: jsonResponse(
          "Verified preference selector",
          preferenceSelectorSchema,
        ),
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const session = c.get("session") as { portal?: string } | null;
      const identity = await resolveIdentity({
        userId: c.get("userId"),
        credential: "session",
      });
      const expectedSide = audience === "agent" ? "staff" : "customer";
      const expectedPortal = audience === "agent" ? "agent" : "customer";
      if (
        portalForHost(c.req.header("host")) !== audience ||
        session?.portal !== expectedPortal ||
        !identity ||
        identity.side !== expectedSide
      )
        throw new HTTPException(404, { message: "Not found" });
      const selector = await readPreferenceHandoff(
        getCookie(c, COOKIE) ?? "",
        audience,
        identity.personId,
      );
      if (!selector) throw new HTTPException(404, { message: "Not found" });
      return c.json(selector, 200);
    },
  );
}
