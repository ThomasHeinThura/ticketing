import { getConfiguredAgentOrigin } from "../../../apps/api/src/auth";
import type { App } from "./organization-http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function cookieValue(cookieHeader: string, name: string): string | undefined {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
}

/**
 * Make one explicit same-origin cookie-session API mutation for integration tests.
 * The helper uses the production CSRF issuer and middleware; callers that test
 * missing/foreign origins or invalid tokens must continue using `app.request` directly.
 */
export async function csrfRequest(
  app: App,
  input: string | URL,
  init: RequestInit,
  sessionCookie: string,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) {
    throw new Error("csrfRequest is only for unsafe custom API requests");
  }
  const origin = getConfiguredAgentOrigin();
  const target = new URL(input, origin);
  if (target.origin !== origin || !target.pathname.startsWith("/api/")) {
    throw new Error("csrfRequest only accepts same-origin API paths");
  }
  if (!cookieValue(sessionCookie, "__Host-tdk_agent_session")) {
    throw new Error("csrfRequest requires an agent session cookie");
  }

  const issuerResponse = await app.request("/api/me/csrf-token", {
    headers: { cookie: sessionCookie, origin },
  });
  if (!issuerResponse.ok) {
    throw new Error(`CSRF issuer returned ${issuerResponse.status}`);
  }
  const issued = (await issuerResponse.json()) as {
    token?: unknown;
    expiresAt?: unknown;
  };
  if (
    typeof issued.token !== "string" ||
    typeof issued.expiresAt !== "string"
  ) {
    throw new Error("CSRF issuer returned an invalid token response");
  }

  const csrfCookieName =
    new URL(origin).protocol === "https:" ? "__Host-tdk_csrf" : "tdk_csrf_dev";
  const csrfSetCookie = issuerResponse.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${csrfCookieName}=`));
  const csrfCookie = csrfSetCookie?.split(";", 1)[0];
  const headers = new Headers(init.headers);
  const requestCookie = headers.get("cookie") ?? sessionCookie;
  const existingCsrfCookie = cookieValue(requestCookie, csrfCookieName);
  if (!existingCsrfCookie && !csrfCookie) {
    throw new Error("CSRF issuer reused a token without a matching cookie");
  }
  headers.set(
    "cookie",
    existingCsrfCookie ? requestCookie : `${requestCookie}; ${csrfCookie}`,
  );
  headers.set("x-taskdesk-csrf", issued.token);
  if (!headers.has("origin")) headers.set("origin", origin);

  return app.request(input, { ...init, headers });
}
