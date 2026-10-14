import { useInfiniteQuery } from "@tanstack/react-query";
import getWorkItems from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";

const BOARD_PAGE_SIZE = 200;

export default function useGetBoardWorkItems({
  projectId,
  realtimeStatus,
  enabled = true,
}: {
  projectId: string | undefined;
  realtimeStatus: WorkItemRealtimeStatus;
  enabled?: boolean;
}) {
  return useInfiniteQuery({
    queryKey: ["work-items", projectId, "board", "position"],
    queryFn: ({ pageParam }) =>
      getWorkItems(projectId as string, "position", "asc", {
        cursor: pageParam,
        limit: BOARD_PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: Boolean(projectId) && enabled,
    refetchInterval: realtimeStatus === "available" ? false : 30_000,
    refetchIntervalInBackground: false,
  });
}
