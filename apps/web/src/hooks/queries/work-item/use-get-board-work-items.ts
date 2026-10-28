import { useInfiniteQuery } from "@tanstack/react-query";
import getWorkItems, {
  type WorkItemAgileScope,
} from "@/fetchers/work-item/get-work-items";
import searchWorkItems from "@/fetchers/work-item/search-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import type {
  WorkItemSearchColumn,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";

const BOARD_PAGE_SIZE = 200;

export default function useGetBoardWorkItems({
  projectId,
  projectSlug,
  workspaceId,
  filter,
  columns,
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
  columns?: WorkItemSearchColumn[];
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  realtimeStatus: WorkItemRealtimeStatus;
  enabled?: boolean;
  /** P5 agile: only the members of this cycle or module (plain list read, no structured filter). */
  scope?: WorkItemAgileScope;
}) {
  const structuredFilter = filter?.trim() ? filter : undefined;
  const hasCustomFieldColumns =
    columns?.some((column) => column.startsWith("cf.")) ?? false;
  // Search has no rank sort; never pretend its partial key-sorted pages are rank order.
  const effectiveSort = structuredFilter && sort === "position" ? "key" : sort;
  const effectiveDir = structuredFilter && sort === "position" ? "asc" : dir;
  const canRunSearch =
    !(structuredFilter || hasCustomFieldColumns) ||
    Boolean(workspaceId && projectSlug);

  return useInfiniteQuery({
    queryKey:
      structuredFilter || hasCustomFieldColumns
        ? [
            "work-items",
            projectId,
            "board",
            "search",
            structuredFilter,
            columns ?? null,
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
      structuredFilter || hasCustomFieldColumns
        ? searchWorkItems({
            workspaceId: workspaceId as string,
            projectSlug: projectSlug as string,
            filter: structuredFilter ?? "",
            sort: effectiveSort,
            dir: effectiveDir,
            columns,
            cursor: pageParam,
          })
        : getWorkItems(
            projectId as string,
            ["key", "position", "title", "priority", "dueDate"].includes(
              effectiveSort,
            )
              ? (effectiveSort as
                  | "key"
                  | "position"
                  | "title"
                  | "priority"
                  | "dueDate")
              : "key",
            effectiveDir,
            {
              cursor: pageParam,
              limit: BOARD_PAGE_SIZE,
              scope,
            },
          ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: Boolean(projectId) && enabled && canRunSearch,
    refetchInterval: realtimeStatus === "available" ? false : 30_000,
    refetchIntervalInBackground: false,
  });
}
