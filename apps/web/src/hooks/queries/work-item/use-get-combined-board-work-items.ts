import { useInfiniteQuery } from "@tanstack/react-query";
import getCombinedWorkItems from "@/fetchers/work-item/get-combined-work-items";
import type {
  WorkItemSearchColumn,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";

export default function useGetCombinedBoardWorkItems({
  projectId,
  workspaceId,
  filter,
  columns,
  sort = "position",
  dir = "asc",
  enabled = true,
}: {
  projectId: string | undefined;
  workspaceId?: string;
  filter?: string;
  columns?: WorkItemSearchColumn[];
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  enabled?: boolean;
}) {
  const structuredFilter = filter?.trim() ? filter : undefined;
  return useInfiniteQuery({
    queryKey: [
      "work-items",
      projectId,
      "combined",
      "descendants",
      structuredFilter ?? null,
      columns ?? null,
      workspaceId ?? "",
      sort,
      dir,
    ],
    queryFn: ({ pageParam }) =>
      getCombinedWorkItems({
        projectId: projectId as string,
        filter: structuredFilter ?? "",
        sort,
        dir,
        columns,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: Boolean(projectId && workspaceId) && enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
