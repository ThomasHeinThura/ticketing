import { and, eq, isNull, ne, or } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { isCurrentInstanceAdmin } from "../../instance/observability/audit-failure-notifier";

async function markAllNotificationsAsRead(userId: string) {
  const visibility = (await isCurrentInstanceAdmin(userId))
    ? eq(notificationTable.userId, userId)
    : and(
        eq(notificationTable.userId, userId),
        or(
          isNull(notificationTable.resourceType),
          ne(notificationTable.resourceType, "instance"),
        ),
      );
  await db.update(notificationTable).set({ isRead: true }).where(visibility);

  return { success: true };
}

export default markAllNotificationsAsRead;
