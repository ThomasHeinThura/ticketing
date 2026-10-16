import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  userAvatarTable,
  userTable,
  workflowTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

/**
 * User repository (issue #580): avatar rows, a minimal account-erasure safety summary, and
 * the statements account deletion runs inside its transaction. The controller keeps the
 * lock order (membership/role locks, then the user row), retry/plan logic and credential
 * invalidation.
 */

export async function deleteAvatarByUserId(
  userId: string,
  executor?: Executor,
) {
  return await executorOrDefault(executor)
    .delete(userAvatarTable)
    .where(eq(userAvatarTable.userId, userId))
    .returning({ id: userAvatarTable.id });
}

export async function findAvatarById(id: string, executor?: Executor) {
  const [avatar] = await executorOrDefault(executor)
    .select({
      id: userAvatarTable.id,
      mimeType: userAvatarTable.mimeType,
      size: userAvatarTable.size,
      data: userAvatarTable.data,
      updatedAt: userAvatarTable.updatedAt,
    })
    .from(userAvatarTable)
    .where(eq(userAvatarTable.id, id))
    .limit(1);
  return avatar;
}

/** One avatar per user: a second upload replaces the row and rotates its id. */
export async function upsertAvatar(
  values: { userId: string; mimeType: string; data: Buffer },
  executor?: Executor,
) {
  const { userId, mimeType, data: bytes } = values;
  const [saved] = await executorOrDefault(executor)
    .insert(userAvatarTable)
    .values({
      userId,
      mimeType,
      size: bytes.length,
      data: bytes,
    })
    .onConflictDoUpdate({
      target: userAvatarTable.userId,
      set: {
        id: createId(),
        mimeType,
        size: bytes.length,
        data: bytes,
        updatedAt: new Date(),
      },
    })
    .returning({ id: userAvatarTable.id });
  return saved;
}

/**
 * Minimal account-erasure safety facts for the authenticated deletion subject.
 * Every distinct persisted holder contributes to the counts, even if their
 * canonical identity is unavailable or inactive. Duplicate rows for one holder
 * do not inflate person counts. No other member's identity or individual role
 * row leaves this statement.
 */
export async function listAccountErasureMembershipSummaries(
  executor: Executor,
  subjectUserId: string,
) {
  const role = workspaceUserTable.role;
  return await executor
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      workspaceName: workspaceTable.name,
      isOwner: sql<boolean>`bool_or(case when ${role} is null then true else exists (
        select 1 from unnest(string_to_array(${role}, ',')) as role_parts(value)
        where lower(btrim(value, U&' \\0009\\000A\\000D\\000C\\000B\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF')) = 'owner'
      ) end)`,
      memberCount: sql<number>`(
        select count(distinct member_rows.user_id)::int from ${workspaceUserTable} as member_rows
        where member_rows.workspace_id = ${workspaceUserTable.workspaceId}
      )`,
      ownerCount: sql<number>`(
        select count(distinct member_rows.user_id)::int from ${workspaceUserTable} as member_rows
        where member_rows.workspace_id = ${workspaceUserTable.workspaceId}
          and lower(btrim(member_rows.role, U&' \\0009\\000A\\000D\\000C\\000B\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF')) = 'owner'
      )`,
    })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceUserTable.workspaceId, workspaceTable.id),
    )
    .where(eq(workspaceUserTable.userId, subjectUserId))
    .groupBy(workspaceUserTable.workspaceId, workspaceTable.name);
}

/** Row-lock the user so concurrent deletions/membership changes serialize on it. */
export async function lockUserRow(executor: Executor, userId: string) {
  return await executor
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .for("update");
}

export async function deleteWorkflowsInWorkspaces(
  executor: Executor,
  subjectUserId: string,
  workspaceIds: string[],
) {
  const subjectWorkspaces = executor
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, subjectUserId));
  await executor
    .delete(workflowTable)
    .where(
      and(
        inArray(workflowTable.workspaceId, workspaceIds),
        inArray(workflowTable.workspaceId, subjectWorkspaces),
      ),
    );
}

export async function deleteWorkspacesByIds(
  executor: Executor,
  subjectUserId: string,
  workspaceIds: string[],
) {
  const subjectWorkspaces = executor
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, subjectUserId));
  await executor
    .delete(workspaceTable)
    .where(
      and(
        inArray(workspaceTable.id, workspaceIds),
        inArray(workspaceTable.id, subjectWorkspaces),
      ),
    );
}

export async function deleteUserMemberships(
  executor: Executor,
  userId: string,
  workspaceIds: string[],
) {
  await executor
    .delete(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        inArray(workspaceUserTable.workspaceId, workspaceIds),
      ),
    );
}
