import {
  type Approval,
  evaluateApprovalWithdrawalDecision,
} from "@taskdesk/domain";
import {
  can,
  expandCapabilities,
  isKeyCredential,
  type ProjectReachFacts,
  type ResolvedIdentity,
  reaches,
  resolveFeatureFlag,
} from "@taskdesk/permissions";
import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  currentInstanceAdminPredicate,
  currentProjectReachPredicate,
} from "../database/repositories/identity-scope.repository";
import { logTaskDesk } from "../instance/observability/runtime";
import type { ApiKey } from "../openapi";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { dbClockUtc } from "../utils/db-time";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";

const approverPerson = alias(schema.personTable, "approver_person");
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function requestWorkItemVisibility(
  identity: ResolvedIdentity,
  executor: Executor,
) {
  if (identity.side === "staff") return sql`true`;

  return or(
    sql`${schema.workItemTable.customerVisibility} <> 'private'`,
    eq(schema.workItemTable.requesterId, identity.personId),
    exists(
      executor
        .select({ one: sql`1` })
        .from(schema.requestParticipantTable)
        .where(
          and(
            eq(
              schema.requestParticipantTable.workItemId,
              schema.workItemTable.id,
            ),
            eq(schema.requestParticipantTable.personId, identity.personId),
          ),
        ),
    ),
  );
}

function requestWorkItemScope(
  identity: ResolvedIdentity,
  executor: Executor,
  options: { allowArchivedForRead?: true } = {},
) {
  return and(
    currentProjectReachPredicate(
      identity,
      schema.projectTable.id,
      schema.projectTable.workspaceId,
      schema.projectTable.organisationId,
      executor,
    ),
    requestWorkItemVisibility(identity, executor),
    isNull(schema.workItemTable.deletedAt),
    options.allowArchivedForRead
      ? undefined
      : isNull(schema.workItemTable.archivedAt),
    isNull(schema.projectTable.deletedAt),
  );
}

function requestWorkItemProjectScope(
  identity: ResolvedIdentity,
  projectId: string,
  executor: Executor,
) {
  return and(
    eq(schema.projectTable.id, projectId),
    isNull(schema.projectTable.deletedAt),
    currentProjectReachPredicate(
      identity,
      schema.projectTable.id,
      schema.projectTable.workspaceId,
      schema.projectTable.organisationId,
      executor,
    ),
  );
}

export function approvalRequestScope(
  identity: ResolvedIdentity,
  executor: Executor,
) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.projectTable.id, schema.workItemTable.projectId),
      )
      .where(
        and(
          eq(schema.workItemTable.id, schema.approvalTable.workItemId),
          eq(
            schema.workItemTable.workspaceId,
            schema.approvalTable.workspaceId,
          ),
          requestWorkItemScope(identity, executor),
        ),
      ),
  );
}

export function approvalAdminScope(
  identity: ResolvedIdentity,
  executor: Executor,
) {
  return identity.credential === "session"
    ? currentInstanceAdminPredicate(identity, executor)
    : sql`false`;
}

export type DueApprovalRow = Awaited<
  ReturnType<typeof selectDueApprovalRows>
>[number];

async function selectDueApprovalRows(tx: Transaction, limit: number) {
  return (
    tx
      .select({
        id: schema.approvalTable.id,
        workItemId: schema.approvalTable.workItemId,
        transitionId: schema.approvalTable.transitionId,
        kind: schema.approvalTable.kind,
        requestedBy: schema.approvalTable.requestedBy,
        approverId: schema.approvalTable.approverId,
        state: schema.approvalTable.state,
        createdAt: schema.approvalTable.createdAt,
        expiresAt: schema.approvalTable.expiresAt,
        reminder50SentAt: schema.approvalTable.reminder50SentAt,
        reminder90SentAt: schema.approvalTable.reminder90SentAt,
        decidedAt: schema.approvalTable.decidedAt,
        decisionNote: schema.approvalTable.decisionNote,
        now: sql<Date>`clock_timestamp()`,
        workspaceId: schema.approvalTable.workspaceId,
        projectId: schema.workItemTable.projectId,
        organisationId: schema.workspaceTable.organisationId,
      })
      .from(schema.approvalTable)
      .innerJoin(
        schema.workItemTable,
        and(
          eq(schema.workItemTable.id, schema.approvalTable.workItemId),
          eq(
            schema.workItemTable.workspaceId,
            schema.approvalTable.workspaceId,
          ),
        ),
      )
      .innerJoin(
        schema.workspaceTable,
        eq(schema.workspaceTable.id, schema.approvalTable.workspaceId),
      )
      .where(
        and(
          eq(schema.approvalTable.state, "pending"),
          sql`(
        ${schema.approvalTable.expiresAt} <= ${dbClockUtc()}
        OR (
          ${schema.approvalTable.reminder50SentAt} IS NULL
          AND ${schema.approvalTable.createdAt} + (${schema.approvalTable.expiresAt} - ${schema.approvalTable.createdAt}) * 0.5 <= ${dbClockUtc()}
        )
        OR (
          ${schema.approvalTable.reminder90SentAt} IS NULL
          AND ${schema.approvalTable.createdAt} + (${schema.approvalTable.expiresAt} - ${schema.approvalTable.createdAt}) * 0.9 <= ${dbClockUtc()}
        )
      )`,
        ),
      )
      .orderBy(schema.approvalTable.expiresAt, schema.approvalTable.id)
      .limit(limit)
      // Lock only the approval rows: the joined work item and workspace rows are not ours.
      .for("update", { skipLocked: true, of: schema.approvalTable })
  );
}

