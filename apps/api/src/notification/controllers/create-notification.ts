import { createId } from "@paralleldrive/cuid2";
import { publishEvent } from "../../events";
import { deliverNotification } from "../../notification-preferences/delivery";
import {
  findNotificationPreferenceRow,
  insertNotificationRow,
} from "../inbox.repository";
import { userCanReachTask } from "../task-reach.repository";

async function createNotification({
  userId,
  title,
  content,
  type,
  eventData,
  resourceId,
  resourceType,
}: {
  userId: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  eventData?: Record<string, unknown> | null;
  resourceId?: string;
  resourceType?: string;
}) {
  if (
    resourceType === "task" &&
    (!resourceId || !(await userCanReachTask(userId, resourceId)))
  ) {
    return null;
  }

  const preferenceKey =
    type === "task_assignee_changed" || type === "task_created"
      ? "taskAssignmentEnabled"
      : type === "task_comment" || type === "task_mention"
        ? "taskCommentEnabled"
        : type === "task_status_changed"
          ? "taskStatusChangeEnabled"
          : type === "due_date_reminder" || type === "task_overdue"
            ? "dueDateReminderEnabled"
            : null;

  if (preferenceKey) {
    const preference = await findNotificationPreferenceRow(userId);

    if (preference?.[preferenceKey] === false) {
      return null;
    }
  }

  const notification = await insertNotificationRow({
    id: createId(),
    userId,
    title: title ?? null,
    content: content ?? null,
    type: type || "info",
    eventData: eventData ?? null,
    resourceId: resourceId || null,
    resourceType: resourceType || null,
  });

  if (notification) {
    await publishEvent("notification.created", {
      notificationId: notification.id,
      userId,
    });
    void deliverNotification(notification.id).catch((error) => {
      console.error("Failed to deliver notification", {
        notificationId: notification.id,
        error,
      });
    });
  }

  return notification;
}

export default createNotification;
