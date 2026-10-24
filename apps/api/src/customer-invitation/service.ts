import type { ResolvedIdentity } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import {
  CUSTOMER_INVITATION_LIMITS,
  credentialMatches,
  hashCredential,
  isAssignableCustomerRole,
  newCredential,
  normaliseInviteeEmail,
} from "./logic";
import {
  isEmailProviderConfigured,
  sendCustomerInvitationEmail,
} from "./mailer";
import {
  type AcceptRefusal,
  addressCannotBeInvited,
  countRecentCreates,
  findCanonicalCustomerRoleId,
  findInvitableOrganisation,
  findLiveCustomerOrganisation,
  findOrganisationName,
  findPersonByUser,
  findUserForAccept,
  insertCustomerInvitation,
  insertCustomerMembership,
  insertCustomerPerson,
  isWellFormedCustomerInvitation,
  lockCustomerInvitation,
  lockInvitationForAccept,
  lockPendingForAddress,
  markAccepted,
  rotateCredential,
  toView,
} from "./repository";

export type InviteActor = {
  userId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};

type Scope = { workspaceId: string; organisationId: string };

/**
 * Audit a refusal outside the failed transaction. Request metadata only: the entity id, the
 * organisation and a reason code. Never the credential and never the invitee address (CP-25).
 */
export async function auditRefusal(input: {
  actorId: string | null;
  workspaceId?: string | null;
  organisationId?: string | null;
  invitationId: string;
  reason: string;
}) {
  try {
    await appendAuditLog(db, {
      actorId: input.actorId,
      actorType: input.actorId ? "person" : "system",
      workspaceId: input.workspaceId ?? null,
      organisationId: input.organisationId ?? null,
      action: "permission.denied",
      entityType: "invitation",
      entityId: input.invitationId,
      before: null,
      after: { scope: "customer_invitation", reason: input.reason },
    });
  } catch {
    // The refusal itself already stands; a failed audit write must not turn it into a 500.
  }
}

async function auditSent(
  tx: Executor,
  actor: InviteActor,
  scope: Scope,
  invitationId: string,
  resend: boolean,
) {
  await appendAuditLog(tx, {
    actorId: actor.userId,
    actorType: actor.actorType,
    apiKeyId: actor.apiKeyId,
    workspaceId: scope.workspaceId,
    organisationId: scope.organisationId,
    action: "invitation.sent",
    entityType: "invitation",
    entityId: invitationId,
    before: null,
    after: { scope: "customer", resend },
  });
}

async function inviterIdentity(userId: string) {
  const [row] = await db
    .select({ name: schema.userTable.name, email: schema.userTable.email })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return { name: row?.name ?? "", email: row?.email ?? "" };
}

/**
 * The `delivered` answer of create and resend: whether an email provider is configured at all,
 * read the same way for an inert row (which sends nothing) as for a real send. The per-send
 * transport outcome never reaches the response, so the answer cannot reveal whether an address
 * has an account elsewhere (CP-22). A failed send is logged server-side and audited.
 */
async function deliverInvitation(
  inert: boolean,
  actor: InviteActor,
  scope: Scope,
  invitationId: string,
  resend: boolean,
  mail: Parameters<typeof sendCustomerInvitationEmail>[0],
): Promise<boolean> {
  const delivered = await isEmailProviderConfigured();
  if (inert) return delivered;
  const sent = await sendCustomerInvitationEmail(mail);
  if (!sent && delivered) {
    console.error(`customer invitation ${invitationId}: email send failed`);
    try {
      await appendAuditLog(db, {
        actorId: actor.userId,
        actorType: actor.actorType,
        apiKeyId: actor.apiKeyId,
        workspaceId: scope.workspaceId,
        organisationId: scope.organisationId,
        action: "invitation.sent",
        entityType: "invitation",
        entityId: invitationId,
        before: null,
        after: { scope: "customer", resend, delivery: "failed" },
      });
    } catch {
      // The response must not depend on the audit write either.
    }
  }
  return delivered;
}

