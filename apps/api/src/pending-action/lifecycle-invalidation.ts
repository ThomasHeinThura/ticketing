import { createId } from "@paralleldrive/cuid2";
import { appendAuditLog } from "../audit/audit-writer";
import type db from "../database";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  invalidateRequesterPendingAction,
  listRequesterPendingActionsForUpdate,
  lockPendingActionLifecycle as lockPendingActionLifecycleQuery,
} from "./lifecycle-invalidation.repository";

type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Serialize pending-action creation/approval with requester lifecycle changes.
 * The two-key advisory-lock form is in a separate PostgreSQL lock namespace from
 * the one-key instance-admin lock 2026. Call before taking row locks. When both
 * locks are needed, take the instance-admin lock first.
 */
export async function lockPendingActionLifecycle(tx: PendingActionTransaction) {
  await lockPendingActionLifecycleQuery(tx);
}

/**
 * Instance actions may bind an organisation in the pending-action row while their event
 * envelope remains instance-scoped. The event contract has no organisation-only scope.
 */
export function pendingActionEventScope(input: {
  action: string;
  targetType: string;
  routeKey: string;
  targetIds: readonly string[];
  workspaceId: string | null;
  projectId: string | null;
  organisationId: string | null;
}) {
  if (
    input.action === "delete" &&
    input.targetType === "organisation" &&
    input.routeKey === "DELETE /api/instance/organisations/{id}" &&
    input.workspaceId === null &&
    input.projectId === null &&
    input.targetIds.length === 1 &&
    input.organisationId === input.targetIds[0]
  )
    return {};
  if (
    input.action === "purge" &&
    input.targetType === "organisation" &&
    input.routeKey === "POST /api/instance/purge" &&
    input.workspaceId === null &&
    input.projectId === null &&
    input.targetIds.length === 1 &&
    input.organisationId === input.targetIds[0]
  )
    return {};
  return eventScope(input);
}

/**
 * Make every outstanding request by a deactivated person terminal in the same
 * transaction as the person-wide lifecycle transition. Callers hold the
 * lifecycle gate and have already locked the person closure.
 */
export async function invalidatePendingActionsForRequester(
  tx: PendingActionTransaction,
  requesterPersonId: string,
  occurredAt: Date,
) {
  const pendingRows = await listRequesterPendingActionsForUpdate(
    tx,
    requesterPersonId,
  );

  let auditFailures = 0;
  for (const row of pendingRows) {
    const invalidated = await invalidateRequesterPendingAction(
      tx,
      row.id,
      occurredAt,
    );
    if (!invalidated) continue;

    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "pending_action.decided",
      occurredAt: occurredAt.toISOString(),
      actor: {
        type: "system",
        id: null,
        name: "TaskDesk identity lifecycle",
      },
      scope: pendingActionEventScope({
        action: row.action,
        targetType: row.targetType,
        routeKey: row.routeKey,
        targetIds: row.targetIds,
        workspaceId: row.workspaceId,
        organisationId: row.organisationId,
        projectId: row.projectId,
      }),
      payload: {
        key: row.id,
        url: `/dashboard/settings/account/pending-actions/${row.id}`,
        pendingActionId: row.id,
        outcome: "invalidated",
        invalidationReason: "requester_deactivated",
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });

    try {
      await tx.transaction(async (auditTx) =>
        appendAuditLog(auditTx, {
          actorId: null,
          actorType: "system",
          traceId: row.traceId,
          workspaceId: row.workspaceId,
          projectId: row.projectId,
          organisationId: row.organisationId,
          action: "pending_action.decided",
          entityType: "pending_action",
          entityId: row.id,
          before: { state: "pending" },
          after: {
            state: "invalidated",
            invalidationReason: "requester_deactivated",
          },
        }),
      );
    } catch {
      auditFailures += 1;
    }
  }
  return auditFailures;
}

/** Report AU-14 failures only after the caller's outer lifecycle transaction commits. */
export async function reportPendingActionAuditFailures(count: number) {
  for (let index = 0; index < count; index += 1)
    recordAuditWriteFailure("pending_action_decision");
  if (count > 0)
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
}
