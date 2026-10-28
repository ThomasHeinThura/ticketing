import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requestApproval } from "@/fetchers/approval/request-approval";
export default function useRequestApproval() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: requestApproval,
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ["approvals"] });
      void cache.invalidateQueries({ queryKey: ["work-items", "transitions"] });
    },
  });
}
