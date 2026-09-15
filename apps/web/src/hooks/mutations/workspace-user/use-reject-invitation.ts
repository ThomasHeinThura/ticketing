import { useMutation } from "@tanstack/react-query";
import rejectInvitation from "@/fetchers/invitation/reject-invitation";

type RejectInvitationRequest = {
  invitationId: string;
};

// S6a (issue #6, retrofit plan §3): native replacement for
// authClient.organization.rejectInvitation() -- see
// apps/web/src/fetchers/invitation/reject-invitation.ts.
function useRejectInvitation() {
  return useMutation({
    mutationFn: async ({ invitationId }: RejectInvitationRequest) => {
      return rejectInvitation(invitationId);
    },
  });
}

export default useRejectInvitation;
