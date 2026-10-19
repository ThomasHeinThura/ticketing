import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { pendingActionTable } from "../database/schema";

export async function lockPendingActionLifecycle(
  executor: Executor,
): Promise<void> {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('taskdesk:pending-action-lifecycle'), hashtext('global'))`,
  );
}

export async function listRequesterPendingActionsForUpdate(
  executor: Executor,
  requesterPersonId: string,
): Promise<(typeof pendingActionTable.$inferSelect)[]> {
  const rows = await executor
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
  return rows;
}

export async function invalidateRequesterPendingAction(
  executor: Executor,
  pendingActionId: string,
  occurredAt: Date,
): Promise<{ id: string } | undefined> {
  const [invalidated] = await executor
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
        eq(pendingActionTable.id, pendingActionId),
        eq(pendingActionTable.state, "pending"),
      ),
    )
    .returning({ id: pendingActionTable.id });
  return invalidated;
}
