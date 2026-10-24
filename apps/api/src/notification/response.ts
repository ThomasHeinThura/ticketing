import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const notificationSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    title: z.string().nullable(),
    content: z.string().nullable().openapi({
      description:
        "Free-text body. Null for generated notifications, whose text the client renders from type and eventData.",
    }),
    type: z.string().openapi({
      description:
        "One of: info, task_created, workspace_created, task_status_changed, task_assignee_changed, time_entry_created, due_date_reminder, task_overdue, task_mention, task_comment.",
    }),
    eventData: z.unknown().openapi({
      description:
        "Type-specific payload, e.g. { taskTitle, oldStatus, newStatus, projectId, workspaceId }.",
    }),
    isRead: z.boolean().nullable(),
    resourceId: z.string().nullable().openapi({
      description:
        "The id of the task or workspace the notification points at.",
    }),
    resourceType: z.string().nullable().openapi({
      description: "`task` or `workspace`.",
    }),
    kind: z.string().nullable().optional().openapi({
      description:
        "The domain event key for event-derived notifications (for example `work_item.mentioned`); null for legacy rows. Drives the inbox mention and assignment filters.",
    }),
    readAt: nullableResponseTimestamp.optional().openapi({
      description: "When the notification was read; null while unread (NO-15).",
    }),
    workItemKey: z.string().nullable().optional().openapi({
      description:
        "The key of the work item the notification is about (directly, or through its comment or approval), for deep links (NO-14); null when it has none.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Notification");

export const notificationListSchema = z.array(notificationSchema);

export const bulkResultSchema = z
  .object({ success: z.boolean() })
  .openapi("NotificationBulkResult");
