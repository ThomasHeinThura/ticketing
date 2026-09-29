import { and, desc, eq } from "drizzle-orm";
import db from "../../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../../database/schema";
import { reachableWorkspacePredicate } from "../../utils/workspace-access-middleware";

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
    // task can be deleted while its notification remains. Once the task is gone,
    // there is no workspace boundary to check and none of the stored task payload
    // can be trusted as reachable. Fail closed instead of returning stale ids or
    // event data from the notification row.
    if (notification.resourceType === "task" && !taskId) {
      return {
        ...notification,
        resourceId: null,
        resourceType: null,
        eventData: null,
      };
    }

    if (notification.resourceType === "task" && taskId && !projectId) {
      const safeEventData = Object.fromEntries(
        Object.entries(existing).filter(
          ([key]) => key !== "projectId" && key !== "workspaceId",
        ),
      );

      return {
        ...notification,
        resourceId: null,
        resourceType: null,
        eventData: safeEventData,
      };
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
