import { TERMINOLOGY_LOCALES } from "@taskdesk/domain";
import {
  checkCandidateBootPrerequisites,
  findActiveTwoFactorChallenge,
  findCandidateSignInUserByEmail,
  findCandidateSignInUserById,
  findVerifiedTwoFactorByUserId,
} from "./candidate-read-only.repository";
import { policyRegistry } from "./policy-registry";
import { parseCandidateReadOnly, parseTaskDeskRole } from "./runtime-role";

type CompiledRouteMatcher = {
  routeKey: string;
  method: string;
  pathPattern: string;
  segments: readonly string[];
  hasWildcard: boolean;
  literalCount: number;
};

function parseRouteKey(routeKey: string): {
  method: string;
  pathPattern: string;
} {
  const spaceIndex = routeKey.indexOf(" ");
  if (spaceIndex <= 0) {
    return { method: "", pathPattern: routeKey };
  }
  return {
    method: routeKey.slice(0, spaceIndex).toUpperCase(),
    pathPattern: routeKey.slice(spaceIndex + 1),
  };
}

const compiledGetRoutes: readonly CompiledRouteMatcher[] =
  policyRegistry.entries
    .map(({ routeKey }): CompiledRouteMatcher | null => {
      const { method, pathPattern } = parseRouteKey(routeKey);
      if (method !== "GET" && method !== "ALL") {
        return null;
      }
      const segments = pathPattern.split("/").filter(Boolean);
      const hasWildcard = segments.includes("*");
      const literalCount = segments.filter(
        (seg) => seg !== "*" && !seg.startsWith("{") && !seg.startsWith(":"),
      ).length;
      return {
        routeKey,
        method,
        pathPattern,
        segments,
        hasWildcard,
        literalCount,
      };
    })
    .filter((entry): entry is CompiledRouteMatcher => entry !== null)
    .sort((a, b) => {
      // Exact / parameterized routes before wildcard routes, then more literal segments first
      if (a.hasWildcard !== b.hasWildcard) {
        return a.hasWildcard ? 1 : -1;
      }
      return b.literalCount - a.literalCount;
    });

function matchesCompiledRoute(
  matcher: CompiledRouteMatcher,
  requestSegments: readonly string[],
): boolean {
  const { segments } = matcher;
  for (let i = 0; i < segments.length; i++) {
    const patternSeg = segments[i];
    if (patternSeg === "*") {
      return requestSegments.length >= i + 1;
    }
    if (i >= requestSegments.length) {
      return false;
    }
    const reqSeg = requestSegments[i];
    if (!reqSeg) {
      return false;
    }
    if (
      (patternSeg?.startsWith("{") && patternSeg.endsWith("}")) ||
      patternSeg?.startsWith(":")
    ) {
      continue;
    }
    if (patternSeg !== reqSeg) {
      return false;
    }
  }
  return requestSegments.length === segments.length;
}

export function resolveRegisteredRouteKey(
  method: string,
  pathname: string,
): string | null {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== "GET") {
    return null;
  }
  const requestSegments = pathname.split("/").filter(Boolean);
  for (const matcher of compiledGetRoutes) {
    if (matchesCompiledRoute(matcher, requestSegments)) {
      return matcher.routeKey;
    }
  }
  return null;
}

export const CANDIDATE_READ_ONLY_ERROR_CODE = "CANDIDATE_READ_ONLY_FORBIDDEN";
export const CANDIDATE_READ_ONLY_ERROR_MESSAGE =
  "Request blocked by candidate read-only mode.";

export const CANDIDATE_ALLOWED_POST_PATHS = new Set<string>([
  "/api/auth/sign-in/email",
  "/api/auth/two-factor/verify-totp",
  "/api/auth/sign-out",
]);

export const CANDIDATE_ALLOWED_AUTH_MUTATION_SUBPATHS = new Set<string>([
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/sign-out",
]);

/**
 * Minimum positive A8-3 API GET route keys permitted in candidate read-only mode.
 * Every other API GET route is denied fail-closed before reaching downstream handlers.
 */
