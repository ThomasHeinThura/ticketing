import { and, eq } from "drizzle-orm";
import db from "../../database";
import { invitationTable } from "../../database/schema";

/**
 * A workspace's invitations that are still `status = "pending"` --
 * expired or not.
 *
 * Issue #160 (found in Opus security review of PR #158, the invitation
 * ceiling): this used to also require `expiresAt > now`, matching
 * `getUserPendingInvitations`'s vocabulary (`apps/api/src/invitation/
 * controllers/get-user-pending-invitations.ts`). That is the right
 * filter for THAT route -- it lists invitations from the INVITEE's side,
 * who can only usefully act on one that hasn't expired. This route lists
 * them from the WORKSPACE side, where the relevant question is different:
 * "which rows still hold `status = 'pending'` and so still count against
 * this workspace, and can an admin do anything about them?" `status`
 * never transitions to anything on expiry by itself (`R9`, no vocabulary
 * drift on `invitation.status`) -- an expired invitation is still a
 * `pending` row until something explicitly cancels it, and the only
 * still-mounted route that could ever cancel one is
 * `DELETE /api/invitation/{id}` (`cancel-invitation.ts`), which itself
 * only checks `status = "pending"`, never expiry.
 *
 * Filtering by expiry here meant an expired-but-uncanceled invitation
 * still counted toward `MAX_PENDING_INVITATIONS_PER_WORKSPACE` (it
 * deliberately counts every `pending` row, expired or not -- otherwise
 * the cap is dodgeable) while being invisible to the only native route
 * that could find its id to cancel it. Before S10, the still-mounted
 * `organization()` plugin's OWN unfiltered `list-invitations` route was
 * the (accidental) recovery path; S10 removes that route entirely, so
 * this is the last one left. The caller already gets `expiresAt` back on
 * every row and can render "expired" however it likes (see
 * `members-table.tsx`) -- dropping the filter costs nothing in either
 * data returned or authorization, since this route was already gated on
 * workspace access, not on any individual invitation's expiry.
 *
 * Shared by both the dedicated `GET /{workspaceId}/invitations` route and
 * the compound `GET /{workspaceId}` view (S2, issue #6) so the two never
 * drift apart.
 */
async function getWorkspaceInvitations(workspaceId: string) {
  return db
    .select({
      id: invitationTable.id,
      email: invitationTable.email,
      role: invitationTable.role,
      status: invitationTable.status,
      expiresAt: invitationTable.expiresAt,
      createdAt: invitationTable.createdAt,
      inviterId: invitationTable.inviterId,
    })
    .from(invitationTable)
    .where(
      and(
        eq(invitationTable.workspaceId, workspaceId),
        eq(invitationTable.status, "pending"),
      ),
    );
}

export default getWorkspaceInvitations;
