import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import { enqueueOutboxEvent } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import {
  logTaskDesk,
  recordAuditWriteFailure,
} from "../instance/observability/runtime";
import { instancePendingActionExpiryPredicate } from "../pending-action/expiry-scope";
import { pendingActionEventScope } from "../pending-action/lifecycle-invalidation";
import { assertJobExecutionOwned, withJobLease } from "./leader-lock";

const JOB_NAME = "pending-action-expire";
const LEASE_MS = 60_000;
const BATCH_SIZE = 100;
const MAX_ROWS_PER_RUN = 1_000;

export type PendingActionExpireOutcome = {
  expired: number;
  degraded: boolean;
};

/**
 * PA-8 expiry supports workspace actions, the explicitly registered instance
 * canonical user-deactivation action and its legacy user_deactivation/person rows,
 * plus exact organisation deletion actions with their organisation scope bound.
 * Other nullable-scope actions remain degraded until
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
        SELECT COALESCE((
          SELECT true
          FROM pending_action
          WHERE state = 'pending'
            AND workspace_id IS NULL
            AND NOT (${sql.raw(instancePendingActionExpiryPredicate)})
            AND expires_at <= (SELECT clock_timestamp())
          ORDER BY expires_at
          LIMIT 1
        ), false) AS exists
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
              AND (workspace_id IS NOT NULL OR
                (workspace_id IS NULL AND (${sql.raw(instancePendingActionExpiryPredicate)})))
              AND expires_at <= (SELECT clock_timestamp())
              ${afterCursor}
            ORDER BY expires_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT ${Math.min(BATCH_SIZE, MAX_ROWS_PER_RUN - scanned)}
          `);

          let batchExpired = 0;
          let batchDegraded = false;
          for (const candidate of candidates.rows) {
            await assertJobExecutionOwned();
            cursor = { expiresAt: candidate.expires_at, id: candidate.id };
            const selected = await tx.execute<{
              id: string;
              workspace_id: string | null;
              project_id: string | null;
              organisation_id: string | null;
              route_key: string;
              target_ids: string[];
              trace_id: string;
              action: string;
              target_type: string;
              decided_at: string;
            }>(sql`
              SELECT pa.id, pa.workspace_id, pa.project_id, pa.organisation_id, pa.route_key,
                     pa.target_ids, pa.trace_id, pa.action, pa.target_type,
                     clock_timestamp() AS decided_at
              FROM pending_action pa
              WHERE pa.id = ${candidate.id} AND pa.state = 'pending'
                AND pa.expires_at <= clock_timestamp()
            `);
            const row = selected.rows[0];

            if (!row) continue;
            const supportedInstanceAction =
              row.workspace_id === null &&
              row.project_id === null &&
              ((row.organisation_id === null &&
                row.action === "delete" &&
                row.target_type === "identity_connection" &&
                row.route_key ===
                  "DELETE /api/instance/identity-connections/{id}" &&
                row.target_ids.length === 1) ||
                (row.organisation_id === null &&
                  ((row.action === "delete" &&
                    row.target_type === "user" &&
                    row.route_key ===
                      "POST /api/instance/users/{id}/deactivate") ||
                    (row.action === "user_deactivation" &&
                      row.target_type === "person" &&
                      row.route_key ===
                        "POST /api/instance/users/{id}/deactivate"))) ||
                (row.action === "delete" &&
                  row.target_type === "organisation" &&
                  row.route_key === "DELETE /api/instance/organisations/{id}" &&
                  row.target_ids.length === 1 &&
                  row.organisation_id === row.target_ids[0]) ||
                (row.action === "purge" &&
                  row.target_type === "organisation" &&
                  row.route_key === "POST /api/instance/purge" &&
                  row.target_ids.length === 1 &&
                  row.organisation_id === row.target_ids[0]));
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
              scope: pendingActionEventScope({
                action: row.action,
                targetType: row.target_type,
                routeKey: row.route_key,
                targetIds: row.target_ids,
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
