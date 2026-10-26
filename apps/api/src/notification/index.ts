import { expandCapabilities } from "@taskdesk/permissions";
import type { notificationTable } from "../database/schema";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  type z,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { apiKeyCapabilitySubset } from "../utils/require-api-key-permission-scope";
import { requireSessionOnly } from "../utils/require-session-only";
import clearNotifications from "./controllers/clear-notifications";
import createNotification from "./controllers/create-notification";
import getNotificationInbox from "./controllers/get-notification-inbox";
import getNotifications from "./controllers/get-notifications";
import markAllNotificationsAsRead from "./controllers/mark-all-notifications-as-read";
import markAsRead from "./controllers/mark-notification-as-read";
import { decodeNotificationInboxCursor } from "./inbox.repository";
import {
  bulkResultSchema,
  notificationInboxSchema,
  notificationListSchema,
  notificationSchema,
} from "./response";
import {
  createNotificationBody,
  notificationInboxQuery,
  notificationParam,
} from "./schema";

type NotificationTransportRow = typeof notificationTable.$inferSelect;

const listNotificationsRoute = createRoute({
  method: "get",
  operationId: "listNotifications",
  path: "/",
  tags: ["Notifications"],
  summary: "List notifications",
  description:
    "Get read and unread notifications for the current user. Task notifications are included only while the task is reachable; missing or unreachable task notifications are omitted.",
  responses: {
    200: jsonResponse("List of notifications", notificationListSchema),
  },
});

const notificationInboxRoute = createRoute({
  method: "get",
  operationId: "getNotificationInbox",
  path: "/inbox",
  tags: ["Notifications"],
  summary: "List the current user's reachable notification inbox",
  description:
    "Returns a server-filtered page and the total unread count across the caller's currently reachable notifications. Resource reach is applied before pagination and counting.",
  request: { query: notificationInboxQuery },
  responses: {
    200: jsonResponse("Notification inbox page", notificationInboxSchema),
    400: errorResponse("Invalid cursor"),
  },
});

const createNotificationRoute = createRoute({
  method: "post",
  operationId: "createNotification",
  path: "/",
  tags: ["Notifications"],
  summary: "Create notification",
  description:
    "Create a notification for the current user. Most notifications are raised by the server from task and workspace events; this exists for integrations. Task notifications are suppressed unless the recipient currently reaches the task. Returns null when the category is muted or the task is unreachable.",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createNotificationBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The created notification, or null when the category is muted or the task is unreachable",
      notificationSchema.nullable(),
    ),
    400: errorResponse("Invalid request"),
    403: errorResponse("A browser session is required"),
  },
});

const markAsReadRoute = createRoute({
  method: "patch",
  operationId: "markNotificationAsRead",
  path: "/{id}/read",
  tags: ["Notifications"],
  summary: "Mark notification read",
  description:
    "Mark one notification as read. Scoped to the current user and current task reach; another user's, missing, or unreachable-task notification is not found.",
  middleware: [requireSessionOnly()] as const,
  request: { params: notificationParam },
  responses: {
    200: jsonResponse("The updated notification", notificationSchema),
    403: errorResponse("A browser session is required"),
    404: errorResponse("Notification not found"),
  },
});

const markAsUnreadRoute = createRoute({
  method: "patch",
  operationId: "markNotificationAsUnread",
  path: "/{id}/unread",
  tags: ["Notifications"],
  summary: "Mark notification unread",
  description:
    "NO-15: mark one notification as unread again, clearing its read time. Same recipient and current reach checks as mark-read; another user's, missing, or unreachable-resource notification is not found.",
  middleware: [requireSessionOnly()] as const,
  request: { params: notificationParam },
  responses: {
    200: jsonResponse("The updated notification", notificationSchema),
    403: errorResponse("A browser session is required"),
    404: errorResponse("Notification not found"),
  },
});

