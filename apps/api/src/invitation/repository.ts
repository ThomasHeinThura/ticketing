import { and, eq } from "drizzle-orm";
import { schema } from "../database";
import { type Executor, executorOrDefault } from "../database/executor";

/**
 * Invitation repository (issue #580). Every invitation statement lives here; the controllers
 * keep the transaction boundary, the membership lock order and the error mapping. Statements
 * are moved verbatim. The only tenant scope an invitation statement has is the invitation id
 * itself (the caller-vs-recipient and pending-status checks stay in the controllers and, for
 * the writes, in the `WHERE status = 'pending'` predicate).
 */

/** Which workspace an invitation belongs to, read before the membership lock is taken. */
export async function findInvitationWorkspaceId(
  invitationId: string,
  executor?: Executor,
) {
  const [pre] = await executorOrDefault(executor)
    .select({ workspaceId: schema.invitationTable.workspaceId })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  return pre;
}

/** The invitation as accept reads it (after the lock): recipient, status and expiry. */
export async function findInvitationForAccept(
  executor: Executor,
  invitationId: string,
) {
  const [invitation] = await executor
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
  return invitation;
}

export async function findInvitationStatus(
  invitationId: string,
  executor?: Executor,
) {
  const [invitation] = await executorOrDefault(executor)
    .select({
      id: schema.invitationTable.id,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  return invitation;
}

export async function findInvitationRecipientAndStatus(
  invitationId: string,
  executor?: Executor,
) {
  const [invitation] = await executorOrDefault(executor)
    .select({
      id: schema.invitationTable.id,
      email: schema.invitationTable.email,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  return invitation;
}

export async function findWorkspaceMemberUserId(
  executor: Executor,
  workspaceId: string,
  userId: string,
) {
  const [existingMember] = await executor
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  return existingMember;
}

export async function findWorkspaceRoleId(
  executor: Executor,
  workspaceId: string,
  role: string,
) {
  const [roleRow] = await executor
    .select({ id: schema.workspaceRoleTable.id })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    )
    .limit(1);
  return roleRow;
}

export async function markInvitationAccepted(
  executor: Executor,
  invitationId: string,
) {
  await executor
    .update(schema.invitationTable)
    .set({ status: "accepted" })
    .where(eq(schema.invitationTable.id, invitationId));
}

export async function insertWorkspaceMember(
  executor: Executor,
  values: {
    workspaceId: string;
    userId: string;
    role: string;
    joinedAt: Date;
  },
) {
  await executor.insert(schema.workspaceUserTable).values(values);
}

/**
 * Cancel a still-pending invitation. The `status = 'pending'` predicate is what makes the
 * write atomic against a concurrent accept/reject/cancel: the loser matches zero rows and
 * gets `undefined`.
 */
export async function cancelPendingInvitation(
  invitationId: string,
  executor?: Executor,
) {
  const [updated] = await executorOrDefault(executor)
    .update(schema.invitationTable)
    .set({ status: "canceled" })
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        eq(schema.invitationTable.status, "pending"),
      ),
    )
    .returning({ id: schema.invitationTable.id });
  return updated;
}
