import { eq } from "drizzle-orm";
import db, { schema } from "../../database";
import { WorkspaceRoleNotFoundError } from "../../workspace/controllers/workspace-membership-errors";
import { lockWorkspaceRoleAssignment } from "../../workspace/controllers/workspace-role-assignment-lock";
import {
  getInvitationForAcceptance,
  getInvitationWorkspace,
  getWorkspaceMember,
  getWorkspaceRoleId,
} from "../repository";
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
 * the shared membership→role lock pair used by role assignment/deletion,
 * `inviteWorkspaceMember`, and every other native membership writer. The
 * second read, taken
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
  const [pre] = await getInvitationWorkspace(db, invitationId);
  if (!pre) {
    throw new InvitationNotFoundError();
  }

  return db.transaction(async (tx) => {
    await lockWorkspaceRoleAssignment(tx, pre.workspaceId);

    const [invitation] = await getInvitationForAcceptance(tx, invitationId);
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
    const [existingMember] = await getWorkspaceMember(
      tx,
      invitation.workspaceId,
      callerId,
    );
    if (existingMember) {
      throw new AlreadyWorkspaceMemberError();
    }

    const role = invitation.role ?? "member";
    const [roleRow] = await getWorkspaceRoleId(
      tx,
      invitation.workspaceId,
      role,
    );
    if (!roleRow) {
      throw new WorkspaceRoleNotFoundError(role);
    }
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