/** State transitions for the existing bounded reminder-scan job only. */
export async function expireDueApprovalRow(
  tx: Transaction,
  input: { id: string; workspaceId: string; decidedAt: Date },
) {
  const [row] = await tx
    .update(schema.approvalTable)
    .set({ state: "expired", decidedAt: input.decidedAt })
    .where(
      and(
        eq(schema.approvalTable.id, input.id),
        eq(schema.approvalTable.workspaceId, input.workspaceId),
        eq(schema.approvalTable.state, "pending"),
      ),
    )
    .returning({ id: schema.approvalTable.id });
  return row ?? null;
}

export async function markDueApprovalReminderSent(
  tx: Transaction,
  input: {
    id: string;
    workspaceId: string;
    reminder: "reminder_50" | "reminder_90";
    sentAt: Date;
  },
) {
  const [row] = await tx
    .update(schema.approvalTable)
    .set(
      input.reminder === "reminder_50"
        ? { reminder50SentAt: input.sentAt }
        : { reminder90SentAt: input.sentAt },
    )
    .where(
      and(
        eq(schema.approvalTable.id, input.id),
        eq(schema.approvalTable.workspaceId, input.workspaceId),
        eq(schema.approvalTable.state, "pending"),
      ),
    )
    .returning({ id: schema.approvalTable.id });
  return row ?? null;
}

/** Lock one bounded batch and run each state/event writer inside the same transaction. */
type DueApprovalRowResult = "expired" | "reminded" | "unchanged";

export async function withDueApprovalRows(
  limit: number,
  process: (
    tx: Transaction,
    row: DueApprovalRow,
  ) => Promise<DueApprovalRowResult>,
): Promise<DueApprovalRowResult[]> {
  return db.transaction(async (tx) => {
    const rows = await selectDueApprovalRows(tx, limit);
    const results: DueApprovalRowResult[] = [];
    for (const row of rows) {
      // Rows are independent: each runs in its own savepoint, so one failing row rolls back only
      // itself and the rest of the batch still commits (a poison row is retried next scan).
      try {
        results.push(
          await (
            tx as unknown as {
              transaction: <T>(
                fn: (inner: Transaction) => Promise<T>,
              ) => Promise<T>;
            }
          ).transaction((inner) => process(inner, row)),
        );
      } catch {
        logTaskDesk({
          module: "jobs",
          message: "jobs.failure",
          level: "error",
          result: "degraded",
        });
        results.push("unchanged");
      }
    }
    return results;
  });
}

/** Lock a live work item by `(workspace_id, id)`: a work item of another workspace is never found. */
export async function lockLiveWorkItem(
  tx: Transaction,
  identity: ResolvedIdentity,
  workspaceId: string,
  workItemId: string,
  allowInstanceAdmin = false,
) {
  const [row] = await tx
    .select({
      id: schema.workItemTable.id,
      workspaceId: schema.workItemTable.workspaceId,
      deletedAt: schema.workItemTable.deletedAt,
      archivedAt: schema.workItemTable.archivedAt,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.workItemTable.id, workItemId),
        eq(schema.workItemTable.workspaceId, workspaceId),
        or(
          requestWorkItemScope(identity, tx),
          allowInstanceAdmin ? approvalAdminScope(identity, tx) : sql`false`,
        ),
      ),
    )
    .for("update", { of: schema.workItemTable });
  return row && !row.deletedAt && !row.archivedAt ? row : null;
}

