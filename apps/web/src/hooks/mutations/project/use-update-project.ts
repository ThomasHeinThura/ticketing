import { useMutation } from "@tanstack/react-query";
import {
  type UpdateProjectRequest,
  updateProjectForSession,
} from "@/fetchers/project/update-project";
import type { HistoryTarget } from "@/hooks/queries/settings/use-settings-history";
import { authClient } from "@/lib/auth-client";

function useUpdateProject() {
  const { data: session } = authClient.useSession();
  return useMutation({
    mutationFn: async (variables: UpdateProjectRequest) => {
      const sessionId = session?.session?.id;
      if (!sessionId) throw new Error("Project save cancelled: no session");
      return updateProjectForSession(variables, sessionId);
    },
    meta: {
      audits: {
        targets: (
          variables: UpdateProjectRequest,
          result: { workspaceId: string },
        ): HistoryTarget[] => [
          {
            kind: "entity",
            type: "project",
            id: variables.id,
            scope: {
              kind: "project",
              workspaceId: result.workspaceId,
              projectId: variables.id,
            },
          },
        ],
      },
    },
  });
}

export default useUpdateProject;
