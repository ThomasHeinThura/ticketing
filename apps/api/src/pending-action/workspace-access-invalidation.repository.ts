import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { pendingActionTable } from "../database/schema";

const WORKSPACE_DELETION_TARGETS = ["service_calendar", "saved_view"] as const;

export async function listWorkspacePendingDeletionActions(
  executor: Executor,
  workspaceIds: string[],
): Promise<(typeof pendingActionTable.$inferSelect)[]> {
  const rows = await executor
    .select()
    .from(pendingActionTable)
    .where(
      and(
        inArray(pendingActionTable.workspaceId, workspaceIds),
        eq(pendingActionTable.state, "pending"),
        inArray(pendingActionTable.targetType, [...WORKSPACE_DELETION_TARGETS]),
      ),
    )
    .orderBy(pendingActionTable.id);
  return rows;
}