function isUniqueViolation(error: unknown): boolean {
  const code = error as { code?: string; cause?: { code?: string } } | null;
  return code?.code === "23505" || code?.cause?.code === "23505";
}

function refuse(status: 404 | 409 | 422 | 429, message: string): never {
  throw new HTTPException(status, { message });
}

/** CP-21 at write: a body that names anything beyond the address, or a non-customer role. */
export async function assertCreateBodyIsCustomerOnly(
  body: Record<string, unknown>,
  actor: InviteActor,
  scope: Scope,
) {
  const extra = Object.keys(body).filter((key) => key !== "email");
  const roleOk = !("role" in body) || isAssignableCustomerRole(body.role);
  if (
    extra.length === 0 ||
    (extra.length === 1 && extra[0] === "role" && roleOk)
  )
    return;
  await auditRefusal({
    actorId: actor.userId,
    workspaceId: scope.workspaceId,
    organisationId: scope.organisationId,
    invitationId: "none",
    reason: "role_refused_at_write",
  });
  refuse(422, "A customer invitation can only grant the customer role");
}

export async function createCustomerInvitation(input: {
  actor: InviteActor;
  identity: ResolvedIdentity;
  scope: Scope;
  email: string;
}) {
  const email = normaliseInviteeEmail(input.email);
  const now = new Date();
  const since = new Date(now.getTime() - CUSTOMER_INVITATION_LIMITS.windowMs);
  const issued = newCredential();
  const expiresAt = new Date(
    now.getTime() + CUSTOMER_INVITATION_LIMITS.lifetimeMs,
  );

  const created = await db
    .transaction(async (tx) => {
      const organisation = await findInvitableOrganisation(
        tx,
        input.scope.workspaceId,
        input.scope.organisationId,
        input.identity,
      );
      if (!organisation) refuse(404, "Organisation not found");

      // CP-26 first: every create counts, including one for an address that can never accept, so
      // the limit also bounds probing for which addresses have an account.
      if (
        (await countRecentCreates(
          tx,
          { inviterId: input.actor.userId },
          since,
        )) >= CUSTOMER_INVITATION_LIMITS.perInviter ||
        (await countRecentCreates(
          tx,
          { organisationId: organisation.id },
          since,
        )) >= CUSTOMER_INVITATION_LIMITS.perOrganisation
      )
        refuse(429, "Too many invitations were created recently");

      const existing = await lockPendingForAddress(tx, organisation.id, email);
      if (existing && existing.expiresAt.getTime() > now.getTime())
        refuse(409, "An invitation for this address is already pending");

      // An address that could never accept here (a member, staff anywhere, a customer of another
      // organisation, a deactivated customer) gets the same answer as any other: an inert pending
      // row with no credential hash (accept can never match it), no email, and the reason in the
      // audit trail only (CP-25). The caller cannot tell it from a real invitation.
      const inert = await addressCannotBeInvited(tx, organisation.id, email);

      // An expired pending row for the same address is renewed in place (the partial unique index
      // allows one pending row per address); a fresh row is inserted otherwise.
      const row = existing
        ? await rotateCredential(tx, existing.id, {
            credentialHash: inert ? null : issued.hash,
            expiresAt,
            now,
            renewedBy: input.actor.userId,
          })
        : await insertCustomerInvitation(tx, {
            workspaceId: input.scope.workspaceId,
            organisationId: organisation.id,
            email,
            inviterId: input.actor.userId,
            credentialHash: inert ? null : issued.hash,
            expiresAt,
            now,
          });
      if (!row) refuse(409, "The invitation could not be created");
      await auditSent(tx, input.actor, input.scope, row.id, false);
      if (inert)
        await appendAuditLog(tx, {
          actorId: input.actor.userId,
          actorType: input.actor.actorType,
          apiKeyId: input.actor.apiKeyId,
          workspaceId: input.scope.workspaceId,
          organisationId: organisation.id,
          action: "permission.denied",
          entityType: "invitation",
          entityId: row.id,
          before: null,
          after: {
            scope: "customer_invitation",
            reason: "address_not_invitable",
          },
        });
      return { row, organisationName: organisation.name, inert };
    })
    .catch((error: unknown) => {
      // Two creates for the same address can both find no pending row; the partial unique index
      // lets exactly one through, and the other is the "already pending" refusal.
      if (isUniqueViolation(error))
        refuse(409, "An invitation for this address is already pending");
      throw error;
    });

  const inviter = await inviterIdentity(input.actor.userId);
  const delivered = await deliverInvitation(
    created.inert,
    input.actor,
    input.scope,
    created.row.id,
    false,
    {
      invitationId: created.row.id,
      email,
      organisationName: created.organisationName,
      inviterName: inviter.name,
      inviterEmail: inviter.email,
      credential: issued.credential,
    },
  );
  return { ...toView(created.row, now), delivered };
}

