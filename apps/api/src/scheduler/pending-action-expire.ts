import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import { enqueueOutboxEvent } from "../events/outbox";
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
 * PA-8: expire only due pending actions. The database clock is sampled after each
 * candidate row has been locked so timestamptz values are compared without session
 * timezone coercion and a lock wait cannot make the decision use stale time.
 */
export async function expirePendingActions(): Promise<PendingActionExpireOutcome> {
  return withJobLease(
    JOB_NAME,
    async () => {
      let expired = 0;
      let scanned = 0;
      let degraded = false;
      let cursor: { expiresAt: string; id: string } | undefined;

      while (scanned < MAX_ROWS_PER_RUN) {
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
              decided_at: string;
            }>(sql`
              SELECT pa.id, pa.workspace_id, pa.project_id, pa.organisation_id,
                     pa.trace_id, clock_timestamp() AS decided_at
              FROM pending_action pa
              WHERE pa.id = ${candidate.id} AND pa.state = 'pending'
                AND pa.expires_at <= clock_timestamp()
            `);
            const row = selected.rows[0];

            if (!row) continue;
            if (!row.workspace_id) {
              console.error(
                "pending-action-expire: row has no workspace scope",
                {
                  pendingActionId: row.id,
                },
              );
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
              scope: {
                workspaceId: row.workspace_id,
                ...(row.organisation_id
                  ? { organisationId: row.organisation_id }
                  : {}),
                ...(row.project_id ? { projectId: row.project_id } : {}),
              },
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
            } catch (error) {
              console.error("AU-14: pending-action expiry audit write failed", {
                pendingActionId: row.id,
                error,
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
