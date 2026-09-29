import { and, eq, isNull, ne, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { reachableTaskNotificationPredicate } from "../task-reach";

async function markNotificationAsRead(id: string, userId: string) {
  // Keep the reach decision in the same statement as the mutation. A separate
  // read/check/update sequence can mark a notification read after reach is lost,
  // then return 404 from a post-update check.
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
