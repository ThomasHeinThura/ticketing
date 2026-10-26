import {
  can,
  evaluatePolicy,
  type ResolvedIdentity,
  reaches,
  workspaceScopeFromRequest,
} from "@taskdesk/permissions";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { appendPendingActionStepUpAudit } from "../auth/step-up-audit";
import { consumePendingActionProof } from "../auth/step-up-service";
import db, { schema } from "../database";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import {
  deleteWorkItemInTransaction,
  publishWorkItemDeletion,
} from "../work-item/controllers/delete-work-item";
import { WORK_ITEM_HIERARCHY_LOCK_NAMESPACE } from "../work-item/hierarchy-lock";
import { lockRelationGraph } from "../work-item-relation/blockers";
import {
  approveClickDeletion,
  type ClickDeletionApprovalInput,
} from "./click-deletion-executor";
import { failOnExecutorError } from "./execution-failure";
import { lockPendingActionLifecycle } from "./lifecycle-invalidation";
import { requiredConfirmation } from "./payload";
import {
  type ActionRequiredAccessInput,
  evaluateActionRequiredAccess,
  type RequiredAccessDecision,
  resolvePendingActionCredentialIdentity,
} from "./required-access";
import {
  type CreatePendingActionInput,
  createPendingAction,
  type PendingActionTransaction,
} from "./service";
import {
  loadWorkItemDeletionTarget,
  workItemDeletionAccess,
  workItemDeletionSnapshot,
} from "./work-item-deletion-target";

export const BULK_WORK_ITEM_DELETION_ROUTE =
  "POST /api/work-items/bulk" as const;