export const CANDIDATE_ALLOWED_API_GET_ROUTE_KEYS = new Set<string>([
  "GET /api/health",
  "GET /api/public/health/live",
  "GET /api/public/health/ready",
  "GET /api/config",
  "GET /api/auth/get-session",
  "GET /api/public/terminology",
  "GET /api/me/security/factors",
  "GET /api/me/csrf-token",
  "GET /api/me/settings",
  "GET /api/workspace",
  "GET /api/workspace/{workspaceId}/members",
  "GET /api/capabilities",
  "GET /api/workspaces/{workspaceId}/features/resolved",
  "GET /api/workspaces/{workspaceId}/terminology/runtime",
  "GET /api/request-types",
  "GET /api/request-type-groups/order",
  "GET /api/workspace/{workspaceId}/work-item-types",
  "GET /api/custom-fields",
  "GET /api/workspaces/{workspaceId}/terminology",
  "GET /api/request-types/{id}",
]);

/**
 * Declared non-API HTML navigation paths permitted for candidate sign-in and A8-3 acceptance.
 */
export const CANDIDATE_ALLOWED_HTML_PATHS = new Set<string>([
  "/auth/sign-in",
  "/auth/two-factor",
  "/dashboard/settings/workspace/request-types",
  "/dashboard/settings/workspace/terminology",
]);

export const CANDIDATE_ALLOWED_SIGN_IN_REDIRECTS = new Set<string>([
  "/dashboard/settings/workspace/request-types",
  "/dashboard/settings/workspace/terminology",
]);

/**
 * Signed build root static asset paths permitted alongside hashed /assets/* bundles.
 */
export const CANDIDATE_ALLOWED_STATIC_ROOT_FILES = new Set<string>([
  "/apple-touch-icon.png",
  "/favicon-96x96.png",
  "/favicon.ico",
  "/favicon.svg",
  "/logo-dark.svg",
  "/logo-light.svg",
  "/site.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
]);

const CONTENT_HASHED_ASSET_PATH =
  /^\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/u;
const VALID_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const ALLOWED_TERMINOLOGY_LOCALES = new Set<string>(TERMINOLOGY_LOCALES);

/**
 * Registered GET route keys that perform database writes, token consumption,
 * lazy creation/repair, audit-log writes, export generation, or WebSocket upgrades,
 * and therefore are classified as effectful GET routes in candidate read-only mode.
 */
export const CANDIDATE_DENIED_GET_ROUTE_KEYS = new Set<string>([
  // Auth / SSO / OAuth / WebSocket
  "GET /api/auth/*",
  "GET /api/auth/device",
  "GET /api/portal/sign-in/home-realm/start",
  "GET /api/oauth/id-token",
  "GET /api/me/identity-links/intents/{intentId}",
  "GET /api/ws",
  "GET /api/ws/user",
  "GET /api/ws/{projectId}",
  "GET /api/ws/portal/notification",

  // Invitations (auto-expire / token-consuming)
  "GET /api/invitation/public/{id}",
  "GET /api/invitation/pending",
  "GET /api/invitation/{id}",
  "GET /api/workspace/{workspaceId}/invitations",
  "GET /api/workspace/{workspaceId}/organisations/{organisationId}/invitations",
  "GET /api/portal/invitations/{id}/continuation-result",

  // Token-consuming notification handoffs
  "GET /api/notification-preferences/email-link-handoff",
  "GET /api/portal/notification-preferences/email-link-handoff",

  // Exports & import dry-run mutations
  "GET /api/task/export/{projectId}",
  "GET /api/portal/requests/export.csv",
  "GET /api/report-exports",
  "GET /api/report-exports/{id}",
  "GET /api/report-exports/{id}/download",
  "GET /api/imports/{id}/dry-run-all",

  // Attachment downloads & previews (append attachment.downloaded audit log)
  "GET /api/attachments/{id}",
  "GET /api/attachments/{id}/preview",
  "GET /api/submissions/{ref}/attachments/{id}",
  "GET /api/submissions/{ref}/attachments/{id}/preview",
  "GET /api/portal/submissions/{ref}/attachments/{id}",
  "GET /api/portal/submissions/{ref}/attachments/{id}/preview",
  "GET /api/portal/requests/{ref}/attachments/{id}",
  "GET /api/storage/filesystem-download",
  "GET /api/storage/portal-download",

  // Audit log reads & reconstruct (append audit.read audit log)
  "GET /api/instance/audit",
  "GET /api/workspaces/{workspaceId}/audit",
  "GET /api/audit/entity/{type}/{id}",
  "GET /api/work-items/{key}/reconstruct",
]);