export async function lockApproval(
  tx: Transaction,
  identity: ResolvedIdentity,
  approvalId: string,
  workItemId: string,
  workspaceId: string,
  allowInstanceAdmin = false,
) {
  const [row] = await tx
    .select({
      id: schema.approvalTable.id,
      workspaceId: schema.approvalTable.workspaceId,
      workItemId: schema.approvalTable.workItemId,
      transitionId: schema.approvalTable.transitionId,
      kind: schema.approvalTable.kind,
      requestedBy: schema.approvalTable.requestedBy,
      approverId: schema.approvalTable.approverId,
      state: schema.approvalTable.state,
      createdAt: schema.approvalTable.createdAt,
      expiresAt: schema.approvalTable.expiresAt,
      reminder50SentAt: schema.approvalTable.reminder50SentAt,
      reminder90SentAt: schema.approvalTable.reminder90SentAt,
      decidedAt: schema.approvalTable.decidedAt,
      decisionNote: schema.approvalTable.decisionNote,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.id, schema.approvalTable.workItemId),
        eq(schema.workItemTable.workspaceId, schema.approvalTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.approvalTable.id, approvalId),
        eq(schema.approvalTable.workItemId, workItemId),
        eq(schema.approvalTable.workspaceId, workspaceId),
        or(
          requestWorkItemScope(identity, tx),
          allowInstanceAdmin ? approvalAdminScope(identity, tx) : sql`false`,
        ),
      ),
    )
    .for("update", { of: schema.approvalTable });
  return row ?? null;
}

export async function insertApprovalForRequest(
  tx: Transaction,
  identity: ResolvedIdentity,
  input: {
    id: string;
    workItemId: string;
    workspaceId: string;
    transitionId: string;
    kind: string;
    requestedBy: string;
    approverId: string;
    expiryDays: number;
    expiresAt?: Date;
  },
) {
  const [row] = await tx
    .insert(schema.approvalTable)
    .select(
      tx
        .select({
          id: sql`${input.id}`.as("id"),
          workspaceId: schema.workItemTable.workspaceId,
          workItemId: schema.workItemTable.id,
          transitionId: sql`${input.transitionId}`.as("transitionId"),
          kind: sql`${input.kind}`.as("kind"),
          requestedBy: sql`${input.requestedBy}`.as("requestedBy"),
          approverId: sql`${input.approverId}`.as("approverId"),
          state: sql`'pending'`.as("state"),
          createdAt: dbClockUtc().as("createdAt"),
          expiresAt: input.expiresAt
            ? sql`${sql.param(input.expiresAt, schema.approvalTable.expiresAt)}`.as(
                "expiresAt",
              )
            : sql`(${dbClockUtc()} + make_interval(days => ${input.expiryDays}::int))`.as(
                "expiresAt",
              ),
          reminder50SentAt: sql`NULL`.as("reminder50SentAt"),
          reminder90SentAt: sql`NULL`.as("reminder90SentAt"),
          decidedAt: sql`NULL`.as("decidedAt"),
          decisionNote: sql`NULL`.as("decisionNote"),
        })
        .from(schema.workItemTable)
        .innerJoin(
          schema.projectTable,
          eq(schema.projectTable.id, schema.workItemTable.projectId),
        )
        .where(
          and(
            eq(schema.workItemTable.id, input.workItemId),
            eq(schema.workItemTable.workspaceId, input.workspaceId),
            requestWorkItemScope(identity, tx),
          ),
        ),
    )
    .returning();
  return row ?? null;
}

export async function updateApprovalDecision(
  tx: Transaction,
  identity: ResolvedIdentity,
  input: {
    id: string;
    workspaceId: string;
    state: string;
    decidedAt: Date;
    decisionNote: string | null;
  },
) {
  const [row] = await tx
    .update(schema.approvalTable)
    .set({
      state: input.state,
      decidedAt: input.decidedAt,
      decisionNote: input.decisionNote,
    })
    .where(
      and(
        eq(schema.approvalTable.id, input.id),
        eq(schema.approvalTable.workspaceId, input.workspaceId),
        eq(schema.approvalTable.approverId, identity.personId),
        eq(schema.approvalTable.state, "pending"),
        approvalRequestScope(identity, tx),
      ),
    )
    .returning();
  return row ?? null;
}

export async function updateApprovalWithdrawal(
  tx: Transaction,
  identity: ResolvedIdentity,
  input: {
    id: string;
    workspaceId: string;
    decidedAt: Date;
    allowInstanceAdmin: boolean;
  },
) {
  const [row] = await tx
    .update(schema.approvalTable)
    .set({ state: "withdrawn", decidedAt: input.decidedAt })
    .where(
      and(
        eq(schema.approvalTable.id, input.id),
        eq(schema.approvalTable.workspaceId, input.workspaceId),
        eq(schema.approvalTable.state, "pending"),
        or(
          and(
            eq(schema.approvalTable.requestedBy, identity.personId),
            approvalRequestScope(identity, tx),
          ),
          input.allowInstanceAdmin
            ? approvalAdminScope(identity, tx)
            : sql`false`,
        ),
      ),
    )
    .returning();
  return row ?? null;
}

