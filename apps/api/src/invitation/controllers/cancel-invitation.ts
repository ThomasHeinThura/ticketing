import { resolveIdentity } from "../../permissions/resolve-identity";
import { cancelPendingInvitation, findInvitationStatus } from "../repository";
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
} from "./invitation-action-errors";

export type CanceledInvitation = {
  id: string;
  status: string;
};

/**
 * Cancel a pending invitation. Native replacement for
 * `authClient.organization.cancelInvitation()` (retrofit plan §3, S6a row).
 *
 * The caller's OWN authority to cancel (workspace membership plus the
 * inherited `invitation:cancel` permission) is checked by
 * `requireWorkspaceMembership`/`requireWorkspacePermission`/
 * `requireWorkspaceRoleAuthority` in `apps/api/src/invitation/index.ts`,
 * ahead of this function -- same shape as every S5 membership write's
 * "middleware checks who, the controller checks what". This function only
 * enforces that the invitation is still cancelable.
 *
 * A conditional `UPDATE ... WHERE status = 'pending'`, same reasoning as
 * `reject-invitation.ts`: cancelling never touches `workspace_member`, so
 * there is no membership race for an advisory lock to close, and the `WHERE`
 * clause alone makes this atomic against a concurrent accept/reject/cancel
 * of the same invitation.
 */
async function cancelInvitation(
  invitationId: string,
  callerId: string,
): Promise<CanceledInvitation> {
  const identity = await resolveIdentity({
    userId: callerId,
    credential: "session",
  });
  if (!identity) throw new InvitationNotFoundError();

  const invitation = await findInvitationStatus(identity, invitationId);
  if (!invitation) {
    throw new InvitationNotFoundError();
  }
  if (invitation.status !== "pending") {
    throw new InvitationNotPendingError();
  }

  const updated = await cancelPendingInvitation(identity, invitationId);

  if (!updated) {
    // Lost the race to a concurrent accept/cancel/reject between the read
    // above and this write.
    const current = await findInvitationStatus(identity, invitationId);
    if (!current) throw new InvitationNotFoundError();
    throw new InvitationNotPendingError();
  }

  return { id: updated.id, status: "canceled" };
}

export default cancelInvitation;
