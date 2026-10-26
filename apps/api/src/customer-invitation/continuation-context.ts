/** Shared request-context parsing for short-lived customer invitation continuations. */
export const CUSTOMER_INVITATION_CONTINUATION_TTL_SECONDS = 300;
const COOKIE_PREFIX = "__Host-tdk_customer_invite_";

const idPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const noncePattern = /^[A-Za-z0-9_-]{43}$/u;

export function customerInvitationContinuationCookieName(
  invitationId: string,
): string {
  if (!idPattern.test(invitationId)) throw new Error("Invalid invitation id");
  return `${COOKIE_PREFIX}${invitationId}`;
}

function readCookie(headers: Headers, name: string): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const entry of cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    const value = entry.slice(separator + 1).trim();
    return noncePattern.test(value) ? value : null;
  }
  return null;
}

function idFromCallback(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value, "https://portal.invalid");
    const match = /^\/invite\/([A-Za-z0-9_-]{1,128})\/?$/u.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * IDs are routing hints only; authority comes from the matching HttpOnly nonce cookie and the
 * database's current invitation/continuation state. Never read a credential from this context.
 */
export function readCustomerInvitationContinuationContext(input: {
  headers?: Headers | null;
  invitationId?: unknown;
  callbackURL?: unknown;
}): { invitationId: string; nonce: string } | null {
  const headers = input.headers;
  if (!headers) return null;
  const candidates = [
    input.invitationId,
    headers.get("x-taskdesk-invitation-id"),
    idFromCallback(input.callbackURL),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !idPattern.test(candidate)) continue;
    const nonce = readCookie(
      headers,
      customerInvitationContinuationCookieName(candidate),
    );
    if (nonce) return { invitationId: candidate, nonce };
  }
  return null;
}
