import { createHash, randomBytes } from "node:crypto";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import type { Executor, Transaction } from "../database/executor";
import { currentEncryptionKeyId } from "../identity/client-secret";
import { projectMembershipKeys } from "../identity/membership-projection";
import {
  claimVerifiedImportPlaceholder,
  reportPlaceholderClaimAuditWriteFailure,
} from "../identity/placeholder-claim";
import { lockOrganisationIdentityDomainBindings } from "../instance/organisation-lifecycle";
import {
  type CustomerInvitationDeliveryKeyring,
  customerInvitationDeliveryKeyring,
  type DeliveryCapacityReservation,
  type DeliveryKey,
} from "./delivery/keyring";
import {
  activateCustomerInvitationDeliveryKey,
  destroyCustomerInvitationDeliveryKeys,
  discardCustomerInvitationDeliveryKey,
  enqueueCustomerInvitationDelivery,
  suppressActiveInvitationDeliveries,
} from "./delivery/repository";
import {
  credentialMatches,
  hashCredential,
  isAssignableCustomerRole,
  newCredential,
  normaliseInviteeEmail,
} from "./logic";
import { isEmailProviderConfigured } from "./mailer";
import {
  type AcceptRefusal,
  addressCannotBeInvited,
  countRecentCreates,
  ensureCustomerMembershipGrant,
  findCanonicalCustomerRoleId,
  findInvitableOrganisation,
  findInvitationForSignUp,
  findLiveCustomerOrganisation,
  findOrganisationName,
  insertCustomerInvitation,
  insertCustomerPerson,
  isWellFormedCustomerInvitation,
  lockCustomerInvitation,
  lockInvitationForAccept,
  lockPendingForAddress,
  lockPeopleForAccept,
  lockUsersForAccept,
  markAccepted,
  readInvitationRuntimeSettings,
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

function isUniqueViolation(error: unknown): boolean {
  const code = error as { code?: string; cause?: { code?: string } } | null;
  return code?.code === "23505" || code?.cause?.code === "23505";
}

function refuse(status: 404 | 409 | 422 | 429, message: string): never {
  throw new HTTPException(status, { message });
}

function assertInvitationDeliveryKeyAvailable() {
  try {
    if (currentEncryptionKeyId()) return;
  } catch {
    // Keep inert and real invite paths on the same infrastructure failure.
  }
  throw new HTTPException(503, { message: "Invitation delivery unavailable" });
}

async function reserveInvitationDeliveryCapacity(
  tx: Transaction,
  keyring: CustomerInvitationDeliveryKeyring,
): Promise<{ admission: DeliveryCapacityReservation; expiresAt: Date }> {
  try {
    const clock = await tx.execute(sql`SELECT clock_timestamp() AS now`);
    const value = (clock.rows[0] as { now?: Date | string } | undefined)?.now;
    if (!value) throw new Error("Database clock unavailable");
    const admission = keyring.reserveCapacity();
    return {
      admission,
      // The persisted window starts at the database timestamp captured before reserving the key,
      // so the database deadline cannot extend the process-monotonic key deadline.
      expiresAt: new Date(
        (value instanceof Date ? value.getTime() : new Date(value).getTime()) +
          15 * 60_000,
      ),
    };
  } catch {
    throw new HTTPException(503, {
      message: "Invitation delivery unavailable",
    });
  }
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

export async function createCustomerInvitation(
  input: {
    actor: InviteActor;
    identity: ResolvedIdentity;
    scope: Scope;
    email: string;
  },
  options: { deliveryKeyring?: CustomerInvitationDeliveryKeyring } = {},
) {
  const keyring = options.deliveryKeyring ?? customerInvitationDeliveryKeyring;
  const preparedRef: { value: PreparedCustomerInvitation | null } = {
    value: null,
  };
  try {
    await db.transaction(async (tx) => {
      const value = await prepareCustomerInvitation(tx, input, {
        deliveryKeyring: keyring,
      });
      preparedRef.value = value;
    });
  } catch (error) {
    preparedRef.value?.rollback();
    throw error;
  }
  const committed = preparedRef.value;
  if (!committed) throw new Error("Customer invitation was not prepared");
  committed.activate();
  const delivered = await isEmailProviderConfigured();
  return { ...committed.view, delivered };
}

export type PreparedCustomerInvitation = {
  view: ReturnType<typeof toView>;
  activate: () => void;
  rollback: () => void;
};

/** Prepare the existing CP23 invitation write inside a caller-owned transaction. */
export async function prepareCustomerInvitation(
  tx: Transaction,
  input: {
    actor: InviteActor;
    identity: ResolvedIdentity;
    scope: Scope;
    email: string;
  },
  options: { deliveryKeyring?: CustomerInvitationDeliveryKeyring } = {},
): Promise<PreparedCustomerInvitation> {
  const keyring = options.deliveryKeyring ?? customerInvitationDeliveryKeyring;
  const email = normaliseInviteeEmail(input.email);
  const issued = newCredential();
  let deliveryKey: DeliveryKey | null = null;
  let deliveryAdmission: DeliveryCapacityReservation | null = null;
  let deliveryExpiresAt: Date | null = null;
  let supersededDeliveries: string[] = [];
  try {
    const organisation = await findInvitableOrganisation(
      tx,
      input.scope.workspaceId,
      input.scope.organisationId,
      input.identity,
    );
    if (!organisation) refuse(404, "Organisation not found");

    // Both quota dimensions are serialized in a stable order. Counts happen only after these
    // locks, so concurrent creates for different addresses cannot exceed either configured cap.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-invitation:create:inviter:${input.actor.userId}`}, 0))`,
    );
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-invitation:create:organisation:${organisation.id}`}, 0))`,
    );
    const limits = await readInvitationRuntimeSettings(tx);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + limits.invitationLifetimeHours * 3_600_000,
    );

    // CP-26 first: every create counts, including one for an address that can never accept, so
    // the limit also bounds probing for which addresses have an account.
    if (
      (await countRecentCreates(
        tx,
        { inviterId: input.actor.userId },
        limits.customerInvitationCreateWindowMinutes,
      )) >= limits.customerInvitationPerInviterLimit ||
      (await countRecentCreates(
        tx,
        { organisationId: organisation.id },
        limits.customerInvitationCreateWindowMinutes,
      )) >= limits.customerInvitationPerOrganisationLimit
    )
      refuse(429, "Too many invitations were created recently");

    assertInvitationDeliveryKeyAvailable();
    const capacity = await reserveInvitationDeliveryCapacity(tx, keyring);
    deliveryAdmission = capacity.admission;
    deliveryExpiresAt = capacity.expiresAt;

    const existing = await lockPendingForAddress(tx, organisation.id, email);
    if (existing && existing.expiresAt.getTime() > now.getTime())
      refuse(409, "An invitation for this address is already pending");

    // An address that could never accept here (a member, staff anywhere, a customer of another
    // organisation, a deactivated customer) gets the same answer as any other: an inert pending
    // row with no credential hash (accept can never match it), no email, and the reason in the
    // audit trail only (CP-25). The caller cannot tell it from a real invitation.
    const inert = await addressCannotBeInvited(tx, organisation.id, email);
    if (inert) {
      deliveryAdmission.release();
      deliveryAdmission = null;
    }

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
    if (existing)
      supersededDeliveries = await suppressActiveInvitationDeliveries(
        tx,
        existing.id,
        "superseded",
      );
    deliveryKey = await enqueueCustomerInvitationDelivery(
      tx,
      {
        invitationId: row.id,
        credentialHash: row.credentialHash,
        credential: inert ? null : issued.credential,
        resend: false,
        inert,
        ...(inert ? {} : { expiresAt: deliveryExpiresAt ?? undefined }),
      },
      keyring,
      deliveryAdmission ?? undefined,
    );
    deliveryAdmission = null;
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
    const view = toView(row, now);
    return {
      view,
      activate: () => {
        activateCustomerInvitationDeliveryKey(deliveryKey, keyring);
        destroyCustomerInvitationDeliveryKeys(supersededDeliveries, keyring);
      },
      rollback: () => {
        discardCustomerInvitationDeliveryKey(deliveryKey, keyring);
        deliveryAdmission?.release();
      },
    };
  } catch (error) {
    discardCustomerInvitationDeliveryKey(deliveryKey, keyring);
    deliveryAdmission?.release();
    // Two creates for the same address can both find no pending row; the partial unique index
    // lets exactly one through, and the other is the "already pending" refusal.
    if (isUniqueViolation(error))
      refuse(409, "An invitation for this address is already pending");
    throw error;
  }
}

