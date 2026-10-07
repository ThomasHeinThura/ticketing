import { useInfiniteQuery } from "@tanstack/react-query";
import getWorkItemActivity from "@/fetchers/work-item/get-work-item-activity";

function useGetWorkItemActivity({
  key,
  enabled = true,
}: {
  key: string | undefined;
  enabled?: boolean;
}) {
  return useInfiniteQuery({
    queryKey: ["work-items", "activity", key],
    queryFn: ({ pageParam }) =>
      getWorkItemActivity({ key: key as string, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    enabled: Boolean(key) && enabled,
  });
}

export default useGetWorkItemActivity;
