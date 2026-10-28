import type { AuthenticatedApiKey } from "../../permissions/resolve-request-identity";
import {
  listVisibleNotificationInbox,
  type NotificationInboxCursor,
  type NotificationInboxFilter,
} from "../inbox.repository";
import { enrichVisibleNotifications } from "./get-notifications";

export default async function getNotificationInbox(params: {
  userId: string;
  credentialCanReadTask: boolean;
  credential?: {
    apiKey?: AuthenticatedApiKey;
    impersonatedBy?: string | null;
  };
  filter: NotificationInboxFilter;
  limit: number;
  cursor?: NotificationInboxCursor;
}) {
  const { userId, credentialCanReadTask, credential, filter, limit, cursor } =
    params;
  const result = await listVisibleNotificationInbox({
    userId,
    credentialCanReadTask,
    credential,
    filter,
    limit,
    cursor,
  });
  return {
    data: await enrichVisibleNotifications(result.rows),
    unreadCount: result.unreadCount,
    hasMore: result.nextCursor !== null,
    nextCursor: result.nextCursor,
  };
}
