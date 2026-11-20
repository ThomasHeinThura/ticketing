import { useMutation, useQueryClient } from "@tanstack/react-query";
import { refreshSettingsHistory } from "@/components/settings/refresh-settings-history";
import updateWorkspaceMemberRole from "@/fetchers/workspace-user/update-workspace-member-role";
import { authClient } from "@/lib/auth-client";
import { profileSessionGuard } from "@/lib/profile-session-guard";

type UpdateWorkspaceUserRoleRequest = {
  workspaceId: string;
  userId: string;
  role: string;
  workspaceMemberId: string | null;
};

// S5 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.updateMemberRole() -- PATCH
// /api/workspace/{workspaceId}/members/{userId}/role, keyed by the target's
// own user id rather than the plugin's `workspace_member.id` row. See
// update-workspace-member-role.ts (the fetcher) for the server's refusal
// rules around the `"owner"` role.
function useUpdateWorkspaceUserRole() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  return useMutation({
    mutationFn: async ({
      workspaceMemberId,
      ...request
    }: UpdateWorkspaceUserRoleRequest) => {
      const userId = session?.user?.id;
      const sessionId = session?.session?.id;
      const result = await updateWorkspaceMemberRole(request);
      if (workspaceMemberId && userId && sessionId)
        refreshSettingsHistory(
          queryClient,
          [
            "settings-history",
            "workspace_member",
            workspaceMemberId,
            "agent",
            userId,
            sessionId,
          ],
          profileSessionGuard(userId, sessionId),
        );
      return result;
    },
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
