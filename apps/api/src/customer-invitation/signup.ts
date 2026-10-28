import db from "../database";
import {
  credentialMatches,
  isWellFormedCustomerInvitation,
  normaliseInviteeEmail,
} from "./logic";
import {
  findInvitationForSignUp,
  findLiveCustomerOrganisation,
} from "./repository";
import { auditRefusal } from "./service";

/**
 * Invitation-gated sign-up on the portal host (CP-12, CP-24). Portal registration is closed
 * everywhere except one narrow door: a sign-up request that carries a live customer invitation
 * credential whose invited address equals the sign-up address. This module only decides that; the
 * Better Auth hooks in `auth.ts` call it twice (request pre-check and user-create guard) and then
 * run the existing locked accept transaction in the same request.
 *
 * The credential travels in the request body only (never a query string or header), is compared in
 * constant time against the stored hash, and is never logged, audited or echoed.
 */

export const INVITE_SIGN_UP_ID_FIELD = "invitationId";
export const INVITE_SIGN_UP_CREDENTIAL_FIELD = "invitationCredential";

/** The one refusal text for every failed invitation sign-up; it never says which check failed. */
export const INVITE_SIGN_UP_REFUSED = "This invitation is no longer valid.";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export type InviteSignUpCredential = {
  invitationId: string;
  credential: string;
};

/** The id and credential from a JSON body, or null when either is missing or malformed. */
export function readInviteSignUpBody(
  body: unknown,
): InviteSignUpCredential | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const invitationId = record[INVITE_SIGN_UP_ID_FIELD];
  const credential = record[INVITE_SIGN_UP_CREDENTIAL_FIELD];
  if (
    typeof invitationId !== "string" ||
    typeof credential !== "string" ||
    !ID_PATTERN.test(invitationId) ||
    !CREDENTIAL_PATTERN.test(credential)
  )
    return null;
  return { invitationId, credential };
}

export type SignUpRefusal =
  | "no_credential"
  | "not_found"
  | "scope_mismatch"
  | "role_refused"
  | "not_pending"
  | "expired"
  | "credential_mismatch"
  | "organisation_unavailable"
  | "address_mismatch";

export type SignUpVerdict =
  | { ok: true; organisationId: string; workspaceId: string }
  | {
      ok: false;
      reason: SignUpRefusal;
      organisationId: string | null;
      workspaceId: string | null;
    };

/**
 * Non-consuming check of a sign-up request against its invitation. A staff-scope invitation, a
 * row that is no longer a well-formed customer invitation, an expired, revoked or accepted one, a
 * wrong credential and a different address are all refused.
 */
export async function verifyInviteSignUp(input: {
  body: unknown;
  email: string | null | undefined;
}): Promise<SignUpVerdict> {
  const presented = readInviteSignUpBody(input.body);
  if (!presented)
    return {
      ok: false,
      reason: "no_credential",
      organisationId: null,
      workspaceId: null,
    };
  const row = await findInvitationForSignUp(db, presented.invitationId);
  if (!row)
    return {
      ok: false,
      reason: "not_found",
      organisationId: null,
      workspaceId: null,
    };
  const refuse = (reason: SignUpRefusal): SignUpVerdict => ({
    ok: false,
    reason,
    organisationId: row.organisationId,
    workspaceId: row.workspaceId,
  });
  if (row.scope !== "customer") return refuse("scope_mismatch");
  if (!isWellFormedCustomerInvitation(row)) return refuse("role_refused");
  if (row.status !== "pending") return refuse("not_pending");
  if (row.expiresAt.getTime() <= Date.now()) return refuse("expired");
  if (!credentialMatches(row.credentialHash, presented.credential))
    return refuse("credential_mismatch");
  const organisationId = row.organisationId as string;
  if (!(await findLiveCustomerOrganisation(db, organisationId)))
    return refuse("organisation_unavailable");
  if (
    typeof input.email !== "string" ||
    normaliseInviteeEmail(input.email) !== normaliseInviteeEmail(row.email)
  )
    return refuse("address_mismatch");
  return { ok: true, organisationId, workspaceId: row.workspaceId };
}

/**
 * Audit a refused sign-up: reason code and entity ids only, never the credential or address.
 *
 * The door is unauthenticated, so only a refusal tied to a real invitation is worth an
 * append-only row: a request with no credential, or naming an invitation that does not exist,
 * could be repeated by anyone to fill the log. Those stay visible in the request log (route and
 * 403 status class) only. Returns whether a row was written.
 */
export async function auditSignUpRefusal(
  verdict: Extract<SignUpVerdict, { ok: false }>,
  invitationId: string | null,
): Promise<boolean> {
  if (
    !invitationId ||
    verdict.reason === "no_credential" ||
    verdict.reason === "not_found"
  )
    return false;
  await auditRefusal({
    actorId: null,
    workspaceId: verdict.workspaceId,
    organisationId: verdict.organisationId,
    invitationId,
    reason: `signup_${verdict.reason}`,
  });
  return true;
}
