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
import type {
  WorkItemCustomFieldColumn,
  WorkItemCustomFieldPerson,
  WorkItemRow,
} from "@/types/work-item";
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

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Canonicalizes arbitrary JSON values (such as customFieldValues) independent of object key order. */
function canonicalizeJson(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== "object") {
    return value ?? null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  return Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([key, entry]) => [key, canonicalizeJson(entry)]);
}

/**
 * Explicit, clock-independent display projection of a rendered work-list row.
 *
 * `version` and `updatedAt` catch direct `work_item` row writes, but `id + updatedAt/version`
 * alone is insufficient because visible list data also comes from joined or batched records that
 * can change without bumping `work_item.version` (custom-field values, label attachments or
 * renames, workflow state renames, assignee display names/activity/project membership, and open
 * blocker counts).
 *
 * The fingerprint includes the SLA badge state and metric (`item.sla.state` and `item.sla.metric`);
 * it ignores only remaining time, consumed percentage and due time (`remainingMinutes`,
 * `consumedPct` and `dueAt`).
 */
function stableRowProjection(item: WorkItemRow) {
  const customFieldValues =
    item.customFieldValues && Object.keys(item.customFieldValues).length > 0
      ? canonicalizeJson(item.customFieldValues)
      : null;
  return {
    id: item.id,
    projectId: item.projectId ?? null,
    number: item.number ?? null,
    key: item.key ?? "",
    title: item.title ?? "",
    stateId: item.stateId ?? null,
    stateName: item.stateName ?? "",
    stateCategory: item.stateCategory ?? null,
    priority: item.priority ?? null,
    assigneeId: item.assigneeId ?? null,
    assigneeName: item.assigneeName ?? null,
    assigneeActive: item.assigneeActive ?? null,
    assigneeOnProject: item.assigneeOnProject ?? null,
    isBlocked: (item.blockedByOpenCount ?? 0) > 0,
    labels: [...(item.labels ?? [])]
      .map(({ id, name, color }) => ({ id, name, color }))
      .sort(
        (a, b) => compareStrings(a.name, b.name) || compareStrings(a.id, b.id),
      ),
    dueDate: item.dueDate ?? null,
    archivedAt: item.archivedAt ?? null,
    deletedAt: item.deletedAt ?? null,
    unavailableFields: [...(item.unavailableFields ?? [])].sort(compareStrings),
    customFieldValues,
    sla: item.sla ? { state: item.sla.state, metric: item.sla.metric } : null,
    version: item.version ?? null,
    updatedAt: item.updatedAt ?? null,
  };
}

function stableColumnsProjection(
  columns: readonly WorkItemCustomFieldColumn[] | undefined,
) {
  if (!columns?.length) return [];
  const byKey = new Map<
    string,
    {
      key: string;
      name: string;
      format: string;
      options: { key: string; label: string }[];
    }
  >();
  for (const column of columns) {
    byKey.set(column.key, {
      key: column.key,
      name: column.name,
      format: column.format,
      options: (column.options ?? []).map((option) => ({
        key: option.key,
        label: option.label,
      })),
    });
  }
  return [...byKey.values()].sort((a, b) => compareStrings(a.key, b.key));
}

function stablePeopleProjection(
  people: readonly WorkItemCustomFieldPerson[] | undefined,
) {
  if (!people?.length) return [];
  const byPerson = new Map<
    string,
    { projectId: string; personId: string; name: string | null }
  >();
  for (const person of people) {
    byPerson.set(`${person.projectId}\0${person.personId}`, {
      projectId: person.projectId,
      personId: person.personId,
      name: person.name ?? null,
    });
  }
  return [...byPerson.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([, person]) => person);
}

/**
 * Clock-independent fingerprint of page one's rendered rows and envelope display metadata.
 * Excludes paging cursors (`nextCursor`, `hasMore`) and search `total`.
 */
export function workListPageFingerprint(
  page: WorkItemsResult | undefined,
): string {
  if (!page) return "";
  return JSON.stringify({
    hasPartialFailure: Boolean(page.hasPartialFailure),
    items: page.items.map(stableRowProjection),
    customFieldColumns: stableColumnsProjection(page.customFieldColumns),
    customFieldPeople: stablePeopleProjection(page.customFieldPeople),
  });
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
    queryFn: ({ pageParam, signal }) =>
      fetchWorkItemsListPage(projectId as string, sort, dir, pageParam, signal),
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
    queryFn: async ({ pageParam, signal }) => {
      const searchWorkItems = await loadSearchWorkItems();
      signal.throwIfAborted();
      return searchWorkItems({
        workspaceId: workspaceId as string,
        projectSlug: projectSlug as string,
        filter: structuredFilter ?? "",
        sort,
        dir,
        sorts: effectiveSorts,
        columns,
        cursor: pageParam,
        signal,
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
    let probeController: AbortController | undefined;
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
      let controller: AbortController | undefined;
      inFlight = true;
      try {
        if (!oldData?.pages.length) {
          // Use the observed query's lifecycle, but disable retries for this tick only.
          // Cleanup must not cancel this normal query so an in-flight cold recovery can
          // finish when realtime connects; unmount or a query-key change cancels via
          // TanStack Query's observer removal, whereas a list/search toggle only flips
          // `enabled` (keeping both observers mounted) and the disposed effect ignores
          // the result.
          const options = query.options;
          const request = query.fetch({ ...options, retry: false });
          query.setOptions(options);
          await request;
          return;
        }
        controller = new AbortController();
        probeController = controller;
        const first = input.useSearch
          ? await (async () => {
              const search = await loadSearchWorkItems();
              controller.signal.throwIfAborted();
              return search({
                workspaceId: input.workspaceId as string,
                projectSlug: input.projectSlug as string,
                filter: input.structuredFilter ?? "",
                sort: input.sort,
                dir: input.dir,
                sorts: input.effectiveSorts,
                columns: input.columns,
                cursor: undefined,
                signal: controller.signal,
              });
            })()
          : await fetchWorkItemsListPage(
              input.projectId as string,
              input.sort,
              input.dir,
              undefined,
              controller.signal,
            );
        if (
          disposed ||
          controller.signal.aborted ||
          query.state !== before ||
          queryClient
            .getQueryCache()
            .find({ queryKey: input.activeKey, exact: true }) !== query
        )
          return;
        if (
          workListPageFingerprint(first) !==
          workListPageFingerprint(oldData.pages[0])
        ) {
          setChangedKey(activeKeyId);
        }
      } catch (error) {
        if (!controller || controller.signal.aborted) return;
        const onError = queryClient.getQueryCache().config.onError;
        onError?.(
          error as Error,
          query as Parameters<NonNullable<typeof onError>>[1],
        );
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
        if (probeController === controller) {
          probeController = undefined;
        }
        inFlight = false;
      }
    }, 30_000);
    return () => {
      disposed = true;
      clearInterval(timer);
      probeController?.abort();
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
