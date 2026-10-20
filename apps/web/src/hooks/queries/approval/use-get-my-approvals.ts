import { useQuery } from "@tanstack/react-query";
import getMyApprovals from "@/fetchers/approval/get-my-approvals";

/** Keyed under `approvals` so every approval mutation's invalidation refreshes it. */
function useGetMyApprovals({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["approvals", "me"],
    queryFn: getMyApprovals,
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export default useGetMyApprovals;
