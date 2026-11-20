import { useMutation } from "@tanstack/react-query";
import createProjectState from "@/fetchers/project/create-project-state";

function useCreateProjectState() {
  return useMutation({
    mutationFn: (
      variables: Parameters<typeof createProjectState>[0] & {
        workspaceId: string;
      },
    ) => createProjectState(variables),
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

export default useCreateProjectState;
