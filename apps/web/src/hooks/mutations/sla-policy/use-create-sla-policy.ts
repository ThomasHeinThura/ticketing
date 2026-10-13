import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSlaPolicy, type SlaPolicyInput } from "@/fetchers/sla-policy";

export function useCreateSlaPolicy(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SlaPolicyInput) => createSlaPolicy(workspaceId, input),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: ["sla-policies", created.workspaceId],
      });
      queryClient.setQueryData(["sla-policy", created.id], created);
    },
  });
}
