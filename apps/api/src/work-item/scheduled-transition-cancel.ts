import { and, eq, ne } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { scheduledTransitionTable } from "../database/schema";

/**
 * `WF-19`: cancels a work item's `pending` scheduled hops inside the caller's transaction.
 * With `exceptFromStateId`, only rows waiting in a different state are cancelled (a transition
 * into that state keeps the rows it is about to own); without it every pending row goes (move
 * to another project, archive, delete). Returns the number of rows cancelled.
 */
export async function cancelPendingScheduledTransitions(
  tx: Executor,
  workItemId: string,
  options: { exceptFromStateId?: string } = {},
): Promise<number> {
  const rows = await tx
    .update(scheduledTransitionTable)
    .set({ state: "cancelled" })
    .where(
      and(
        eq(scheduledTransitionTable.workItemId, workItemId),
        eq(scheduledTransitionTable.state, "pending"),
        options.exceptFromStateId === undefined
          ? undefined
          : ne(scheduledTransitionTable.fromStateId, options.exceptFromStateId),
      ),
    )
    .returning({ id: scheduledTransitionTable.id });
  return rows.length;
}
