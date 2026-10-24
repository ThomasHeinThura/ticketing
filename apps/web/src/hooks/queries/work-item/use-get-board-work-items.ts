import { useInfiniteQuery } from "@tanstack/react-query";
import getWorkItems, {
  type WorkItemAgileScope,
} from "@/fetchers/work-item/get-work-items";
import searchWorkItems from "@/fetchers/work-item/search-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";

const BOARD_PAGE_SIZE = 200;

export default function useGetBoardWorkItems({
  projectId,
  projectSlug,
  workspaceId,
  filter,
  sort = "position",
  dir = "asc",
  realtimeStatus,
  enabled = true,
  scope,
}: {
  projectId: string | undefined;
  projectSlug?: string;
  workspaceId?: string;
  filter?: string;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  realtimeStatus: WorkItemRealtimeStatus;
  enabled?: boolean;
  /** P5 agile: only the members of this cycle or module (plain list read, no structured filter). */
  scope?: WorkItemAgileScope;
}) {
  const structuredFilter = filter?.trim() ? filter : undefined;
  // Search has no rank sort; never pretend its partial key-sorted pages are rank order.
  const effectiveSort = structuredFilter && sort === "position" ? "key" : sort;
  const effectiveDir = structuredFilter && sort === "position" ? "asc" : dir;
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
          effectiveSort,
          effectiveDir,
        ]
      : scope?.cycleId || scope?.moduleId
        ? [
            "work-items",
            projectId,
            "board",
            effectiveSort,
            effectiveDir,
            "scope",
            scope.cycleId ?? "",
            scope.moduleId ?? "",
          ]
        : ["work-items", projectId, "board", effectiveSort, effectiveDir],
    queryFn: ({ pageParam }) =>
      structuredFilter
        ? searchWorkItems({
            workspaceId: workspaceId as string,
            projectSlug: projectSlug as string,
            filter: structuredFilter,
            sort: effectiveSort,
            dir: effectiveDir,
            cursor: pageParam,
          })
        : getWorkItems(projectId as string, effectiveSort, effectiveDir, {
            cursor: pageParam,
            limit: BOARD_PAGE_SIZE,
            scope,
          }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: Boolean(projectId) && enabled && canRunFiltered,
    refetchInterval: realtimeStatus === "available" ? false : 30_000,
    refetchIntervalInBackground: false,
  });
}
