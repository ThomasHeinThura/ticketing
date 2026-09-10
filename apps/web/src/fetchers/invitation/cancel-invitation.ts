import { client } from "@taskdesk/libs";

// S6a (issue #6, retrofit plan §3): native replacement for
// authClient.organization.cancelInvitation().
// DELETE /api/invitation/{id}, not workspace-scoped in the URL -- the
// server resolves the owning workspace from the invitation id itself
// (apps/api/src/utils/require-invitation-workspace-access.ts) and checks the
// caller's authority against it.
const cancelInvitation = async (invitationId: string) => {
  const response = await client.invitation[":id"].$delete({
    param: { id: invitationId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to cancel invitation");
  }

  return await response.json();
};

export default cancelInvitation;
