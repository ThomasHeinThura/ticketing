import { and, eq, isNull, ne, or } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { approvalNotificationReadable } from "../approval-reach";
import { reachableTaskNotificationPredicate } from "../task-reach";

async function clearNotifications(userId: string) {
  await db
    .delete(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        approvalNotificationReadable(userId),
        or(
          isNull(notificationTable.resourceType),
          ne(notificationTable.resourceType, "task"),
          reachableTaskNotificationPredicate(userId),
        ),
      ),
    );

  return { success: true };
}

export default clearNotifications;
