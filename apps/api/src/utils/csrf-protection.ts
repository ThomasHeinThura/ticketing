import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { getConfiguredAgentOrigin, signCsrfPayload } from "../auth";

const TOKEN_LIFETIME_MS = 10 * 60 * 1000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_COOKIE_NAMES = ["__Host-tdk_agent_session"] as const;
const TOKEN_CLAIM_KEYS = [
  "version",
  "sessionId",
  "origin",
  "issuedAt",
  "expiresAt",
  "nonce",
];

type CsrfClaims = {
  version: 1;
  sessionId: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type CsrfSourceResult = { ok: true; origin: string } | { ok: false };

function sourceOrigin(
  context: Context,
  allowFetchMetadata: boolean,
): CsrfSourceResult {
  const expected = getConfiguredAgentOrigin();
  const originHeader = context.req.header("origin");
  if (originHeader !== undefined) {
    if (originHeader === "null") return { ok: false };
    try {
      const parsed = new URL(originHeader);
      if (
        parsed.origin !== originHeader ||
        parsed.username ||
        parsed.password ||
        parsed.origin !== expected
      )
        return { ok: false };
      return { ok: true, origin: parsed.origin };
    } catch {
      return { ok: false };
    }
  }

  const referer = context.req.header("referer");
  if (referer !== undefined) {
    try {
      const parsed = new URL(referer);
      if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username ||
        parsed.password ||
        parsed.origin !== expected
      ) {
        return { ok: false };
      }
      return { ok: true, origin: parsed.origin };
    } catch {
      return { ok: false };
    }
  }

  // A same-origin GET fetch does not always include Origin or Referer when the
  // document sets a strict referrer policy. Fetch Metadata is browser-controlled.
  if (
    allowFetchMetadata &&
    context.req.header("sec-fetch-site") === "same-origin"
  ) {
    return { ok: true, origin: expected };
  }
  return { ok: false };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function cookieValues(
  cookieHeader: string | undefined,
  name: string,
): string[] {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0 || part.slice(0, separator) !== name) return [];
      return [part.slice(separator + 1)];
    });
}

function csrfCookieName(origin: string): string {
  return new URL(origin).protocol === "https:"
    ? "__Host-tdk_csrf"
    : "tdk_csrf_dev";
}

function parseToken(
  token: string,
  sessionId: string,
  origin: string,
): CsrfClaims | null {
  if (token.length > 2048) return null;
  const separator = token.indexOf(".");
  if (separator <= 0 || token.indexOf(".", separator + 1) >= 0) return null;
  const payloadText = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(signature)) return null;
  if (!constantTimeEqual(signature, signCsrfPayload(payloadText))) return null;

  try {
    const json = Buffer.from(payloadText, "base64url").toString("utf8");
    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return null;
    const entries = Object.keys(payload as Record<string, unknown>);
    if (
      entries.length !== TOKEN_CLAIM_KEYS.length ||
      entries.some((key) => !TOKEN_CLAIM_KEYS.includes(key))
    )
      return null;
    const claims = payload as CsrfClaims;
    const now = Date.now();
    if (
      claims.version !== 1 ||
      claims.sessionId !== sessionId ||
      claims.origin !== origin ||
      !Number.isSafeInteger(claims.issuedAt) ||
      !Number.isSafeInteger(claims.expiresAt) ||
      claims.issuedAt > now + 30_000 ||
      claims.expiresAt <= now ||
      claims.expiresAt - claims.issuedAt !== TOKEN_LIFETIME_MS ||
      claims.expiresAt > now + TOKEN_LIFETIME_MS + 30_000 ||
      !/^[A-Za-z0-9_-]{22}$/u.test(claims.nonce)
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}

export function issueCsrfToken(
  context: Context,
  sessionId: string,
  origin: string,
): {
  token: string;
  expiresAt: string;
  reused: boolean;
} {
  const name = csrfCookieName(origin);
  const existingCookies = cookieValues(context.req.header("cookie"), name);
  const existing =
    existingCookies.length === 1 ? existingCookies[0] : undefined;
  const verified = existing ? parseToken(existing, sessionId, origin) : null;
  if (existing && verified) {
    return {
      token: existing,
      expiresAt: new Date(verified.expiresAt).toISOString(),
      reused: true,
    };
  }

  const issuedAt = Date.now();
  const claims: CsrfClaims = {
    version: 1,
    sessionId,
    origin,
    issuedAt,
    expiresAt: issuedAt + TOKEN_LIFETIME_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const payloadText = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  const token = `${payloadText}.${signCsrfPayload(payloadText)}`;
  setCookie(context, name, token, {
    httpOnly: true,
    maxAge: TOKEN_LIFETIME_MS / 1000,
    path: "/",
    sameSite: "Strict",
    secure: new URL(origin).protocol === "https:",
  });
  return {
    token,
    expiresAt: new Date(claims.expiresAt).toISOString(),
    reused: false,
  };
}

export function requireSameOriginIssuer(context: Context): string {
  const source = sourceOrigin(context, true);
  if (!source.ok || context.get("appOrigin") !== "agent") {
    throw new HTTPException(403, { message: "csrf_origin_invalid" });
  }
  return source.origin;
}

export function csrfProtectionMiddleware() {
  return async (context: Context, next: Next) => {
    if (SAFE_METHODS.has(context.req.method.toUpperCase())) return next();
    // Only an actually resolved key is a non-ambient credential exemption.
    if (context.get("apiKey")) return next();

    const session = context.get("session") as {
      id?: string;
      userId?: string;
      portal?: string;
    } | null;
    if (!session) return next();
    const cookieHeader = context.req.header("cookie");
    const hasSessionCookie = SESSION_COOKIE_NAMES.some(
      (name) => cookieValues(cookieHeader, name).length > 0,
    );
    if (!hasSessionCookie) return next();

    const source = sourceOrigin(context, false);
    if (
      !source.ok ||
      context.get("appOrigin") !== "agent" ||
      session.portal !== "agent"
    ) {
      return context.json({ message: "csrf_origin_invalid" as const }, 403);
    }
    const cookieName = csrfCookieName(source.origin);
    const cookie = cookieValues(cookieHeader, cookieName);
    const header = context.req.header("x-taskdesk-csrf");
    if (cookie.length !== 1 || !header) {
      return context.json({ message: "csrf_token_missing" as const }, 403);
    }
    if (!constantTimeEqual(cookie[0]!, header)) {
      return context.json({ message: "csrf_token_mismatch" as const }, 403);
    }
    if (
      !session.id ||
      !session.userId ||
      session.userId !== context.get("userId") ||
      !parseToken(header, session.id, source.origin)
    ) {
      return context.json({ message: "csrf_token_invalid" as const }, 403);
    }
    return next();
  };
}