export async function closePendingApprovalRowsForTransition(
  tx: Transaction,
  identity: ResolvedIdentity,
  input: { workspaceId: string; workItemId: string; transitionId: string },
) {
  const closed = await tx
    .update(schema.approvalTable)
    .set({ state: "expired", decidedAt: dbClockUtc() })
    .where(
      and(
        eq(schema.approvalTable.workspaceId, input.workspaceId),
        eq(schema.approvalTable.workItemId, input.workItemId),
        eq(schema.approvalTable.transitionId, input.transitionId),
        eq(schema.approvalTable.state, "pending"),
        approvalRequestScope(identity, tx),
      ),
    )
    .returning({
      id: schema.approvalTable.id,
      kind: schema.approvalTable.kind,
      approverId: schema.approvalTable.approverId,
    });
  if (closed.length > 0) {
    await tx.delete(schema.notificationTable).where(
      and(
        eq(schema.notificationTable.resourceType, "approval"),
        inArray(
          schema.notificationTable.resourceId,
          closed.map(({ id }) => id),
        ),
      ),
    );
  }
  return closed;
}

export async function findApprovalActorPerson(
  tx: Transaction,
  userId: string | null,
) {
  if (!userId) return undefined;
  const [person] = await tx
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  return person;
}

export async function findApprovalWorkspaceOrganisation(
  tx: Transaction,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
  return workspace;
}

export async function isActiveInstanceAdmin(
  tx: Transaction,
  userId: string,
): Promise<boolean> {
  const [admin] = await tx
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .innerJoin(
      schema.personTable,
      and(
        eq(schema.personTable.userId, schema.userTable.id),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .where(
      and(eq(schema.userTable.id, userId), eq(schema.userTable.role, "admin")),
    )
    .limit(1);
  return admin !== undefined;
}

export async function resolveApprovalIdentity(
  userId: string,
  apiKey?: ApiKey,
  impersonatedBy?: string | null,
) {
  const identity = await resolveApprovalIdentityIfActive(
    userId,
    apiKey,
    impersonatedBy,
  );
  if (!identity) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  return identity;
}

export async function resolveApprovalIdentityIfActive(
  userId: string,
  apiKey?: ApiKey,
  impersonatedBy?: string | null,
) {
  return resolveRequestIdentity({
    userId,
    apiKey,
    impersonatedBy,
  });
}

export type ApprovalTarget = {
  workItemId: string;
  workItemKey: string;
  title: string;
  workspaceId: string;
  projectId: string;
  organisationId: string | null;
  requesterId: string | null;
  isPrivate: boolean;
  reachFacts: ProjectReachFacts;
};

export async function loadApprovalTargetByKey(
  identity: ResolvedIdentity,
  key: string,
  executor?: Executor,
  options: { allowArchivedForRead?: true } = {},
): Promise<ApprovalTarget> {
  const queryDb = executorOrDefault(executor);
  const [row] = await queryDb
    .select({
      workItemId: schema.workItemTable.id,
      workItemKey: schema.workItemTable.key,
      title: schema.workItemTable.title,
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      requesterId: schema.workItemTable.requesterId,
      customerVisibility: schema.workItemTable.customerVisibility,
      organisationId: schema.projectTable.organisationId,
      participantIds: sql<
        string[]
      >`ARRAY(SELECT rp.person_id FROM request_participant rp WHERE rp.work_item_id = ${schema.workItemTable.id})`,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.workItemTable.key, key),
        requestWorkItemScope(identity, queryDb, options),
      ),
    )
    .limit(1);

  if (!row) throw new HTTPException(404, { message: "Work item not found" });

  const visibleToPersonIds =
    row.customerVisibility === "private"
      ? [
          ...new Set(
            [row.requesterId, ...row.participantIds].filter(
              (personId): personId is string => personId !== null,
            ),
          ),
        ]
      : null;
  const reachFacts: ProjectReachFacts = {
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    organisationId: row.organisationId,
    // PR-2/PR-3: reach and approval authority follow the ancestor chain.
    ancestorProjectIds: await projectAncestryFor(
      queryDb,
      identity,
      row.workspaceId,
      row.projectId,
    ),
    ownerTeamId: await projectOwnerTeamFor(
      queryDb,
      identity,
      row.workspaceId,
      row.projectId,
    ),
    visibleToPersonIds,
  };
  return {
    workItemId: row.workItemId,
    workItemKey: row.workItemKey,
    title: row.title,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    organisationId: row.organisationId,
    requesterId: row.requesterId,
    isPrivate: row.customerVisibility === "private",
    reachFacts,
  };
}

/** Resolve the approval feature flag from persisted project/workspace/instance
 * settings. The pure hierarchy/default rules remain owned by permissions/features.ts. */
export async function resolveApprovalFeatureFlag(input: {
  identity: ResolvedIdentity;
  workspaceId: string;
  projectId: string;
}) {
  const [[instance], [workspace], [project]] = await Promise.all([
    db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(
        eq(schema.instanceFeatureFlagTable.featureKey, "feature.approvals"),
      )
      .limit(1),
    db
      .select({ enabled: schema.workspaceFeatureFlagTable.enabled })
      .from(schema.workspaceFeatureFlagTable)
      .innerJoin(
        schema.projectTable,
        eq(
          schema.projectTable.workspaceId,
          schema.workspaceFeatureFlagTable.workspaceId,
        ),
      )
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, input.workspaceId),
          eq(schema.projectTable.id, input.projectId),
          requestWorkItemProjectScope(input.identity, input.projectId, db),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      )
      .limit(1),
    db
      .select({ enabled: schema.projectFeatureFlagTable.enabled })
      .from(schema.projectFeatureFlagTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.projectTable.id, schema.projectFeatureFlagTable.projectId),
      )
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, input.projectId),
          requestWorkItemProjectScope(input.identity, input.projectId, db),
          eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      )
      .limit(1),
  ]);
  return resolveFeatureFlag({
    feature: "feature.approvals",
    instance: instance ?? null,
    workspace: workspace?.enabled ?? null,
    project: project?.enabled ?? null,
  });
}

