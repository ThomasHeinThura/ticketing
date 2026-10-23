import { and, asc, eq, sql } from "drizzle-orm";
import db from "../database";
import { scheduledTransitionTable, workItemTable } from "../database/schema";
import { logTaskDesk } from "../instance/observability/runtime";
import { recordWorkItemActivity } from "../work-item/activity";
import {
  getSystemTransitionExecutor,
  type SystemTransitionExecutor,
} from "../workflow/system-transition";
import { withJobLease } from "./leader-lock";

/**
 * `WF-19` scheduled-transition executor (every minute). A `pending` row whose `due_at` has
 * passed is executed as the already-resolved concrete hop `from_state_id -> to_state_id`
 * through the system-actor transition port; a row whose item has left `from_state_id` (or is
 * deleted/archived) is `cancelled` instead.
 *
 * Idempotency and optimism: each row is claimed inside the transition's own transaction, after
 * the work-item lock and the `from_state_id` re-check, by `UPDATE ... SET state = 'fired'
 * WHERE state = 'pending'`; losing that race means another replica fired it. Failure handling
 * (the contract names none): an unavailable executor or a refused/blocked hop leaves the row
 * `pending` and is retried on the next tick (a thrown error); a hop that can never apply is
 * `cancelled` with a logged reason and, when refused, a flagged activity row. The CHECK allows
 * only pending|fired|cancelled and there is no reason column.
 */

const BATCH_SIZE = 100;
const MAX_PER_RUN = 1_000;

export type ScheduledTransitionOutcome = {
  fired: number;
  cancelled: number;
  retained: number;
  degraded: boolean;
};

/** Cancels every pending row whose item left `from_state_id` or is no longer actionable. */
export async function cancelStaleScheduledTransitions(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE "scheduled_transition" st
    SET "state" = 'cancelled'
    FROM "work_item" wi
    WHERE st."state" = 'pending'
      AND wi."id" = st."work_item_id"
      AND (wi."state_id" <> st."from_state_id"
           OR wi."deleted_at" IS NOT NULL
           OR wi."archived_at" IS NOT NULL)
  `);
  return result.rowCount ?? 0;
}

/**
 * Cancels a pending row whose hop can never apply. A moved/deleted item is routine and only
 * logged; a refused hop (guard, approval gate, missing target) also writes an internal
 * `scheduled_transition_cancelled` activity row so staff can see why nothing fired.
 */
async function cancelUnappliableRow(
  row: typeof scheduledTransitionTable.$inferSelect,
  reason: string,
): Promise<boolean> {
  const flagged = reason !== "left_state" && reason !== "unavailable";
  const [item] = await db
    .select({ workspaceId: workItemTable.workspaceId })
    .from(workItemTable)
    .where(eq(workItemTable.id, row.workItemId))
    .limit(1);
  const cancelled = await db.transaction(async (tx) => {
    const done = await tx
      .update(scheduledTransitionTable)
      .set({ state: "cancelled" })
      .where(
        and(
          eq(scheduledTransitionTable.id, row.id),
          eq(scheduledTransitionTable.state, "pending"),
        ),
      )
      .returning({ id: scheduledTransitionTable.id });
    if (done.length === 0) return false;
    if (flagged && item) {
      await recordWorkItemActivity(tx, [
        {
          workspaceId: item.workspaceId,
          workItemId: row.workItemId,
          actorId: null,
          actorType: "system",
          verb: "scheduled_transition_cancelled",
          payload: {
            scheduledTransitionId: row.id,
            fromStateId: row.fromStateId,
            toStateId: row.toStateId,
            reason,
          },
          visibility: "internal",
        },
      ]);
    }
    return true;
  });
  if (cancelled)
    logTaskDesk({
      module: "jobs",
      message: "jobs.failure",
      level: flagged ? "warn" : "info",
      result: flagged ? "degraded" : "ok",
    });
  return cancelled;
}

export async function runScheduledTransitions(
  executor: SystemTransitionExecutor | null = getSystemTransitionExecutor(),
): Promise<ScheduledTransitionOutcome> {
  const outcome: ScheduledTransitionOutcome = {
    fired: 0,
    cancelled: await cancelStaleScheduledTransitions(),
    retained: 0,
    degraded: false,
  };
  if (!executor) {
    // Fail closed: nothing is executed without the shared system-actor path.
    const [pending] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(scheduledTransitionTable)
      .where(
        and(
          eq(scheduledTransitionTable.state, "pending"),
          sql`${scheduledTransitionTable.dueAt} <= ${sql`(now() AT TIME ZONE 'UTC')`}`,
        ),
      );
    outcome.retained = pending?.n ?? 0;
    outcome.degraded = outcome.retained > 0;
    return outcome;
  }
  const skip = new Set<string>();
  let handled = 0;
  while (handled < MAX_PER_RUN) {
    const due = await db
      .select()
      .from(scheduledTransitionTable)
      .where(
        and(
          eq(scheduledTransitionTable.state, "pending"),
          // `due_at` is `timestamp` (UTC wall clock, utils/db-time.ts).
          sql`${scheduledTransitionTable.dueAt} <= (now() AT TIME ZONE 'UTC')`,
        ),
      )
      .orderBy(asc(scheduledTransitionTable.dueAt))
      .limit(BATCH_SIZE + skip.size);
    const rows = due.filter((row) => !skip.has(row.id)).slice(0, BATCH_SIZE);
    if (rows.length === 0) break;
    for (const row of rows) {
      handled++;
      try {
        const result = await executor({
          kind: "scheduled",
          workItemId: row.workItemId,
          fromStateId: row.fromStateId,
          toStateId: row.toStateId,
          claim: async (tx) => {
            const claimed = await tx
              .update(scheduledTransitionTable)
              .set({ state: "fired" })
              .where(
                and(
                  eq(scheduledTransitionTable.id, row.id),
                  eq(scheduledTransitionTable.state, "pending"),
                ),
              )
              .returning({ id: scheduledTransitionTable.id });
            return claimed.length === 1;
          },
        });
        if (result.kind === "applied") outcome.fired++;
        else {
          // Terminal: the hop can never apply (item left the state, is gone, or a guard or
          // approval gate refuses it). Cancel it with a recorded reason instead of retrying.
          skip.add(row.id);
          const reason =
            result.kind === "blocked" ? result.reason : result.kind;
          if (await cancelUnappliableRow(row, reason)) outcome.cancelled++;
        }
      } catch {
        skip.add(row.id);
        outcome.retained++;
        outcome.degraded = true;
        logTaskDesk({
          module: "jobs",
          message: "jobs.failure",
          level: "error",
          result: "degraded",
        });
      }
    }
  }
  return outcome;
}

/** Registered as `scheduled-transition`, every minute, leader-locked. */
export async function scanScheduledTransitions(): Promise<ScheduledTransitionOutcome> {
  return withJobLease(
    "scheduled-transition",
    () => runScheduledTransitions(),
    () => ({ fired: 0, cancelled: 0, retained: 0, degraded: false }),
    60_000,
  );
}
