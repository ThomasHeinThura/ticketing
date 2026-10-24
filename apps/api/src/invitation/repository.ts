import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, exists, type SQL, sql } from "drizzle-orm";
import { schema } from "../database";
import { type Executor, executorOrDefault } from "../database/executor";
import { currentWorkspaceReachPredicate } from "../database/repositories/identity-scope.repository";

/**
 * Invitation statements. Recipient reads and writes bind to the current user's stored email;
 * manager cancellation also binds the invitation row to current workspace reach. Transaction
 * boundaries, membership lock order and route error mapping remain in the controllers.
 */
function recipientMatchesCurrentUser(
  identity: ResolvedIdentity,
  executor: Executor,
): SQL<boolean> {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(schema.userTable)
      .where(
        and(
          eq(schema.userTable.id, identity.userId),
          sql`lower(${schema.userTable.email}) = lower(${schema.invitationTable.email})`,
        ),
      ),
  ) as SQL<boolean>;
}

function managerHasCurrentWorkspaceReach(
  identity: ResolvedIdentity,
  executor: Executor,
) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(schema.workspaceTable)
      .where(
        and(
          eq(schema.workspaceTable.id, schema.invitationTable.workspaceId),
          currentWorkspaceReachPredicate(
            identity,
            schema.workspaceTable.id,
            executor,
          ),
        ),
      ),
  );
}

/** Which workspace a recipient's invitation belongs to, read before its membership lock. */
export async function findInvitationWorkspaceId(
  identity: ResolvedIdentity,
  invitationId: string,
  executor?: Executor,
) {
  const database = executorOrDefault(executor);
  const [pre] = await database
    .select({ workspaceId: schema.invitationTable.workspaceId })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        recipientMatchesCurrentUser(identity, database),
      ),
    )
    .limit(1);
  return pre;
}

/** Minimal existence/recipient fact, preserving route 404/403 outcomes without returning content. */
export async function findInvitationRecipientMatch(
  identity: ResolvedIdentity,
  invitationId: string,
  executor?: Executor,
) {
  const database = executorOrDefault(executor);
  const [row] = await database
    .select({ matches: recipientMatchesCurrentUser(identity, database) })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  return row?.matches;
}

/** The invitation content for acceptance, after the shared membership lock is held. */
export async function findInvitationForAccept(
  executor: Executor,
  identity: ResolvedIdentity,
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
      inviterId: schema.invitationTable.inviterId,
    })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        recipientMatchesCurrentUser(identity, executor),
      ),
    )
    .limit(1);
  return invitation;
}

/** Invitation status for a manager whose current row-derived workspace reach is established. */
export async function findInvitationStatus(
  identity: ResolvedIdentity,
  invitationId: string,
  executor?: Executor,
) {
  const database = executorOrDefault(executor);
  const [invitation] = await database
    .select({
      id: schema.invitationTable.id,
      status: schema.invitationTable.status,
    })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        managerHasCurrentWorkspaceReach(identity, database),
      ),
    )
    .limit(1);
  return invitation;
}

/** Minimal recipient/state facts for reject; no invitation content is returned to a non-recipient. */
export async function findInvitationRecipientAndStatus(
  identity: ResolvedIdentity,
  invitationId: string,
  executor?: Executor,
) {
  const database = executorOrDefault(executor);
  const [invitation] = await database
    .select({
      id: schema.invitationTable.id,
      pending: sql<boolean>`${schema.invitationTable.status} = 'pending'`,
      recipientMatches: recipientMatchesCurrentUser(identity, database),
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
    .select({ id: schema.roleTable.id })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.key, role),
      ),
    )
    .limit(1);
  return roleRow;
}

export async function markInvitationAccepted(
  executor: Executor,
  identity: ResolvedIdentity,
  invitationId: string,
) {
  const [updated] = await executor
    .update(schema.invitationTable)
    .set({ status: "accepted" })
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        eq(schema.invitationTable.status, "pending"),
        recipientMatchesCurrentUser(identity, executor),
      ),
    )
    .returning({ id: schema.invitationTable.id });
  return updated;
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

/** Manager cancellation: current reach and pending state are in the DML predicate. */
export async function cancelPendingInvitation(
  identity: ResolvedIdentity,
  invitationId: string,
  executor?: Executor,
) {
  const database = executorOrDefault(executor);
  const [updated] = await database
    .update(schema.invitationTable)
    .set({ status: "canceled" })
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        eq(schema.invitationTable.status, "pending"),
        managerHasCurrentWorkspaceReach(identity, database),
      ),
    )
    .returning({ id: schema.invitationTable.id });
  return updated;
}

/** Recipient rejection: current-user email and pending state are in the DML predicate. */
export async function rejectOwnPendingInvitation(
  identity: ResolvedIdentity,
  invitationId: string,
  executor?: Executor,
) {
  const database = executorOrDefault(executor);
  const [updated] = await database
    .update(schema.invitationTable)
    .set({ status: "canceled" })
    .where(
      and(
        eq(schema.invitationTable.id, invitationId),
        eq(schema.invitationTable.status, "pending"),
        recipientMatchesCurrentUser(identity, database),
      ),
    )
    .returning({ id: schema.invitationTable.id });
  return updated;
}
