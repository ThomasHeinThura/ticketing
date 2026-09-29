import { and, eq, exists } from "drizzle-orm";
import db from "../database";
import { notificationTable, projectTable, taskTable } from "../database/schema";
import { reachableWorkspacePredicate } from "../utils/workspace-access-middleware";

export async function userCanReachTask(
  userId: string,
  taskId: string,
): Promise<boolean> {
  const [reachableTask] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        reachableWorkspacePredicate(projectTable.workspaceId, userId),
      ),
    )
    .limit(1);

  return Boolean(reachableTask);
}

/**
 * SQL predicate for a notification update that must observe task reach in the
 * same statement as the mutation. This avoids a reach-check/update race and
 * leaves orphaned task notifications inaccessible after task deletion.
 */
export function reachableTaskNotificationPredicate(userId: string) {
  return exists(
    db
      .select({ id: taskTable.id })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, notificationTable.resourceId),
          reachableWorkspacePredicate(projectTable.workspaceId, userId),
        ),
      ),
  );
}
