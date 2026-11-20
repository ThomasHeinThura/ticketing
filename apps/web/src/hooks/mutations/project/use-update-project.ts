import { useMutation, useQueryClient } from "@tanstack/react-query";
import { refreshSettingsHistory } from "@/components/settings/refresh-settings-history";
import {
  type UpdateProjectRequest,
  updateProjectForSession,
} from "@/fetchers/project/update-project";
import { authClient } from "@/lib/auth-client";
import { profileSessionGuard } from "@/lib/profile-session-guard";

function useUpdateProject() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  return useMutation({
    mutationFn: async (variables: UpdateProjectRequest) => {
      const sessionId = session?.session?.id;
      const userId = session?.user?.id;
      if (!sessionId) throw new Error("Project save cancelled: no session");
      const result = await updateProjectForSession(variables, sessionId);
      if (userId)
        refreshSettingsHistory(
          queryClient,
          [
            "settings-history",
            "project",
            variables.id,
            "agent",
            userId,
            sessionId,
          ],
          profileSessionGuard(userId, sessionId),
        );
      return result;
    },
  });
}

export default useUpdateProject;
