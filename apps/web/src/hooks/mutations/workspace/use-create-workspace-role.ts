import { useMutation, useQueryClient } from "@tanstack/react-query";
import createWorkspaceRole from "@/fetchers/workspace/create-workspace-role";

type CreateWorkspaceRoleRequest = {
  workspaceId: string;
  role: string;
  permission: Record<string, string[]>;
};

// S7 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.createRole(). Same request shape, same cache
// invalidation.
function useCreateWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      role,
      permission,
    }: CreateWorkspaceRoleRequest) => {
      return createWorkspaceRole({ workspaceId, role, permission });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-roles", variables.workspaceId],
      });
    },
  });
}

export default useCreateWorkspaceRole;
