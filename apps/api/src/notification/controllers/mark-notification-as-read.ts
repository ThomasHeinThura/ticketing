import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { isCurrentInstanceAdmin } from "../../instance/observability/audit-failure-notifier";
import { getOwnedNotificationType } from "../repository";

async function markNotificationAsRead(id: string, userId: string) {
  const [existing] = await getOwnedNotificationType(id, userId);
  if (
    existing?.type === "audit_write_failed" &&
    !(await isCurrentInstanceAdmin(userId))
  ) {
    throw new HTTPException(404, { message: "Notification not found" });
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

  return notification;
}

export default markNotificationAsRead;
