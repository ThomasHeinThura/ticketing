import { useMutation } from "@tanstack/react-query";
import updateProjectState from "@/fetchers/project/update-project-state";

function useUpdateProjectState() {
  return useMutation({
    mutationFn: (
      variables: Parameters<typeof updateProjectState>[0] & {
        workspaceId: string;
      },
    ) => updateProjectState(variables),
    meta: {
      audits: {
        targets: ({
          workspaceId,
          projectId,
        }: {
          workspaceId: string;
          projectId: string;
        }) => [
          {
            kind: "entity" as const,
            type: "project" as const,
            id: projectId,
            scope: { kind: "project" as const, workspaceId, projectId },
          },
        ],
      },
    },
  });
}

export default useUpdateProjectState;
