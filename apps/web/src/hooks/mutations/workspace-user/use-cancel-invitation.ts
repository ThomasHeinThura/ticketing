import { useMutation } from "@tanstack/react-query";
import cancelInvitation from "@/fetchers/invitation/cancel-invitation";
import queryClient from "@/query-client";

type CancelInvitationRequest = {
  invitationId: string;
  workspaceId: string;
};

// S6a (issue #6, retrofit plan §3): native replacement for
// authClient.organization.cancelInvitation() -- see
// apps/web/src/fetchers/invitation/cancel-invitation.ts.
function useCancelInvitation() {
  return useMutation({
    mutationFn: async ({ invitationId }: CancelInvitationRequest) => {
      return cancelInvitation(invitationId);
    },
    onSuccess: (_, { workspaceId }) => {
      // Invalidate all workspace-related queries
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace-users", workspaceId],
      });

      // Also invalidate the broader workspace query
      queryClient.invalidateQueries({
        queryKey: ["workspace"],
      });
    },
  });
}

export default useCancelInvitation;
