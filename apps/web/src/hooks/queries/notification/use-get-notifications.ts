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

function useGetNotifications(filter: AgentInboxFilter = "all") {
  const client = useQueryClient();
  const operations = useNotificationOperations();
  const query = useInfiniteQuery({
    queryKey: ["notifications", "inbox", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getNotifications(filter, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
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
