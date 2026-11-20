import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateLabel from "@/fetchers/label/update-label";
import { auditEntity } from "@/query-client/audit-invalidation";

function useUpdateLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateLabel,
    meta: {
      audits: {
        targets: (_: unknown, l: { id: string; workspaceId: string | null }) =>
          l.workspaceId
            ? auditEntity("workspace_label", l.id, {
                kind: "workspace",
                workspaceId: l.workspaceId,
              })
            : [],
      },
    },
    onSuccess: (_updatedLabel) => {
      void queryClient.invalidateQueries({
        queryKey: ["labels"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["tasks"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["task"],
      });
    },
  });
}

export default useUpdateLabel;
