import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSlaPolicy, type SlaPolicyInput } from "@/fetchers/sla-policy";
import { auditEntity } from "@/query-client/audit-invalidation";

export function useCreateSlaPolicy(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SlaPolicyInput) => createSlaPolicy(workspaceId, input),
    meta: {
      audits: {
        targets: (_: unknown, r: { id: string; workspaceId: string }) =>
          auditEntity("sla_policy", r.id, {
            kind: "workspace",
            workspaceId: r.workspaceId,
          }),
      },
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: ["sla-policies", created.workspaceId],
      });
      queryClient.setQueryData(["sla-policy", created.id], created);
    },
  });
}
