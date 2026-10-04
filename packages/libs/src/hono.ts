/// <reference types="vite/types/importMeta.d.ts" />

import type {
  CoreAppType,
  CreateRequestTypeInput,
  FeatureFlagsApiType,
  IntakeQueueDto,
  IntakeSubmissionDto,
  RequestTypeDto,
  RequestTypeListDto,
  UpdateRequestTypeInput,
} from "@taskdesk/api";
import type { Hono } from "hono";
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

async function readCsrfToken(
  fetchImpl: typeof fetch,
  endpoint: URL,
): Promise<string> {
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
  return payload.token;
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
export function createApiFetch(
  fetchImpl: typeof fetch = fetch,
  options: ApiFetchOptions = {},
) {
  const baseUrlValue = options.apiBaseUrl ?? apiUrl;
  const baseUrl = new URL(
    baseUrlValue,
    globalThis.location?.origin ?? "http://localhost",
  );
  const csrfEndpoint = new URL(
    `${baseUrl.pathname.replace(/\/$/, "")}/me/csrf-token`,
    baseUrl.origin,
  );

  return async (input: RequestInfo | URL, init?: RequestInit) => {
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
    const needsCsrf = !safeMethods.has(method) && !isBetterAuthRoute;

    const requestInit = needsCsrf
      ? { ...init, redirect: "error" as const }
      : init;
    const request = requestWithHeaders(input, requestInit, headers, "include");
    if (!needsCsrf) return fetchImpl(request);

    // Keep the request body replayable for the single, narrowly-scoped retry.
    const retryBase = request.clone();
    request.headers.set(
      "X-TaskDesk-CSRF",
      await readCsrfToken(fetchImpl, csrfEndpoint),
    );
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
}

export const apiFetch = createApiFetch();

export const client = hc<CoreAppType>(apiUrl, {
  fetch: apiFetch,
});

function clientAt<T extends Hono<any, any, any>>(path: string) {
  return hc<T>(`${apiUrl.replace(/\/$/u, "")}${path}`, { fetch: apiFetch });
}

// Keep these route families fully typed while avoiding one monolithic Hono
// client instantiation across the full API route union.
export const featureFlagsClient = clientAt<FeatureFlagsApiType>("");
async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${apiUrl.replace(/\/$/u, "")}${path}`, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

async function requestTypeCall<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return apiCall(`/request-types${path}`, init);
}

export const intakeApiCall = apiCall;
export type { IntakeQueueDto, IntakeSubmissionDto };

/** Contract-derived request-type client; recursive form JSON is kept out of Hono's path inference. */
export const requestTypeClient = {
  list(input: { workspaceId: string }): Promise<RequestTypeListDto> {
    const query = new URLSearchParams({ workspaceId: input.workspaceId });
    return requestTypeCall(`/?${query.toString()}`);
  },
  create(input: CreateRequestTypeInput): Promise<RequestTypeDto> {
    return requestTypeCall("/", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  update(id: string, input: UpdateRequestTypeInput): Promise<RequestTypeDto> {
    return requestTypeCall(`/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  publish(id: string): Promise<RequestTypeDto> {
    return requestTypeCall(`/${encodeURIComponent(id)}/publish`, {
      method: "POST",
    });
  },
  unpublish(id: string): Promise<RequestTypeDto> {
    return requestTypeCall(`/${encodeURIComponent(id)}/unpublish`, {
      method: "POST",
    });
  },
  delete(id: string): Promise<RequestTypeDto> {
    return requestTypeCall(`/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
