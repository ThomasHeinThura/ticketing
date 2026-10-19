import { useInfiniteQuery } from "@tanstack/react-query";
import getWorkItems from "@/fetchers/work-item/get-work-items";
import searchWorkItems from "@/fetchers/work-item/search-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";

const BOARD_PAGE_SIZE = 200;

export default function useGetBoardWorkItems({
  projectId,
  projectSlug,
  workspaceId,
  filter,
  realtimeStatus,
  enabled = true,
}: {
  projectId: string | undefined;
  projectSlug?: string;
  workspaceId?: string;
  filter?: string;
  realtimeStatus: WorkItemRealtimeStatus;
  enabled?: boolean;
}) {
  const structuredFilter = filter?.trim() ? filter : undefined;
  const canRunFiltered =
    !structuredFilter || Boolean(workspaceId && projectSlug);

  return useInfiniteQuery({
    queryKey: structuredFilter
      ? [
          "work-items",
          projectId,
          "board",
          "search",
          structuredFilter,
          workspaceId ?? "",
        ]
      : ["work-items", projectId, "board", "position"],
    queryFn: ({ pageParam }) =>
      structuredFilter
        ? searchWorkItems({
            workspaceId: workspaceId as string,
            projectSlug: projectSlug as string,
            filter: structuredFilter,
            sort: "key",
            dir: "asc",
            cursor: pageParam,
          })
        : getWorkItems(projectId as string, "position", "asc", {
            cursor: pageParam,
            limit: BOARD_PAGE_SIZE,
          }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: Boolean(projectId) && enabled && canRunFiltered,
    refetchInterval: realtimeStatus === "available" ? false : 30_000,
    refetchIntervalInBackground: false,
  });
}
