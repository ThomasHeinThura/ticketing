import { useQuery } from "@tanstack/react-query";
import getWorkItemApprovals from "@/fetchers/approval/get-work-item-approvals";

/**
 * Approvals change from outside this page (an approver decides, an approval expires), so
 * the list is refetched every time the detail mounts instead of trusting the app-wide
 * `refetchOnMount: false` default.
 */
function useGetWorkItemApprovals({
  key,
  enabled = true,
}: {
  key: string | undefined;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["approvals", "work-item", key],
    queryFn: () => getWorkItemApprovals(key as string),
    enabled: enabled && !!key,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetWorkItemApprovals;
