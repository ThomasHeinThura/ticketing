import { createId } from "@paralleldrive/cuid2";
import { dueReminder, isApprovalOverdue } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import { schema } from "../database";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { withJobLease } from "../scheduler/leader-lock";
import { withDueApprovalRows } from "./repository";

const JOB_NAME = "reminder-scan";
const BATCH_SIZE = 100;
const MAX_ROWS_PER_RUN = 1_000;

export type ApprovalReminderOutcome = {
  expired: number;
  reminded: number;
  scanned: number;
};

/** Persist approval expiry and reminder events idempotently, in bounded locked batches. */
export async function scanApprovalReminders(): Promise<ApprovalReminderOutcome> {
  return withJobLease(
    JOB_NAME,
    async () => {
      let scanned = 0;
      let expired = 0;
      let reminded = 0;
      while (scanned < MAX_ROWS_PER_RUN) {
        const batch = await withDueApprovalRows(
          Math.min(BATCH_SIZE, MAX_ROWS_PER_RUN - scanned),
          async (tx, row) => {
            // Computed timestamp expressions may arrive as ISO strings through
            // some PostgreSQL drivers even though schema-backed timestamps are
            // mapped to Date instances.
            const now = row.now instanceof Date ? row.now : new Date(row.now);
            const approval = {
              id: row.id,
              transitionId: row.transitionId,
              kind: row.kind as "customer" | "cab",
              requestedBy: row.requestedBy,
              approverId: row.approverId,
              state: row.state as
                | "pending"
                | "approved"
                | "rejected"
                | "expired"
                | "withdrawn",
              createdAt: row.createdAt,
              expiresAt: row.expiresAt,
              reminder50SentAt: row.reminder50SentAt,
              reminder90SentAt: row.reminder90SentAt,
            };

            if (isApprovalOverdue(approval, now)) {
              const [updated] = await tx
                .update(schema.approvalTable)
                .set({ state: "expired", decidedAt: now })
                .where(
                  and(
                    eq(schema.approvalTable.id, row.id),
                    eq(schema.approvalTable.workspaceId, row.workspaceId),
                    eq(schema.approvalTable.state, "pending"),
                  ),
                )
                .returning({ id: schema.approvalTable.id });
              if (!updated) return "unchanged" as const;
              const occurredAt = now.toISOString();
              await enqueueOutboxEvent(tx, {
                id: `evt_${createId()}`,
                kind: "approval.expired",
                occurredAt,
                actor: { type: "system", id: null, name: "TaskDesk system" },
                scope: eventScope({
                  workspaceId: row.workspaceId,
                  organisationId: row.organisationId,
                  projectId: row.projectId,
                }),
                payload: { approvalId: row.id },
                causationId: null,
                depth: 0,
                originAutomationId: null,
              });
              await appendAuditLog(tx, {
                actorId: null,
                actorType: "system",
                workspaceId: row.workspaceId,
                projectId: row.projectId,
                organisationId: row.organisationId,
                action: "approval.expired",
                entityType: "approval",
                entityId: row.id,
                before: { state: "pending" },
                after: { state: "expired", expiredAt: occurredAt },
              });
              return "expired" as const;
            }

            const reminder = dueReminder(approval, now);
            if (!reminder) return "unchanged" as const;
            const pctElapsed = reminder === "reminder_50" ? 50 : 90;
            const [updated] = await tx
              .update(schema.approvalTable)
              .set(
                reminder === "reminder_50"
                  ? { reminder50SentAt: now }
                  : { reminder90SentAt: now },
              )
              .where(
                and(
                  eq(schema.approvalTable.id, row.id),
                  eq(schema.approvalTable.workspaceId, row.workspaceId),
                  eq(schema.approvalTable.state, "pending"),
                ),
              )
              .returning({ id: schema.approvalTable.id });
            if (!updated) return "unchanged" as const;
            await enqueueOutboxEvent(tx, {
              id: `evt_${createId()}`,
              kind: "approval.expiring",
              occurredAt: now.toISOString(),
              actor: { type: "system", id: null, name: "TaskDesk system" },
              scope: eventScope({
                workspaceId: row.workspaceId,
                organisationId: row.organisationId,
                projectId: row.projectId,
              }),
              payload: {
                approvalId: row.id,
                expiresAt: row.expiresAt.toISOString(),
                pctElapsed,
              },
              causationId: null,
              depth: 0,
              originAutomationId: null,
            });
            return "reminded" as const;
          },
        );
        scanned += batch.length;
        expired += batch.filter((result) => result === "expired").length;
        reminded += batch.filter((result) => result === "reminded").length;
        if (batch.length === 0) break;
      }
      return { scanned, expired, reminded };
    },
    () => ({ scanned: 0, expired: 0, reminded: 0 }),
    5 * 60_000,
  );
}
