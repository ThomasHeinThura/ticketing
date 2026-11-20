import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type SlaPolicyPatch, updateSlaPolicy } from "@/fetchers/sla-policy";
import { auditEntity } from "@/query-client/audit-invalidation";

export function useUpdateSlaPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      version: number;
      data: SlaPolicyPatch;
    }) => updateSlaPolicy(input),
    meta: {
      audits: {
        targets: (_: unknown, r: { id: string; workspaceId: string }) =>
          auditEntity("sla_policy", r.id, {
            kind: "workspace",
            workspaceId: r.workspaceId,
          }),
      },
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["sla-policy", updated.id], updated);
      void queryClient.invalidateQueries({
        queryKey: ["sla-policies", updated.workspaceId],
      });
    },
  });
}
