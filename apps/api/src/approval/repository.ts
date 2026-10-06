import { type Approval, evaluateApprovalWithdrawal } from "@taskdesk/domain";
import {
  CAPABILITY_NAMES,
  can,
  expandCapabilities,
  isKeyCredential,
  type ProjectReachFacts,
  reaches,
  resolveFeatureFlag,
} from "@taskdesk/permissions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import type { ApiKey } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { apiKeyHasCapabilityScope } from "../utils/require-api-key-permission-scope";

const approverPerson = alias(schema.personTable, "approver_person");
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DueApprovalRow = Awaited<
  ReturnType<typeof selectDueApprovalRows>
>[number];

async function selectDueApprovalRows(tx: Transaction, limit: number) {
  return tx
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
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      organisationId: schema.workspaceTable.organisationId,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      eq(schema.workItemTable.id, schema.approvalTable.workItemId),
    )
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
    )
    .where(
      and(
        eq(schema.approvalTable.state, "pending"),
        sql`(
        ${schema.approvalTable.expiresAt} <= clock_timestamp()
        OR (
          ${schema.approvalTable.reminder50SentAt} IS NULL
          AND ${schema.approvalTable.createdAt} + (${schema.approvalTable.expiresAt} - ${schema.approvalTable.createdAt}) * 0.5 <= clock_timestamp()
        )
        OR (
          ${schema.approvalTable.reminder90SentAt} IS NULL
          AND ${schema.approvalTable.createdAt} + (${schema.approvalTable.expiresAt} - ${schema.approvalTable.createdAt}) * 0.9 <= clock_timestamp()
        )
      )`,
      ),
    )
    .orderBy(schema.approvalTable.expiresAt, schema.approvalTable.id)
    .limit(limit)
    .for("update", { skipLocked: true });
}

/** Lock one bounded batch and run each state/event writer inside the same transaction. */
export async function withDueApprovalRows<T>(
  limit: number,
  process: (tx: Transaction, row: DueApprovalRow) => Promise<T>,
): Promise<T[]> {
  return db.transaction(async (tx) => {
    const rows = await selectDueApprovalRows(tx, limit);
    const results: T[] = [];
    for (const row of rows) results.push(await process(tx, row));
    return results;
  });
}

export async function lockLiveWorkItem(tx: Transaction, workItemId: string) {
  const [row] = await tx
    .select({
      id: schema.workItemTable.id,
      deletedAt: schema.workItemTable.deletedAt,
      archivedAt: schema.workItemTable.archivedAt,
    })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, workItemId))
    .for("update");
  return row && !row.deletedAt && !row.archivedAt ? row : null;
}

export async function lockApproval(
  tx: Transaction,
  approvalId: string,
  workItemId: string,
) {
  const [row] = await tx
    .select()
    .from(schema.approvalTable)
    .where(
      and(
        eq(schema.approvalTable.id, approvalId),
        eq(schema.approvalTable.workItemId, workItemId),
      ),
    )
    .for("update");
  return row ?? null;
}

export async function resolveApprovalIdentity(userId: string, apiKey?: ApiKey) {
  const identity = await resolveApprovalIdentityIfActive(userId, apiKey);
  if (!identity) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  return identity;
}

export async function resolveApprovalIdentityIfActive(
  userId: string,
  apiKey?: ApiKey,
) {
  return resolveIdentity({
    userId,
    credential: apiKey ? "api_key" : "session",
    apiKey: apiKey
      ? {
          enabled: apiKey.enabled,
          ownerUserId: apiKey.userId,
          // Better Auth stores key scopes as resource/action statements; project those
          // statements onto the registered capability vocabulary before the canonical
          // evaluator intersects them with the owner's current roles. Keep this mapping
          // in the shared, validated scope helper instead of parsing it locally.
          capabilities: CAPABILITY_NAMES.filter((capability) =>
            apiKeyHasCapabilityScope(apiKey, capability),
          ),
        }
      : undefined,
  });
}

export type ApprovalTarget = {
  workItemId: string;
  workItemKey: string;
  title: string;
  workspaceId: string;
  projectId: string;
  organisationId: string;
  requesterId: string | null;
  isPrivate: boolean;
  reachFacts: ProjectReachFacts;
};

