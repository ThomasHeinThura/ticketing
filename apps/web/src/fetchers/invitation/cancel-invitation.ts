import { client } from "@taskdesk/libs";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

// DELETE /api/invitation/{id}, not workspace-scoped in the URL -- the server resolves the
// owning workspace from the invitation id itself
// (apps/api/src/utils/require-invitation-workspace-access.ts) and checks the caller's
// authority against it. Cancelling is requested here and completed only when the requester
// approves the pending action.
const cancelInvitation = async (invitationId: string) => {
  const response = await client.invitation[":id"].$delete({
    param: { id: invitationId },
  });
  return readPendingDeletion(response, "Failed to cancel invitation");
};

export default cancelInvitation;