export type BulkDeletionResult = {
  succeeded: string[];
  failed: Array<{ id: string; reason: string }>;
};
class NoEligibleBulkDeletionTargets extends Error {
  constructor(readonly failed: BulkDeletionResult["failed"]) {
    super("No eligible bulk deletion targets");
  }
}
function ordinaryObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function batchRouteAccess(
  identity: ResolvedIdentity,
  workspaceId: string,
): RequiredAccessDecision {
  const route = policyRegistry.get(BULK_WORK_ITEM_DELETION_ROUTE);
  if (
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.capability !== "work_item:read" ||
    route.policy.scope !== "workspace" ||
    route.policy.scopeSource !== "request" ||
    route.policy.reach !== "required"
  )
    return { allowed: false, failure: "unsupported", status: 403 };
  const inReach =
    identity.reach.kind === "all" ||
    (identity.reach.kind !== "organisation" &&
      ((identity.reach.kind === "membership_with_workspaces" &&
        identity.reach.workspaceIds.includes(workspaceId)) ||
        identity.memberships.some(
          (m) => m.scope === "workspace" && m.scopeId === workspaceId,
        )));
  const decision = evaluatePolicy(route.policy, {
    identity,
    target: { workspaceId },
    scope: workspaceScopeFromRequest({ workspaceId }),
    inReach,
  });
  if (!decision.allowed)
    return {
      allowed: false,
      failure: decision.status === 404 ? "reach" : "capability",
      status: decision.status,
    };
  // The route's operation-specific check remains the existing work_item:delete capability.
  return can(identity, "work_item:delete", "workspace", { workspaceId })
    ? { allowed: true }
    : { allowed: false, failure: "capability", status: 403 };
}
async function lockBatch(
  tx: PendingActionTransaction,
  workspaceId: string,
  keys: readonly string[],
) {
  await lockRelationGraph(tx, workspaceId);
  const anchors = await tx
    .select({ projectId: schema.workItemTable.projectId })
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.workspaceId, workspaceId),
        inArray(schema.workItemTable.key, [...keys]),
      ),
    )
    .orderBy(asc(schema.workItemTable.projectId));
  for (const projectId of [...new Set(anchors.map((r) => r.projectId))])
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORK_ITEM_HIERARCHY_LOCK_NAMESPACE},hashtext(${projectId}))`,
    );
}
export async function resolveBulkWorkItemDeletionRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
) {
  if (
    !input.workspaceId ||
    input.projectId != null ||
    !input.targetIds.length ||
    input.targetIds.length > 500 ||
    new Set(input.targetIds).size !== input.targetIds.length
  )
    throw new HTTPException(400, { message: "Invalid bulk deletion targets" });
  if (
    !(
      (input.origin === "web" && input.credentialType === "session") ||
      ((input.origin === "api" || input.origin === "mcp") &&
        input.credentialType === "api_key")
    )
  )
    throw new HTTPException(403, {
      message: "pending_action_credential_unsupported",
    });
  const identity = await resolvePendingActionCredentialIdentity(tx, {
    requestedByPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
  });
  if (!("authority" in identity))
    throw new HTTPException(403, { message: "Forbidden" });
  const access = batchRouteAccess(identity, input.workspaceId);
  if (!access.allowed)
    throw new HTTPException(access.status === 404 ? 404 : 403, {
      message: "Forbidden",
    });
  const [workspace] = await tx
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, input.workspaceId));
  const [actor] = await tx
    .select({ userId: schema.personTable.userId, name: schema.userTable.name })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(eq(schema.personTable.id, input.requesterPersonId));
  if (
    !workspace ||
    !actor ||
    (input.actorId !== actor.userId &&
      !(
        input.actorType === "person" &&
        input.actorId === input.requesterPersonId
      ))
  )
    throw new HTTPException(403, { message: "Forbidden" });
  if (
    input.organisationId !== undefined &&
    input.organisationId !== workspace.organisationId
  )
    throw new HTTPException(404, { message: "Work item not found" });
  await lockBatch(tx, input.workspaceId, input.targetIds);
  const targets: NonNullable<
    Awaited<ReturnType<typeof loadWorkItemDeletionTarget>>
  >[] = [];
  const failed: BulkDeletionResult["failed"] = [];
  for (const key of [...input.targetIds].sort()) {
    // Never take another workspace's graph lock for a hidden/foreign supplied key.
    const [anchor] = await tx
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(
        and(
          eq(schema.workItemTable.key, key),
          eq(schema.workItemTable.workspaceId, input.workspaceId),
        ),
      );
    const target = anchor
      ? await loadWorkItemDeletionTarget(tx, key)
      : undefined;
    const permission = target
      ? await workItemDeletionAccess(tx, identity, target)
      : undefined;
    if (!target || !permission?.allowed)
      failed.push({
        id: key,
        reason:
          permission?.failure === "capability"
            ? "Insufficient permissions"
            : "Work item not found",
      });
    else targets.push(target);
  }
  if (!targets.length) throw new NoEligibleBulkDeletionTargets(failed);
  const projects = new Map<
    string,
    { id: string; name: string; count: number }
  >();
  for (const target of targets) {
    const project = projects.get(target.project.id) ?? {
      id: target.project.id,
      name: target.project.name,
      count: 0,
    };
    project.count++;
    projects.set(project.id, project);
  }
  const executionTargetIds = targets.map((t) => t.item.key);
  return {
    workspaceId: input.workspaceId,
    projectId: null,
    organisationId: workspace.organisationId,
    actorName: actor.name,
    executionTargetIds,
    summary: {
      selectedCount: input.targetIds.length,
      affectedCount: targets.length,
      selection: { kind: "keys", keys: executionTargetIds },
      projects: [...projects.values()],
      representativeTargets: targets.slice(0, 10).map((t) => ({
        key: t.item.key,
        title: t.item.title,
        projectName: t.project.name,
      })),
      childrenAffected: new Set(
        targets.flatMap((t) => t.children.map((c) => c.id)),
      ).size,
      failed,
      recoveryDays: 30,
      requesterName: actor.name,
    },
    targetVersions: Object.fromEntries(
      targets.map((t) => [
        t.item.key,
        {
          ...workItemDeletionSnapshot(t),
          organisationId: t.project.organisationId,
        },
      ]),
    ),
  };
}
export async function requestBulkWorkItemDeletion(
  input: CreatePendingActionInput,
) {
  try {
    return { kind: "pending" as const, data: await createPendingAction(input) };
  } catch (error) {
    if (!(error instanceof NoEligibleBulkDeletionTargets)) throw error;
    await appendAuditLog(db, {
      actorId: input.actorId,
      actorType: input.actorType,
      workspaceId: input.workspaceId ?? null,
      action: "bulk.performed",
      entityType: "workspace",
      entityId: input.workspaceId ?? "",
      before: null,
      after: {
        operation: "delete",
        requested: input.targetIds.length,
        succeeded: 0,
        failed: error.failed.length,
      },
    });
    return {
      kind: "empty" as const,
      data: {
        succeeded: [],
        failed: error.failed,
      } satisfies BulkDeletionResult,
    };
  }
}
export async function evaluateBulkWorkItemDeletionAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
): Promise<RequiredAccessDecision> {
  if (
    input.action !== "bulk_delete" ||
    input.targetType !== "work_item" ||
    input.routeKey !== BULK_WORK_ITEM_DELETION_ROUTE ||
    !input.workspaceId ||
    input.projectId !== null ||
    !input.targetIds.length ||
    input.targetIds.length > 500 ||
    input.confirmationRequired !==
      requiredConfirmation({
        action: "bulk_delete",
        targetType: "work_item",
        targetCount: input.targetIds.length,
      })
  )
    return { allowed: false, failure: "unsupported", status: 403 };
  const routeAccess = batchRouteAccess(identity, input.workspaceId);
  if (!routeAccess.allowed) return routeAccess;
  const [workspace] = await tx
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, input.workspaceId));
  if (!workspace || workspace.organisationId !== input.organisationId)
    return { allowed: false, failure: "target_scope", status: 409 };
  const versions = ordinaryObject(input.targetVersions);
  if (!versions || Object.keys(versions).length !== input.targetIds.length)
    return { allowed: false, failure: "target_version", status: 409 };
  await lockBatch(tx, input.workspaceId, input.targetIds);
  for (const key of [...input.targetIds].sort()) {
    const stored = ordinaryObject(versions[key]);
    // Check frozen workspace before loading/locking a possibly moved record in another graph.
    const [anchor] = await tx
      .select({ workspaceId: schema.workItemTable.workspaceId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    if (!anchor || anchor.workspaceId !== input.workspaceId)
      return { allowed: false, failure: "target_scope", status: 409 };
    const target = await loadWorkItemDeletionTarget(tx, key);
    if (
      !target ||
      !stored ||
      target.item.workspaceId !== input.workspaceId ||
      stored.projectId !== target.item.projectId ||
      stored.organisationId !== target.project.organisationId
    )
      return { allowed: false, failure: "target_scope", status: 409 };
    const permission = await workItemDeletionAccess(tx, identity, target);
    if (!permission.allowed) return permission;
    const expected = {
      ...workItemDeletionSnapshot(target),
      organisationId: target.project.organisationId,
    };
    if (
      Object.keys(stored).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([k, v]) => stored[k] !== v)
    )
      return { allowed: false, failure: "target_version", status: 409 };
  }
  return { allowed: true };
}
export async function bulkWorkItemDeletionReadSummary(
  row: typeof schema.pendingActionTable.$inferSelect,
  executor: typeof db | PendingActionTransaction,
  viewer?: ResolvedIdentity,
): Promise<Record<string, unknown> | undefined> {
  const [person] = await executor
    .select({ userId: schema.personTable.userId })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, row.requestedByPersonId));
  const identity =
    viewer ??
    (person?.userId
      ? await resolveIdentity(
          { userId: person.userId, credential: "session" },
          executor,
        )
      : null);
  if (
    !identity ||
    identity.personId !== row.requestedByPersonId ||
    !row.targetIds.length
  )
    return undefined;
  const targets = await executor
    .select({
      id: schema.workItemTable.id,
      key: schema.workItemTable.key,
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        inArray(schema.workItemTable.key, row.targetIds),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    );
  if (targets.length !== row.targetIds.length) return undefined;
  for (const t of targets) {
    if (t.workspaceId !== row.workspaceId) return undefined;
    const ancestorProjectIds = await projectAncestryFor(
      executor,
      identity,
      t.workspaceId,
      t.projectId,
    );
    const ownerTeamId = await projectOwnerTeamFor(
      executor,
      identity,
      t.workspaceId,
      t.projectId,
    );
    if (
      !reaches(identity, { ...t, ancestorProjectIds, ownerTeamId }) ||
      !can(identity, "work_item:read", "work_item", {
        workItemId: t.id,
        workItemProjectId: t.projectId,
        workspaceId: t.workspaceId,
        ancestorProjectIds,
      })
    )
      return undefined;
  }
  return ordinaryObject(row.payloadSummary);
}
export async function approveBulkWorkItemDeletion(
  input: ClickDeletionApprovalInput,
) {
  const approved = await approveClickDeletion<{
    result: BulkDeletionResult;
    deleted: Awaited<ReturnType<typeof deleteWorkItemInTransaction>>[];
  }>(input, {
    action: "bulk_delete",
    targetType: "work_item",
    routeKey: BULK_WORK_ITEM_DELETION_ROUTE,
    confirmation: ["typed_count", "typed_count_step_up"],
    confirm: async (tx, row) => {
      if (input.typedCount !== String(row.targetIds.length))
        throw new HTTPException(400, { message: "confirmation_mismatch" });
      if (row.confirmationRequired !== "typed_count_step_up")
        return { supplied: { typedCount: row.targetIds.length } };
      const proof = await consumePendingActionProof(tx, {
        token: input.stepUpToken ?? "",
        personId: input.requesterPersonId,
        sessionId: input.sessionId,
        userId: input.userId,
        pendingActionId: row.id,
      });
      if (!proof) {
        await appendPendingActionStepUpAudit(tx, {
          action: "auth.step_up_denied",
          actorId: input.userId,
          personId: input.requesterPersonId,
          pendingActionId: row.id,
          traceId: input.traceId,
        });
        return {
          supplied: {},
          denied: input.stepUpToken
            ? ("step_up_expired" as const)
            : ("step_up_required" as const),
        };
      }
      await appendPendingActionStepUpAudit(tx, {
        action: "auth.step_up_consumed",
        actorId: input.userId,
        personId: input.requesterPersonId,
        pendingActionId: row.id,
        traceId: input.traceId,
      });
      return {
        supplied: { typedCount: row.targetIds.length, stepUp: true },
        stepUpTokenId: proof.id,
      };
    },
    execute: failOnExecutorError(async (tx, row) => {
      const summary = ordinaryObject(row.payloadSummary);
      const initialFailures = Array.isArray(summary?.failed)
        ? summary.failed.filter(
            (f): f is { id: string; reason: string } =>
              !!f &&
              typeof f === "object" &&
              typeof f.id === "string" &&
              typeof f.reason === "string",
          )
        : [];
      const result: BulkDeletionResult = {
        succeeded: [],
        failed: [...initialFailures],
      };
      const deleted: Awaited<ReturnType<typeof deleteWorkItemInTransaction>>[] =
        [];
      for (const key of row.targetIds) {
        try {
          deleted.push(
            await tx.transaction((itemTx) =>
              deleteWorkItemInTransaction(
                itemTx,
                key,
                row.workspaceId ?? "",
                input.userId,
                "person",
              ),
            ),
          );
          result.succeeded.push(key);
        } catch {
          result.failed.push({ id: key, reason: "failed" });
        }
      }
      await appendAuditLog(tx, {
        actorId: input.userId,
        actorType: "person",
        workspaceId: row.workspaceId,
        action: "bulk.performed",
        entityType: "workspace",
        entityId: row.workspaceId ?? "",
        before: null,
        after: {
          operation: "delete",
          requested: row.targetIds.length + initialFailures.length,
          succeeded: result.succeeded.length,
          failed: result.failed.length,
        },
      });
      return { result, deleted };
    }),
    summaryResult: (value) => value.result,
    afterCommit: async (value) => {
      for (const item of value.deleted) await publishWorkItemDeletion(item);
    },
  });
  return { ...approved, result: approved.executionResult?.result };
}

/** Admit only the requester's current frozen bulk action, with both credential ceilings intact. */
export async function bulkWorkItemDeletionStepUpAccess(
  executor: typeof db | PendingActionTransaction,
  input: { id: string; requesterPersonId: string; sessionId: string },
): Promise<boolean> {
  const check = async (tx: PendingActionTransaction) => {
    await lockPendingActionLifecycle(tx);
    const [row] = await tx
      .select()
      .from(schema.pendingActionTable)
      .where(
        and(
          eq(schema.pendingActionTable.id, input.id),
          eq(
            schema.pendingActionTable.requestedByPersonId,
            input.requesterPersonId,
          ),
          eq(schema.pendingActionTable.state, "pending"),
        ),
      )
      .for("update");
    if (
      !row ||
      row.expiresAt <= new Date() ||
      row.action !== "bulk_delete" ||
      row.targetType !== "work_item" ||
      row.routeKey !== BULK_WORK_ITEM_DELETION_ROUTE ||
      row.confirmationRequired !== "typed_count_step_up"
    )
      return false;
    const original = await evaluateActionRequiredAccess(tx, row, {
      existingPendingAction: true,
    });
    if (!original.allowed) return false;
    return (
      await evaluateActionRequiredAccess(tx, {
        ...row,
        credentialType: "session",
        credentialId: input.sessionId,
      })
    ).allowed;
  };
  return executor === db
    ? db.transaction(check)
    : check(executor as PendingActionTransaction);
}
