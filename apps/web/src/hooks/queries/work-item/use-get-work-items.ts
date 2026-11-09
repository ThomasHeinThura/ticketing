import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { HttpError } from "@/lib/http-error";
import type {
  WorkItemSearchColumn,
  WorkItemSort,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";
import {
  fetchWorkItemsListPage,
  usesWorkItemSearch,
  workItemsListQueryKey,
} from "./work-items-list-query";

function selectListWorkItems(
  data: InfiniteData<WorkItemsResult>,
): WorkItemsResult {
  const seen = new Set<string>();
  const last = data.pages.at(-1);
  return {
    items: data.pages
      .flatMap((page) => page.items)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }),
    hasPartialFailure: data.pages.some((page) => page.hasPartialFailure),
    hasMore: last?.hasMore ?? false,
  };
}

function selectSearchWorkItems(
  data: InfiniteData<WorkItemsResult>,
): WorkItemsResult {
  const last = data.pages.at(-1);
  const customFieldColumns = data.pages.find(
    (page) => page.customFieldColumns,
  )?.customFieldColumns;
  const people = new Map(
    data.pages
      .flatMap((page) => page.customFieldPeople ?? [])
      .map((person) => [`${person.projectId}\0${person.personId}`, person]),
  );
  return {
    items: data.pages.flatMap((page) => page.items),
    hasPartialFailure: data.pages.some((page) => page.hasPartialFailure),
    hasMore: last?.hasMore ?? false,
    ...(customFieldColumns ? { customFieldColumns } : {}),
    ...(people.size > 0 ? { customFieldPeople: [...people.values()] } : {}),
  };
}

/** The structured-search fetcher, loaded only when a list needs it. */
async function loadSearchWorkItems() {
  const { default: searchWorkItems } = await import(
    "@/fetchers/work-item/search-work-items"
  );
  return searchWorkItems;
}

/** Canonical list and structured search retain independent cursor caches beneath the
 * project invalidation prefix. Previous ordering is a same-project placeholder only;
 * it must never become a writable rank ordering or appear under a different project. */
function useGetWorkItems({
  projectId,
  projectSlug,
  workspaceId,
  filter,
  columns,
  sort,
  dir,
  sorts,
  realtimeStatus = "connecting",
  enabled = true,
}: {
  projectId: string | undefined;
  /** The project's slug, the `project` clause of a structured search. */
  projectSlug?: string;
  /** The workspace a structured search is scoped to (it is sent in the body). */
  workspaceId?: string;
  filter?: string;
  columns?: WorkItemSearchColumn[];
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  sorts?: WorkItemSort[];
  /** Stay on the conservative foreground polling fallback until list realtime is ready. */
  realtimeStatus?: WorkItemRealtimeStatus;
  /** False while another layout (the board) owns the fetch for this project. */
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const structuredFilter = filter?.trim() ? filter : undefined;
  const effectiveSorts = useMemo(
    () => (sorts?.length ? sorts : [{ field: sort, order: dir }]),
    [sorts, sort, dir],
  );
  const useSearch = usesWorkItemSearch({ filter, columns, sort, dir, sorts });
  const readEnabled = !!projectId && enabled;
  const refetchInterval = realtimeStatus === "available" ? false : 30_000;
  const listQueryKey = useMemo(
    () => workItemsListQueryKey(projectId, sort, dir),
    [projectId, sort, dir],
  );
  const searchQueryKey = useMemo(
    () =>
      [
        "work-items",
        projectId,
        sort,
        dir,
        effectiveSorts,
        "search",
        structuredFilter ?? "",
        workspaceId ?? "",
        columns ?? null,
      ] as const,
    [
      projectId,
      sort,
      dir,
      effectiveSorts,
      structuredFilter,
      workspaceId,
      columns,
    ],
  );
  const listQuery = useInfiniteQuery({
    queryKey: listQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchWorkItemsListPage(projectId as string, sort, dir, pageParam),
    getNextPageParam: (last, _pages, _lastParam, pageParams) =>
      last.hasMore && last.nextCursor && !pageParams.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    select: selectListWorkItems,
    enabled: readEnabled && !useSearch,
    refetchInterval,
    refetchIntervalInBackground: false,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === projectId ? previousData : undefined,
  });

  // A structured filter reads pages of `POST /api/work-items/search` and follows the cursor
  // on demand, so a filter matching more than one page is never silently cut off.
  const searchQuery = useInfiniteQuery({
    queryKey: searchQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const searchWorkItems = await loadSearchWorkItems();
      return searchWorkItems({
        workspaceId: workspaceId as string,
        projectSlug: projectSlug as string,
        filter: structuredFilter ?? "",
        sort,
        dir,
        sorts: effectiveSorts,
        columns,
        cursor: pageParam,
      });
    },
    getNextPageParam: (last) =>
      last.hasMore ? (last.nextCursor ?? undefined) : undefined,
    select: selectSearchWorkItems,
    enabled: readEnabled && useSearch && !!workspaceId && !!projectSlug,
    refetchInterval,
    refetchIntervalInBackground: false,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === projectId ? previousData : undefined,
  });

  const active = useSearch ? searchQuery : listQuery;
  const accessDenied =
    active.error instanceof HttpError &&
    [401, 403, 404].includes(active.error.status);
  const isCursorChanged =
    active.error instanceof HttpError &&
    active.error.status === 409 &&
    active.error.message === "cursor_changed";
  const restartFromFirstPage = useCallback(
    () =>
      queryClient.resetQueries({
        queryKey: useSearch ? searchQueryKey : listQueryKey,
        exact: true,
      }),
    [queryClient, useSearch, searchQueryKey, listQueryKey],
  );
  return {
    ...active,
    // React Query deliberately retains cached pages after a failed refresh. A fresh
    // authorization denial must hide them; a recoverable paging failure must not.
    data: accessDenied ? undefined : active.data,
    isError: active.isError && (accessDenied || !active.data),
    isLoadMoreError:
      !accessDenied &&
      (active.isFetchNextPageError ||
        (!active.isPlaceholderData &&
          Boolean(active.data?.hasMore) &&
          !active.hasNextPage)),
    isCursorChanged,
    restartFromFirstPage,
    hasNextPage:
      !accessDenied && !active.isPlaceholderData && active.hasNextPage,
    isFetchingNextPage: active.isFetchingNextPage,
    fetchNextPage: active.fetchNextPage,
    realtimeStatus,
    isRealtimeUnavailable: realtimeStatus === "unavailable",
  };
}

export default useGetWorkItems;
