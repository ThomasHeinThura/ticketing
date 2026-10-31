/// <reference types="vite/types/importMeta.d.ts" />

import type { AppType } from "@taskdesk/api";
import { hc } from "hono/client";
import { resolveApiBaseUrl } from "./api-url";

const apiUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL);

// Generate once per tab load
export const windowId = Math.random().toString(36).substring(2, 11);

const csrfFailureMessages = new Set([
  "csrf_origin_invalid",
  "csrf_token_missing",
  "csrf_token_mismatch",
  "csrf_token_invalid",
]);
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export interface ApiFetchOptions {
  /** Configured client base, including the API path; injectable for tests. */
  apiBaseUrl?: string;
  /**
   * Whether unsafe requests obtain and send the agent session CSRF token from
   * `/me/csrf-token`. That issuer is an agent-only route (CP-19: the portal host
   * returns 404 for it), so the customer portal build must not call it; portal
   * unsafe requests are protected server-side by an exact portal Origin check.
   * Defaults to false for the Vite `portal` mode and true otherwise.
   */
  agentCsrfToken?: boolean;
}

function resolvedUrl(input: RequestInfo | URL, baseUrl: URL): URL | undefined {
  try {
    const value = input instanceof Request ? input.url : input.toString();
    return new URL(value, baseUrl);
  } catch {
    return undefined;
  }
}

function isWithinApiPath(target: URL, base: URL): boolean {
  const apiPath = base.pathname.replace(/\/$/, "");
  return (
    target.pathname === apiPath || target.pathname.startsWith(`${apiPath}/`)
  );
}

function mergeHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const requestHeaders = input instanceof Request ? input.headers : undefined;
  const headers = new Headers(requestHeaders);
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

function requestWithHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  headers: Headers,
  credentials: RequestCredentials,
): Request {
  return new Request(input, { ...init, headers, credentials });
}

/** A primed token is not sent when it expires within this margin; a fresh one is read instead. */
const PRIMED_TOKEN_EXPIRY_MARGIN_MS = 30_000;

async function readCsrfToken(
  fetchImpl: typeof fetch,
  endpoint: URL,
): Promise<string> {
  return (await readCsrfTokenWithExpiry(fetchImpl, endpoint)).token;
}

async function readCsrfTokenWithExpiry(
  fetchImpl: typeof fetch,
  endpoint: URL,
): Promise<{ token: string; expiry: number }> {
  const response = await fetchImpl(endpoint, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Unable to obtain CSRF token");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Unable to obtain CSRF token");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("token" in payload) ||
    typeof payload.token !== "string" ||
    payload.token.length === 0 ||
    !("expiresAt" in payload) ||
    typeof payload.expiresAt !== "string"
  ) {
    throw new Error("Unable to obtain CSRF token");
  }
  const expiry = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new Error("Unable to obtain CSRF token");
  }
  return { token: payload.token, expiry };
}

async function csrfFailureMessage(
  response: Response,
): Promise<string | undefined> {
  if (response.status !== 403) return undefined;
  try {
    const payload: unknown = await response.clone().json();
    if (
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
    ) {
      return payload.message;
    }
  } catch {
    // A non-JSON 403 is not a CSRF retry signal.
  }
  return undefined;
}

/**
 * Add TaskDesk's common request headers and session-bound CSRF protection to
 * first-party API calls. Foreign origins receive no ambient credentials or
 * TaskDesk headers. Auth bootstrap routes retain Better Auth's own origin
 * protection and do not use the custom API CSRF issuer.
 */
