import { useMutation } from "@tanstack/react-query";
import {
  type UpdateProjectRequest,
  updateProjectForSession,
} from "@/fetchers/project/update-project";
import { authClient } from "@/lib/auth-client";

function useUpdateProject() {
  const { data: session } = authClient.useSession();
  return useMutation({
    mutationFn: (variables: UpdateProjectRequest) => {
      const sessionId = session?.session?.id;
      if (!sessionId) throw new Error("Project save cancelled: no session");
      return updateProjectForSession(variables, sessionId);
    },
  });
}

export default useUpdateProject;
