import { and, eq, gt } from "drizzle-orm";
import db from "../../database";
import { invitationTable } from "../../database/schema";

/**
 * A workspace's pending, unexpired invitations. Same vocabulary as
 * `getUserPendingInvitations` (`apps/api/src/invitation/controllers/
 * get-user-pending-invitations.ts`): `status = "pending"` AND
 * `expiresAt > now`. An invitation whose status was ever flipped to
 * `accepted`/`canceled`, or whose expiry has passed, is not "pending" and
 * is not returned here -- `R9` (no vocabulary drift on `invitation.status`).
 *
 * Shared by both the dedicated `GET /{workspaceId}/invitations` route and
 * the compound `GET /{workspaceId}` view (S2, issue #6) so the two never
 * drift apart.
 */
async function getWorkspaceInvitations(workspaceId: string) {
  const now = new Date();

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
        gt(invitationTable.expiresAt, now),
      ),
    );
}

export default getWorkspaceInvitations;
