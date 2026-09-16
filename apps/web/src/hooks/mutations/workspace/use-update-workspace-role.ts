import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateWorkspaceRole from "@/fetchers/workspace/update-workspace-role";

type UpdateWorkspaceRoleRequest = {
  workspaceId: string;
  /**
   * S7 (issue #6, retrofit plan §3): the role's opaque id, NOT its name --
   * changed from `roleName` when this hook was repointed off
   * authClient.organization.updateRole() onto the native route, which keys
   * on `roleId` (S7 blueprint Ambiguity Q1). Every call site must pass the
   * row's `id` (already in hand from useWorkspaceRoles), not `role`.
   */
  roleId: string;
  permission: Record<string, string[]>;
};

function useUpdateWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      roleId,
      permission,
    }: UpdateWorkspaceRoleRequest) => {
      return updateWorkspaceRole({ workspaceId, roleId, permission });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-roles", variables.workspaceId],
      });
      // The role's permission set just changed, so any cached capability
      // map for members assigned to this role is now stale.
      queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", variables.workspaceId],
      });
    },
  });
}

export default useUpdateWorkspaceRole;
