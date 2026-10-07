import { useQuery } from "@tanstack/react-query";
import getPortalApprovals from "@/fetchers/approval/get-portal-approvals";

function useGetPortalApprovals() {
  return useQuery({
    queryKey: ["approvals", "portal"],
    queryFn: getPortalApprovals,
  });
}

export default useGetPortalApprovals;