export async function resendCustomerInvitation(input: {
  actor: InviteActor;
  identity: ResolvedIdentity;
  scope: Scope;
  invitationId: string;
}) {
  const now = new Date();
  const issued = newCredential();
  const expiresAt = new Date(
    now.getTime() + CUSTOMER_INVITATION_LIMITS.lifetimeMs,
  );
  const result = await db.transaction(async (tx) => {
    // Reach first and the same body as a missing invitation: an organisation outside the caller's
    // reach must be indistinguishable from one that has no such invitation.
    const organisation = await findInvitableOrganisation(
      tx,
      input.scope.workspaceId,
      input.scope.organisationId,
      input.identity,
    );
    if (!organisation) refuse(404, "Invitation not found");
    const row = await lockCustomerInvitation(
      tx,
      input.scope.workspaceId,
      input.scope.organisationId,
      input.invitationId,
    );
    if (!row) refuse(404, "Invitation not found");
    if (row.status !== "pending")
      refuse(409, "Only a pending invitation can be resent");
    if (
      row.lastSentAt &&
      now.getTime() - row.lastSentAt.getTime() <
        CUSTOMER_INVITATION_LIMITS.resendCooldownMs
    )
      refuse(429, "This invitation was sent a moment ago");
    // An inert row (no credential hash) is re-evaluated: once its address can be invited it gets
    // a credential and a normal send; while it cannot, nothing is minted and nothing is sent.
    const inert =
      row.credentialHash === null &&
      (await addressCannotBeInvited(
        tx,
        organisation.id,
        normaliseInviteeEmail(row.email),
      ));
    const updated = await rotateCredential(tx, row.id, {
      credentialHash: inert ? null : issued.hash,
      expiresAt,
      now,
    });
    if (!updated) refuse(409, "Only a pending invitation can be resent");
    await auditSent(tx, input.actor, input.scope, row.id, true);
    return { updated, organisationName: organisation.name, inert };
  });

  const inviter = await inviterIdentity(input.actor.userId);
  const delivered = await deliverInvitation(
    result.inert,
    input.actor,
    input.scope,
    result.updated.id,
    true,
    {
      invitationId: result.updated.id,
      email: result.updated.email,
      organisationName: result.organisationName,
      inviterName: inviter.name,
      inviterEmail: inviter.email,
      credential: issued.credential,
    },
  );
  return { ...toView(result.updated, now), delivered };
}

class AcceptRefused extends Error {
  constructor(
    readonly reason: AcceptRefusal,
    readonly organisationId: string | null,
    readonly workspaceId: string | null,
  ) {
    super(reason);
  }
}

/**
 * CP-24 accept. Runs in one transaction: re-reads the invitation under a row lock, re-validates
 * its scope and role (CP-21), checks the credential, expiry, organisation and the session's
 * verified address, then creates the customer person (if none) and the organisation membership
 * and consumes the invitation through a conditional update that affects exactly one row.
 *
 * Every refusal throws the same generic 404 to the caller; the reason goes to the audit trail.
 * Accepting never creates an agent session.
 */
