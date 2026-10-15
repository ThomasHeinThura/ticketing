import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  userAvatarTable,
  userTable,
  workflowTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

/**
 * User repository (issue #580): avatar rows and the statements account deletion runs inside
 * its transaction. Statements are moved verbatim; the controllers keep the lock order
 * (membership/role locks, then the user row), the retry/plan logic and credential invalidation.
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

/** Every workspace the user belongs to, with their role there. */
export async function listUserMemberships(executor: Executor, userId: string) {
  return await executor
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));
}

/** All members (with workspace name and role) of the given workspaces. */
export async function listMembersOfWorkspaces(
  executor: Executor,
  workspaceIds: string[],
) {
  return await executor
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      workspaceName: workspaceTable.name,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceUserTable.workspaceId, workspaceTable.id),
    )
    .where(inArray(workspaceUserTable.workspaceId, workspaceIds));
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
  workspaceIds: string[],
) {
  await executor
    .delete(workflowTable)
    .where(inArray(workflowTable.workspaceId, workspaceIds));
}

export async function deleteWorkspacesByIds(
  executor: Executor,
  workspaceIds: string[],
) {
  await executor
    .delete(workspaceTable)
    .where(inArray(workspaceTable.id, workspaceIds));
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
