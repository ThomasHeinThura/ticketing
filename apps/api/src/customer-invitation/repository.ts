import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import db, { schema } from "../database";
import { type Executor, executorOrDefault } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import { dbClockUtc } from "../utils/db-time";
import {
  CUSTOMER_INVITATION_ROLE,
  customerInvitationStatus,
  isWellFormedCustomerInvitation,
} from "./logic";

/**
 * Customer-invitation statements (CP-20..CP-26). Every function takes the executor so the
 * callers decide the transaction boundary; row locks are taken here, never skipped.
 */

const invitation = schema.invitationTable;
const organisation = schema.organisationTable;

/** A live, active, non-internal customer organisation: the only thing that can be invited into. */
function invitableOrganisation(): SQL {
  return and(
    eq(organisation.isInternal, false),
    eq(organisation.active, true),
    isNull(organisation.deletedAt),
  ) as SQL;
}

/**
 * The workspace serves the organisation: the organisation is bound to a live, non-archived project
 * in it, or holds a published, customer-visible request type from it (the same binding the portal
 * knowledge base uses). Without it any workspace could invite into any customer organisation.
 */
function servedByWorkspace(workspaceId: string): SQL {
  return or(
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.organisationId, organisation.id),
            eq(schema.projectTable.workspaceId, workspaceId),
            isNull(schema.projectTable.deletedAt),
            isNull(schema.projectTable.archivedAt),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.organisationRequestTypeTable)
        .innerJoin(
          schema.requestTypeTable,
          eq(
            schema.requestTypeTable.id,
            schema.organisationRequestTypeTable.requestTypeId,
          ),
        )
        .where(
          and(
            eq(
              schema.organisationRequestTypeTable.organisationId,
              organisation.id,
            ),
            eq(schema.requestTypeTable.workspaceId, workspaceId),
            eq(schema.requestTypeTable.published, true),
            eq(schema.requestTypeTable.customerVisible, true),
          ),
        ),
    ),
  ) as SQL;
}

/**
 * CP-20 reach, the narrowest reading: the caller reaches the organisation when it holds
 * workspace-wide reach (instance admin, or a workspace `sees_all` grant for this workspace), or
 * reaches at least one live, non-archived project bound to the organisation (the project's roster,
 * an ancestor project, the owner team: the same predicate every project read uses), or reaches the
 * default project of a published, customer-visible request type served to the organisation. A
 * request type with no default project is therefore reachable by workspace-wide callers only.
 * Customers never reach anything here.
 */
function reachableByCaller(
  identity: ResolvedIdentity,
  workspaceId: string,
): SQL {
  if (identity.side !== "staff") return sql`false`;
  if (
    identity.reach.kind === "all" ||
    (identity.reach.kind === "membership_with_workspaces" &&
      identity.reach.workspaceIds.includes(workspaceId))
  )
    return sql`true`;
  const reachableProject = (
    projectId: SQL | typeof schema.projectTable.id,
    projectWorkspaceId: typeof schema.projectTable.workspaceId,
    projectOrganisationId: SQL | typeof schema.projectTable.organisationId,
  ) =>
    currentProjectReachPredicate(
      identity,
      projectId,
      projectWorkspaceId,
      projectOrganisationId as typeof schema.projectTable.organisationId,
    ) as SQL;
  return or(
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.organisationId, organisation.id),
            eq(schema.projectTable.workspaceId, workspaceId),
            isNull(schema.projectTable.deletedAt),
            isNull(schema.projectTable.archivedAt),
            reachableProject(
              schema.projectTable.id,
              schema.projectTable.workspaceId,
              schema.projectTable.organisationId,
            ),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.organisationRequestTypeTable)
        .innerJoin(
          schema.requestTypeTable,
          eq(
            schema.requestTypeTable.id,
            schema.organisationRequestTypeTable.requestTypeId,
          ),
        )
        .innerJoin(
          schema.projectTable,
          eq(schema.projectTable.id, schema.requestTypeTable.defaultProjectId),
        )
        .where(
          and(
            eq(
              schema.organisationRequestTypeTable.organisationId,
              organisation.id,
            ),
            eq(schema.requestTypeTable.workspaceId, workspaceId),
            eq(schema.requestTypeTable.published, true),
            eq(schema.requestTypeTable.customerVisible, true),
            eq(schema.projectTable.workspaceId, workspaceId),
            isNull(schema.projectTable.deletedAt),
            isNull(schema.projectTable.archivedAt),
            reachableProject(
              schema.projectTable.id,
              schema.projectTable.workspaceId,
              schema.projectTable.organisationId,
            ),
          ),
        ),
    ),
  ) as SQL;
}

