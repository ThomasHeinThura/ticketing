import { useMutation, useQueryClient } from "@tanstack/react-query";
import withdrawApproval from "@/fetchers/approval/withdraw-approval";

function useWithdrawApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: withdrawApproval,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["work-items"] }),
      ]);
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

export default useWithdrawApproval;
