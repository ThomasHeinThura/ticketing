import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import type db from "../database";
import { pendingActionTable } from "../database/schema";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";

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
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('taskdesk:pending-action-lifecycle'), hashtext('global'))`,
  );
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
  const pendingRows = await tx
    .select()
    .from(pendingActionTable)
    .where(
      and(
        eq(pendingActionTable.requestedByPersonId, requesterPersonId),
        eq(pendingActionTable.state, "pending"),
      ),
    )
    .orderBy(pendingActionTable.id)
    .for("update");

  let auditFailures = 0;
  for (const row of pendingRows) {
    const [invalidated] = await tx
      .update(pendingActionTable)
      .set({
        state: "invalidated",
        invalidationReason: "requester_deactivated",
        decidedByPersonId: null,
        decisionSessionId: null,
        decidedAt: occurredAt,
      })
      .where(
        and(
          eq(pendingActionTable.id, row.id),
          eq(pendingActionTable.state, "pending"),
        ),
      )
      .returning({ id: pendingActionTable.id });
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
      scope: eventScope({
        workspaceId: row.workspaceId,
        organisationId: row.organisationId,
        projectId: row.projectId,
      }),
      payload: {
        key: row.id,
        url: `/agent/settings/profile/pending-actions/${row.id}`,
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
