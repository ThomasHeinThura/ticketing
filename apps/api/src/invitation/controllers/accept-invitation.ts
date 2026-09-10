import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import { WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE } from "../../workspace/controllers/workspace-membership-lock";
import {
  AlreadyWorkspaceMemberError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationNotPendingError,
  NotInvitationRecipientError,
} from "./invitation-action-errors";

export type AcceptedInvitation = {
  invitation: {
    id: string;
    workspaceId: string;
    email: string;
    role: string | null;
    status: string;
  };
  member: {
    workspaceId: string;
    userId: string;
    role: string;
  };
};

/**
 * Accept an invitation. Native replacement for
 * `authClient.organization.acceptInvitation()` (retrofit plan §3, S6a row).
 *
 * ATOMIC, AND REFUSES A DUPLICATE -- THIS IS ISSUE #88's FIX AT SOURCE.
 * better-auth's own `acceptInvitation` (`crud-invites.mjs`) calls
 * `adapter.createMember(...)` unconditionally: no existing-member check, no
 * lock. Invite an email that is already a member (or that gets added through
 * the native `add-workspace-member` route while its OWN invitation is still
 * pending) and accepting produces a SECOND `workspace_member` row for the
 * same `(workspace_id, user_id)` pair -- `workspace-member-roles.ts`'s doc
 * comment names this as the exact reachability proof for why that table has
 * no unique constraint to lean on.
 *
 * Reads the invitation TWICE, deliberately. The first read (outside any
 * lock) exists only to learn which workspace's advisory lock to take --
 * `WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE`, the SAME namespace every S5
 * membership write and `inviteWorkspaceMember` use, so this accept, a
 * concurrent `addWorkspaceMember`, and a concurrent second accept for the
 * same workspace all serialize against each other. The second read, taken
 * AFTER the lock is held, is the one every check below is against -- status,
 * expiry, recipient match, and the existing-membership check that is this
 * function's whole reason to exist. A lock taken on stale data protects
 * nothing.
 */
async function acceptInvitation(
  invitationId: string,
  callerId: string,
  callerEmail: string,
): Promise<AcceptedInvitation> {
  const [pre] = await db
    .select({ workspaceId: schema.invitationTable.workspaceId })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  if (!pre) {
    throw new InvitationNotFoundError();
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE}, hashtext(${pre.workspaceId}))`,
    );

    const [invitation] = await tx
      .select({
        id: schema.invitationTable.id,
        workspaceId: schema.invitationTable.workspaceId,
        email: schema.invitationTable.email,
        role: schema.invitationTable.role,
        status: schema.invitationTable.status,
        expiresAt: schema.invitationTable.expiresAt,
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
    if (invitation.expiresAt < new Date()) {
      throw new InvitationExpiredError();
    }

    // THE #88 FIX. Checked inside the SAME lock/transaction as the insert
    // below, not before it -- a check-then-write outside the lock is exactly
    // the race shape `workspace-membership-lock.ts` documents for every other
    // membership write.
    const [existingMember] = await tx
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, invitation.workspaceId),
          eq(schema.workspaceUserTable.userId, callerId),
        ),
      )
      .limit(1);
    if (existingMember) {
      throw new AlreadyWorkspaceMemberError();
    }

    const role = invitation.role ?? "member";
    const now = new Date();

    await tx
      .update(schema.invitationTable)
      .set({ status: "accepted" })
      .where(eq(schema.invitationTable.id, invitationId));

    await tx.insert(schema.workspaceUserTable).values({
      workspaceId: invitation.workspaceId,
      userId: callerId,
      role,
      joinedAt: now,
    });

    return {
      invitation: {
        id: invitation.id,
        workspaceId: invitation.workspaceId,
        email: invitation.email,
        role: invitation.role,
        status: "accepted",
      },
      member: {
        workspaceId: invitation.workspaceId,
        userId: callerId,
        role,
      },
    };
  });
}

export default acceptInvitation;