export async function acceptCustomerInvitation(input: {
  userId: string;
  invitationId: string;
  credential: string;
  /** Set by invitation-gated sign-up, which accepts in the same request (CP-12). */
  via?: "sign_up";
}): Promise<{ organisationId: string; personId: string }> {
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const row = await lockInvitationForAccept(tx, input.invitationId);
      if (!row) throw new AcceptRefused("not_found", null, null);
      const known = [row.organisationId, row.workspaceId] as const;
      const fail = (reason: AcceptRefusal): never => {
        throw new AcceptRefused(reason, known[0], known[1]);
      };
      if (row.scope !== "customer") fail("scope_mismatch");
      if (!isWellFormedCustomerInvitation(row)) fail("role_refused");
      if (row.status !== "pending") fail("not_pending");
      if (row.expiresAt.getTime() <= now.getTime()) fail("expired");
      if (!credentialMatches(row.credentialHash, input.credential))
        fail("credential_mismatch");
      const organisationId = row.organisationId as string;
      if (!(await findLiveCustomerOrganisation(tx, organisationId)))
        fail("organisation_unavailable");

      const user = await findUserForAccept(tx, input.userId);
      if (!user) return fail("address_mismatch");
      if (
        !user.emailVerified ||
        normaliseInviteeEmail(user.email) !== normaliseInviteeEmail(row.email)
      )
        fail("address_mismatch");

      const roleId = await findCanonicalCustomerRoleId(tx);
      if (!roleId) fail("role_refused");

      let personId: string;
      const existing = await findPersonByUser(tx, input.userId);
      if (existing) {
        if (
          existing.organisationId !== organisationId ||
          existing.side !== "customer" ||
          !existing.active ||
          existing.isPlaceholder
        )
          fail("person_conflict");
        personId = existing.id;
      } else {
        const created = await insertCustomerPerson(tx, {
          userId: input.userId,
          organisationId,
          displayName: user?.name ?? "",
        });
        if (!created) return fail("person_conflict");
        personId = created.id;
      }
      await insertCustomerMembership(tx, {
        personId,
        organisationId,
        roleId: roleId as string,
      });
      const consumed = await markAccepted(tx, {
        id: row.id,
        credentialHash: hashCredential(input.credential),
        personId,
        now,
      });
      if (!consumed) fail("concurrent");
      await appendAuditLog(tx, {
        actorId: input.userId,
        actorType: "person",
        workspaceId: row.workspaceId,
        organisationId,
        action: "invitation.redeemed",
        entityType: "invitation",
        entityId: row.id,
        before: null,
        after: input.via
          ? { scope: "customer", via: input.via }
          : { scope: "customer" },
      });
      return { organisationId, personId };
    });
  } catch (error) {
    if (error instanceof AcceptRefused) {
      await auditRefusal({
        actorId: input.userId,
        workspaceId: error.workspaceId,
        organisationId: error.organisationId,
        invitationId: input.invitationId,
        reason: error.reason,
      });
      throw new HTTPException(404, { message: "Invitation not found" });
    }
    throw error;
  }
}

export { findOrganisationName };

/**
 * CP-25: a customer-scope invitation id presented to the staff accept route is a wrong-portal
 * refusal. The staff route itself answers its generic not-found; this records the attempt.
 */
export async function auditWrongPortalAccept(
  callerId: string,
  invitationId: string,
) {
  const [row] = await db
    .select({
      scope: schema.invitationTable.scope,
      workspaceId: schema.invitationTable.workspaceId,
      organisationId: schema.invitationTable.organisationId,
    })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  if (row?.scope !== "customer") return;
  await auditRefusal({
    actorId: callerId,
    workspaceId: row.workspaceId,
    organisationId: row.organisationId,
    invitationId,
    reason: "wrong_portal",
  });
}
