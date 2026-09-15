import { and, eq } from "drizzle-orm";
import db, { schema } from "../../database";
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
): Promise<CanceledInvitation> {
  const [invitation] = await db
    .select({
      id: schema.invitationTable.id,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  if (!invitation) {
    throw new InvitationNotFoundError();
  }
  if (invitation.status !== "pending") {
    throw new InvitationNotPendingError();
  }

  const [updated] = await db
    .update(schema.invitationTable)
    .set({ status: "canceled" })
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        eq(schema.invitationTable.status, "pending"),
      ),
    )
    .returning({ id: schema.invitationTable.id });

  if (!updated) {
    // Lost the race to a concurrent accept/cancel/reject between the read
    // above and this write.
    throw new InvitationNotPendingError();
  }

  return { id: updated.id, status: "canceled" };
}

export default cancelInvitation;
