import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";

/**
 * Enforces that an invitation link copy route is reachable ONLY from an interactive browser
 * session on the agent host (owner decision D-N, contract CP-23):
 * - refuses personal API keys, MCP keys and workspace service keys (`c.get("apiKey")`)
 * - refuses unauthenticated requests (`!c.get("session")`)
 * - refuses impersonation sessions (`session.impersonatedBy`)
 * - refuses customer-portal hosts and customer-portal sessions (`portalForHost(host) !== "agent"`)
 */
export function requireAgentBrowserSession(
  options: {
    resolvePortal?: (host: string | null | undefined) => string | null;
  } = {},
) {
  const resolvePortal = options.resolvePortal ?? portalForHost;
  return async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);

    if (c.get("apiKey")) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, {
        message:
          "session_required: this route accepts a browser session only, not an API key",
      });
    }

    const session = c.get("session") as {
      impersonatedBy?: string | null;
      portal?: string | null;
    } | null;

    if (!session) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    if (session.impersonatedBy) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, {
        message:
          "session_required: this route accepts a browser session only, not an impersonation session",
      });
    }

    if (
      resolvePortal(c.req.header("host")) !== "agent" ||
      session.portal === "customer"
    ) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }

    setShadowLegacyAuthorization(c, "allowed");
    return next();
  };
}