/**
 * Resolve an approval link to its target. The workspace comes from the approval's own
 * anchored `workspace_id`, and a caller with no reach in that workspace who is not the
 * requester or the named approver gets `null` (a 404 for the route), never a 403 that
 * would confirm the id exists in another workspace.
 */
export async function loadApprovalTargetByApprovalId(
  id: string,
  identity: Awaited<ReturnType<typeof resolveApprovalIdentity>>,
  options: { currentInstanceAdmin?: boolean; executor?: Executor } = {},
) {
  const queryDb = executorOrDefault(options.executor);
  const allowAdmin =
    options.currentInstanceAdmin && identity.credential === "session";
  const [row] = await queryDb
    .select({
      workItemId: schema.workItemTable.id,
      workItemKey: schema.workItemTable.key,
      title: schema.workItemTable.title,
      workspaceId: schema.approvalTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      organisationId: schema.projectTable.organisationId,
      requesterId: schema.workItemTable.requesterId,
      customerVisibility: schema.workItemTable.customerVisibility,
      participantIds: sql<
        string[]
      >`ARRAY(SELECT rp.person_id FROM request_participant rp WHERE rp.work_item_id = ${schema.workItemTable.id})`,
      requestedBy: schema.approvalTable.requestedBy,
      approverId: schema.approvalTable.approverId,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.id, schema.approvalTable.workItemId),
        eq(schema.workItemTable.workspaceId, schema.approvalTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.approvalTable.id, id),
        or(
          requestWorkItemScope(identity, queryDb),
          eq(schema.approvalTable.requestedBy, identity.personId),
          eq(schema.approvalTable.approverId, identity.personId),
          allowAdmin
            ? currentInstanceAdminPredicate(identity, queryDb)
            : sql`false`,
        ),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const visibleToPersonIds =
    row.customerVisibility === "private"
      ? [
          ...new Set(
            [row.requesterId, ...row.participantIds].filter(
              (personId): personId is string => personId !== null,
            ),
          ),
        ]
      : null;
  const reachFacts: ProjectReachFacts = {
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    organisationId: row.organisationId,
    // PR-2/PR-3: reach and approval authority follow the ancestor chain.
    ancestorProjectIds: await projectAncestryFor(
      queryDb,
      identity,
      row.workspaceId,
      row.projectId,
    ),
    ownerTeamId: await projectOwnerTeamFor(
      queryDb,
      identity,
      row.workspaceId,
      row.projectId,
    ),
    visibleToPersonIds,
  };
  return {
    workItemId: row.workItemId,
    workItemKey: row.workItemKey,
    title: row.title,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    organisationId: row.organisationId,
    requesterId: row.requesterId,
    isPrivate: row.customerVisibility === "private",
    reachFacts,
  } satisfies ApprovalTarget;
}

/** The approval's kind and named approver, for the portal `addressed_approval` predicate. */
export async function loadApprovalAddressing(
  id: string,
  workspaceId: string,
  identity: ResolvedIdentity,
) {
  const [row] = await db
    .select({
      kind: schema.approvalTable.kind,
      approverId: schema.approvalTable.approverId,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.id, schema.approvalTable.workItemId),
        eq(schema.workItemTable.workspaceId, schema.approvalTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.approvalTable.id, id),
        eq(schema.approvalTable.workspaceId, workspaceId),
        or(
          eq(schema.approvalTable.approverId, identity.personId),
          eq(schema.approvalTable.requestedBy, identity.personId),
          requestWorkItemScope(identity, db),
        ),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listApprovalRows(
  identity: ResolvedIdentity,
  workItemId: string,
  workspaceId: string,
  allowInstanceAdmin = false,
  options: { allowArchivedForRead?: true } = {},
) {
  return db
    .select({
      id: schema.approvalTable.id,
      workItemId: schema.approvalTable.workItemId,
      workItemKey: schema.workItemTable.key,
      workItemTitle: schema.workItemTable.title,
      transitionId: schema.approvalTable.transitionId,
      kind: schema.approvalTable.kind,
      state: schema.approvalTable.state,
      createdAt: schema.approvalTable.createdAt,
      expiresAt: schema.approvalTable.expiresAt,
      reminder50SentAt: schema.approvalTable.reminder50SentAt,
      reminder90SentAt: schema.approvalTable.reminder90SentAt,
      decidedAt: schema.approvalTable.decidedAt,
      decisionNote: schema.approvalTable.decisionNote,
      requesterId: schema.approvalTable.requestedBy,
      requesterName: schema.personTable.displayName,
      approverId: schema.approvalTable.approverId,
      approverName: approverPerson.displayName,
      approverUserId: approverPerson.userId,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.id, schema.approvalTable.workItemId),
        eq(schema.workItemTable.workspaceId, schema.approvalTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.approvalTable.requestedBy),
    )
    .innerJoin(
      approverPerson,
      eq(approverPerson.id, schema.approvalTable.approverId),
    )
    .where(
      and(
        eq(schema.approvalTable.workItemId, workItemId),
        eq(schema.approvalTable.workspaceId, workspaceId),
        or(
          requestWorkItemScope(identity, db, options),
          eq(schema.approvalTable.requestedBy, identity.personId),
          eq(schema.approvalTable.approverId, identity.personId),
          allowInstanceAdmin ? approvalAdminScope(identity, db) : sql`false`,
        ),
        isNull(schema.workItemTable.deletedAt),
        options.allowArchivedForRead
          ? undefined
          : isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .orderBy(schema.approvalTable.createdAt);
}

/**
 * The approvals that can still count toward a gate (owner decision 2026-10-10): only
 * `pending`, `approved` and `rejected` approvals count, and approvals are single use, so an
 * approval created before its transition last ran on this work item is spent. The run is
 * read from the durable `transitioned` activity row, which records the transition id.
 */
function countingApprovalClause() {
  return and(
    inArray(schema.approvalTable.state, ["pending", "approved", "rejected"]),
    sql`NOT EXISTS (
      SELECT 1 FROM activity a
      WHERE a.workspace_id = ${schema.approvalTable.workspaceId}
        AND a.work_item_id = ${schema.approvalTable.workItemId}
        AND a.verb = 'transitioned'
        AND a.payload ->> 'transitionId' = ${schema.approvalTable.transitionId}
        AND a.created_at > ${schema.approvalTable.createdAt}
    )`,
  );
}

export async function listApprovalsForWorkItemTransition(
  identity: ResolvedIdentity,
  workItemId: string,
  workspaceId: string,
) {
  return db
    .select({
      id: schema.approvalTable.id,
      transitionId: schema.approvalTable.transitionId,
      kind: schema.approvalTable.kind,
      requestedBy: schema.approvalTable.requestedBy,
      approverId: schema.approvalTable.approverId,
      state: schema.approvalTable.state,
      createdAt: schema.approvalTable.createdAt,
      expiresAt: schema.approvalTable.expiresAt,
      reminder50SentAt: schema.approvalTable.reminder50SentAt,
      reminder90SentAt: schema.approvalTable.reminder90SentAt,
      approverName: approverPerson.displayName,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.id, schema.approvalTable.workItemId),
        eq(schema.workItemTable.workspaceId, schema.approvalTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      approverPerson,
      eq(approverPerson.id, schema.approvalTable.approverId),
    )
    .where(
      and(
        eq(schema.approvalTable.workItemId, workItemId),
        eq(schema.approvalTable.workspaceId, workspaceId),
        requestWorkItemScope(identity, db),
        countingApprovalClause(),
      ),
    );
}

export async function lockApprovalsForWorkItemTransition(
  tx: Transaction,
  identity: ResolvedIdentity,
  workItemId: string,
  workspaceId: string,
) {
  return tx
    .select({
      id: schema.approvalTable.id,
      transitionId: schema.approvalTable.transitionId,
      kind: schema.approvalTable.kind,
      requestedBy: schema.approvalTable.requestedBy,
      approverId: schema.approvalTable.approverId,
      state: schema.approvalTable.state,
      createdAt: schema.approvalTable.createdAt,
      expiresAt: schema.approvalTable.expiresAt,
      reminder50SentAt: schema.approvalTable.reminder50SentAt,
      reminder90SentAt: schema.approvalTable.reminder90SentAt,
      approverName: approverPerson.displayName,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.id, schema.approvalTable.workItemId),
        eq(schema.workItemTable.workspaceId, schema.approvalTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      approverPerson,
      eq(approverPerson.id, schema.approvalTable.approverId),
    )
    .where(
      and(
        eq(schema.approvalTable.workItemId, workItemId),
        eq(schema.approvalTable.workspaceId, workspaceId),
        requestWorkItemScope(identity, tx),
        countingApprovalClause(),
      ),
    )
    .for("share", { of: schema.approvalTable });
}

export async function listApprovalsForPerson(
  identity: ResolvedIdentity,
  options: { addressedOnly: boolean; pendingOnly?: boolean },
) {
  const clauses = [
    options.addressedOnly
      ? eq(schema.approvalTable.approverId, identity.personId)
      : sql`(${schema.approvalTable.approverId} = ${identity.personId} OR ${schema.approvalTable.requestedBy} = ${identity.personId})`,
  ];
  if (options.pendingOnly) {
    clauses.push(eq(schema.approvalTable.state, "pending"));
  }
  return db
    .select({
      id: schema.approvalTable.id,
      workItemId: schema.approvalTable.workItemId,
      workItemKey: schema.workItemTable.key,
      workItemTitle: schema.workItemTable.title,
      transitionId: schema.approvalTable.transitionId,
      kind: schema.approvalTable.kind,
      state: schema.approvalTable.state,
      createdAt: schema.approvalTable.createdAt,
      expiresAt: schema.approvalTable.expiresAt,
      reminder50SentAt: schema.approvalTable.reminder50SentAt,
      reminder90SentAt: schema.approvalTable.reminder90SentAt,
      decidedAt: schema.approvalTable.decidedAt,
      decisionNote: schema.approvalTable.decisionNote,
      requesterId: schema.approvalTable.requestedBy,
      requesterName: schema.personTable.displayName,
      approverId: schema.approvalTable.approverId,
      approverName: approverPerson.displayName,
      approverUserId: approverPerson.userId,
      workspaceId: schema.approvalTable.workspaceId,
      projectId: schema.workItemTable.projectId,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.id, schema.approvalTable.workItemId),
        eq(schema.workItemTable.workspaceId, schema.approvalTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.approvalTable.requestedBy),
    )
    .innerJoin(
      approverPerson,
      eq(approverPerson.id, schema.approvalTable.approverId),
    )
    .where(
      and(
        ...clauses,
        or(
          requestWorkItemScope(identity, db),
          eq(schema.approvalTable.requestedBy, identity.personId),
          eq(schema.approvalTable.approverId, identity.personId),
        ),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .orderBy(schema.approvalTable.createdAt);
}

export async function isCabTeamMember(
  identity: ResolvedIdentity,
  userId: string,
  workspaceId: string,
  workItemId: string,
  executor?: Executor,
) {
  const queryDb = executorOrDefault(executor);
  const [row] = await queryDb
    .select({ id: schema.teamMemberTable.id })
    .from(schema.teamMemberTable)
    .innerJoin(
      schema.teamTable,
      eq(schema.teamTable.id, schema.teamMemberTable.teamId),
    )
    .where(
      and(
        eq(schema.teamMemberTable.userId, userId),
        eq(schema.teamTable.workspaceId, workspaceId),
        eq(schema.teamTable.isCab, true),
        exists(
          queryDb
            .select({ one: sql`1` })
            .from(schema.workItemTable)
            .innerJoin(
              schema.projectTable,
              eq(schema.projectTable.id, schema.workItemTable.projectId),
            )
            .where(
              and(
                eq(schema.workItemTable.id, workItemId),
                eq(schema.workItemTable.workspaceId, workspaceId),
                requestWorkItemScope(identity, queryDb),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function loadApprovalActorName(personId: string): Promise<string> {
  const [person] = await db
    .select({ displayName: schema.personTable.displayName })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, personId))
    .limit(1);
  return person?.displayName ?? "TaskDesk user";
}

export async function loadApprovalRequestFacts(
  identity: ResolvedIdentity,
  workItemId: string,
  workspaceId: string,
  approverId: string,
) {
  const [[type], [approver], [settings]] = await Promise.all([
    db
      .select({
        typeId: schema.workItemTypeTable.id,
        workflowId: schema.workItemTypeTable.workflowId,
        isChange: schema.workItemTypeTable.isChange,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.projectTable.id, schema.workItemTable.projectId),
      )
      .innerJoin(
        schema.workItemTypeTable,
        eq(schema.workItemTypeTable.id, schema.workItemTable.typeId),
      )
      .where(
        and(
          eq(schema.workItemTable.id, workItemId),
          eq(schema.workItemTable.workspaceId, workspaceId),
          requestWorkItemScope(identity, db),
        ),
      )
      .limit(1),
    db
      .select({
        userId: schema.personTable.userId,
        side: schema.personTable.side,
      })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.id, approverId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.isPlaceholder, false),
        ),
      )
      .limit(1),
    db
      .select({ days: schema.instanceSettingTable.approvalDefaultExpiryDays })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"))
      .limit(1),
  ]);
  return { type, approver, expiryDays: settings?.days ?? 7 };
}

/**
 * The transition must be an approval-gated edge of the workflow version that governs this
 * work item (its type's workflow, that workflow's active version) in this workspace.
 * `workflow_transition` has no tenant FK, so every join below is the tenancy check (0120
 * review check 3). The review's "from state matches the current state" sub-check is NOT
 * enforced: approvals.md allows an approval on an already-completed item ("approve after the
 * fact"), so it conflicts with the spec and is reported as an open question.
 */
export async function loadTransitionForWorkItem(
  tx: Transaction,
  identity: ResolvedIdentity,
  input: {
    workItemId: string;
    workspaceId: string;
    transitionId: string;
  },
) {
  const [row] = await tx
    .select({ id: schema.workflowTransitionTable.id })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      schema.workItemTypeTable,
      eq(schema.workItemTypeTable.id, schema.workItemTable.typeId),
    )
    .innerJoin(
      schema.workflowTable,
      and(
        eq(schema.workflowTable.id, schema.workItemTypeTable.workflowId),
        eq(schema.workflowTable.workspaceId, schema.workItemTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.workflowVersionTable,
      and(
        eq(schema.workflowVersionTable.workflowId, schema.workflowTable.id),
        eq(
          schema.workflowVersionTable.id,
          schema.workflowTable.activeVersionId,
        ),
      ),
    )
    .innerJoin(
      schema.workflowTransitionTable,
      eq(
        schema.workflowTransitionTable.versionId,
        schema.workflowVersionTable.id,
      ),
    )
    .where(
      and(
        eq(schema.workItemTable.id, input.workItemId),
        eq(schema.workItemTable.workspaceId, input.workspaceId),
        requestWorkItemScope(identity, tx),
        eq(schema.workflowTransitionTable.id, input.transitionId),
        or(
          eq(schema.workflowTransitionTable.requiresApproval, true),
          eq(schema.workflowTransitionTable.requiresCab, true),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function hasWorkItemReach(
  identity: Awaited<ReturnType<typeof resolveApprovalIdentity>>,
  target: ApprovalTarget,
): Promise<boolean> {
  const reachFacts =
    identity.side === "staff"
      ? { ...target.reachFacts, visibleToPersonIds: null }
      : target.reachFacts;
  return reaches(identity, reachFacts);
}

export function hasApprovalCapability(
  identity: Awaited<ReturnType<typeof resolveApprovalIdentity>>,
  capability: Parameters<typeof can>[1],
  target: ApprovalTarget,
): boolean {
  return can(identity, capability, "work_item", {
    workItemId: target.workItemId,
    workItemProjectId: target.projectId,
    workspaceId: target.workspaceId,
    organisationId: target.organisationId ?? undefined,
    ancestorProjectIds: target.reachFacts.ancestorProjectIds,
  });
}

/** Customer deciders hold `approval:decide` through their organisation-scope `customer` role. */
export function hasPortalApprovalDecideCapability(
  identity: Awaited<ReturnType<typeof resolveApprovalIdentity>>,
  target: ApprovalTarget,
): boolean {
  return can(identity, "approval:decide", "organisation", {
    organisationId: target.organisationId ?? undefined,
  });
}

export async function canWithdrawApproval(
  row: {
    id: string;
    transitionId: string;
    kind: string;
    requesterId: string;
    approverId: string;
    state: string;
    createdAt: Date;
    expiresAt: Date;
    reminder50SentAt: Date | null;
    reminder90SentAt: Date | null;
  },
  identity: Awaited<ReturnType<typeof resolveApprovalIdentity>>,
  target: ApprovalTarget,
  options: { allowInstanceAdmin?: boolean } = {},
): Promise<{ authorized: boolean; actionable: boolean }> {
  // The requester route leaves this false. The affordance calculation and the dedicated
  // session-only admin route may opt in; key credentials never inherit the admin exception.
  const isInstanceAdmin =
    options.allowInstanceAdmin === true &&
    identity.credential === "session" &&
    can(identity, "instance:admin", "instance", { instance: true });
  const withdrawal = evaluateApprovalWithdrawalDecision({
    approval: {
      id: row.id,
      transitionId: row.transitionId,
      kind: row.kind as Approval["kind"],
      requestedBy: row.requesterId,
      approverId: row.approverId,
      state: row.state as Approval["state"],
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      reminder50SentAt: row.reminder50SentAt,
      reminder90SentAt: row.reminder90SentAt,
    },
    actingPersonId: identity.personId,
    isInstanceAdmin,
  });
  if (!withdrawal.authorized) return withdrawal;

  if (
    isKeyCredential(identity.credential) &&
    !expandCapabilities(identity.keyCapabilities ?? []).has("approval:request")
  ) {
    return { authorized: false, actionable: false };
  }
  if (isInstanceAdmin) return withdrawal;
  if (!(await hasWorkItemReach(identity, target))) {
    return { authorized: false, actionable: false };
  }
  if (!hasApprovalCapability(identity, "approval:request", target)) {
    return { authorized: false, actionable: false };
  }
  return withdrawal;
}
