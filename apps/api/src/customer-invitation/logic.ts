import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Customer invitations (feature-contracts-p3.md CP-20..CP-26). Pure helpers: the accept
 * credential, the derived status and the role rule. No I/O.
 */

/** The only role a customer-scope invitation may carry (CP-21). */
export const CUSTOMER_INVITATION_ROLE = "customer" as const;

/** The two values of `invitation.scope`. */
export const INVITATION_SCOPES = ["staff", "customer"] as const;

/**
 * Defaults for what CP-22 and CP-26 call instance configuration. The instance settings screen does
 * not carry these values yet, so they are named here, in one place, rather than scattered.
 */
export const CUSTOMER_INVITATION_LIMITS = {
  /** The existing invitation lifetime (the staff flow uses the same 48 hours). */
  lifetimeMs: 48 * 60 * 60 * 1000,
  /** Creates per inviter per window. */
  perInviter: 20,
  /** Creates per organisation per window. */
  perOrganisation: 50,
  windowMs: 60 * 60 * 1000,
  /** Minimum gap between two sends of the same invitation. */
  resendCooldownMs: 60 * 1000,
} as const;

export type CustomerInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

/**
 * The status an agent sees. The row stores `pending`, `accepted` or `canceled` (this app's one
 * vocabulary for revoked and declined); `expired` is derived from the clock, never stored.
 */
export function customerInvitationStatus(input: {
  status: string;
  expiresAt: Date;
  now: Date;
}): CustomerInvitationStatus {
  if (input.status === "accepted") return "accepted";
  if (input.status === "canceled") return "revoked";
  if (input.expiresAt.getTime() <= input.now.getTime()) return "expired";
  return "pending";
}

/** 256 bits from the CSPRNG, URL-safe. Shown once, in the email link fragment; never stored. */
export function newCredential(): { credential: string; hash: string } {
  const credential = randomBytes(32).toString("base64url");
  return { credential, hash: hashCredential(credential) };
}

export function hashCredential(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

/** Constant-time comparison of a presented credential against the stored hash. */
export function credentialMatches(
  storedHash: string | null,
  presented: string,
): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(storedHash, "utf8");
  const b = Buffer.from(hashCredential(presented), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The accept link. The credential travels in the fragment, so it is never sent to a server log. */
export function buildAcceptLink(
  portalOrigin: string,
  invitationId: string,
  credential: string,
): string {
  const origin = portalOrigin.replace(/\/+$/, "");
  return `${origin}/invite/${encodeURIComponent(invitationId)}#t=${credential}`;
}

export function normaliseInviteeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * CP-21 at write: only the literal `customer` role is accepted. Anything else (a staff or custom
 * role, `instance:admin`, `owner`, a team or a workspace-level grant) is a refusal.
 */
export function isAssignableCustomerRole(role: unknown): boolean {
  return role === CUSTOMER_INVITATION_ROLE;
}

/** CP-21 at accept: the stored row must still be a well-formed customer-scope invitation. */
export function isWellFormedCustomerInvitation(row: {
  scope: string;
  role: string | null;
  organisationId: string | null;
  teamId: string | null;
}): boolean {
  return (
    row.scope === "customer" &&
    row.role === CUSTOMER_INVITATION_ROLE &&
    row.organisationId !== null &&
    row.teamId === null
  );
}
