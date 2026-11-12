import { useInfiniteQuery } from "@tanstack/react-query";
import getNotifications from "@/fetchers/notification/get-notifications";
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
  return useInfiniteQuery(notificationInboxOptions(filter));
}

export default useGetNotifications;
