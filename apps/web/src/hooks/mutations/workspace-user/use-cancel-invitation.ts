import { useMutation } from "@tanstack/react-query";
import cancelInvitation from "@/fetchers/invitation/cancel-invitation";

type CancelInvitationRequest = {
  invitationId: string;
  workspaceId: string;
};

/**
 * Requests invitation cancellation (`202` pending action). The invitation stays listed
 * until the requester approves the action, so no list is invalidated here.
 */
function useCancelInvitation() {
  return useMutation({
    mutationFn: ({ invitationId }: CancelInvitationRequest) =>
      cancelInvitation(invitationId),
  });
}

export default useCancelInvitation;
