import { and, eq, isNull } from "drizzle-orm";
import type db from "../database";
import { slaPauseTable } from "../database/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PauseReason = "waiting_customer" | "resolved" | "manual";
type Metric = "first_response" | "resolution";

const METRICS: readonly Metric[] = ["first_response", "resolution"];

/** Apply workflow-owned pause effects while the parent work item row is locked. */
export async function applyTransitionSlaPauses(
  tx: Transaction,
  input: {
    workItemId: string;
    hasPinnedSla: boolean;
    pauseWaitingCustomer: boolean;
    resumeWaitingCustomer: boolean;
    enterCompleted: boolean;
    leaveCompleted: boolean;
    at: Date;
  },
): Promise<void> {
  if (!input.hasPinnedSla) return;

  const openRows = await tx
    .select({ metric: slaPauseTable.metric, reason: slaPauseTable.reason })
    .from(slaPauseTable)
    .where(
      and(
        eq(slaPauseTable.workItemId, input.workItemId),
        isNull(slaPauseTable.endedAt),
      ),
    )
    .for("update");
  const openByMetric = new Map(
    openRows.map((row) => [row.metric as Metric, row.reason as PauseReason]),
  );

  // Moving into a completed state changes an automatic waiting pause into a
  // resolved pause at the same instant. A manual pause remains authoritative and
  // is never closed or replaced by an automatic workflow effect.
  if (input.enterCompleted) {
    await tx
      .update(slaPauseTable)
      .set({ endedAt: input.at })
      .where(
        and(
          eq(slaPauseTable.workItemId, input.workItemId),
          eq(slaPauseTable.reason, "waiting_customer"),
          isNull(slaPauseTable.endedAt),
        ),
      );
    for (const metric of METRICS) {
      if (openByMetric.get(metric) !== "manual") {
        await openPause(tx, input.workItemId, metric, "resolved", input.at);
      }
    }
    return;
  }

  if (input.leaveCompleted) {
    await closeReason(tx, input.workItemId, "resolved", input.at);
  }
  if (input.resumeWaitingCustomer) {
    await closeReason(tx, input.workItemId, "waiting_customer", input.at);
  }
  if (input.pauseWaitingCustomer) {
    for (const metric of METRICS) {
      const reason = openByMetric.get(metric);
      if (reason === undefined) {
        await openPause(
          tx,
          input.workItemId,
          metric,
          "waiting_customer",
          input.at,
        );
      }
    }
  }
}

async function openPause(
  tx: Transaction,
  workItemId: string,
  metric: Metric,
  reason: PauseReason,
  at: Date,
) {
  await tx
    .insert(slaPauseTable)
    .values({ workItemId, metric, reason, startedAt: at })
    .onConflictDoNothing();
}

async function closeReason(
  tx: Transaction,
  workItemId: string,
  reason: PauseReason,
  at: Date,
) {
  await tx
    .update(slaPauseTable)
    .set({ endedAt: at })
    .where(
      and(
        eq(slaPauseTable.workItemId, workItemId),
        eq(slaPauseTable.reason, reason),
        isNull(slaPauseTable.endedAt),
      ),
    );
}
