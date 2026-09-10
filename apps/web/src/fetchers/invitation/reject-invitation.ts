import { client } from "@taskdesk/libs";

// S6a (issue #6, retrofit plan §3): native replacement for
// authClient.organization.rejectInvitation(). Stored server-side as status
// "canceled" (apps/api/src/invitation/controllers/reject-invitation.ts) --
// this app's status vocabulary has no separate "rejected" value.
const rejectInvitation = async (invitationId: string) => {
  const response = await client.invitation[":id"].reject.$post({
    param: { id: invitationId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to reject invitation");
  }

  return await response.json();
};

export default rejectInvitation;
