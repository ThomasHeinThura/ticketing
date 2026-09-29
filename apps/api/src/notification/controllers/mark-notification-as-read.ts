import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import {
  redactUnreachableTaskNotification,
  userCanReachTask,
} from "../task-reach";

async function markNotificationAsRead(id: string, userId: string) {
  const [notification] = await db
    .update(notificationTable)
    .set({ isRead: true })
    .where(
      and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)),
    )
    .returning();

  if (!notification) {
    throw new HTTPException(404, {
      message: "Notification not found",
    });
  }

  if (
    notification.resourceType === "task" &&
    (!notification.resourceId ||
      !(await userCanReachTask(userId, notification.resourceId)))
  ) {
    return redactUnreachableTaskNotification(notification);
  }

  return notification;
}

export default markNotificationAsRead;
