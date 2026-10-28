import { createId } from "@paralleldrive/cuid2";
import type { Executor } from "../../database/executor";
import { publishEvent } from "../../events";
import { QUIET_HOURS_HOLD_KEY } from "../../notification-preferences/delivery.repository";
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
  executor,
}: {
  userId: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  eventData?: Record<string, unknown> | null;
  resourceId?: string;
  resourceType?: string;
  /**
   * Write inside the caller's transaction. The realtime `notification.created` publish is then
   * the caller's job after commit, so nothing is announced for a row that rolls back.
   */
  executor?: Executor;
}) {
  if (
    resourceType === "task" &&
    (!resourceId || !(await userCanReachTask(userId, resourceId, executor)))
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
    const preference = await findNotificationPreferenceRow(userId, executor);

    if (preference?.[preferenceKey] === false) {
      return null;
    }
  }

  const notification = await insertNotificationRow(
    {
      id: createId(),
      userId,
      title: title ?? null,
      content: content ?? null,
      type: type || "info",
      eventData: {
        ...(eventData ?? {}),
        [QUIET_HOURS_HOLD_KEY]: new Date().toISOString(),
      },
      resourceId: resourceId || null,
      resourceType: resourceType || null,
    },
    executor,
  );

  if (notification && !executor) {
    await publishEvent("notification.created", {
      notificationId: notification.id,
      userId,
    });
  }

  return notification;
}

export default createNotification;
