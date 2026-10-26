import { useInfiniteQuery } from "@tanstack/react-query";
import getNotifications from "@/fetchers/notification/get-notifications";
import type { AgentInboxFilter } from "@/lib/routes";

function useGetNotifications(filter: AgentInboxFilter = "all") {
  return useInfiniteQuery({
    queryKey: ["notifications", "inbox", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getNotifications(filter, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export default useGetNotifications;
