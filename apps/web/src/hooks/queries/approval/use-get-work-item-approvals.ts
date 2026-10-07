import { useQuery } from "@tanstack/react-query";
import getWorkItemApprovals from "@/fetchers/approval/get-work-item-approvals";

function useGetWorkItemApprovals({
  key,
  enabled,
}: {
  key: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ["approvals", "work-item", key],
    queryFn: () => getWorkItemApprovals(key),
    enabled,
  });
}

export default useGetWorkItemApprovals;