export type CandidateGateDecision =
  | {
      allowed: true;
      reason:
        | "candidate_mode_inactive"
        | "allowed_password_sign_in"
        | "allowed_existing_totp_verify"
        | "allowed_session_sign_out"
        | "allowed_read_only_route";
    }
  | {
      allowed: false;
      status: 401 | 403;
      reason:
        | "totp_verify_body_forbidden"
        | "cross_origin_auth_post_forbidden"
        | "trust_device_cookie_forbidden"
        | "sign_out_without_session_forbidden"
        | "websocket_upgrade_forbidden"
        | "api_key_or_bearer_forbidden"
        | "method_not_allowed"
        | "unregistered_route_forbidden"
        | "effectful_get_route_forbidden"
        | "non_allowlisted_get_route_forbidden"
        | "invalid_query_parameters"
        | "totp_enrollment_verify_forbidden";
    };

export function isCandidateReadOnlyActive(options?: {
  role?: string;
  candidateReadOnly?: string;
}): boolean {
  const role = parseTaskDeskRole(options?.role ?? process.env.TASKDESK_ROLE);
  return parseCandidateReadOnly(
    options?.candidateReadOnly ?? process.env.TASKDESK_CANDIDATE_READ_ONLY,
    role,
  );
}

export function normalizeRequestPathname(pathname: string): string {
  const qIndex = pathname.indexOf("?");
  const rawPath = qIndex >= 0 ? pathname.slice(0, qIndex) : pathname;
  if (!rawPath || rawPath === "/") {
    return "/";
  }
  const collapsed = rawPath.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 && collapsed.endsWith("/")
    ? collapsed.slice(0, -1)
    : collapsed;
}

function extractRawQueryString(
  pathname: string,
  search?: string,
  url?: string,
): string {
  if (typeof search === "string" && search.length > 0) {
    return search.startsWith("?") ? search.slice(1) : search;
  }
  const qIndex = pathname.indexOf("?");
  if (qIndex >= 0) {
    return pathname.slice(qIndex + 1);
  }
  if (typeof url === "string" && url.length > 0) {
    const urlQIndex = url.indexOf("?");
    if (urlQIndex >= 0) {
      const hashIndex = url.indexOf("#", urlQIndex);
      return hashIndex >= 0
        ? url.slice(urlQIndex + 1, hashIndex)
        : url.slice(urlQIndex + 1);
    }
  }
  return "";
}

function parseStrictQueryParams(
  rawQuery: string,
): { ok: true; params: Map<string, string> } | { ok: false } {
  const params = new Map<string, string>();
  if (!rawQuery) {
    return { ok: true, params };
  }
  if (
    rawQuery.startsWith("&") ||
    rawQuery.endsWith("&") ||
    rawQuery.includes("&&")
  ) {
    return { ok: false };
  }
  for (const part of rawQuery.split("&")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) {
      return { ok: false };
    }
    const rawKey = part.slice(0, eqIndex);
    const rawValue = part.slice(eqIndex + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      value = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch {
      return { ok: false };
    }
    if (!key || params.has(key)) {
      return { ok: false };
    }
    params.set(key, value);
  }
  return { ok: true, params };
}

function isValidIdentifier(
  value: string | undefined,
  approvedId?: string,
): boolean {
  if (!value || !VALID_IDENTIFIER_PATTERN.test(value)) {
    return false;
  }
  if (approvedId !== undefined && value !== approvedId) {
    return false;
  }
  return true;
}

function isValidLocale(
  value: string | undefined,
  approvedLocale?: string,
): boolean {
  if (!value || !ALLOWED_TERMINOLOGY_LOCALES.has(value)) {
    return false;
  }
  if (approvedLocale !== undefined && value !== approvedLocale) {
    return false;
  }
  return true;
}

