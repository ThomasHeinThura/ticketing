import { client } from "@taskdesk/libs";

// S6a (issue #6, retrofit plan §3): native replacement for
// authClient.organization.acceptInvitation(). Atomic on the server
// (apps/api/src/invitation/controllers/accept-invitation.ts) and refuses a
// caller who is already a member of the workspace (issue #88) -- this
// client no longer has any duplicate-membership possibility to guard
// against.
const acceptInvitation = async (invitationId: string) => {
  const response = await client.invitation[":id"].accept.$post({
    param: { id: invitationId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to accept invitation");
  }

  return await response.json();
};

export default acceptInvitation;
