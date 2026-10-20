import { useMutation, useQueryClient } from "@tanstack/react-query";
import createApproval from "@/fetchers/approval/create-approval";

function useCreateApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createApproval,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({
        queryKey: ["work-items", "transitions"],
      });
    },
  });
}

export default useCreateApproval;
