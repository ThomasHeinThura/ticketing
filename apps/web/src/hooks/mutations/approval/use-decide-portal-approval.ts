import { useMutation, useQueryClient } from "@tanstack/react-query";
import decidePortalApproval from "@/fetchers/approval/decide-portal-approval";

function useDecidePortalApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: decidePortalApproval,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["approvals", "portal"],
      });
    },
  });
}

export default useDecidePortalApproval;
