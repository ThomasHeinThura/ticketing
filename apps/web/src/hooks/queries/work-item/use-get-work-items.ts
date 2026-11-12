import {
  focusManager,
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  const effectiveSorts = sorts?.length ? sorts : [{ field: sort, order: dir }];
  const useSearch = usesWorkItemSearch({ filter, columns, sort, dir, sorts });
  const readEnabled = !!projectId && enabled;
  const listQueryKey = workItemsListQueryKey(projectId, sort, dir);
  const searchQueryKey = [
    "work-items",
    projectId,
    sort,
    dir,
    effectiveSorts,
    "search",
    structuredFilter ?? "",
    workspaceId ?? "",
    columns ?? null,
  ] as const;
  const listQuery = useInfiniteQuery({
    queryKey: listQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchWorkItemsListPage(projectId as string, sort, dir, pageParam),
    getNextPageParam: (last, _pages, _lastParam, pageParams) =>
      last.hasMore && last.nextCursor && !pageParams.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    select: (data): WorkItemsResult => {
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
    },
    enabled: readEnabled && !useSearch,
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
    select: (data): WorkItemsResult => {
      const last = data.pages.at(-1);
      const customFieldColumns = data.pages.find(
        (page) => page.customFieldColumns,
      )?.customFieldColumns;
      const people = new Map(
        data.pages
          .flatMap((page) => page.customFieldPeople ?? [])
          .map((person) => [`${person.projectId}\0${person.personId}`, person]),
      );
      const seen = new Set<string>();
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
        ...(customFieldColumns ? { customFieldColumns } : {}),
        ...(people.size > 0 ? { customFieldPeople: [...people.values()] } : {}),
      };
    },
    enabled: readEnabled && useSearch && !!workspaceId && !!projectSlug,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === projectId ? previousData : undefined,
  });

  const active = useSearch ? searchQuery : listQuery;
  const activeKey = useSearch ? searchQueryKey : listQueryKey;
  // A key's JSON representation is stable even when callers recreate their filter arrays.
  const activeKeyId = JSON.stringify(activeKey);
  const [changedKey, setChangedKey] = useState<string>();
  const keyRef = useRef(activeKeyId);
  keyRef.current = activeKeyId;
  useEffect(() => {
    setChangedKey((current) =>
      realtimeStatus === "available" || current !== activeKeyId
        ? undefined
        : current,
    );
  }, [activeKeyId, realtimeStatus]);
  const pollRef = useRef({
    activeKey,
    projectId,
    sort,
    dir,
    workspaceId,
    projectSlug,
    structuredFilter,
    effectiveSorts,
    columns,
    useSearch,
  });
  pollRef.current = {
    activeKey,
    projectId,
    sort,
    dir,
    workspaceId,
    projectSlug,
    structuredFilter,
    effectiveSorts,
    columns,
    useSearch,
  };
  const pollingEnabled =
    readEnabled &&
    realtimeStatus !== "available" &&
    (!useSearch || Boolean(workspaceId && projectSlug));

  useEffect(() => {
    if (!pollingEnabled) return;
    let disposed = false;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (disposed || inFlight || !focusManager.isFocused()) return;
      const input = pollRef.current;
      if (JSON.stringify(input.activeKey) !== activeKeyId) return;
      const query = queryClient
        .getQueryCache()
        .find({ queryKey: input.activeKey, exact: true });
      if (query?.state.fetchStatus !== "idle") return;
      // A terminal access refusal stays visible until a normal manual refresh or navigation.
      if (
        query.state.error instanceof HttpError &&
        [401, 403, 404].includes(query.state.error.status)
      )
        return;
      const before = query.state;
      const oldData = before.data as
        | InfiniteData<WorkItemsResult, string | undefined>
        | undefined;
      if (!oldData?.pages.length) return;
      inFlight = true;
      try {
        const first = await queryClient.fetchQuery({
          queryKey: ["work-list-outage-poll", ...input.activeKey],
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            if (input.useSearch) {
              const search = await loadSearchWorkItems();
              signal.throwIfAborted();
              return search({
                workspaceId: input.workspaceId as string,
                projectSlug: input.projectSlug as string,
                filter: input.structuredFilter ?? "",
                sort: input.sort,
                dir: input.dir,
                sorts: input.effectiveSorts,
                columns: input.columns,
                cursor: undefined,
                signal,
              });
            }
            return fetchWorkItemsListPage(
              input.projectId as string,
              input.sort,
              input.dir,
              undefined,
              signal,
            );
          },
        });
        if (
          disposed ||
          query.state !== before ||
          queryClient
            .getQueryCache()
            .find({ queryKey: input.activeKey, exact: true }) !== query
        )
          return;
        const firstIds = first.items.map((item) => item.id);
        const previousIds =
          oldData.pages[0]?.items.map((item) => item.id) ?? [];
        if (
          firstIds.length !== previousIds.length ||
          firstIds.some((id, index) => id !== previousIds[index])
        ) {
          setChangedKey(activeKeyId);
        }
        const updates = new Map(first.items.map((item) => [item.id, item]));
        queryClient.setQueryData<
          InfiniteData<WorkItemsResult, string | undefined>
        >(input.activeKey, (current) => {
          if (!current) return current;
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((item) => updates.get(item.id) ?? item),
            })),
          };
        });
      } catch (error) {
        // fetchQuery has already invoked the cache's normal error callback.
        if (
          disposed ||
          query.state !== before ||
          queryClient
            .getQueryCache()
            .find({ queryKey: input.activeKey, exact: true }) !== query
        )
          return;
        if (
          error instanceof HttpError &&
          [401, 403, 404].includes(error.status)
        ) {
          query.setState({
            error,
            errorUpdatedAt: Date.now(),
            status: "error",
          });
        }
      } finally {
        inFlight = false;
      }
    }, 30_000);
    return () => {
      disposed = true;
      clearInterval(timer);
      void queryClient.cancelQueries({
        queryKey: ["work-list-outage-poll", ...JSON.parse(activeKeyId)],
        exact: true,
      });
    };
  }, [activeKeyId, pollingEnabled, queryClient]);
  const accessDenied =
    active.error instanceof HttpError &&
    [401, 403, 404].includes(active.error.status);
  const isCursorChanged =
    active.error instanceof HttpError &&
    active.error.status === 409 &&
    active.error.message === "cursor_changed";
  return {
    ...active,
    hasNewerChanges:
      realtimeStatus !== "available" && changedKey === activeKeyId,
    refreshChangedList: async () => {
      const refreshed = await active.refetch();
      if (!refreshed.isError && keyRef.current === activeKeyId)
        setChangedKey(undefined);
    },
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
    restartFromFirstPage: () =>
      queryClient.resetQueries({
        queryKey: useSearch ? searchQueryKey : listQueryKey,
        exact: true,
      }),
    hasNextPage:
      !accessDenied && !active.isPlaceholderData && active.hasNextPage,
    isFetchingNextPage: active.isFetchingNextPage,
    fetchNextPage: active.fetchNextPage,
    realtimeStatus,
    isRealtimeUnavailable: realtimeStatus === "unavailable",
  };
}

export default useGetWorkItems;
