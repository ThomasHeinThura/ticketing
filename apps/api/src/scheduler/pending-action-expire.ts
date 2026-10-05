import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import {
  logTaskDesk,
  recordAuditWriteFailure,
} from "../instance/observability/runtime";
import { withJobLease } from "./leader-lock";

const JOB_NAME = "pending-action-expire";
const LEASE_MS = 60_000;
const BATCH_SIZE = 100;
const MAX_ROWS_PER_RUN = 1_000;

export type PendingActionExpireOutcome = {
  expired: number;
  degraded: boolean;
};

/**
 * PA-8 expiry supports workspace actions and the explicitly registered instance
 * user_deactivation/person action. Other nullable-scope actions remain degraded until
 * their own scope and event contract is documented. The database clock is sampled
 * after each row is locked so lock waits cannot make the decision use stale time.
 */
export async function expirePendingActions(): Promise<PendingActionExpireOutcome> {
  return withJobLease(
    JOB_NAME,
    async () => {
      let expired = 0;
      let scanned = 0;
      const unsupported = await db.execute<{ exists: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM pending_action
          WHERE state = 'pending'
            AND workspace_id IS NULL
            AND NOT (action = 'user_deactivation' AND target_type = 'person')
            AND expires_at <= clock_timestamp()
        ) AS exists
      `);
      let degraded = unsupported.rows[0]?.exists === true;
      let unsupportedLogged = false;
      if (degraded) {
        logTaskDesk({
          module: "jobs",
          message: "jobs.failure",
          level: "error",
          result: "degraded",
        });
        unsupportedLogged = true;
      }
      let cursor: { expiresAt: string; id: string } | undefined;

      while (scanned < MAX_ROWS_PER_RUN) {
        let batchAuditFailures = 0;
        const batch = await db.transaction(async (tx) => {
          const afterCursor = cursor
            ? sql`AND (expires_at, id) > (${cursor.expiresAt}::timestamptz, ${cursor.id})`
            : sql``;
          const candidates = await tx.execute<{
            id: string;
            expires_at: string;
          }>(sql`
            SELECT id, expires_at
            FROM pending_action
            WHERE state = 'pending'
              AND (workspace_id IS NOT NULL OR (action = 'user_deactivation' AND target_type = 'person'))
              AND expires_at <= clock_timestamp()
              ${afterCursor}
            ORDER BY expires_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT ${Math.min(BATCH_SIZE, MAX_ROWS_PER_RUN - scanned)}
          `);

          let batchExpired = 0;
          let batchDegraded = false;
          for (const candidate of candidates.rows) {
            cursor = { expiresAt: candidate.expires_at, id: candidate.id };
            const selected = await tx.execute<{
              id: string;
              workspace_id: string | null;
              project_id: string | null;
              organisation_id: string | null;
              trace_id: string;
              action: string;
              target_type: string;
              decided_at: string;
            }>(sql`
              SELECT pa.id, pa.workspace_id, pa.project_id, pa.organisation_id,
                     pa.trace_id, pa.action, pa.target_type, clock_timestamp() AS decided_at
              FROM pending_action pa
              WHERE pa.id = ${candidate.id} AND pa.state = 'pending'
                AND pa.expires_at <= clock_timestamp()
            `);
            const row = selected.rows[0];

            if (!row) continue;
            const supportedInstanceAction =
              row.workspace_id === null &&
              row.action === "user_deactivation" &&
              row.target_type === "person" &&
              row.project_id === null &&
              row.organisation_id === null;
            if (!row.workspace_id && !supportedInstanceAction) {
              if (!unsupportedLogged) {
                logTaskDesk({
                  module: "jobs",
                  message: "jobs.failure",
                  level: "error",
                  result: "degraded",
                });
                unsupportedLogged = true;
              }
              batchDegraded = true;
              continue;
            }

            const updated = await tx.execute(sql`
              UPDATE pending_action
              SET state = 'expired', decided_at = ${row.decided_at}
              WHERE id = ${row.id} AND state = 'pending'
                AND expires_at <= ${row.decided_at}::timestamptz
              RETURNING id
            `);
            if ((updated.rowCount ?? 0) !== 1) continue;

            await enqueueOutboxEvent(tx, {
              id: `evt_${createId()}`,
              kind: "pending_action.decided",
              occurredAt: new Date(row.decided_at).toISOString(),
              actor: { type: "system", id: null, name: "TaskDesk system" },
              scope: eventScope({
                workspaceId: row.workspace_id,
                organisationId: row.organisation_id,
                projectId: row.project_id,
              }),
              payload: {
                key: row.id,
                url: `/agent/settings/profile/pending-actions/${row.id}`,
                pendingActionId: row.id,
                outcome: "expired",
              },
              causationId: null,
              depth: 0,
              originAutomationId: null,
            });

            try {
              await appendAuditLog(tx, {
                actorId: null,
                actorType: "system",
                traceId: row.trace_id,
                workspaceId: row.workspace_id,
                projectId: row.project_id,
                organisationId: row.organisation_id,
                action: "pending_action.decided",
                entityType: "pending_action",
                entityId: row.id,
                before: { state: "pending" },
                after: { state: "expired" },
              });
            } catch {
              batchAuditFailures += 1;
              recordAuditWriteFailure("pending_action_decision", {
                log: false,
              });
              batchDegraded = true;
            }
            batchExpired += 1;
          }
          return {
            expired: batchExpired,
            degraded: batchDegraded,
            scanned: candidates.rows.length,
          };
        });

        if (batchAuditFailures > 0) {
          logTaskDesk({
            module: "audit",
            message: "audit.write_failure",
            level: "error",
            result: "degraded",
            auditOperation: "pending_action_decision",
          });
          await notifyCurrentInstanceAdminsOfAuditFailure(
            "pending_action_decision",
          );
        }

        expired += batch.expired;
        scanned += batch.scanned;
        degraded ||= batch.degraded;
        if (batch.scanned === 0) break;
      }

      return { expired, degraded };
    },
    () => ({ expired: 0, degraded: false }),
    LEASE_MS,
  );
}
