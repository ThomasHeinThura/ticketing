import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { NotificationInboxPage } from "@/fetchers/notification/get-notifications";
import {
  projectNotifications,
  useNotificationOperations,
} from "@/hooks/mutations/notification/optimistic-notifications";
import type { AgentInboxFilter } from "@/lib/routes";

import { notificationInboxOptions } from "./notification-inbox-options";

export { notificationInboxOptions } from "./notification-inbox-options";

function useGetNotifications(filter: AgentInboxFilter = "all") {
  const client = useQueryClient();
  const operations = useNotificationOperations();
  const query = useInfiniteQuery(notificationInboxOptions(filter));
  const known = client
    .getQueriesData<InfiniteData<NotificationInboxPage>>({
      queryKey: ["notifications", "inbox"],
    })
    .flatMap(([, inbox]) => inbox?.pages.flatMap((page) => page.data) ?? []);
  return {
    ...query,
    data: projectNotifications(query.data, operations, filter, known),
  };
}

export default useGetNotifications;
