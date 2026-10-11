import { and, eq, isNull, ne, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { isCurrentInstanceAdmin } from "../../instance/observability/audit-failure-notifier";
import { reachableTaskNotificationPredicate } from "../task-reach";

async function markNotificationAsRead(id: string, userId: string) {
  const [existing] = await db
    .select({ type: notificationTable.type })
    .from(notificationTable)
    .where(
      and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)),
    )
    .limit(1);
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
      and(
        eq(notificationTable.id, id),
        eq(notificationTable.userId, userId),
        or(
          isNull(notificationTable.resourceType),
          ne(notificationTable.resourceType, "task"),
          reachableTaskNotificationPredicate(userId),
        ),
      ),
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
