import { useMutation } from "@tanstack/react-query";
import inviteWorkspaceMember from "@/fetchers/workspace/invite-workspace-member";
import queryClient from "@/query-client";

type InviteWorkspaceUserRequest = {
  workspaceId: string;
  email: string;
  role: "admin" | "member" | "owner";
  resend?: boolean;
};

// S6a (issue #6, retrofit plan §3): native replacement for
// authClient.organization.inviteMember() -- see
// apps/web/src/fetchers/workspace/invite-workspace-member.ts.
function useInviteWorkspaceUser() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      email,
      role,
      resend,
    }: InviteWorkspaceUserRequest) => {
      return inviteWorkspaceMember({ workspaceId, email, role, resend });
    },
    onSuccess: (_, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace-users", workspaceId],
      });
    },
  });
}

export default useInviteWorkspaceUser;
