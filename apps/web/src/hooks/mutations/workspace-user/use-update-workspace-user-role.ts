import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateWorkspaceMemberRole from "@/fetchers/workspace-user/update-workspace-member-role";

type UpdateWorkspaceUserRoleRequest = {
  workspaceId: string;
  userId: string;
  role: string;
};

// S5 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.updateMemberRole() -- PATCH
// /api/workspace/{workspaceId}/members/{userId}/role, keyed by the target's
// own user id rather than the plugin's `workspace_member.id` row. See
// update-workspace-member-role.ts (the fetcher) for the server's refusal
// rules around the `"owner"` role.
function useUpdateWorkspaceUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateWorkspaceUserRoleRequest) =>
      updateWorkspaceMemberRole(request),
    onSuccess: (_data, variables) => {
      // The members page reads from useGetFullWorkspace which keys by
      // ["workspace", "full", workspaceId], so invalidate that exact prefix
      // so the table re-renders with the new role.
      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-users", variables.workspaceId],
      });
      // useGetActiveWorkspaceUser is keyed ["workspace-user", "active", ...]
      // and drives sidebar/role badges for the current user.
      queryClient.invalidateQueries({
        queryKey: ["workspace-user", "active"],
      });
      // The active user's role may have changed; capability cache is keyed
      // by (workspaceId, role) so we drop the per-workspace cache.
      queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", variables.workspaceId],
      });
    },
  });
}

export default useUpdateWorkspaceUserRole;