function validateAllowedApiGetParameters(input: {
  routeKey: string;
  pathname: string;
  params: Map<string, string>;
  approvedWorkspaceId?: string;
  approvedRequestTypeId?: string;
  approvedLocale?: string;
}): boolean {
  const {
    routeKey,
    pathname,
    params,
    approvedWorkspaceId,
    approvedRequestTypeId,
    approvedLocale,
  } = input;
  const segments = pathname.split("/").filter(Boolean);

  switch (routeKey) {
    case "GET /api/health":
    case "GET /api/public/health/live":
    case "GET /api/public/health/ready":
    case "GET /api/config":
    case "GET /api/me/security/factors":
    case "GET /api/me/csrf-token":
    case "GET /api/me/settings":
    case "GET /api/workspace":
      return params.size === 0;

    case "GET /api/auth/get-session": {
      for (const [key, value] of params.entries()) {
        if (
          (key !== "disableCookieCache" && key !== "disableRefresh") ||
          value !== "true"
        ) {
          return false;
        }
      }
      return true;
    }

    case "GET /api/public/terminology":
      return (
        params.size === 1 && isValidLocale(params.get("locale"), approvedLocale)
      );

    case "GET /api/workspace/{workspaceId}/members":
    case "GET /api/workspace/{workspaceId}/work-item-types":
    case "GET /api/workspaces/{workspaceId}/features/resolved":
    case "GET /api/workspaces/{workspaceId}/terminology":
      return (
        params.size === 0 && isValidIdentifier(segments[2], approvedWorkspaceId)
      );

    case "GET /api/workspaces/{workspaceId}/terminology/runtime":
      return (
        isValidIdentifier(segments[2], approvedWorkspaceId) &&
        params.size === 1 &&
        isValidLocale(params.get("locale"), approvedLocale)
      );

    case "GET /api/capabilities":
    case "GET /api/request-types":
    case "GET /api/request-type-groups/order":
    case "GET /api/custom-fields":
      return (
        params.size === 1 &&
        isValidIdentifier(params.get("workspaceId"), approvedWorkspaceId)
      );

    case "GET /api/request-types/{id}":
      return (
        params.size === 0 &&
        isValidIdentifier(segments[2], approvedRequestTypeId)
      );

    default:
      return false;
  }
}

function validateAllowedNonApiGet(input: {
  pathname: string;
  params: Map<string, string>;
  approvedRequestTypeId?: string;
}):
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "unregistered_route_forbidden"
        | "non_allowlisted_get_route_forbidden"
        | "invalid_query_parameters";
    } {
  const { pathname, params, approvedRequestTypeId } = input;

  if (pathname === "/scim" || pathname.startsWith("/scim/")) {
    return { allowed: false, reason: "unregistered_route_forbidden" };
  }

  if (
    CANDIDATE_ALLOWED_STATIC_ROOT_FILES.has(pathname) ||
    CONTENT_HASHED_ASSET_PATH.test(pathname)
  ) {
    if (params.size > 0) {
      return { allowed: false, reason: "invalid_query_parameters" };
    }
    return { allowed: true };
  }

  if (!CANDIDATE_ALLOWED_HTML_PATHS.has(pathname)) {
    return { allowed: false, reason: "non_allowlisted_get_route_forbidden" };
  }

  if (pathname === "/auth/sign-in" || pathname === "/auth/two-factor") {
    if (params.size === 0) {
      return { allowed: true };
    }
    const redirect = params.get("redirect");
    if (
      params.size === 1 &&
      redirect !== undefined &&
      CANDIDATE_ALLOWED_SIGN_IN_REDIRECTS.has(redirect)
    ) {
      return { allowed: true };
    }
    return { allowed: false, reason: "invalid_query_parameters" };
  }

  if (pathname === "/dashboard/settings/workspace/request-types") {
    if (params.size === 0) {
      return { allowed: true };
    }
    if (
      params.size === 1 &&
      isValidIdentifier(params.get("requestTypeId"), approvedRequestTypeId)
    ) {
      return { allowed: true };
    }
    return { allowed: false, reason: "invalid_query_parameters" };
  }

  // pathname === "/dashboard/settings/workspace/terminology"
  if (params.size > 0) {
    return { allowed: false, reason: "invalid_query_parameters" };
  }
  return { allowed: true };
}

function hasForbiddenCandidateCredentialHeader(headers: Headers): boolean {
  const authorization = headers.get("authorization")?.trim();
  if (authorization && authorization.length > 0) {
    return true;
  }
  const apiKey = headers.get("x-api-key")?.trim();
  if (apiKey && apiKey.length > 0) {
    return true;
  }
  return false;
}

function isWebSocketUpgradeRequest(
  pathname: string,
  headers: Headers,
): boolean {
  const upgrade = headers.get("upgrade")?.trim().toLowerCase();
  if (upgrade === "websocket") {
    return true;
  }
  return pathname === "/api/ws" || pathname.startsWith("/api/ws/");
}

function parseCookieNames(cookieHeader: string | null): Set<string> {
  const names = new Set<string>();
  if (!cookieHeader) {
    return names;
  }
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    const rawName = eqIndex >= 0 ? trimmed.slice(0, eqIndex).trim() : trimmed;
    if (!rawName) continue;
    names.add(rawName);
    const strippedSecurePrefix = rawName.replace(/^__(Secure|Host)-/i, "");
    names.add(strippedSecurePrefix);
  }
  return names;
}

