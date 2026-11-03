import {
  keepPreviousData,
  type QueryClient,
  useQuery,
} from "@tanstack/react-query";
import {
  getPortalCases,
  getPortalHome,
  type PortalCaseQuery,
} from "@/fetchers/portal/cases";

/**
 * The dashboard figures and the case lists change whenever the customer or the support team acts
 * on a case or an approval. The app's QueryClient does not refetch on mount, so these two reads
 * opt in (as `useGetMyApprovals` does): returning to `/` or `/requests` always fetches current
 * figures and statuses, while the cached data paints first.
 */
export function usePortalHome(portalUserId: string, project?: string) {
  return useQuery({
    queryKey: ["portal", portalUserId, "home", project ?? null],
    queryFn: () => getPortalHome(project),
    refetchOnMount: "always",
  });
}

export function usePortalCases(
  portalUserId: string,
  query: PortalCaseQuery,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["portal", portalUserId, "cases", query],
    queryFn: () => getPortalCases(query),
    enabled,
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
  });
}

/**
 * Called by every portal mutation that changes a case or an approval. `refetchType: "all"`
 * refetches every cached dashboard figure and case list now, mounted or not, so the next visit to
 * `/` or `/requests` paints current data instead of the figures from before the action.
 */
export function invalidatePortalCaseViews(
  queryClient: QueryClient,
  portalUserId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["portal", portalUserId, "home"],
      refetchType: "all",
    }),
    queryClient.invalidateQueries({
      queryKey: ["portal", portalUserId, "cases"],
      refetchType: "all",
    }),
  ]);
}