export async function loadApprovalTargetByKey(
  key: string,
): Promise<ApprovalTarget> {
  const [row] = await db
    .select({
      workItemId: schema.workItemTable.id,
      workItemKey: schema.workItemTable.key,
      title: schema.workItemTable.title,
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      requesterId: schema.workItemTable.requesterId,
      customerVisibility: schema.workItemTable.customerVisibility,
      organisationId: schema.workspaceTable.organisationId,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
    )
    .where(
      and(
        eq(schema.workItemTable.key, key),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);

  if (!row) throw new HTTPException(404, { message: "Work item not found" });

  const visibleToPersonIds =
    row.customerVisibility === "private" && row.requesterId
      ? [row.requesterId]
      : null;
  const reachFacts: ProjectReachFacts = {
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    organisationId: row.organisationId,
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
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, input.workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      )
      .limit(1),
    db
      .select({ enabled: schema.projectFeatureFlagTable.enabled })
      .from(schema.projectFeatureFlagTable)
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, input.projectId),
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

export async function loadApprovalTargetByApprovalId(id: string) {
  const [row] = await db
    .select({ key: schema.workItemTable.key })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      eq(schema.workItemTable.id, schema.approvalTable.workItemId),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(eq(schema.approvalTable.id, id))
    .limit(1);
  if (!row) return null;
  return loadApprovalTargetByKey(row.key);
}

export async function listApprovalRows(workItemId: string) {
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
      eq(schema.workItemTable.id, schema.approvalTable.workItemId),
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
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .orderBy(schema.approvalTable.createdAt);
}

export async function listApprovalsForWorkItemTransition(workItemId: string) {
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
      approverPerson,
      eq(approverPerson.id, schema.approvalTable.approverId),
    )
    .where(eq(schema.approvalTable.workItemId, workItemId));
}

export async function lockApprovalsForWorkItemTransition(
  tx: Transaction,
  workItemId: string,
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
      approverPerson,
      eq(approverPerson.id, schema.approvalTable.approverId),
    )
    .where(eq(schema.approvalTable.workItemId, workItemId))
    .for("share");
}

export async function listApprovalsForPerson(
  personId: string,
  options: { addressedOnly: boolean; pendingOnly?: boolean },
) {
  const clauses = [
    options.addressedOnly
      ? eq(schema.approvalTable.approverId, personId)
      : sql`(${schema.approvalTable.approverId} = ${personId} OR ${schema.approvalTable.requestedBy} = ${personId})`,
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
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      eq(schema.workItemTable.id, schema.approvalTable.workItemId),
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
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .orderBy(schema.approvalTable.createdAt);
}

export async function isCabTeamMember(userId: string, workspaceId: string) {
  const [row] = await db
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
  workItemId: string,
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
        schema.workItemTypeTable,
        eq(schema.workItemTypeTable.id, schema.workItemTable.typeId),
      )
      .where(eq(schema.workItemTable.id, workItemId))
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

export async function loadTransitionForWorkItem(
  tx: Transaction,
  workItemId: string,
  transitionId: string,
) {
  const [row] = await tx
    .select({ id: schema.workflowTransitionTable.id })
    .from(schema.workItemTable)
    .innerJoin(
      schema.workItemTypeTable,
      eq(schema.workItemTypeTable.id, schema.workItemTable.typeId),
    )
    .innerJoin(
      schema.workflowTable,
      eq(schema.workflowTable.id, schema.workItemTypeTable.workflowId),
    )
    .innerJoin(
      schema.workflowVersionTable,
      eq(schema.workflowVersionTable.workflowId, schema.workflowTable.id),
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
        eq(schema.workItemTable.id, workItemId),
        eq(schema.workflowTransitionTable.id, transitionId),
        eq(
          schema.workflowVersionTable.id,
          schema.workflowTable.activeVersionId,
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
  let reachFacts = target.reachFacts;
  if (target.isPrivate) {
    const participants = await db
      .select({ personId: schema.requestParticipantTable.personId })
      .from(schema.requestParticipantTable)
      .where(eq(schema.requestParticipantTable.workItemId, target.workItemId));
    reachFacts = {
      ...target.reachFacts,
      visibleToPersonIds: [
        ...(target.requesterId ? [target.requesterId] : []),
        ...participants.map(({ personId }) => personId),
      ],
    };
  }
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
    organisationId: target.organisationId,
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
): Promise<boolean> {
  const isInstanceAdmin = identity.reach.kind === "all";
  const withdrawal = evaluateApprovalWithdrawal({
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
  if (!withdrawal.ok) {
    return false;
  }

  if (
    isKeyCredential(identity.credential) &&
    !expandCapabilities(identity.keyCapabilities ?? []).has("approval:request")
  ) {
    return false;
  }
  if (isInstanceAdmin) return true;
  if (!(await hasWorkItemReach(identity, target))) return false;
  return hasApprovalCapability(identity, "approval:request", target);
}