export function hasTwoFactorChallengeCookie(headers: Headers): boolean {
  const cookieNames = parseCookieNames(headers.get("cookie"));
  for (const name of cookieNames) {
    const normalized = name.toLowerCase();
    if (
      normalized === "better-auth.two_factor" ||
      normalized.endsWith(".two_factor") ||
      normalized === "two_factor" ||
      normalized.startsWith("two_factor.")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Better Auth's `trust_device` cookie lets a later password sign-in skip TOTP and mints a
 * session without a second factor; it is never honoured or issued in candidate mode.
 */
export function hasTrustDeviceCookie(headers: Headers): boolean {
  for (const name of parseCookieNames(headers.get("cookie"))) {
    const normalized = name.toLowerCase();
    if (
      normalized === "trust_device" ||
      normalized === "trust-device" ||
      normalized.endsWith("trust_device") ||
      normalized.endsWith("trust-device")
    ) {
      return true;
    }
  }
  return false;
}

/** Same-origin allow-list for candidate auth POSTs: the configured agent/portal origins. */
function candidateAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const value of [
    process.env.TASKDESK_AGENT_URL || "http://localhost:5173",
    process.env.TASKDESK_PORTAL_URL || "http://localhost:5174",
  ]) {
    try {
      origins.add(new URL(value).origin);
    } catch {
      // An unparsable configured origin never matches a request origin.
    }
  }
  return origins;
}

function hasAllowedCandidateOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  return origin !== null && candidateAllowedOrigins().has(origin);
}

/**
 * The only `verify-totp` body the candidate accepts: a non-empty `code` and, optionally,
 * `trustDevice: false`. `trustDevice: true` would persist a 30-day second-factor bypass.
 */
export function isAllowedCandidateVerifyTotpBody(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (
    !Object.keys(record).every((key) => key === "code" || key === "trustDevice")
  )
    return false;
  if (typeof record.code !== "string" || record.code.trim().length === 0)
    return false;
  return record.trustDevice === undefined || record.trustDevice === false;
}

/**
 * Inspects a candidate auth POST body at the HTTP gate without consuming the request
 * stream Better Auth reads (a clone is parsed). Only `verify-totp` has a body contract.
 */
export async function evaluateCandidateAuthPostBody(input: {
  pathname: string;
  request: Request;
  candidateReadOnly?: boolean;
}): Promise<CandidateGateDecision> {
  const active = input.candidateReadOnly ?? isCandidateReadOnlyActive();
  if (
    !active ||
    input.request.method.toUpperCase() !== "POST" ||
    normalizeRequestPathname(input.pathname) !==
      "/api/auth/two-factor/verify-totp"
  ) {
    return { allowed: true, reason: "candidate_mode_inactive" };
  }
  let body: unknown;
  try {
    body = await input.request.clone().json();
  } catch {
    body = undefined;
  }
  if (!isAllowedCandidateVerifyTotpBody(body)) {
    return {
      allowed: false,
      status: 403,
      reason: "totp_verify_body_forbidden",
    };
  }
  return { allowed: true, reason: "allowed_existing_totp_verify" };
}

export function hasActiveSessionTokenCookie(headers: Headers): boolean {
  const cookieNames = parseCookieNames(headers.get("cookie"));
  for (const name of cookieNames) {
    const normalized = name.toLowerCase();
    if (
      normalized === "tdk_agent_session" ||
      normalized === "tdk_portal_session" ||
      normalized.startsWith("tdk_agent_session.") ||
      normalized.startsWith("tdk_portal_session.") ||
      normalized === "better-auth.session_token" ||
      normalized.endsWith(".session_token") ||
      normalized === "session_token" ||
      normalized.startsWith("session_token.")
    ) {
      return true;
    }
  }
  return false;
}

