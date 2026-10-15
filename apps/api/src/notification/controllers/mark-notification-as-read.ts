import { HTTPException } from "hono/http-exception";
import { isCurrentInstanceAdmin } from "../../instance/observability/audit-failure-notifier";
import {
  findOwnNotificationType,
  markOwnReadableNotificationRead,
} from "../inbox.repository";

async function markNotificationAsRead(id: string, userId: string) {
  const existing = await findOwnNotificationType(id, userId);
  if (
    existing?.type === "audit_write_failed" &&
    !(await isCurrentInstanceAdmin(userId))
  ) {
    throw new HTTPException(404, { message: "Notification not found" });
  }
  const notification = await markOwnReadableNotificationRead(id, userId);

  if (!notification) {
    throw new HTTPException(404, {
      message: "Notification not found",
    });
  }

  return notification;
}

export default markNotificationAsRead;
