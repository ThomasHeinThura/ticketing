import { useMutation, useQueryClient } from "@tanstack/react-query";
import { publishSlaPolicy } from "@/fetchers/sla-policy";

export function usePublishSlaPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      publishSlaPolicy(input),
    onSuccess: (published) => {
      queryClient.setQueryData(["sla-policy", published.id], published);
      void queryClient.invalidateQueries({
        queryKey: ["sla-policies", published.workspaceId],
      });
    },
  });
}
