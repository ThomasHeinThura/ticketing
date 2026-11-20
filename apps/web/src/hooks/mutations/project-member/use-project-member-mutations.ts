import { useMutation, useQueryClient } from "@tanstack/react-query";
import { refreshSettingsHistory } from "@/components/settings/refresh-settings-history";
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
} from "@/fetchers/project-member/project-members";
import { authClient } from "@/lib/auth-client";
import { profileSessionGuard } from "@/lib/profile-session-guard";

/** Every roster write answers with the updated roster; the roster, the candidate list and the
 * project's assignable people (AS-5) all depend on it. */
function useRosterMutation<Variables extends { projectId: string }>(
  mutationFn: (variables: Variables) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "members"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "assignable"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["workspace-capabilities"],
        }),
      ]);
    },
  });
}

export const useAddProjectMember = () => useRosterMutation(addProjectMember);
export const useUpdateProjectMemberRole = () => {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  return useRosterMutation(
    async ({
      membershipId,
      ...request
    }: Parameters<typeof updateProjectMemberRole>[0] & {
      membershipId: string | null;
    }) => {
      const userId = session?.user?.id;
      const sessionId = session?.session?.id;
      const result = await updateProjectMemberRole(request);
      if (membershipId && userId && sessionId)
        refreshSettingsHistory(
          queryClient,
          [
            "settings-history",
            "project_membership",
            membershipId,
            "agent",
            userId,
            sessionId,
          ],
          profileSessionGuard(userId, sessionId),
        );
      return result;
    },
  );
};
export const useRemoveProjectMember = () =>
  useRosterMutation(removeProjectMember);