export function evaluateCandidateReadOnlyRequest(input: {
  method: string;
  pathname: string;
  search?: string;
  url?: string;
  headers: Headers;
  candidateReadOnly?: boolean;
  approvedWorkspaceId?: string;
  approvedRequestTypeId?: string;
  approvedLocale?: string;
}): CandidateGateDecision {
  const active = input.candidateReadOnly ?? isCandidateReadOnlyActive();
  if (!active) {
    return { allowed: true, reason: "candidate_mode_inactive" };
  }

  const method = input.method.toUpperCase();
  const pathname = normalizeRequestPathname(input.pathname);
  const rawQuery = extractRawQueryString(
    input.pathname,
    input.search,
    input.url,
  );
  const parsedQuery = parseStrictQueryParams(rawQuery);

  if (isWebSocketUpgradeRequest(pathname, input.headers)) {
    return {
      allowed: false,
      status: 403,
      reason: "websocket_upgrade_forbidden",
    };
  }

  if (hasForbiddenCandidateCredentialHeader(input.headers)) {
    return {
      allowed: false,
      status: 403,
      reason: "api_key_or_bearer_forbidden",
    };
  }

  if (method === "POST") {
    if (!CANDIDATE_ALLOWED_POST_PATHS.has(pathname)) {
      return {
        allowed: false,
        status: 403,
        reason: "method_not_allowed",
      };
    }

    if (!parsedQuery.ok || parsedQuery.params.size > 0) {
      return {
        allowed: false,
        status: 403,
        reason: "invalid_query_parameters",
      };
    }

    if (!hasAllowedCandidateOrigin(input.headers)) {
      return {
        allowed: false,
        status: 403,
        reason: "cross_origin_auth_post_forbidden",
      };
    }

    if (hasTrustDeviceCookie(input.headers)) {
      return {
        allowed: false,
        status: 403,
        reason: "trust_device_cookie_forbidden",
      };
    }

    if (pathname === "/api/auth/sign-in/email") {
      return {
        allowed: true,
        reason: "allowed_password_sign_in",
      };
    }

    if (pathname === "/api/auth/sign-out") {
      // Revokes the caller's own session only; the session itself (and that it is not an
      // impersonation session) is verified against the store at the auth handler.
      if (!hasActiveSessionTokenCookie(input.headers)) {
        return {
          allowed: false,
          status: 401,
          reason: "sign_out_without_session_forbidden",
        };
      }
      return { allowed: true, reason: "allowed_session_sign_out" };
    }

    // pathname === "/api/auth/two-factor/verify-totp"
    // Only existing TOTP sign-in challenge verification is permitted in candidate mode.
    // Logged-in TOTP enrollment verification carries a session token cookie or lacks a 2FA challenge cookie.
    if (
      hasActiveSessionTokenCookie(input.headers) ||
      !hasTwoFactorChallengeCookie(input.headers)
    ) {
      return {
        allowed: false,
        status: 403,
        reason: "totp_enrollment_verify_forbidden",
      };
    }

    return {
      allowed: true,
      reason: "allowed_existing_totp_verify",
    };
  }

  // Only GET is permitted for candidate read/navigation/asset requests (no HEAD)
  if (method !== "GET") {
    return {
      allowed: false,
      status: 403,
      reason: "method_not_allowed",
    };
  }

  if (pathname !== "/api" && !pathname.startsWith("/api/")) {
    if (!parsedQuery.ok) {
      return {
        allowed: false,
        status: 403,
        reason: "invalid_query_parameters",
      };
    }
    const nonApiDecision = validateAllowedNonApiGet({
      pathname,
      params: parsedQuery.params,
      approvedRequestTypeId: input.approvedRequestTypeId,
    });
    if (!nonApiDecision.allowed) {
      return {
        allowed: false,
        status: 403,
        reason: nonApiDecision.reason,
      };
    }
    return {
      allowed: true,
      reason: "allowed_read_only_route",
    };
  }

  const resolvedRouteKey = resolveRegisteredRouteKey("GET", pathname);
  if (!resolvedRouteKey) {
    return {
      allowed: false,
      status: 403,
      reason: "unregistered_route_forbidden",
    };
  }

  if (CANDIDATE_DENIED_GET_ROUTE_KEYS.has(resolvedRouteKey)) {
    return {
      allowed: false,
      status: 403,
      reason: "effectful_get_route_forbidden",
    };
  }

  const parsed = parseRouteKey(resolvedRouteKey);
  if (
    parsed.pathPattern.startsWith("/api/auth/") &&
    resolvedRouteKey !== "GET /api/auth/get-session"
  ) {
    return {
      allowed: false,
      status: 403,
      reason: "effectful_get_route_forbidden",
    };
  }

  if (!CANDIDATE_ALLOWED_API_GET_ROUTE_KEYS.has(resolvedRouteKey)) {
    return {
      allowed: false,
      status: 403,
      reason: "non_allowlisted_get_route_forbidden",
    };
  }

  if (
    !parsedQuery.ok ||
    !validateAllowedApiGetParameters({
      routeKey: resolvedRouteKey,
      pathname,
      params: parsedQuery.params,
      approvedWorkspaceId: input.approvedWorkspaceId,
      approvedRequestTypeId: input.approvedRequestTypeId,
      approvedLocale: input.approvedLocale,
    })
  ) {
    return {
      allowed: false,
      status: 403,
      reason: "invalid_query_parameters",
    };
  }

  return {
    allowed: true,
    reason: "allowed_read_only_route",
  };
}

