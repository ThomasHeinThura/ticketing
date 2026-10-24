import { HTTPException } from "hono/http-exception";
import { markOwnReadableNotificationRead } from "../inbox.repository";

async function markNotificationAsRead(
  id: string,
  userId: string,
  mode: "read" | "unread" = "read",
) {
  const notification = await markOwnReadableNotificationRead(id, userId, mode);

  if (!notification) {
    throw new HTTPException(404, {
      message: "Notification not found",
    });
  }

  return notification;
}

export default markNotificationAsRead;
