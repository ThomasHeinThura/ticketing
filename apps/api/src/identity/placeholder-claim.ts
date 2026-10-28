import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import { normaliseInviteeEmail } from "../customer-invitation/logic";
import { schema } from "../database";
import type { Transaction } from "../database/executor";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { lockPersonLifecycleClosureInTransaction } from "./person-lifecycle";

const CLAIM = schema.importPlaceholderClaimTable;
const PERSON = schema.personTable;
const USER = schema.userTable;
const IMPORT_RUN = schema.importRunTable;
const WORKSPACE = schema.workspaceTable;
const EXTERNAL_IDENTITY = schema.externalIdentityTable;

export type VerifiedPlaceholderClaimInput = {
  userId: string;
  verifiedEmail: string;
  side: "staff" | "customer";
  organisationId: string;
  method: "email_otp" | "magic_link";
};

export type VerifiedPlaceholderClaimResult =
  | { kind: "none" }
  | { kind: "claimed"; personId: string; auditFailure?: true };

/** Serialize marker creation and claims for the same normalized source address. */
export async function lockImportPlaceholderClaimEmail(
  tx: Transaction,
  email: string,
) {
  const normalizedEmail = normaliseInviteeEmail(email);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`taskdesk:import-placeholder-claim:${normalizedEmail}`}, 0))`,
  );
}

async function lockVerifiedClaimant(
  tx: Transaction,
  input: VerifiedPlaceholderClaimInput,
  normalizedEmail: string,
) {
  const [user] = await tx
    .select({
      id: USER.id,
      email: USER.email,
      emailVerified: USER.emailVerified,
      banned: USER.banned,
      isAnonymous: USER.isAnonymous,
    })
    .from(USER)
    .where(eq(USER.id, input.userId))
    .for("update")
    .limit(1);
  if (
    !user?.emailVerified ||
    user?.banned === true ||
    user?.isAnonymous === true ||
    normaliseInviteeEmail(user?.email ?? "") !== normalizedEmail
  ) {
    throw new Error("Placeholder claim denied");
  }
}

/**
 * Claim a specifically imported placeholder after an auth caller has established the
 * exact TaskDesk OTP or magic-link proof. This never creates a person, imports a role,
 * or falls back to matching an IdP-provided email.
 */
export async function claimVerifiedImportPlaceholder(
  tx: Transaction,
  input: VerifiedPlaceholderClaimInput,
): Promise<VerifiedPlaceholderClaimResult> {
  const normalizedEmail = normaliseInviteeEmail(input.verifiedEmail);
  if (
    !input.userId ||
    !input.organisationId ||
    normalizedEmail.length < 3 ||
    normalizedEmail.length > 320 ||
    !normalizedEmail.includes("@")
  ) {
    throw new Error("Placeholder claim denied");
  }

  // Keep the tenant anchor before the user/person lifecycle locks, matching invitation
  // acceptance and identity lifecycle ordering.
  const { lockOrganisationIdentityDomainBindings } = await import(
    "../instance/organisation-lifecycle"
  );
  await lockOrganisationIdentityDomainBindings(tx);
  const [organisation] = await tx
    .select({
      id: schema.organisationTable.id,
      isInternal: schema.organisationTable.isInternal,
      portalAccess: schema.organisationTable.portalAccess,
    })
    .from(schema.organisationTable)
    .where(
      and(
        eq(schema.organisationTable.id, input.organisationId),
        eq(schema.organisationTable.active, true),
        isNull(schema.organisationTable.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (
    !organisation ||
    (input.side === "staff" && !organisation.isInternal) ||
    (input.side === "customer" &&
      (organisation.isInternal || !organisation.portalAccess))
  ) {
    throw new Error("Placeholder claim denied");
  }
  await lockImportPlaceholderClaimEmail(tx, normalizedEmail);

  const allCandidates = await tx
    .select({
      personId: CLAIM.personId,
      importRunId: CLAIM.importRunId,
      normalizedEmail: CLAIM.normalizedEmail,
      claimedAt: CLAIM.claimedAt,
      workspaceId: IMPORT_RUN.workspaceId,
      organisationId: PERSON.organisationId,
    })
    .from(CLAIM)
    .innerJoin(PERSON, eq(PERSON.id, CLAIM.personId))
    .innerJoin(IMPORT_RUN, eq(IMPORT_RUN.id, CLAIM.importRunId))
    .where(eq(CLAIM.normalizedEmail, normalizedEmail))
    .orderBy(asc(CLAIM.personId));

  if (allCandidates.length === 0) {
    await lockVerifiedClaimant(tx, input, normalizedEmail);
    return { kind: "none" };
  }
  // A contractor imported into several client organisations has one placeholder per organisation
  // (never one merged identity). Only the placeholder of the organisation the proof is for is a
  // candidate; another organisation's placeholder is neither claimed nor made ambiguous by it. An
  // address that has placeholders but none here, or more than one here, is denied as before.
  const candidates = allCandidates.filter(
    (row) => row.organisationId === input.organisationId,
  );
  if (candidates.length !== 1) throw new Error("Placeholder claim denied");
  const candidate = candidates[0];
  if (!candidate) throw new Error("Placeholder claim denied");

  const workspaceIds = [
    ...new Set(candidates.map((row) => row.workspaceId)),
  ].sort();
  if (workspaceIds.length) {
    await tx
      .select({ id: WORKSPACE.id })
      .from(WORKSPACE)
      .where(inArray(WORKSPACE.id, workspaceIds))
      .orderBy(WORKSPACE.id)
      .for("update");
  }

  await lockVerifiedClaimant(tx, input, normalizedEmail);

  // Acquires org/workspace/person/grant/identity locks in the canonical lifecycle order
  // and verifies that the discovered closure did not change while locks were acquired.
  const closure = await lockPersonLifecycleClosureInTransaction(
    tx,
    [candidate.personId],
    { kind: "administrative" },
  );
  if (closure.people.length !== 1 || closure.grants.length !== 0) {
    throw new Error("Placeholder claim denied");
  }
  const memberships = await tx
    .select({ id: schema.membershipTable.id })
    .from(schema.membershipTable)
    .where(eq(schema.membershipTable.personId, candidate.personId))
    .orderBy(schema.membershipTable.id)
    .for("update");
  if (memberships.length !== 0) throw new Error("Placeholder claim denied");

  const lockedClaims = await tx
    .select({
      personId: CLAIM.personId,
      importRunId: CLAIM.importRunId,
      normalizedEmail: CLAIM.normalizedEmail,
      claimedAt: CLAIM.claimedAt,
    })
    .from(CLAIM)
    .where(eq(CLAIM.normalizedEmail, normalizedEmail))
    .orderBy(CLAIM.personId)
    .for("update");
  const ownPersonIds = new Set(candidates.map((row) => row.personId));
  const ownClaims = lockedClaims.filter((row) =>
    ownPersonIds.has(row.personId),
  );
  const [claim] = ownClaims;

  const [person] = await tx
    .select({
      id: PERSON.id,
      userId: PERSON.userId,
      organisationId: PERSON.organisationId,
      side: PERSON.side,
      active: PERSON.active,
      isPlaceholder: PERSON.isPlaceholder,
    })
    .from(PERSON)
    .where(eq(PERSON.id, candidate.personId))
    .limit(1);
  const [runScope] = await tx
    .select({
      workspaceDeletedAt: WORKSPACE.deletedAt,
    })
    .from(IMPORT_RUN)
    .innerJoin(WORKSPACE, eq(WORKSPACE.id, IMPORT_RUN.workspaceId))
    .where(eq(IMPORT_RUN.id, candidate.importRunId))
    .limit(1);
  const existingPeople = await tx
    .select({ id: PERSON.id })
    .from(PERSON)
    .where(eq(PERSON.userId, input.userId))
    .orderBy(PERSON.id);

  const externalIdentities = await tx
    .select({ id: EXTERNAL_IDENTITY.id })
    .from(EXTERNAL_IDENTITY)
    .where(eq(EXTERNAL_IDENTITY.personId, candidate.personId))
    .orderBy(EXTERNAL_IDENTITY.id)
    .for("update");

  if (
    !claim ||
    ownClaims.length !== 1 ||
    claim.personId !== candidate.personId ||
    claim.importRunId !== candidate.importRunId ||
    claim.normalizedEmail !== normalizedEmail ||
    claim.claimedAt !== null ||
    !person ||
    person.userId !== null ||
    !person.active ||
    !person.isPlaceholder ||
    person.side !== input.side ||
    person.organisationId !== input.organisationId ||
    !runScope ||
    runScope.workspaceDeletedAt !== null ||
    existingPeople.length !== 0 ||
    externalIdentities.length !== 0
  ) {
    throw new Error("Placeholder claim denied");
  }

  const now = new Date();
  const [updatedPerson] = await tx
    .update(PERSON)
    .set({ userId: input.userId, isPlaceholder: false, updatedAt: now })
    .where(
      and(
        eq(PERSON.id, candidate.personId),
        isNull(PERSON.userId),
        eq(PERSON.active, true),
        eq(PERSON.isPlaceholder, true),
        eq(PERSON.side, input.side),
        eq(PERSON.organisationId, input.organisationId),
      ),
    )
    .returning({ id: PERSON.id });
  if (!updatedPerson) throw new Error("Placeholder claim denied");

  const [updatedClaim] = await tx
    .update(CLAIM)
    .set({ claimedAt: now })
    .where(and(eq(CLAIM.personId, candidate.personId), isNull(CLAIM.claimedAt)))
    .returning({ personId: CLAIM.personId });
  if (!updatedClaim) throw new Error("Placeholder claim denied");

  let auditFailure = false;
  try {
    await tx.transaction(async (auditTx) =>
      appendAuditLog(auditTx, {
        actorId: input.userId,
        actorType: "person",
        organisationId: input.organisationId,
        action: "identity.placeholder_claimed",
        entityType: "person",
        entityId: candidate.personId,
        before: {
          personId: candidate.personId,
          isPlaceholder: true,
          userId: null,
        },
        after: {
          personId: candidate.personId,
          importRunId: candidate.importRunId,
          organisationId: input.organisationId,
          side: input.side,
          method: input.method,
          isPlaceholder: false,
          userId: input.userId,
        },
      }),
    );
  } catch {
    auditFailure = true;
  }

  return {
    kind: "claimed",
    personId: candidate.personId,
    ...(auditFailure ? { auditFailure: true as const } : {}),
  };
}

/** Call only after the transaction containing the claim has committed. */
export async function reportPlaceholderClaimAuditWriteFailure(failed: boolean) {
  if (!failed) return;
  recordAuditWriteFailure("mutation");
  await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
}
