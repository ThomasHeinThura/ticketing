import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import useMarkNotificationAsRead from "@/hooks/mutations/notification/use-mark-notification-as-read";
import { getStatusLabel } from "@/lib/i18n/domain";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import type { Notification } from "@/types/notification";

function getEventDataRecord(
  eventData: unknown,
): Record<string, unknown> | null {
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
    return null;
  }

  return eventData as Record<string, unknown>;
}

function getReminderLeadTime(
  eventData: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const minutes = Number(eventData.leadTimeMinutes ?? 1440);
  if (minutes % 1440 === 0) {
    return t("notifications:reminderLeadTime.days", {
      count: minutes / 1440,
    });
  }
  if (minutes % 60 === 0) {
    return t("notifications:reminderLeadTime.hours", {
      count: minutes / 60,
    });
  }
  return t("notifications:reminderLeadTime.minutes", { count: minutes });
}

export function getNotificationTitle(
  notification: Notification,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const eventData = getEventDataRecord(notification.eventData);
  if (eventData) {
    switch (notification.type) {
      case "task_created":
        return t("notifications:events.task_created.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "workspace_created":
        return t("notifications:events.workspace_created.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_status_changed":
        return t("notifications:events.task_status_changed.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_assignee_changed":
        return t("notifications:events.task_assignee_changed.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "time_entry_created":
        return t("notifications:events.time_entry_created.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_mention":
        return t("notifications:events.task_mention.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_comment":
        return t("notifications:events.task_comment.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "due_date_reminder":
        return t("notifications:events.due_date_reminder.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      case "task_overdue":
        return t("notifications:events.task_overdue.title", {
          ...eventData,
          defaultValue: notification.title ?? notification.type,
        });
      default:
        break;
    }
  }

  return notification.title ?? notification.type;
}

export function getNotificationContent(
  notification: Notification,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const eventData = getEventDataRecord(notification.eventData);
  if (eventData) {
    switch (notification.type) {
      case "task_created":
        return t("notifications:events.task_created.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "workspace_created":
        return t("notifications:events.workspace_created.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "task_status_changed":
        return t("notifications:events.task_status_changed.content", {
          ...eventData,
          oldStatus: getStatusLabel(String(eventData.oldStatus ?? "")),
          newStatus: getStatusLabel(String(eventData.newStatus ?? "")),
          defaultValue: notification.content ?? "",
        });
      case "task_assignee_changed":
        return t("notifications:events.task_assignee_changed.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "time_entry_created":
        return eventData.taskTitle
          ? t("notifications:events.time_entry_created.contentWithTask", {
              ...eventData,
              defaultValue: notification.content ?? "",
            })
          : t("notifications:events.time_entry_created.contentWithoutTask", {
              ...eventData,
              defaultValue: notification.content ?? "",
            });
      case "task_mention":
        return t("notifications:events.task_mention.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "task_comment":
        return t("notifications:events.task_comment.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      case "due_date_reminder":
        return t("notifications:events.due_date_reminder.content", {
          ...eventData,
          leadTime: getReminderLeadTime(eventData, t),
          defaultValue: notification.content ?? "",
        });
      case "task_overdue":
        return t("notifications:events.task_overdue.content", {
          ...eventData,
          defaultValue: notification.content ?? "",
        });
      default:
        break;
    }
  }

  return notification.content ?? "";
}

/** A `pending_action` notification opens the requester's approval page for that action. */
export function getPendingActionNotificationHref(
  notification: Pick<Notification, "resourceType" | "resourceId">,
): string | null {
  return notification.resourceType === "pending_action" &&
    notification.resourceId
    ? routes.pendingAction.build({ id: notification.resourceId })
    : null;
}

/** WH-7 auto-disable notices open the canonical webhook editor route. */
export function getWebhookNotificationHref(
  notification: Pick<Notification, "deepLink">,
): string | null {
  return notification.deepLink?.type === "webhook" && notification.deepLink.id
    ? routes.webhookEditor.build({ id: notification.deepLink.id })
    : null;
}

/**
 * A-09: a submission notice (a customer reply on a request) opens it in the triage queue. The
 * inbox carries its reference as `eventData.submissionRef`.
 */
export function getSubmissionNotificationHref(
  notification: Pick<Notification, "resourceType" | "eventData">,
): string | null {
  if (notification.resourceType !== "submission") return null;
  const ref = getEventDataRecord(notification.eventData)?.submissionRef;
  return typeof ref === "string" && /^SUB-[1-9]\d{0,9}$/u.test(ref)
    ? routes.intakeQueue.build({ ref })
    : null;
}

/** AK-6 notices open the current user's canonical API key management page. */
export function getApiKeyNotificationHref(
  notification: Pick<Notification, "deepLink">,
): string | null {
  return notification.deepLink?.type === "api_key" && notification.deepLink.id
    ? "/dashboard/settings/account/developer"
    : null;
}

/**
 * `NO-14`: a work-item, comment or approval notification opens its work item on the canonical
 * `/agent` route, and a comment notification focuses that comment.
 */
export function getWorkItemNotificationHref(
  notification: Pick<Notification, "resourceType" | "resourceId"> & {
    workItemKey?: string | null;
  },
): string | null {
  if (!notification.workItemKey) return null;
  return routes.workItemDetail.build(
    { key: notification.workItemKey },
    notification.resourceType === "comment" && notification.resourceId
      ? { comment: notification.resourceId }
      : {},
  );
}

/**
 * A notification about a row of the retired Kaneo task table has no work item to open: it is
 * shown as unavailable and never links to an old task URL.
 */
export function isLegacyTaskNotification(
  notification: Pick<Notification, "resourceType"> & {
    workItemKey?: string | null;
  },
): boolean {
  return notification.resourceType === "task" && !notification.workItemKey;
}

/**
 * Marks a notification read and opens what it is about. Shared by the dropdown and the
 * full-page inbox (`/agent/inbox`).
 */
export function useNotificationClick() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutate: markAsRead } = useMarkNotificationAsRead();
  return useCallback(
    (notification: Notification) => {
      if (!notification.isRead) {
        markAsRead(notification.id);
      }

      const webhookHref = getWebhookNotificationHref(notification);
      if (webhookHref) {
        void navigate({ href: webhookHref });
        return;
      }

      const apiKeyHref = getApiKeyNotificationHref(notification);
      if (apiKeyHref) {
        void navigate({ href: apiKeyHref });
        return;
      }

      const submissionHref = getSubmissionNotificationHref(notification);
      if (submissionHref) {
        void navigate({ href: submissionHref });
        return;
      }

      const pendingActionHref = getPendingActionNotificationHref(notification);
      if (pendingActionHref) {
        void navigate({ href: pendingActionHref });
        return;
      }

      const workItemHref = getWorkItemNotificationHref(notification);
      if (workItemHref) {
        void navigate({ href: workItemHref });
        return;
      }

      if (isLegacyTaskNotification(notification)) {
        toast.info(t("notifications:unavailableMessage"));
      }
    },
    [markAsRead, navigate, t],
  );
}
