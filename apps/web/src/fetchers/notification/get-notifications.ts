import { client } from "@taskdesk/libs";
import type { AgentInboxFilter } from "@/lib/routes";
import type { Notification } from "@/types/notification";

export type NotificationInboxPage = {
  data: Notification[];
  unreadCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

async function getNotifications(filter: AgentInboxFilter, cursor?: string) {
  const response = await client.notification.inbox.$get({
    query: { filter, limit: "50", ...(cursor ? { cursor } : {}) },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return (await response.json()) as NotificationInboxPage;
}

export default getNotifications;
