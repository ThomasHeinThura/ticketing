import { z } from "../openapi";

export const notificationParam = z.object({ id: z.string() });

export const createNotificationBody = z.object({
  title: z.string().nullable().optional(),
  message: z.string().nullable().optional().openapi({
    description: "Stored as the notification's content.",
  }),
  type: z.string(),
  eventData: z.record(z.string(), z.unknown()).nullable().optional(),
  relatedEntityId: z.string().optional().openapi({
    description:
      "Stored as resourceId: the task or workspace being pointed at.",
  }),
  relatedEntityType: z.string().optional().openapi({
    description: "Stored as resourceType: `task` or `workspace`.",
  }),
});

export const notificationInboxQuery = z
  .object({
    filter: z.enum(["all", "unread", "mentions", "assignments"]).default("all"),
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
