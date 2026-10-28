import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  decodeNotificationInboxCursor,
  listVisibleNotificationInbox,
  markOwnReadableNotificationRead,
  markReadableNotificationsRead,
} from "./inbox.repository";
import {
  admitPortalNotifications,
  resolvePortalNotificationTargets,
} from "./portal-inbox-repository";

const customerFilterSchema = z.enum(["all", "unread", "mentions"]);
const customerEventSchema = z.enum([
  "work_item.commented",
  "work_item.mentioned",
  "work_item.transitioned",
  "submission.replied",
  "submission.declined",
  // AP-21 / AP-13 (`P2R1-04`): a customer approver's approval events.
  "approval.requested",
  "approval.expiring",
  "approval.withdrawn",
]);
type CustomerEventKind = z.infer<typeof customerEventSchema>;

function isCustomerEventKind(kind: string | null): kind is CustomerEventKind {
  return (
    kind === "work_item.commented" ||
    kind === "work_item.mentioned" ||
    kind === "work_item.transitioned" ||
    kind === "submission.replied" ||
    kind === "submission.declined" ||
    kind === "approval.requested" ||
    kind === "approval.expiring" ||
    kind === "approval.withdrawn"
  );
}

const portalNotificationSchema = z.object({
  id: z.string(),
  kind: customerEventSchema,
  isRead: z.boolean(),
  createdAt: z.string().datetime(),
  /** Null for an approval event, which opens the portal Approvals screen. */
  requestRef: z.string().nullable(),
  commentId: z.string().nullable(),
});

const inboxResponseSchema = z.object({
  data: z.array(portalNotificationSchema),
  unreadCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
const mutationResponseSchema = z.object({ success: z.boolean() });
const inboxQuerySchema = z.object({
  filter: customerFilterSchema.default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().max(256).optional(),
});
const notificationParamSchema = z.object({ id: z.string().min(1).max(128) });

async function requireCustomerSession(c: {
  req: { header(name: string): string | undefined };
  get(key: "userId"): string;
  get(key: "session"): unknown;
  get(key: "apiKey"): unknown;
}) {
  const session = c.get("session") as { portal?: unknown } | null;
  const userId = c.get("userId");
  if (
    !userId ||
    c.get("apiKey") ||
    portalForHost(c.req.header("host")) !== "customer" ||
    session?.portal !== "customer"
  )
    throw new HTTPException(404, { message: "Not found" });

  const identity = await resolveIdentity({ userId, credential: "session" });
  if (identity?.side !== "customer")
    throw new HTTPException(404, { message: "Not found" });
  return identity;
}

const getInboxRoute = createRoute({
  method: "get",
  path: "/inbox",
  operationId: "getPortalNotificationInbox",
  tags: ["Portal notifications"],
  summary: "List the current customer's notifications",
  middleware: [requireSessionOnly()] as const,
  request: { query: inboxQuerySchema },
  responses: {
    200: jsonResponse("Customer-safe notification inbox", inboxResponseSchema),
    400: errorResponse("Invalid inbox cursor"),
    404: errorResponse("Not found"),
  },
});
const markReadRoute = createRoute({
  method: "patch",
  path: "/{id}/read",
  operationId: "markPortalNotificationRead",
  tags: ["Portal notifications"],
  summary: "Mark a notification as read",
  middleware: [requireSessionOnly()] as const,
  request: { params: notificationParamSchema },
  responses: {
    200: jsonResponse("Updated notification state", mutationResponseSchema),
    404: errorResponse("Not found"),
  },
});
const markUnreadRoute = createRoute({
  method: "patch",
  path: "/{id}/unread",
  operationId: "markPortalNotificationUnread",
  tags: ["Portal notifications"],
  summary: "Mark a notification as unread",
  middleware: [requireSessionOnly()] as const,
  request: { params: notificationParamSchema },
  responses: {
    200: jsonResponse("Updated notification state", mutationResponseSchema),
    404: errorResponse("Not found"),
  },
});
const markAllReadRoute = createRoute({
  method: "patch",
  path: "/read-all",
  operationId: "markAllPortalNotificationsRead",
  tags: ["Portal notifications"],
  summary: "Mark all reachable customer notifications as read",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("Updated notification state", mutationResponseSchema),
    404: errorResponse("Not found"),
  },
});

function customerNotificationRows(
  rows: Awaited<ReturnType<typeof listVisibleNotificationInbox>>["rows"],
  targets: Awaited<ReturnType<typeof resolvePortalNotificationTargets>>,
) {
  return rows.flatMap(({ notification }) => {
    const kind = notification.kind;
    if (!isCustomerEventKind(kind)) return [];

    // Generic notification title/body/eventData may contain internal terminology or staff
    // names. The portal receives only the customer event key and its request/comment target.
    const target = targets.get(notification.id);
    if (!target) return [];
    return [
      {
        id: notification.id,
        kind,
        isRead: notification.isRead === true,
        createdAt: notification.createdAt.toISOString(),
        requestRef: target.requestRef,
        commentId: target.commentId,
      },
    ];
  });
}

export const portalNotificationRouter = apiRouter()
  .openapi(getInboxRoute, async (c) => {
    const identity = await requireCustomerSession(c);
    const query = c.req.valid("query");
    const cursor = query.cursor
      ? decodeNotificationInboxCursor(query.cursor)
      : undefined;
    if (query.cursor && !cursor) {
      throw new HTTPException(400, { message: "Invalid inbox cursor" });
    }
    const result = await listVisibleNotificationInbox({
      userId: identity.userId,
      credentialCanReadTask: true,
      filter: query.filter,
      limit: query.limit,
      ...(cursor ? { cursor } : {}),
      // P4R2-M2: notifications of a project or workspace with the customer portal off are
      // neither listed nor counted.
      admit: (rows) => admitPortalNotifications(rows),
    });
    const targets = await resolvePortalNotificationTargets(
      result.rows.map(({ notification }) => ({ notification })),
      identity.personId,
    );
    const response = {
      data: customerNotificationRows(result.rows, targets),
      unreadCount: result.unreadCount,
      hasMore: result.nextCursor !== null,
      nextCursor: result.nextCursor,
    };
    c.header("Cache-Control", "no-store");
    return c.json(response, 200);
  })
  .openapi(markReadRoute, async (c) => {
    const identity = await requireCustomerSession(c);
    const updated = await markOwnReadableNotificationRead(
      c.req.valid("param").id,
      identity.userId,
      "read",
    );
    if (!updated) throw new HTTPException(404, { message: "Not found" });
    return c.json({ success: true }, 200);
  })
  .openapi(markUnreadRoute, async (c) => {
    const identity = await requireCustomerSession(c);
    const updated = await markOwnReadableNotificationRead(
      c.req.valid("param").id,
      identity.userId,
      "unread",
    );
    if (!updated) throw new HTTPException(404, { message: "Not found" });
    return c.json({ success: true }, 200);
  })
  .openapi(markAllReadRoute, async (c) => {
    const identity = await requireCustomerSession(c);
    await markReadableNotificationsRead(identity.userId);
    return c.json({ success: true }, 200);
  });

export default portalNotificationRouter;
