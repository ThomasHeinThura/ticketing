import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
} from "@/fetchers/project-member/project-members";

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
export const useUpdateProjectMemberRole = () =>
  useRosterMutation(updateProjectMemberRole);
export const useRemoveProjectMember = () =>
  useRosterMutation(removeProjectMember);
