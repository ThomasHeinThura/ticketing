import { keepPreviousData, useQuery } from "@tanstack/react-query";
import getWorkItems from "@/fetchers/work-item/get-work-items";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";

/**
 * `sort`/`dir` are part of the query key (#310): the server now sorts server-side, so
 * changing either must refetch rather than just re-render a client-side sort of
 * already-cached data.
 *
 * `placeholderData: keepPreviousData` -- without it, changing `sort`/`dir` changes the
 * query key to one React Query has never fetched, so it would fall back to `isLoading`
 * (no data at all) for the round trip and the screen would flash to the loading-skeleton
 * state on every sort click, a layout shift (G13) this list never had before #310 (the
 * old client-side sort was instant, same data, no refetch). Keeping the previous sort's
 * rows on screen while the new one loads removes that flash; `isLoading` still only
 * covers the true first load (`enabled` gates it on `projectId`).
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
    placeholderData: keepPreviousData,
  });
}

export default useGetWorkItems;