/** Organisations the caller may invite into: served by the workspace and within the caller's reach. */
export async function listInvitableOrganisations(
  workspaceId: string,
  identity: ResolvedIdentity,
  executor?: Executor,
) {
  return executorOrDefault(executor)
    .select({
      id: organisation.id,
      key: organisation.key,
      name: organisation.name,
    })
    .from(organisation)
    .where(
      and(
        invitableOrganisation(),
        servedByWorkspace(workspaceId),
        reachableByCaller(identity, workspaceId),
      ),
    )
    .orderBy(organisation.name);
}

/**
 * A live customer organisation the workspace serves and the caller reaches; anything else
 * (missing, internal, unserved, out of reach) is the same `undefined`.
 */
export async function findInvitableOrganisation(
  executor: Executor,
  workspaceId: string,
  organisationId: string,
  identity: ResolvedIdentity,
) {
  const [row] = await executor
    .select({
      id: organisation.id,
      key: organisation.key,
      name: organisation.name,
    })
    .from(organisation)
    .where(
      and(
        eq(organisation.id, organisationId),
        invitableOrganisation(),
        servedByWorkspace(workspaceId),
        reachableByCaller(identity, workspaceId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Whether the caller reaches the organisation (CP-20), for revoking an invitation that already
 * exists: the organisation need not still be live or served, so an invitation that outlived its
 * project can still be withdrawn by whoever reaches it.
 */
export async function callerReachesOrganisation(
  executor: Executor,
  workspaceId: string,
  organisationId: string,
  identity: ResolvedIdentity,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: organisation.id })
    .from(organisation)
    .where(
      and(
        eq(organisation.id, organisationId),
        reachableByCaller(identity, workspaceId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** A live customer organisation, with no workspace binding (accepting an existing invitation). */
export async function findLiveCustomerOrganisation(
  executor: Executor,
  organisationId: string,
) {
  const [row] = await executor
    .select({ id: organisation.id })
    .from(organisation)
    .where(and(eq(organisation.id, organisationId), invitableOrganisation()))
    .limit(1);
  return row;
}

/** Whether the address already belongs to an active person with a membership in the organisation. */
export async function hasActiveMembershipByEmail(
  executor: Executor,
  organisationId: string,
  email: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ one: sql<number>`1` })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .innerJoin(
      schema.membershipTable,
      and(
        eq(schema.membershipTable.personId, schema.personTable.id),
        eq(schema.membershipTable.scope, "organisation"),
        eq(schema.membershipTable.scopeId, organisationId),
      ),
    )
    .where(
      and(
        eq(schema.personTable.organisationId, organisationId),
        eq(schema.personTable.active, true),
        sql`lower(${schema.userTable.email}) = ${email}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Whether an invitation to this address could never be accepted here: it already has an active
 * membership in the organisation, or it already belongs to a person that accept would refuse
 * (`person_conflict`): a staff person, a customer of another organisation, a deactivated or
 * placeholder customer. An address with no person yet, or an active customer of this very
 * organisation, can still be accepted.
 */
export async function addressCannotBeInvited(
  executor: Executor,
  organisationId: string,
  email: string,
): Promise<boolean> {
  if (await hasActiveMembershipByEmail(executor, organisationId, email))
    return true;
  const [row] = await executor
    .select({ one: sql<number>`1` })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(
      and(
        sql`lower(${schema.userTable.email}) = ${email}`,
        sql`NOT (${schema.personTable.side} = 'customer'
          AND ${schema.personTable.organisationId} = ${organisationId}
          AND ${schema.personTable.active} = true
          AND ${schema.personTable.isPlaceholder} = false)`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** How many customer invitations a subject created since the window start (CP-26). */
export async function countRecentCreates(
  executor: Executor,
  by: { inviterId: string } | { organisationId: string },
  windowMinutes: number,
): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(invitation)
    .where(
      and(
        eq(invitation.scope, "customer"),
        "inviterId" in by
          ? eq(invitation.inviterId, by.inviterId)
          : eq(invitation.organisationId, by.organisationId),
        sql`${invitation.createdAt} > ${dbClockUtc()} - make_interval(mins => ${windowMinutes}::int)`,
      ),
    );
  return row?.value ?? 0;
}

/** Current CP-22/26 values. Missing singleton configuration fails closed. */
export async function readInvitationRuntimeSettings(executor: Executor) {
  const [row] = await executor
    .select({
      invitationLifetimeHours:
        schema.instanceSettingTable.invitationLifetimeHours,
      customerInvitationCreateWindowMinutes:
        schema.instanceSettingTable.customerInvitationCreateWindowMinutes,
      customerInvitationPerInviterLimit:
        schema.instanceSettingTable.customerInvitationPerInviterLimit,
      customerInvitationPerOrganisationLimit:
        schema.instanceSettingTable.customerInvitationPerOrganisationLimit,
      customerInvitationResendCooldownSeconds:
        schema.instanceSettingTable.customerInvitationResendCooldownSeconds,
    })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
  if (!row) throw new Error("Invitation runtime settings unavailable");
  return row;
}

export async function insertCustomerInvitation(
  executor: Executor,
  values: {
    workspaceId: string;
    organisationId: string;
    email: string;
    inviterId: string;
    credentialHash: string | null;
    expiresAt: Date;
    now: Date;
  },
) {
  const [row] = await executor
    .insert(invitation)
    .values({
      workspaceId: values.workspaceId,
      organisationId: values.organisationId,
      email: values.email,
      role: CUSTOMER_INVITATION_ROLE,
      scope: "customer",
      status: "pending",
      inviterId: values.inviterId,
      credentialHash: values.credentialHash,
      expiresAt: values.expiresAt,
      lastSentAt: values.now,
    })
    .returning();
  return row;
}

/** The pending customer invitation for an address in an organisation, locked for update. */
export async function lockPendingForAddress(
  executor: Executor,
  organisationId: string,
  email: string,
) {
  const [row] = await executor
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.scope, "customer"),
        eq(invitation.organisationId, organisationId),
        eq(invitation.status, "pending"),
        sql`lower(${invitation.email}) = ${email}`,
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

export async function listCustomerInvitations(
  executor: Executor,
  workspaceId: string,
  organisationId: string,
  now: Date,
) {
  const rows = await executor
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.scope, "customer"),
        eq(invitation.workspaceId, workspaceId),
        eq(invitation.organisationId, organisationId),
      ),
    )
    .orderBy(desc(invitation.createdAt))
    .limit(200);
  return rows.map((row) => toView(row, now));
}

/** A customer invitation of this workspace and organisation, locked; a foreign row is `undefined`. */
export async function lockCustomerInvitation(
  executor: Executor,
  workspaceId: string,
  organisationId: string,
  id: string,
) {
  const [row] = await executor
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.scope, "customer"),
        eq(invitation.workspaceId, workspaceId),
        eq(invitation.organisationId, organisationId),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

/** Resend: a fresh credential replaces the old hash, expiry moves out, the send time is recorded. */
export async function rotateCredential(
  executor: Executor,
  id: string,
  values: {
    credentialHash: string | null;
    expiresAt: Date;
    now: Date;
    /** An expired row renewed at create: it counts as a new create toward the CP-26 limits. */
    renewedBy?: string;
  },
) {
  const [row] = await executor
    .update(invitation)
    .set({
      credentialHash: values.credentialHash,
      expiresAt: values.expiresAt,
      lastSentAt: values.now,
      ...(values.renewedBy
        ? { inviterId: values.renewedBy, createdAt: dbClockUtc() }
        : {}),
    })
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.scope, "customer"),
        eq(invitation.status, "pending"),
      ),
    )
    .returning();
  return row;
}

export type InvitationRow = typeof invitation.$inferSelect;

export function toView(row: InvitationRow, now: Date) {
  return {
    id: row.id,
    organisationId: row.organisationId ?? "",
    email: row.email,
    status: customerInvitationStatus({
      status: row.status,
      expiresAt: row.expiresAt,
      now,
    }),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    inviterId: row.inviterId,
  };
}

export async function findOrganisationName(
  executor: Executor,
  organisationId: string,
) {
  const [row] = await executor
    .select({ name: organisation.name })
    .from(organisation)
    .where(eq(organisation.id, organisationId))
    .limit(1);
  return row?.name ?? "";
}

// ---- accept ---------------------------------------------------------------------------------

/** Why an accept was refused. Audited; never shown to the visitor (one generic notice). */
export type AcceptRefusal =
  | "not_found"
  | "scope_mismatch"
  | "role_refused"
  | "not_pending"
  | "expired"
  | "credential_mismatch"
  | "organisation_unavailable"
  | "address_mismatch"
  | "person_conflict"
  | "concurrent";

export async function lockInvitationForAccept(
  executor: Executor,
  invitationId: string,
) {
  const [row] = await executor
    .select()
    .from(invitation)
    .where(eq(invitation.id, invitationId))
    .for("update")
    .limit(1);
  return row;
}

/** A plain, non-locking read for the sign-up pre-check; accept re-reads the row under a lock. */
export async function findInvitationForSignUp(
  executor: Executor,
  invitationId: string,
) {
  const [row] = await executor
    .select()
    .from(invitation)
    .where(eq(invitation.id, invitationId))
    .limit(1);
  return row;
}

export async function lockUsersForAccept(
  executor: Executor,
  userIds: readonly string[],
) {
  const ids = [...new Set(userIds)].sort();
  return executor
    .select({
      id: schema.userTable.id,
      name: schema.userTable.name,
      email: schema.userTable.email,
      emailVerified: schema.userTable.emailVerified,
    })
    .from(schema.userTable)
    .where(inArray(schema.userTable.id, ids))
    .orderBy(schema.userTable.id)
    .for("update");
}

export async function lockPeopleForAccept(
  executor: Executor,
  userIds: readonly string[],
) {
  const ids = [...new Set(userIds)].sort();
  return executor
    .select({
      id: schema.personTable.id,
      userId: schema.personTable.userId,
      organisationId: schema.personTable.organisationId,
      side: schema.personTable.side,
      active: schema.personTable.active,
      isPlaceholder: schema.personTable.isPlaceholder,
    })
    .from(schema.personTable)
    .where(inArray(schema.personTable.userId, ids))
    .orderBy(schema.personTable.id)
    .for("update");
}

export async function insertCustomerPerson(
  executor: Executor,
  values: { userId: string; organisationId: string; displayName: string },
) {
  const [row] = await executor
    .insert(schema.personTable)
    .values({
      userId: values.userId,
      organisationId: values.organisationId,
      side: "customer",
      displayName: values.displayName || null,
      active: true,
      isPlaceholder: false,
    })
    .returning({ id: schema.personTable.id });
  return row;
}

export async function findCanonicalCustomerRoleId(executor: Executor) {
  const [row] = await executor
    .select({ id: schema.roleTable.id })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "organisation"),
        eq(schema.roleTable.key, CUSTOMER_INVITATION_ROLE),
        eq(schema.roleTable.isSystem, true),
        isNull(schema.roleTable.workspaceId),
      ),
    )
    .limit(1);
  return row?.id;
}

/** The invitation sender is the evidenced actor for this direct customer-role grant. */
export async function ensureCustomerMembershipGrant(
  executor: Executor,
  values: {
    personId: string;
    organisationId: string;
    roleId: string;
    grantedByPersonId: string;
  },
) {
  const [active] = await executor
    .select({
      id: schema.membershipGrantTable.id,
      roleId: schema.membershipGrantTable.roleId,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, values.personId),
        eq(schema.membershipGrantTable.scope, "organisation"),
        eq(schema.membershipGrantTable.scopeId, values.organisationId),
        eq(schema.membershipGrantTable.sourceKind, "direct"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (active) {
    return {
      grantId: active.id,
      created: false,
      roleMatches: active.roleId === values.roleId,
    };
  }

  const [created] = await executor
    .insert(schema.membershipGrantTable)
    .values({
      personId: values.personId,
      scope: "organisation",
      scopeId: values.organisationId,
      roleId: values.roleId,
      sourceKind: "direct",
      directOrigin: "admin",
      grantedByPersonId: values.grantedByPersonId,
      seesAll: false,
    })
    .onConflictDoNothing()
    .returning({ id: schema.membershipGrantTable.id });
  if (created) return { grantId: created.id, created: true, roleMatches: true };

  const [raced] = await executor
    .select({
      id: schema.membershipGrantTable.id,
      roleId: schema.membershipGrantTable.roleId,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, values.personId),
        eq(schema.membershipGrantTable.scope, "organisation"),
        eq(schema.membershipGrantTable.scopeId, values.organisationId),
        eq(schema.membershipGrantTable.sourceKind, "direct"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    )
    .for("update")
    .limit(1);
  return {
    grantId: raced?.id,
    created: false,
    roleMatches: raced?.roleId === values.roleId,
  };
}

/** The single-use gate: affects exactly one row, and only while the same credential is stored. */
export async function markAccepted(
  executor: Executor,
  values: {
    id: string;
    credentialHash: string;
    personId: string;
    now: Date;
  },
) {
  const [row] = await executor
    .update(invitation)
    .set({
      status: "accepted",
      credentialHash: null,
      acceptedAt: values.now,
      acceptedPersonId: values.personId,
    })
    .where(
      and(
        eq(invitation.id, values.id),
        eq(invitation.scope, "customer"),
        eq(invitation.status, "pending"),
        eq(invitation.credentialHash, values.credentialHash),
      ),
    )
    .returning({ id: invitation.id });
  return row;
}

export { isWellFormedCustomerInvitation };
