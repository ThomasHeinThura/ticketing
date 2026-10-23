import { useInfiniteQuery } from "@tanstack/react-query";
import getWorkItemActivity from "@/fetchers/work-item/get-work-item-activity";

function useGetWorkItemActivity({
  key,
  enabled = true,
  comment,
}: {
  key: string | undefined;
  enabled?: boolean;
  comment?: string;
}) {
  return useInfiniteQuery({
    queryKey: ["work-items", "activity", key, ...(comment ? [comment] : [])],
    queryFn: ({ pageParam }) =>
      getWorkItemActivity({ key: key as string, cursor: pageParam, comment }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    enabled: Boolean(key) && enabled,
  });
}

export default useGetWorkItemActivity;
