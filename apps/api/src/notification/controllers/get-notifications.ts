import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import db from "../../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../../database/schema";
import { isCurrentInstanceAdmin } from "../../instance/observability/audit-failure-notifier";
import { reachableTaskNotificationPredicate } from "../task-reach";

async function getNotifications(
  userId: string,
  credentialCanReadTask: boolean,
) {
  const canReadInstanceAlerts = await isCurrentInstanceAdmin(userId);
  const visibleToUser = canReadInstanceAlerts
    ? eq(notificationTable.userId, userId)
    : and(
        eq(notificationTable.userId, userId),
        ne(notificationTable.type, "audit_write_failed"),
      );
  const rows = await db
    .select({
      notification: notificationTable,
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
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(
      and(
        visibleToUser,
        or(
          isNull(notificationTable.resourceType),
          ne(notificationTable.resourceType, "task"),
          reachableTaskNotificationPredicate(userId, credentialCanReadTask),
        ),
      ),
    )
    .orderBy(desc(notificationTable.createdAt))
    .limit(50);

  return rows.map(({ notification, projectId, workspaceId }) => {
    if (!projectId && !workspaceId) {
      return notification;
    }

    const existing =
      notification.eventData &&
      typeof notification.eventData === "object" &&
      !Array.isArray(notification.eventData)
        ? (notification.eventData as Record<string, unknown>)
        : {};

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