export async function resendCustomerInvitation(
  input: {
    actor: InviteActor;
    identity: ResolvedIdentity;
    scope: Scope;
    invitationId: string;
  },
  options: { deliveryKeyring?: CustomerInvitationDeliveryKeyring } = {},
) {
  const keyring = options.deliveryKeyring ?? customerInvitationDeliveryKeyring;
  const issued = newCredential();
  let deliveryKey: DeliveryKey | null = null;
  let deliveryAdmission: DeliveryCapacityReservation | null = null;
  let deliveryExpiresAt: Date | null = null;
  let supersededDeliveries: string[] = [];
  const result = await db
    .transaction(async (tx) => {
      // Reach first and the same body as a missing invitation: an organisation outside the caller's
      // reach must be indistinguishable from one that has no such invitation.
      const organisation = await findInvitableOrganisation(
        tx,
        input.scope.workspaceId,
        input.scope.organisationId,
        input.identity,
      );
      if (!organisation) refuse(404, "Invitation not found");
      assertInvitationDeliveryKeyAvailable();
      const capacity = await reserveInvitationDeliveryCapacity(tx, keyring);
      deliveryAdmission = capacity.admission;
      deliveryExpiresAt = capacity.expiresAt;
      const row = await lockCustomerInvitation(
        tx,
        input.scope.workspaceId,
        input.scope.organisationId,
        input.invitationId,
      );
      if (!row) refuse(404, "Invitation not found");
      const limits = await readInvitationRuntimeSettings(tx);
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + limits.invitationLifetimeHours * 3_600_000,
      );
      if (row.status !== "pending")
        refuse(409, "Only a pending invitation can be resent");
      if (
        row.lastSentAt &&
        now.getTime() - row.lastSentAt.getTime() <
          limits.customerInvitationResendCooldownSeconds * 1000
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
      if (inert) {
        deliveryAdmission.release();
        deliveryAdmission = null;
      }
      const updated = await rotateCredential(tx, row.id, {
        credentialHash: inert ? null : issued.hash,
        expiresAt,
        now,
      });
      if (!updated) refuse(409, "Only a pending invitation can be resent");
      supersededDeliveries = await suppressActiveInvitationDeliveries(
        tx,
        row.id,
        "superseded",
      );
      deliveryKey = await enqueueCustomerInvitationDelivery(
        tx,
        {
          invitationId: updated.id,
          credentialHash: updated.credentialHash,
          credential: inert ? null : issued.credential,
          resend: true,
          inert,
          ...(inert ? {} : { expiresAt: deliveryExpiresAt ?? undefined }),
        },
        keyring,
        deliveryAdmission ?? undefined,
      );
      deliveryAdmission = null;
      await auditSent(tx, input.actor, input.scope, row.id, true);
      return { updated, inert, now };
    })
    .catch((error: unknown) => {
      discardCustomerInvitationDeliveryKey(deliveryKey, keyring);
      deliveryAdmission?.release();
      throw error;
    });

  activateCustomerInvitationDeliveryKey(deliveryKey, keyring);
  destroyCustomerInvitationDeliveryKeys(supersededDeliveries, keyring);
  const delivered = await isEmailProviderConfigured();
  return { ...toView(result.updated, result.now), delivered };
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

type CustomerInvitationAcceptProof =
  | { kind: "credential"; credential: string }
  | { kind: "credential_hash"; credentialHash: string };

/** Local-proof claims acquire parent locks before invitation/user/person locks.
 * OIDC does not enter this path or acquire a new late domain lock. */
async function lockVerifiedClaimInvitationParents(
  tx: Transaction,
  invitationId: string,
) {
  const [anchor] = await tx
    .select({ organisationId: schema.invitationTable.organisationId })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  if (!anchor?.organisationId) return;
  await lockOrganisationIdentityDomainBindings(tx);
  await tx
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.id, anchor.organisationId))
    .for("update")
    .limit(1);
}

