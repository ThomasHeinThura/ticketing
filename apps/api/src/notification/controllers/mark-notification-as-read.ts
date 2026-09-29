import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { userCanReachTask } from "../task-reach";

async function markNotificationAsRead(id: string, userId: string) {
  const [existingNotification] = await db
    .select()
    .from(notificationTable)
    .where(
      and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)),
    )
    .limit(1);

  if (
    !existingNotification ||
    (existingNotification.resourceType === "task" &&
      (!existingNotification.resourceId ||
        !(await userCanReachTask(userId, existingNotification.resourceId))))
  ) {
    throw new HTTPException(404, {
      message: "Notification not found",
    });
  }

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
    throw new HTTPException(404, {
      message: "Notification not found",
    });
  }

  return notification;
}

export default markNotificationAsRead;