const markAllAsReadRoute = createRoute({
  method: "patch",
  operationId: "markAllNotificationsAsRead",
  path: "/read-all",
  tags: ["Notifications"],
  summary: "Mark all read",
  description:
    "Mark every notification the current user can currently reach as read. Task notifications for unreachable or deleted tasks stay unread and stay hidden.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("All notifications marked as read", bulkResultSchema),
    403: errorResponse("A browser session is required"),
  },
});

const clearAllRoute = createRoute({
  method: "delete",
  operationId: "clearAllNotifications",
  path: "/clear-all",
  tags: ["Notifications"],
  summary: "Clear all",
  description:
    "Permanently delete every notification for the current user. This cannot be undone.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("All notifications cleared", bulkResultSchema),
    403: errorResponse("A browser session is required"),
  },
});

const notificationInbox = apiRouter().openapi(
  notificationInboxRoute,
  async (c) => {
    const query = c.req.valid("query");
    const cursor = query.cursor
      ? decodeNotificationInboxCursor(query.cursor)
      : undefined;
    if (query.cursor && !cursor) return c.text("Invalid cursor", 400);
    const apiKey = c.get("apiKey");
    const credentialCanReadTask =
      !apiKey ||
      expandCapabilities(apiKeyCapabilitySubset(apiKey)).has("work_item:read");
    const response: z.infer<typeof notificationInboxSchema> =
      await getNotificationInbox({
        userId: c.get("userId"),
        credentialCanReadTask,
        filter: query.filter,
        limit: query.limit ? Number(query.limit) : 50,
        ...(cursor ? { cursor } : {}),
        credential: {
          ...(apiKey ? { apiKey } : {}),
          impersonatedBy: (
            c.get("session") as { impersonatedBy?: string | null } | null
          )?.impersonatedBy,
        },
      });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(response, 200);
  },
);

const notificationBase = apiRouter()
  .openapi(listNotificationsRoute, async (c) => {
    const apiKey = c.get("apiKey");
    const credentialCanReadTask =
      !apiKey ||
      expandCapabilities(apiKeyCapabilitySubset(apiKey)).has("work_item:read");
    const notifications = await getNotifications(
      c.get("userId"),
      credentialCanReadTask,
      {
        ...(apiKey ? { apiKey } : {}),
        impersonatedBy: (
          c.get("session") as { impersonatedBy?: string | null } | null
        )?.impersonatedBy,
      },
    );
    const response: NotificationTransportRow[] = notifications;
    // This route's completed query filters by the authenticated caller's userId.
    // Record only this proven self-read boundary; a failed query remains unknown.
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(response, 200);
  })
  .openapi(createNotificationRoute, async (c) => {
    const {
      title,
      message,
      type,
      eventData,
      relatedEntityId,
      relatedEntityType,
    } = c.req.valid("json");
    const created = await createNotification({
      userId: c.get("userId"),
      title,
      content: message,
      type,
      eventData,
      resourceId: relatedEntityId,
      resourceType: relatedEntityType,
    });
    const response: NotificationTransportRow | null | undefined = created;
    return c.json(response, 200);
  })
  .openapi(markAsReadRoute, async (c) => {
    const updated = await markAsRead(c.req.valid("param").id, c.get("userId"));
    const response: NotificationTransportRow = updated;
    return c.json(response, 200);
  })
  .openapi(markAsUnreadRoute, async (c) => {
    const updated = await markAsRead(
      c.req.valid("param").id,
      c.get("userId"),
      "unread",
    );
    const response: NotificationTransportRow = updated;
    return c.json(response, 200);
  })
  .openapi(markAllAsReadRoute, async (c) =>
    c.json(await markAllNotificationsAsRead(c.get("userId")), 200),
  )
  .openapi(clearAllRoute, async (c) =>
    c.json(await clearNotifications(c.get("userId")), 200),
  );

// `workspace.created` is no longer handled here: the owner's notification is written in the
// creation transaction by `enqueueNotificationEvent` (workspace/controllers/create-workspace.ts).

const notification = apiRouter()
  .route("/", notificationInbox)
  .route("/", notificationBase);

export default notification;
