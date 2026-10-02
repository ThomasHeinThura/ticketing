import { useInfiniteQuery } from "@tanstack/react-query";
import getWorkItemActivity from "@/fetchers/work-item/get-work-item-activity";
import { WORK_ITEM_REFRESH_INTERVAL_MS } from "./use-get-work-item";

export default function useGetWorkItemActivity(key: string) {
  return useInfiniteQuery({
    queryKey: ["work-items", "activity", key],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getWorkItemActivity(key, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.page.hasMore
        ? (lastPage.page.nextCursor ?? undefined)
        : undefined,
    refetchInterval: WORK_ITEM_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
