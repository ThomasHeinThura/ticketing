import { useMutation, useQueryClient } from "@tanstack/react-query";
import decideApproval from "@/fetchers/approval/decide-approval";

/** A decision can unblock a transition, so approvals and transitions both refetch. */
function useDecideApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: decideApproval,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({
        queryKey: ["work-items", "transitions"],
      });
    },
  });
}

export default useDecideApproval;
