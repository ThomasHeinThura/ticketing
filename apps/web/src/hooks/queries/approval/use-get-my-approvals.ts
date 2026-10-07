import { useQuery } from "@tanstack/react-query";
import getMyApprovals from "@/fetchers/approval/get-my-approvals";

function useGetMyApprovals() {
  return useQuery({
    queryKey: ["approvals", "me"],
    queryFn: getMyApprovals,
  });
}

export default useGetMyApprovals;
