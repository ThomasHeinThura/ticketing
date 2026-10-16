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

/** All members of workspaces the deletion subject currently belongs to. */
export async function listMembersOfWorkspaces(
  executor: Executor,
  subjectUserId: string,
) {
  const subjectWorkspaces = executor
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, subjectUserId));
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
    .where(inArray(workspaceUserTable.workspaceId, subjectWorkspaces));
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
