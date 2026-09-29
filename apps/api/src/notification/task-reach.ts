import { and, eq } from "drizzle-orm";
import db from "../database";
import {
  type notificationTable,
  projectTable,
  taskTable,
} from "../database/schema";
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

export function redactUnreachableTaskNotification(
  notification: typeof notificationTable.$inferSelect,
) {
  return {
    ...notification,
    title: null,
    content: null,
    eventData: null,
    resourceId: null,
    resourceType: null,
  };
}
