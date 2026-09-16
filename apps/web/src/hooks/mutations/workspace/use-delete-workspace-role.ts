import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteWorkspaceRole from "@/fetchers/workspace/delete-workspace-role";

type DeleteWorkspaceRoleRequest = {
  workspaceId: string;
  /**
   * S7 (issue #6, retrofit plan §3): the role's opaque id, NOT its name --
   * same `roleName` -> `roleId` change as use-update-workspace-role.ts.
   */
  roleId: string;
};

function useDeleteWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, roleId }: DeleteWorkspaceRoleRequest) => {
      return deleteWorkspaceRole({ workspaceId, roleId });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-roles", variables.workspaceId],
      });
    },
  });
}

export default useDeleteWorkspaceRole;
