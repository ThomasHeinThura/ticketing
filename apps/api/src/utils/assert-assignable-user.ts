import { HTTPException } from "hono/http-exception";
import type { Executor } from "../database/executor";
import {
  findLiveProjectWorkspaceId,
  listAdminUserIds,
  listWorkspaceMemberUserIds,
  lockWorkspaceMembershipRow,
  shareLockAdminUser,
} from "./assignable-user.repository";

type DbOrTx = Executor;

const NOT_ASSIGNABLE = "Assignee is not a member of this workspace";

export async function filterAssignableUsers(
  userIds: string[],
  workspaceId: string,
  executor?: DbOrTx,
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const memberships = await listWorkspaceMemberUserIds(
    userIds,
    workspaceId,
    executor,
  );

  const assignable = new Set(memberships.map((row) => row.userId));
  const remaining = userIds.filter((id) => !assignable.has(id));

  if (remaining.length === 0) {
    return assignable;
  }

  const admins = await listAdminUserIds(remaining, executor);

  for (const admin of admins) {
    assignable.add(admin.id);
  }

  return assignable;
}

export async function assertAssignableUser(
  userId: string,
  workspaceId: string,
  executor?: DbOrTx,
): Promise<void> {
  const assignable = await filterAssignableUsers(
    [userId],
    workspaceId,
    executor,
  );

  if (!assignable.has(userId)) {
    throw new HTTPException(403, { message: NOT_ASSIGNABLE });
  }
}

/**
 * Validate an assignee and hold any workspace membership row through the
 * caller's transaction. This serializes assignment against membership removal:
 * whichever transaction gets the row lock first commits before the other can
 * make its decision. Global admins remain assignable without a workspace row,
 * matching `assertAssignableUser`'s existing behavior.
 */
export async function assertAssignableUserAndLockMembership(
  userId: string,
  workspaceId: string,
  executor: DbOrTx,
): Promise<void> {
  const memberships = await lockWorkspaceMembershipRow(
    executor,
    userId,
    workspaceId,
  );

  if (memberships.length > 0) return;

  // An absent row cannot be gap-locked by PostgreSQL. Do not call
  // `assertAssignableUser` here: its membership read would be unlocked, so a
  // membership inserted after the first query could be removed before the
  // caller's task write. Global admins remain assignable through their user
  // row, which is shared-locked through the transaction instead.
  const admin = await shareLockAdminUser(executor, userId);

  if (!admin) {
    throw new HTTPException(403, { message: NOT_ASSIGNABLE });
  }
}

export async function getProjectWorkspaceId(
  projectId: string,
  executor?: DbOrTx,
): Promise<string> {
  const project = await findLiveProjectWorkspaceId(projectId, executor);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return project.workspaceId;
}
