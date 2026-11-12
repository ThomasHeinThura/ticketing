import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import getNotifications, {
  type NotificationInboxPage,
} from "@/fetchers/notification/get-notifications";
import {
  projectNotifications,
  useNotificationOperations,
} from "@/hooks/mutations/notification/optimistic-notifications";
import type { AgentInboxFilter } from "@/lib/routes";

export function notificationInboxOptions(filter: AgentInboxFilter = "all") {
  return {
    queryKey: ["notifications", "inbox", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      getNotifications(filter, pageParam),
    getNextPageParam: (
      lastPage: Awaited<ReturnType<typeof getNotifications>>,
    ) => lastPage.nextCursor ?? undefined,
  };
}

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
