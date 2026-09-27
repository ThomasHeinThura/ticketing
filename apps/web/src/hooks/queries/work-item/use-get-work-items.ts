import { useQuery } from "@tanstack/react-query";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import getWorkItems from "@/fetchers/work-item/get-work-items";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";

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
 */
function useGetWorkItems({
  projectId,
  sort,
  dir,
}: {
  projectId: string | undefined;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
}) {
  return useQuery({
    queryKey: ["work-items", projectId, sort, dir],
    queryFn: () => getWorkItems(projectId as string, sort, dir),
    enabled: !!projectId,
    placeholderData: (
      previousData: WorkItemsResult | undefined,
      previousQuery,
    ) => (previousQuery?.queryKey[1] === projectId ? previousData : undefined),
  });
}

export default useGetWorkItems;
