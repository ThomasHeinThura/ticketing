import { useQuery } from "@tanstack/react-query";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import type {
  WorkItemSearchColumn,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";

/**
 * `sort`/`dir` are part of the query key (#310): the server now sorts server-side, so
 * changing either must refetch rather than just re-render a client-side sort of
 * already-cached data.
 *
 * `placeholderData` keeps the PREVIOUS SORT's rows on screen while a new sort loads,
 * for the SAME project only -- without it, changing `sort`/`dir` changes the query key
 * to one React Query has never fetched, so it would fall back to `isLoading` (no data
 * at all) for the round trip and the screen would flash to the loading-skeleton state
 * on every sort click, a layout shift (G13) this list never had before #310 (the old
 * client-side sort was instant, same data, no refetch).
 *
 * It must NOT reuse data across a PROJECT switch. A bare `placeholderData:
 * keepPreviousData` (the first version of this hook) reuses the previous result for
 * ANY key change, `projectId` included -- an independent review reproduced this live:
 * navigating from project A to project B left `isLoading: false` and `data` still
 * holding A's rows (`isPlaceholderData: true`) until B's fetch resolved, and
 * `work.tsx` rendered them under B's page with no guard against it. The function form
 * below only returns the previous data when `previousQuery`'s own query key names the
 * SAME `projectId` this call is for (`previousQuery.queryKey[1]`, matching this hook's
 * own `queryKey` shape one line down) -- a project switch's `previousQuery` names a
 * DIFFERENT project, so this returns `undefined`, and `useQuery` falls back to its
 * normal `isLoading` state exactly as if no placeholder were configured at all. Signature
 * per the installed `@tanstack/query-core` (5.101.4): `(previousData, previousQuery) =>
 * TData | undefined`.
 *
 * A non-empty `filter` (the structured filter text from the URL, `SV-11`) switches the read
 * to `POST /api/work-items/search`, scoped to this project and the active workspace; without
 * one the list route is used exactly as before. The filter and the chosen `columns` are part
 * of the query key after the project, sort and direction, so every `["work-items",
 * projectId]` invalidation (realtime, mutations) still reaches both reads.
 */
function useGetWorkItems({
  projectId,
  projectSlug,
  workspaceId,
  filter,
  columns,
  sort,
  dir,
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
  /** Stay on the conservative foreground polling fallback until list realtime is ready. */
  realtimeStatus?: WorkItemRealtimeStatus;
  /** False while another layout (the board) owns the fetch for this project. */
  enabled?: boolean;
}) {
  const structuredFilter = filter?.trim() ? filter : undefined;
  const query = useQuery({
    queryKey: [
      "work-items",
      projectId,
      sort,
      dir,
      structuredFilter ?? "",
      structuredFilter ? (workspaceId ?? "") : "",
      structuredFilter ? (columns ?? null) : null,
    ],
    queryFn: async () => {
      if (structuredFilter) {
        const { default: searchWorkItems } = await import(
          "@/fetchers/work-item/search-work-items"
        );
        return searchWorkItems({
          workspaceId: workspaceId as string,
          projectSlug: projectSlug as string,
          filter: structuredFilter,
          sort,
          dir,
          columns,
        });
      }
      const { default: getWorkItems } = await import(
        "@/fetchers/work-item/get-work-items"
      );
      return getWorkItems(projectId as string, sort, dir);
    },
    enabled:
      !!projectId &&
      enabled &&
      (!structuredFilter || (!!workspaceId && !!projectSlug)),
    refetchInterval: realtimeStatus === "available" ? false : 30_000,
    refetchIntervalInBackground: false,
    placeholderData: (
      previousData: WorkItemsResult | undefined,
      previousQuery,
    ) => (previousQuery?.queryKey[1] === projectId ? previousData : undefined),
  });
  return {
    ...query,
    realtimeStatus,
    isRealtimeUnavailable: realtimeStatus === "unavailable",
  };
}

export default useGetWorkItems;