async function acceptCustomerInvitationInTransaction(
  tx: Transaction,
  input: {
    userId: string;
    invitationId: string;
    via?: "sign_up";
    verifiedClaimMethod?: "email_otp" | "magic_link";
  },
  proof: CustomerInvitationAcceptProof,
): Promise<{
  accepted: { organisationId: string; personId: string };
  acceptedDeliveries: string[];
  placeholderAuditFailure?: true;
}> {
  if (input.verifiedClaimMethod)
    await lockVerifiedClaimInvitationParents(tx, input.invitationId);
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
  const credentialHash =
    proof.kind === "credential"
      ? hashCredential(proof.credential)
      : proof.credentialHash;
  if (
    proof.kind === "credential"
      ? !credentialMatches(row.credentialHash, proof.credential)
      : !row.credentialHash || row.credentialHash !== proof.credentialHash
  )
    fail("credential_mismatch");
  const organisationId = row.organisationId as string;
  if (!(await findLiveCustomerOrganisation(tx, organisationId)))
    fail("organisation_unavailable");

  let placeholderAuditFailure = false;
  if (input.verifiedClaimMethod) {
    const [existingPerson] = await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, input.userId))
      .limit(1);
    if (!existingPerson) {
      const claim = await claimVerifiedImportPlaceholder(tx, {
        userId: input.userId,
        verifiedEmail: row.email,
        side: "customer",
        organisationId,
        method: input.verifiedClaimMethod,
      });
      placeholderAuditFailure =
        claim.kind === "claimed" && claim.auditFailure === true;
    }
  }
  const userIds = [input.userId, row.inviterId];
  const users = await lockUsersForAccept(tx, userIds);
  const user = users.find((candidate) => candidate.id === input.userId);
  if (!user) throw new AcceptRefused("address_mismatch", known[0], known[1]);
  if (
    !user.emailVerified ||
    normaliseInviteeEmail(user.email) !== normaliseInviteeEmail(row.email)
  )
    fail("address_mismatch");

  // Lock all extant person rows for invitee and inviter in deterministic person-id order.
  // The invitation sender is the only evidenced grantor for this already-authorised invite.
  const people = await lockPeopleForAccept(tx, userIds);
  const inviter = people.find(
    (person) => person.userId === row.inviterId && person.side === "staff",
  );
  if (!inviter) throw new AcceptRefused("role_refused", known[0], known[1]);

  const roleId = await findCanonicalCustomerRoleId(tx);
  if (!roleId) throw new AcceptRefused("role_refused", known[0], known[1]);

  let personId: string;
  const inviteePeople = people.filter(
    (person) => person.userId === input.userId,
  );
  const existing = inviteePeople.find(
    (person) =>
      person.side === "customer" && person.organisationId === organisationId,
  );
  if (existing) {
    if (!existing.active || existing.isPlaceholder) fail("person_conflict");
    personId = existing.id;
  } else {
    if (inviteePeople.length > 0) fail("person_conflict");
    const created = await insertCustomerPerson(tx, {
      userId: input.userId,
      organisationId,
      displayName: user.name ?? "",
    });
    if (!created)
      throw new AcceptRefused("person_conflict", known[0], known[1]);
    personId = created.id;
  }
  const grant = await ensureCustomerMembershipGrant(tx, {
    personId,
    organisationId,
    roleId,
    grantedByPersonId: inviter.id,
  });
  if (!grant.grantId || !grant.roleMatches) fail("person_conflict");
  await projectMembershipKeys(tx, [
    { personId, scope: "organisation", scopeId: organisationId },
  ]);
  if (grant.created) {
    await appendAuditLog(tx, {
      actorId: row.inviterId,
      actorType: "person",
      workspaceId: row.workspaceId,
      organisationId,
      action: "membership.changed",
      entityType: "membership",
      entityId: personId,
      before: null,
      after: {
        source: "customer_invitation",
        scope: "organisation",
        scopeId: organisationId,
        roleId,
        grantedByPersonId: inviter.id,
        granted: true,
      },
    });
  }
  const consumed = await markAccepted(tx, {
    id: row.id,
    credentialHash,
    personId,
    now,
  });
  if (!consumed) fail("concurrent");
  const acceptedDeliveries = await suppressActiveInvitationDeliveries(
    tx,
    row.id,
    "accepted",
  );
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
  return {
    accepted: { organisationId, personId },
    acceptedDeliveries,
    ...(placeholderAuditFailure
      ? { placeholderAuditFailure: true as const }
      : {}),
  };
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
  verifiedClaimMethod?: "email_otp" | "magic_link";
}): Promise<{ organisationId: string; personId: string }> {
  try {
    const result = await db.transaction((tx) =>
      acceptCustomerInvitationInTransaction(tx, input, {
        kind: "credential",
        credential: input.credential,
      }),
    );
    destroyCustomerInvitationDeliveryKeys(result.acceptedDeliveries);
    await reportPlaceholderClaimAuditWriteFailure(
      result.placeholderAuditFailure === true,
    );
    return result.accepted;
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

/**
 * Begin a provider-neutral invite continuation. The raw credential is verified under the
 * canonical invitation lock and is never persisted; the short-lived row carries only its
 * current hash and the hash of an opaque, one-use cookie nonce.
 */
export async function beginCustomerInvitationContinuation(input: {
  invitationId: string;
  credential: string;
}): Promise<string> {
  try {
    return await db.transaction(async (tx) => {
      const row = await lockInvitationForAccept(tx, input.invitationId);
      if (!row) throw new AcceptRefused("not_found", null, null);
      if (row.scope !== "customer")
        throw new AcceptRefused(
          "scope_mismatch",
          row.organisationId,
          row.workspaceId,
        );
      if (!isWellFormedCustomerInvitation(row))
        throw new AcceptRefused(
          "role_refused",
          row.organisationId,
          row.workspaceId,
        );
      if (row.status !== "pending")
        throw new AcceptRefused(
          "not_pending",
          row.organisationId,
          row.workspaceId,
        );
      if (row.expiresAt.getTime() <= Date.now())
        throw new AcceptRefused("expired", row.organisationId, row.workspaceId);
      if (!credentialMatches(row.credentialHash, input.credential))
        throw new AcceptRefused(
          "credential_mismatch",
          row.organisationId,
          row.workspaceId,
        );
      if (
        !(await findLiveCustomerOrganisation(tx, row.organisationId as string))
      )
        throw new AcceptRefused(
          "organisation_unavailable",
          row.organisationId,
          row.workspaceId,
        );
      if (!row.credentialHash)
        throw new AcceptRefused(
          "credential_mismatch",
          row.organisationId,
          row.workspaceId,
        );

      const nonce = randomBytes(32).toString("base64url");
      await tx.insert(schema.customerInvitationAuthContinuationTable).values({
        invitationId: row.id,
        credentialHash: row.credentialHash,
        nonceHash: createHash("sha256").update(nonce, "utf8").digest("hex"),
        expiresAt: sql`clock_timestamp() + interval '5 minutes'`,
      });
      return nonce;
    });
  } catch (error) {
    if (error instanceof AcceptRefused) {
      await auditRefusal({
        actorId: null,
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

/**
 * Non-consuming check used only by provider signup hooks. The invitation and nonce are
 * revalidated again under locks by the acceptance transaction; this check only prevents a
 * provider from creating a customer identity without a live, browser-bound invite context.
 */
export async function validateCustomerInvitationContinuation(input: {
  invitationId: string;
  nonce: string;
  email: string;
}): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.invitationId)) return false;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.nonce)) return false;
  const nonceHash = createHash("sha256")
    .update(input.nonce, "utf8")
    .digest("hex");
  const [row] = await db
    .select({
      invitationId: schema.invitationTable.id,
    })
    .from(schema.customerInvitationAuthContinuationTable)
    .innerJoin(
      schema.invitationTable,
      eq(
        schema.invitationTable.id,
        schema.customerInvitationAuthContinuationTable.invitationId,
      ),
    )
    .where(
      and(
        eq(schema.invitationTable.id, input.invitationId),
        eq(schema.customerInvitationAuthContinuationTable.nonceHash, nonceHash),
        isNull(schema.customerInvitationAuthContinuationTable.consumedAt),
        gt(
          schema.customerInvitationAuthContinuationTable.expiresAt,
          sql`clock_timestamp()`,
        ),
        gt(schema.invitationTable.expiresAt, sql`clock_timestamp()`),
        eq(schema.invitationTable.status, "pending"),
        eq(
          schema.customerInvitationAuthContinuationTable.credentialHash,
          schema.invitationTable.credentialHash,
        ),
      ),
    )
    .limit(1);
  if (!row) return false;
  const invitation = await findInvitationForSignUp(db, row.invitationId);
  if (
    !invitation ||
    invitation.scope !== "customer" ||
    !isWellFormedCustomerInvitation(invitation) ||
    invitation.status !== "pending" ||
    invitation.expiresAt.getTime() <= Date.now() ||
    !invitation.credentialHash ||
    !normaliseInviteeEmail(input.email) ||
    normaliseInviteeEmail(input.email) !==
      normaliseInviteeEmail(invitation.email)
  )
    return false;
  if (
    !(await findLiveCustomerOrganisation(db, invitation.organisationId ?? ""))
  )
    return false;
  return true;
}

/** Accept through trusted server continuation context. No hash is accepted from an HTTP body. */
export async function acceptCustomerInvitationContinuationInTransaction(
  tx: Transaction,
  input: {
    userId: string;
    invitationId: string;
    nonce: string;
    expectedOrganisationId?: string;
    via?: "sign_up";
    verifiedClaimMethod?: "email_otp" | "magic_link";
  },
): Promise<{
  accepted: { organisationId: string; personId: string };
  acceptedDeliveries: string[];
  placeholderAuditFailure?: true;
}> {
  if (input.verifiedClaimMethod)
    await lockVerifiedClaimInvitationParents(tx, input.invitationId);
  // Canonical invitation-before-continuation lock order also serializes resend/revoke/purge.
  const invitation = await lockInvitationForAccept(tx, input.invitationId);
  if (!invitation) throw new AcceptRefused("not_found", null, null);
  if (
    input.expectedOrganisationId &&
    invitation.organisationId !== input.expectedOrganisationId
  )
    throw new AcceptRefused(
      "scope_mismatch",
      invitation.organisationId,
      invitation.workspaceId,
    );
  const continuationHash = createHash("sha256")
    .update(input.nonce, "utf8")
    .digest("hex");
  const [continuation] = await tx
    .select()
    .from(schema.customerInvitationAuthContinuationTable)
    .where(
      and(
        eq(
          schema.customerInvitationAuthContinuationTable.invitationId,
          input.invitationId,
        ),
        eq(
          schema.customerInvitationAuthContinuationTable.nonceHash,
          continuationHash,
        ),
      ),
    )
    .for("update")
    .limit(1);
  if (
    !continuation ||
    continuation.consumedAt ||
    continuation.expiresAt.getTime() <= Date.now() ||
    !invitation.credentialHash ||
    continuation.credentialHash !== invitation.credentialHash
  )
    throw new AcceptRefused(
      "credential_mismatch",
      invitation.organisationId,
      invitation.workspaceId,
    );

  const accepted = await acceptCustomerInvitationInTransaction(
    tx,
    {
      userId: input.userId,
      invitationId: input.invitationId,
      ...(input.via ? { via: input.via } : {}),
      ...(input.verifiedClaimMethod
        ? { verifiedClaimMethod: input.verifiedClaimMethod }
        : {}),
    },
    { kind: "credential_hash", credentialHash: continuation.credentialHash },
  );
  await tx
    .update(schema.customerInvitationAuthContinuationTable)
    .set({
      acceptedUserId: input.userId,
      consumedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(schema.customerInvitationAuthContinuationTable.id, continuation.id),
        isNull(schema.customerInvitationAuthContinuationTable.consumedAt),
      ),
    );
  return accepted;
}

/** Read-only result check for local auth flows that accepted before returning a session. */
export async function getCustomerInvitationContinuationResult(input: {
  userId: string;
  invitationId: string;
  nonce: string;
}): Promise<boolean> {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.invitationId) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input.nonce)
  )
    throw new HTTPException(404, { message: "Invitation not found" });
  const nonceHash = createHash("sha256")
    .update(input.nonce, "utf8")
    .digest("hex");
  const [row] = await db
    .select({
      invitationId: schema.invitationTable.id,
      scope: schema.invitationTable.scope,
      role: schema.invitationTable.role,
      organisationId: schema.invitationTable.organisationId,
      teamId: schema.invitationTable.teamId,
      email: schema.invitationTable.email,
      status: schema.invitationTable.status,
      expiresAt: schema.invitationTable.expiresAt,
      credentialHash: schema.invitationTable.credentialHash,
      acceptedPersonId: schema.invitationTable.acceptedPersonId,
      continuationCredentialHash:
        schema.customerInvitationAuthContinuationTable.credentialHash,
      acceptedUserId:
        schema.customerInvitationAuthContinuationTable.acceptedUserId,
      continuationExpiresAt:
        schema.customerInvitationAuthContinuationTable.expiresAt,
      consumedAt: schema.customerInvitationAuthContinuationTable.consumedAt,
    })
    .from(schema.customerInvitationAuthContinuationTable)
    .innerJoin(
      schema.invitationTable,
      eq(
        schema.invitationTable.id,
        schema.customerInvitationAuthContinuationTable.invitationId,
      ),
    )
    .where(
      and(
        eq(schema.invitationTable.id, input.invitationId),
        eq(schema.customerInvitationAuthContinuationTable.nonceHash, nonceHash),
        gt(
          schema.customerInvitationAuthContinuationTable.expiresAt,
          sql`clock_timestamp()`,
        ),
      ),
    )
    .limit(1);
  if (!row || !isWellFormedCustomerInvitation(row))
    throw new HTTPException(404, { message: "Invitation not found" });

  const [user] = await db
    .select({
      email: schema.userTable.email,
      emailVerified: schema.userTable.emailVerified,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, input.userId))
    .limit(1);
  if (
    !user?.emailVerified ||
    normaliseInviteeEmail(user.email) !== normaliseInviteeEmail(row.email)
  )
    throw new HTTPException(404, { message: "Invitation not found" });

  if (
    row.status === "accepted" &&
    row.consumedAt !== null &&
    row.acceptedUserId === input.userId &&
    row.acceptedPersonId
  ) {
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.id, row.acceptedPersonId),
          eq(schema.personTable.userId, input.userId),
          eq(schema.personTable.organisationId, row.organisationId as string),
          eq(schema.personTable.side, "customer"),
          eq(schema.personTable.active, true),
          eq(schema.personTable.isPlaceholder, false),
        ),
      )
      .limit(1);
    if (person) return true;
    throw new HTTPException(404, { message: "Invitation not found" });
  }

  if (
    row.status === "pending" &&
    row.consumedAt === null &&
    row.acceptedUserId === null &&
    row.expiresAt.getTime() > Date.now() &&
    row.credentialHash !== null &&
    row.continuationCredentialHash === row.credentialHash &&
    (await findLiveCustomerOrganisation(db, row.organisationId as string))
  )
    return false;
  throw new HTTPException(404, { message: "Invitation not found" });
}

export async function acceptCustomerInvitationFromContinuation(input: {
  userId: string;
  invitationId: string;
  nonce: string;
  via?: "sign_up";
  verifiedClaimMethod?: "email_otp" | "magic_link";
}): Promise<{ organisationId: string; personId: string }> {
  let acceptedDeliveries: string[] = [];
  let placeholderAuditFailure = false;
  try {
    const result = await db.transaction(async (tx) => {
      const accepted = await acceptCustomerInvitationContinuationInTransaction(
        tx,
        input,
      );
      acceptedDeliveries = accepted.acceptedDeliveries;
      placeholderAuditFailure = accepted.placeholderAuditFailure === true;
      return accepted.accepted;
    });
    destroyCustomerInvitationDeliveryKeys(acceptedDeliveries);
    await reportPlaceholderClaimAuditWriteFailure(placeholderAuditFailure);
    return result;
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

/** Post-commit cleanup shared by the portal and OIDC acceptance entry points. */
export function finalizeCustomerInvitationAcceptance(deliveryIds: string[]) {
  destroyCustomerInvitationDeliveryKeys(deliveryIds);
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
