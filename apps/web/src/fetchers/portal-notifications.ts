import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export type PortalNotificationFilter = "all" | "unread" | "mentions";
export type PortalNotificationKind =
  | "work_item.commented"
  | "work_item.mentioned"
  | "work_item.transitioned"
  | "submission.replied"
  | "submission.declined"
  | "approval.requested"
  | "approval.expiring"
  | "approval.withdrawn";

export type PortalNotification = {
  id: string;
  kind: PortalNotificationKind;
  isRead: boolean;
  createdAt: string;
  /** Null for an approval event, which opens the Approvals screen. */
  requestRef: string | null;
  commentId: string | null;
};

export type PortalNotificationPage = {
  data: PortalNotification[];
  unreadCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

async function parsePage(response: Response): Promise<PortalNotificationPage> {
  if (!response.ok)
    throw new HttpError(response.status, "Unable to load notifications");
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as PortalNotificationPage).data) ||
    typeof (value as PortalNotificationPage).unreadCount !== "number" ||
    typeof (value as PortalNotificationPage).hasMore !== "boolean" ||
    ((value as PortalNotificationPage).nextCursor !== null &&
      typeof (value as PortalNotificationPage).nextCursor !== "string")
  )
    throw new Error("Invalid portal notification response");
  return value as PortalNotificationPage;
}

export async function getPortalNotifications(
  input: {
    filter?: PortalNotificationFilter;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<PortalNotificationPage> {
  const query = new URLSearchParams();
  if (input.filter) query.set("filter", input.filter);
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.cursor) query.set("cursor", input.cursor);
  return parsePage(
    await apiFetch(
      getApiUrl(`/portal/notification/inbox?${query.toString()}`),
      { cache: "no-store", referrerPolicy: "no-referrer" },
    ),
  );
}

async function mutate(path: string) {
  const response = await apiFetch(getApiUrl(path), { method: "PATCH" });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to update notification");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("success" in value))
    throw new Error("Invalid notification update response");
  return value;
}

export function markPortalNotificationRead(id: string) {
  return mutate(`/portal/notification/${encodeURIComponent(id)}/read`);
}

export function markPortalNotificationUnread(id: string) {
  return mutate(`/portal/notification/${encodeURIComponent(id)}/unread`);
}

export function markAllPortalNotificationsRead() {
  return mutate("/portal/notification/read-all");
}
