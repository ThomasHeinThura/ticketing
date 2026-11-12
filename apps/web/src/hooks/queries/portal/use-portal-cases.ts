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
import { portalProjectKeys } from "@/fetchers/portal/projects";

/**
 * The dashboard figures and the case lists change whenever the customer or the support team acts
 * on a case or an approval. The app's QueryClient does not refetch on mount, so these two reads
 * opt in (as `useGetMyApprovals` does): returning to `/` or `/requests` always fetches current
 * figures and statuses, while the cached data paints first.
 */
export function portalHomeOptions(portalUserId: string, project?: string) {
  return {
    queryKey: ["portal", portalUserId, "home", project ?? null],
    queryFn: () => getPortalHome(project),
  };
}

export function usePortalHome(
  portalUserId: string,
  project?: string,
  prefetched = false,
) {
  return useQuery({
    ...portalHomeOptions(portalUserId, project),
    refetchOnMount: prefetched ? false : "always",
  });
}

export function portalCasesOptions(
  portalUserId: string,
  query: PortalCaseQuery,
) {
  return {
    queryKey: ["portal", portalUserId, "cases", query],
    queryFn: () => getPortalCases(query),
  };
}

export function usePortalCases(
  portalUserId: string,
  query: PortalCaseQuery,
  {
    enabled = true,
    prefetched = false,
  }: { enabled?: boolean; prefetched?: boolean } = {},
) {
  return useQuery({
    ...portalCasesOptions(portalUserId, query),
    enabled,
    placeholderData: keepPreviousData,
    refetchOnMount: prefetched ? false : "always",
  });
}

/**
 * Called by every portal mutation that changes a case or an approval. `refetchType: "all"`
 * refetches every cached dashboard figure, case list and project count (the project cards, the
 * Projects list, Project Details and the top-bar selector) now, mounted or not, so the next visit
 * paints current data instead of the figures from before the action.
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
    queryClient.invalidateQueries({
      queryKey: portalProjectKeys.all,
      refetchType: "all",
    }),
  ]);
}
