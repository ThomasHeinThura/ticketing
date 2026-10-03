import { useInfiniteQuery } from "@tanstack/react-query";
import getWorkItemActivity from "@/fetchers/work-item/get-work-item-activity";

const WORK_ITEM_ACTIVITY_REFRESH_INTERVAL_MS = 30_000;

export default function useGetWorkItemActivity(key: string) {
  return useInfiniteQuery({
    queryKey: ["work-items", "activity", key],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getWorkItemActivity(key, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.page.hasMore
        ? (lastPage.page.nextCursor ?? undefined)
        : undefined,
    refetchInterval: WORK_ITEM_ACTIVITY_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