export type ApiFetch = ((
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>) & {
  /**
   * Starts reading the session CSRF token before the first unsafe request needs it (called by
   * the signed-in agent shell), so that request does not wait one extra round trip for the
   * issuer. Only the first call per page load reads; the token is used by one request, after
   * which every unsafe request reads its own token as before. A no-op where the agent token is
   * disabled (the portal build).
   */
  primeCsrfToken: () => void;
};

export function createApiFetch(
  fetchImpl: typeof fetch = fetch,
  options: ApiFetchOptions = {},
): ApiFetch {
  const baseUrlValue = options.apiBaseUrl ?? apiUrl;
  const agentCsrfToken =
    options.agentCsrfToken ?? import.meta.env.MODE !== "portal";
  const baseUrl = new URL(
    baseUrlValue,
    globalThis.location?.origin ?? "http://localhost",
  );
  const csrfEndpoint = new URL(
    `${baseUrl.pathname.replace(/\/$/, "")}/me/csrf-token`,
    baseUrl.origin,
  );

  let primeRequested = false;
  let primedToken: Promise<{ token: string; expiry: number }> | undefined;
  const primeCsrfToken = () => {
    if (!agentCsrfToken || primeRequested) return;
    primeRequested = true;
    const read = readCsrfTokenWithExpiry(fetchImpl, csrfEndpoint);
    // A failed prime is dropped; the request that needs a token reads its own.
    read.catch(() => {
      if (primedToken === read) primedToken = undefined;
    });
    primedToken = read;
  };
  const takeCsrfToken = async () => {
    const primed = primedToken;
    primedToken = undefined;
    if (primed) {
      try {
        const { token, expiry } = await primed;
        if (expiry - PRIMED_TOKEN_EXPIRY_MARGIN_MS > Date.now()) return token;
      } catch {
        // Fall through to a fresh read.
      }
    }
    return readCsrfToken(fetchImpl, csrfEndpoint);
  };

  const apiFetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = resolvedUrl(input, baseUrl);
    const isFirstPartyApi =
      target?.origin === baseUrl.origin &&
      target !== undefined &&
      isWithinApiPath(target, baseUrl);

    if (!isFirstPartyApi || !target) {
      const headers = mergeHeaders(input, init);
      headers.delete("authorization");
      headers.delete("proxy-authorization");
      headers.delete("cookie");
      headers.delete("x-api-key");
      headers.delete("api-key");
      headers.delete("x-auth-token");
      for (const name of [...headers.keys()]) {
        if (name.startsWith("x-taskdesk-")) headers.delete(name);
      }
      return fetchImpl(input, { ...init, headers, credentials: "omit" });
    }

    const headers = mergeHeaders(input, init);
    headers.set("Content-Type", "application/json");
    headers.set("X-TaskDesk-Window-Id", windowId);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const authBasePath = `${baseUrl.pathname.replace(/\/$/, "")}/auth`;
    const isBetterAuthRoute =
      target.pathname === authBasePath ||
      target.pathname.startsWith(`${authBasePath}/`);
    const needsCsrf =
      agentCsrfToken && !safeMethods.has(method) && !isBetterAuthRoute;

    const requestInit = needsCsrf
      ? { ...init, redirect: "error" as const }
      : init;
    const request = requestWithHeaders(input, requestInit, headers, "include");
    if (!needsCsrf) return fetchImpl(request);

    // Keep the request body replayable for the single, narrowly-scoped retry.
    const retryBase = request.clone();
    request.headers.set("X-TaskDesk-CSRF", await takeCsrfToken());
    const response = await fetchImpl(request);
    const failureMessage = await csrfFailureMessage(response);
    if (!failureMessage || !csrfFailureMessages.has(failureMessage)) {
      return response;
    }

    const retryHeaders = new Headers(retryBase.headers);
    retryHeaders.set(
      "X-TaskDesk-CSRF",
      await readCsrfToken(fetchImpl, csrfEndpoint),
    );
    return fetchImpl(
      requestWithHeaders(retryBase, undefined, retryHeaders, "include"),
    );
  };
  return Object.assign(apiFetchImpl, { primeCsrfToken });
}

export const apiFetch = createApiFetch();

/** Primes the shared client's session CSRF token; see {@link ApiFetch.primeCsrfToken}. */
export function primeCsrfToken() {
  apiFetch.primeCsrfToken();
}

export const client = hc<AppType>(apiUrl, {
  fetch: apiFetch,
});
