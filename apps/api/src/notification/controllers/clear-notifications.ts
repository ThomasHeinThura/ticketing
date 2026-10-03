import { and, eq, isNull, ne, or } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { isCurrentInstanceAdmin } from "../../instance/observability/audit-failure-notifier";

async function clearNotifications(userId: string) {
  const visibility = (await isCurrentInstanceAdmin(userId))
    ? eq(notificationTable.userId, userId)
    : and(
        eq(notificationTable.userId, userId),
        or(
          isNull(notificationTable.resourceType),
          ne(notificationTable.resourceType, "instance"),
        ),
      );
  await db.delete(notificationTable).where(visibility);

  return { success: true };
}

export default clearNotifications;
