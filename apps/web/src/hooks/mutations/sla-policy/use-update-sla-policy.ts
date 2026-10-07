import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type SlaPolicyPatch, updateSlaPolicy } from "@/fetchers/sla-policy";

export function useUpdateSlaPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      version: number;
      data: SlaPolicyPatch;
    }) => updateSlaPolicy(input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["sla-policy", updated.id], updated);
      void queryClient.invalidateQueries({
        queryKey: ["sla-policies", updated.workspaceId],
      });
    },
  });
}
