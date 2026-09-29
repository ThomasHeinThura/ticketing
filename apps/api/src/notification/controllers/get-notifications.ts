import { and, desc, eq } from "drizzle-orm";
import db from "../../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../../database/schema";
import { reachableWorkspacePredicate } from "../../utils/workspace-access-middleware";
import { redactUnreachableTaskNotification } from "../task-reach";

async function getNotifications(userId: string) {
  const rows = await db
    .select({
      notification: notificationTable,
      taskId: taskTable.id,
      projectId: projectTable.id,
      workspaceId: workspaceTable.id,
    })
    .from(notificationTable)
    .leftJoin(
      taskTable,
      and(
        eq(notificationTable.resourceId, taskTable.id),
        eq(notificationTable.resourceType, "task"),
      ),
    )
    .leftJoin(
      projectTable,
      and(
        eq(taskTable.projectId, projectTable.id),
        reachableWorkspacePredicate(projectTable.workspaceId, userId),
      ),
    )
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(eq(notificationTable.userId, userId))
    .orderBy(desc(notificationTable.createdAt))
    .limit(50);

  return rows.map(({ notification, taskId, projectId, workspaceId }) => {
    const existing =
      notification.eventData &&
      typeof notification.eventData === "object" &&
      !Array.isArray(notification.eventData)
        ? (notification.eventData as Record<string, unknown>)
        : {};

    // Notifications intentionally do not reference tasks with a foreign key, so a
    // task can be deleted while its notification remains. A missing task or a task
    // outside the caller's reachable workspaces has no verified boundary for its
    // stored payload. Fail closed instead of returning stale ids or task data.
    if (notification.resourceType === "task" && (!taskId || !projectId)) {
      return redactUnreachableTaskNotification(notification);
    }

    if (!projectId && !workspaceId) {
      return notification;
    }

    return {
      ...notification,
      eventData: {
        ...existing,
        projectId: projectId ?? existing.projectId ?? null,
        workspaceId: workspaceId ?? existing.workspaceId ?? null,
      },
    };
  });
}

export default getNotifications;