export function createCandidateReadOnlyForbiddenResponse(
  decision?: Extract<CandidateGateDecision, { allowed: false }>,
): Response {
  return new Response(
    JSON.stringify({
      code: CANDIDATE_READ_ONLY_ERROR_CODE,
      message: CANDIDATE_READ_ONLY_ERROR_MESSAGE,
      reason: decision?.reason ?? "method_not_allowed",
    }),
    {
      status: decision?.status ?? 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function isUserBannedOrHasBanMetadata(user: {
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
}): boolean {
  return (
    user.banned === true || user.banExpires != null || user.banReason != null
  );
}

/**
 * Verifies that an auth hook invocation in candidate read-only mode is strictly
 * limited to:
 * 1) Agent-portal password sign-in (`POST /sign-in/email`) for an existing, non-banned,
 *    staff-side user with an active workspace membership and either password-only or
 *    already-verified TOTP state.
 * 2) Existing TOTP sign-in verification (`POST /two-factor/verify-totp`) backed by a live
 *    2FA sign-in challenge and an existing verified `two_factor` row (never factor enrollment).
 */
export async function assertCandidateReadOnlyAuthActionAllowed(input: {
  path: string;
  method?: string;
  portal?: "agent" | "customer";
  headers?: Headers;
  body?: unknown;
  existingSessionUserId?: string | null;
  sessionImpersonatedBy?: string | null;
  twoFactorCookieValue?: string | null;
}): Promise<
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
    }
> {
  if (input.portal && input.portal !== "agent") {
    return {
      allowed: false,
      reason: "customer_portal_auth_forbidden",
    };
  }

  const normalizedSubpath = normalizeRequestPathname(input.path);
  const method = (input.method ?? "GET").toUpperCase();

  if (method === "GET") {
    if (normalizedSubpath === "/get-session") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "auth_get_subpath_forbidden",
    };
  }

  if (method !== "POST") {
    return {
      allowed: false,
      reason: "auth_method_forbidden",
    };
  }

  if (!CANDIDATE_ALLOWED_AUTH_MUTATION_SUBPATHS.has(normalizedSubpath)) {
    return {
      allowed: false,
      reason: "auth_subpath_forbidden",
    };
  }

  if (input.headers && hasTrustDeviceCookie(input.headers)) {
    return { allowed: false, reason: "trust_device_cookie_forbidden" };
  }

  if (normalizedSubpath === "/sign-out") {
    if (!input.headers || !hasActiveSessionTokenCookie(input.headers)) {
      return { allowed: false, reason: "sign_out_without_session_forbidden" };
    }
    if (input.headers && !hasAllowedCandidateOrigin(input.headers)) {
      return { allowed: false, reason: "cross_origin_auth_post_forbidden" };
    }
    if (!input.existingSessionUserId) {
      return { allowed: false, reason: "sign_out_without_session_forbidden" };
    }
    if (input.sessionImpersonatedBy) {
      return { allowed: false, reason: "impersonation_sign_out_forbidden" };
    }
    return { allowed: true };
  }

  if (
    normalizedSubpath === "/two-factor/verify-totp" &&
    !isAllowedCandidateVerifyTotpBody(input.body)
  ) {
    return { allowed: false, reason: "totp_verify_body_forbidden" };
  }

  if (normalizedSubpath === "/sign-in/email") {
    const email =
      typeof (input.body as { email?: unknown } | null)?.email === "string"
        ? (input.body as { email: string }).email.trim().toLowerCase()
        : "";
    if (!email) {
      return { allowed: true };
    }

    const existingUser = await findCandidateSignInUserByEmail(email);
    if (existingUser && "ambiguousEmail" in existingUser) {
      return { allowed: false, reason: "ambiguous_email_forbidden" };
    }
    if (!existingUser) {
      return { allowed: true };
    }

    if (isUserBannedOrHasBanMetadata(existingUser)) {
      return {
        allowed: false,
        reason: "banned_or_expired_ban_user_forbidden",
      };
    }

    if (existingUser.isCustomerSidePerson === true) {
      return {
        allowed: false,
        reason: "wrong_portal_user_forbidden",
      };
    }

    if (existingUser.hasActiveWorkspaceMembership === false) {
      return {
        allowed: false,
        reason: "missing_active_workspace_membership_forbidden",
      };
    }

    // If user has twoFactorEnabled === true, verify they actually have a verified two_factor row
    if (existingUser.twoFactorEnabled === true) {
      const verifiedFactor = await findVerifiedTwoFactorByUserId(
        existingUser.id,
      );
      if (!verifiedFactor) {
        return {
          allowed: false,
          reason: "incomplete_totp_enrollment_forbidden",
        };
      }
    }

    return { allowed: true };
  }

  // normalizedSubpath === "/two-factor/verify-totp"
  if (
    input.existingSessionUserId ||
    (input.headers && hasActiveSessionTokenCookie(input.headers))
  ) {
    return {
      allowed: false,
      reason: "totp_enrollment_verify_forbidden",
    };
  }

  if (input.headers && !hasTwoFactorChallengeCookie(input.headers)) {
    return {
      allowed: false,
      reason: "missing_two_factor_challenge_cookie",
    };
  }

  const rawCookie = input.twoFactorCookieValue?.trim() ?? "";
  if (!rawCookie) {
    return {
      allowed: false,
      reason: "missing_two_factor_challenge_cookie",
    };
  }

  // Better Auth signed cookies may append ".<signature>"; check both raw value and base identifier
  const dotIndex = rawCookie.indexOf(".");
  const candidateIdentifiers =
    dotIndex > 0 ? [rawCookie, rawCookie.slice(0, dotIndex)] : [rawCookie];

  let challengeRecord:
    | Awaited<ReturnType<typeof findActiveTwoFactorChallenge>>
    | null
    | undefined;
  for (const identifier of candidateIdentifiers) {
    challengeRecord = await findActiveTwoFactorChallenge(identifier);
    if (challengeRecord) {
      break;
    }
  }

  if (!challengeRecord) {
    return {
      allowed: false,
      reason: "missing_active_two_factor_challenge",
    };
  }

  if (challengeRecord.expiresAt.getTime() <= Date.now()) {
    return {
      allowed: false,
      reason: "expired_two_factor_challenge",
    };
  }

  const userId = challengeRecord.value.trim();
  const [userRecord, verifiedFactor] = await Promise.all([
    findCandidateSignInUserById(userId),
    findVerifiedTwoFactorByUserId(userId),
  ]);

  if (!userRecord) {
    return {
      allowed: false,
      reason: "totp_not_already_enrolled",
    };
  }

  if (isUserBannedOrHasBanMetadata(userRecord)) {
    return {
      allowed: false,
      reason: "banned_or_expired_ban_user_forbidden",
    };
  }

  if (userRecord.isCustomerSidePerson === true) {
    return {
      allowed: false,
      reason: "wrong_portal_user_forbidden",
    };
  }

  if (userRecord.hasActiveWorkspaceMembership === false) {
    return {
      allowed: false,
      reason: "missing_active_workspace_membership_forbidden",
    };
  }

  if (userRecord.twoFactorEnabled !== true || !verifiedFactor) {
    return {
      allowed: false,
      reason: "totp_not_already_enrolled",
    };
  }

  return { allowed: true };
}

/**
 * Verifies that the copied candidate database already has the required schema and baseline
 * rows before the candidate read-only web process starts serving, without executing any
 * boot-time seed, repair, or purge writes.
 */
export async function assertCandidateServingBootPrerequisites(): Promise<void> {
  const status = await checkCandidateBootPrerequisites();
  const missing: string[] = [];

  if (!status.hasUserTable) {
    missing.push("user table");
  }
  if (!status.hasSessionTable) {
    missing.push("session table");
  }
  if (!status.hasVerificationTable) {
    missing.push("verification table");
  }
  if (!status.hasTwoFactorTable) {
    missing.push("two_factor table");
  }
  if (!status.hasWorkspaceTable) {
    missing.push("workspace table");
  }
  if (!status.hasWorkspaceRoleTable) {
    missing.push("workspace_role table");
  }
  if (!status.hasInternalOrganisation) {
    missing.push("seeded internal organisation");
  }
  if (!status.hasCanonicalWorkspaceRoles) {
    missing.push("seeded workspace_role rows");
  }
  if (status.hasActiveWorkspaceFixture === false) {
    missing.push("active workspace membership fixture");
  }
  if (status.hasActiveImpersonationSessions === true) {
    missing.push("no active impersonation sessions");
  }

  if (missing.length > 0) {
    throw new Error(
      `Candidate read-only serving boot prerequisites missing (${missing.join(", ")}); serving-boot seed/repair/purge writes are disabled in candidate read-only mode.`,
    );
  }
}
