import { and, eq } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  NotInvitationRecipientError,
} from "./invitation-action-errors";

export type RejectedInvitation = {
  id: string;
  status: string;
};

/**
 * Reject an invitation. Native replacement for
 * `authClient.organization.rejectInvitation()` (retrofit plan §3, S6a row).
 *
 * STATUS `"canceled"`, NOT `"rejected"` -- deliberate, and a departure from
 * better-auth's own `rejectInvitation` (`crud-invites.mjs`, which sets
 * `status: "rejected"`). This app's `status` vocabulary is, and must stay,
 * exactly `pending` / `accepted` / `canceled`
 * (`apps/api/src/utils/check-registration-allowed.ts:67,158-159`,
 * retrofit plan §3, S6a row: "keep... the `status` vocabulary... byte-
 * identical"). `getInvitationDetails` in that file branches on `"accepted"`
 * and `"canceled"` only -- a `"rejected"` row would satisfy NEITHER branch
 * and fall through to `valid: true`, reporting a declined invitation as
 * still acceptable. Nothing in this codebase ever reads or writes
 * `"rejected"` (confirmed by grep across `apps/api/src`, `apps/web/src` and
 * `tests/`); it is purely an artifact of the still-mounted plugin's own
 * route, which this one does not call. Using `"canceled"` here keeps a
 * rejected invitation indistinguishable, to every existing reader, from a
 * canceled one -- both are "no longer available, not because it was used".
 *
 * A conditional `UPDATE ... WHERE status = 'pending'` rather than a
 * transaction with an advisory lock: rejecting never touches
 * `workspace_member`, so there is no membership race to close the way
 * `acceptInvitation` and `cancelInvitation` (which touch or contend with
 * that table) need to. The `WHERE` clause is still what makes this atomic
 * against a concurrent accept/cancel of the SAME invitation -- whichever
 * commits first wins, and the loser's `UPDATE` matches zero rows.
 */
async function rejectInvitation(
  invitationId: string,
  callerEmail: string,
): Promise<RejectedInvitation> {
  const [invitation] = await db
    .select({
      id: schema.invitationTable.id,
      email: schema.invitationTable.email,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  if (!invitation) {
    throw new InvitationNotFoundError();
  }
  if (invitation.email.toLowerCase() !== callerEmail.toLowerCase()) {
    throw new NotInvitationRecipientError();
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

export default rejectInvitation;
