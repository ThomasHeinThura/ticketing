import { useMutation } from "@tanstack/react-query";
import acceptInvitation from "@/fetchers/invitation/accept-invitation";

type AcceptInvitationRequest = {
  invitationId: string;
};

// S6a (issue #6, retrofit plan §3): native replacement for
// authClient.organization.acceptInvitation() -- see
// apps/web/src/fetchers/invitation/accept-invitation.ts. The response
// shape's `invitation.workspaceId` replaces the plugin response's
// `invitation.organizationId` -- callers that used to read the latter to
// feed `authClient.organization.setActive({ organizationId })` now read
// `data.invitation.workspaceId` instead.
function useAcceptInvitation() {
  return useMutation({
    mutationFn: async ({ invitationId }: AcceptInvitationRequest) => {
      return acceptInvitation(invitationId);
    },
  });
}

export default useAcceptInvitation;
