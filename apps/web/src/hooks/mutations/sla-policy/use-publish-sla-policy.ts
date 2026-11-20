import { useMutation, useQueryClient } from "@tanstack/react-query";
import { publishSlaPolicy } from "@/fetchers/sla-policy";
import { auditEntity } from "@/query-client/audit-invalidation";

export function usePublishSlaPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      publishSlaPolicy(input),
    meta: {
      audits: {
        targets: (_: unknown, r: { id: string; workspaceId: string }) =>
          auditEntity("sla_policy", r.id, {
            kind: "workspace",
            workspaceId: r.workspaceId,
          }),
      },
    },
    onSuccess: (published) => {
      queryClient.setQueryData(["sla-policy", published.id], published);
      void queryClient.invalidateQueries({
        queryKey: ["sla-policies", published.workspaceId],
      });
    },
  });
}
