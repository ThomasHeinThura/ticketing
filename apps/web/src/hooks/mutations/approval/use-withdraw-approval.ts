import { useMutation, useQueryClient } from "@tanstack/react-query";
import withdrawApproval from "@/fetchers/approval/withdraw-approval";

/**
 * Settles by refetching approvals on success AND failure: a 409 (already terminal) or a
 * 403/404 (authority or reach changed) means the list on screen is stale, so the next
 * render must show the server's current state rather than an affordance that no longer
 * applies.
 */
function useWithdrawApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: withdrawApproval,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  });
}

export default useWithdrawApproval;
