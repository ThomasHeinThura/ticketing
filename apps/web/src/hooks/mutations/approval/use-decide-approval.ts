import { useMutation, useQueryClient } from "@tanstack/react-query";
import decideApproval from "@/fetchers/approval/decide-approval";

function useDecideApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: decideApproval,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["work-items"] }),
      ]);
    },
  });
}

export default useDecideApproval;
