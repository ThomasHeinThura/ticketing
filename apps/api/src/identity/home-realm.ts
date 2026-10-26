import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { logTaskDesk } from "../instance/observability/runtime";
import { apiRouter, jsonResponse, z } from "../openapi";
import {
  HOME_REALM_CONTINUATION_COOKIE,
  HOME_REALM_CONTINUATION_TTL_SECONDS,
  openHomeRealmContinuation,
  sealHomeRealmContinuation,
} from "./home-realm-continuation";
import { consumeHomeRealmRateLimit } from "./home-realm-rate-limit";
import {
  createOidcAuthorizationStart,
  oidcStateCookieName,
  oidcStateCookieOptions,
} from "./oidc-login";
import {
  getCustomerOidcConnectionForHomeRealm,
  resolveCustomerOidcDomain,
} from "./repository";

const failurePath = "/sign-in?identity_error=sign_in_failed";
const domainPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

type HomeRealmApiOptions = {
  consumeRateLimit?: typeof consumeHomeRealmRateLimit;
  resolveDomain?: typeof resolveCustomerOidcDomain;
  getConnection?: typeof getCustomerOidcConnectionForHomeRealm;
  createAuthorizationStart?: typeof createOidcAuthorizationStart;
};

function emailDomain(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const address = value.trim();
  if (!address || /[^\x21-\x7e]/u.test(address)) return null;
  const separator = address.indexOf("@");
  if (separator < 1 || separator !== address.lastIndexOf("@") || separator > 64)
    return null;
  const domain = address.slice(separator + 1).toLowerCase();
  return domainPattern.test(domain) ? domain : null;
}

function clearContinuation(c: Context) {
  setCookie(c, HOME_REALM_CONTINUATION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

function genericFailure(c: Context) {
  return c.redirect(failurePath, 302);
}

/** Anonymous typed-domain discovery and fixed-target portal OIDC initiation. */
export function createHomeRealmApi(options: HomeRealmApiOptions = {}) {
  const routes = apiRouter();
  // Register documentation separately: malformed or oversized discovery requests
  // deliberately return the same local-method response rather than validation detail.
  routes.openAPIRegistry.registerPath({
    method: "post",
    path: "/portal/sign-in/home-realm",
    operationId: "resolvePortalHomeRealm",
    security: [],
    tags: ["Identity"],
    summary: "Resolve a customer sign-in method on the portal host",
    request: {
      body: {
        content: {
          "application/json": { schema: z.object({ email: z.string() }) },
        },
      },
    },
    responses: {
      200: jsonResponse(
        "Sign-in method; invalid or unavailable discovery falls back to local",
        z.object({ next: z.enum(["local", "sso"]) }),
      ),
    },
  });
  routes.openAPIRegistry.registerPath({
    method: "get",
    path: "/portal/sign-in/home-realm/start",
    operationId: "startPortalHomeRealmAuthorization",
    security: [],
    tags: ["Identity"],
    summary: "Consume the portal sign-in continuation",
    responses: {
      302: {
        description:
          "Redirect to the selected identity provider or portal sign-in",
        headers: { Location: { schema: { type: "string" } } },
      },
    },
  });
  const rateLimit = options.consumeRateLimit ?? consumeHomeRealmRateLimit;
  const resolveDomain = options.resolveDomain ?? resolveCustomerOidcDomain;
  const getConnection =
    options.getConnection ?? getCustomerOidcConnectionForHomeRealm;
  const startAuthorization =
    options.createAuthorizationStart ?? createOidcAuthorizationStart;

  routes.post(
    "/portal/sign-in/home-realm",
    bodyLimit({
      maxSize: 512,
      onError: (c) => {
        c.header("Cache-Control", "no-store");
        clearContinuation(c);
        return c.json({ next: "local" as const });
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      let allowed = false;
      try {
        allowed = await rateLimit(c);
      } catch {
        // A limiter failure is handled like a local-method result; it never exposes detail.
      }
      if (!allowed) {
        clearContinuation(c);
        return c.json({ next: "local" as const });
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        clearContinuation(c);
        return c.json({ next: "local" as const });
      }
      const bodyRecord = body as Record<string, unknown>;
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) => key !== "email" && key !== "invitationId",
        ) ||
        !("email" in body) ||
        ("invitationId" in bodyRecord &&
          (typeof bodyRecord.invitationId !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/u.test(bodyRecord.invitationId)))
      ) {
        clearContinuation(c);
        return c.json({ next: "local" as const });
      }

      const requestBody = bodyRecord;
      const domain = emailDomain(requestBody.email);
      const invitationId =
        typeof requestBody.invitationId === "string"
          ? requestBody.invitationId
          : undefined;
      body = null;
      if (!domain) {
        clearContinuation(c);
        return c.json({ next: "local" as const });
      }

      try {
        const connectionId = await resolveDomain(domain);
        if (!connectionId) {
          clearContinuation(c);
          return c.json({ next: "local" as const });
        }
        const continuation = sealHomeRealmContinuation({
          connectionId,
          domain,
          ...(invitationId ? { invitationId } : {}),
        });
        setCookie(c, HOME_REALM_CONTINUATION_COOKIE, continuation, {
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
          path: "/",
          maxAge: HOME_REALM_CONTINUATION_TTL_SECONDS,
        });
        return c.json({ next: "sso" as const });
      } catch {
        clearContinuation(c);
        logTaskDesk({
          module: "auth",
          message: "auth.failure",
          level: "warn",
          result: "failed",
        });
        return c.json({ next: "local" as const });
      }
    },
  );

  routes.get("/portal/sign-in/home-realm/start", async (c) => {
    c.header("Cache-Control", "no-store");
    const token = getCookie(c, HOME_REALM_CONTINUATION_COOKIE);
    clearContinuation(c);
    if (new URL(c.req.url).search) return genericFailure(c);
    const continuation = token ? openHomeRealmContinuation(token) : null;
    if (!continuation) return genericFailure(c);

    try {
      const connection = await getConnection(
        continuation.connectionId,
        continuation.domain,
      );
      if (!connection) return genericFailure(c);
      const start = await startAuthorization({
        connection,
        portal: "customer",
        ...(continuation.invitationId
          ? { invitationId: continuation.invitationId }
          : {}),
        revalidate: async () =>
          Boolean(
            await getConnection(continuation.connectionId, continuation.domain),
          ),
      });
      if (!start) return genericFailure(c);
      setCookie(
        c,
        oidcStateCookieName(start.secure),
        start.state,
        oidcStateCookieOptions(start.secure),
      );
      return c.redirect(start.authorizationUrl, 302);
    } catch {
      logTaskDesk({
        module: "auth",
        message: "auth.failure",
        level: "warn",
        result: "failed",
      });
      return genericFailure(c);
    }
  });

  return routes;
}
