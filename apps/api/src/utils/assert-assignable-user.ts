import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  getGlobalAdmin,
  getLiveProjectWorkspace,
  listAdminUserIds,
  listWorkspaceMembershipUserIds,
  lockWorkspaceMembership,
} from "./repository";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const NOT_ASSIGNABLE = "Assignee is not a member of this workspace";

export async function filterAssignableUsers(
  userIds: string[],
  workspaceId: string,
  executor: DbOrTx = db,
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const memberships = await listWorkspaceMembershipUserIds(
    executor,
    userIds,
    workspaceId,
  );

  const assignable = new Set(memberships.map((row) => row.userId));
  const remaining = userIds.filter((id) => !assignable.has(id));

  if (remaining.length === 0) {
    return assignable;
  }

  const admins = await listAdminUserIds(executor, remaining);

  for (const admin of admins) {
    assignable.add(admin.id);
  }

  return assignable;
}

export async function assertAssignableUser(
  userId: string,
  workspaceId: string,
  executor: DbOrTx = db,
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
  const memberships = await lockWorkspaceMembership(
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
  const [admin] = await getGlobalAdmin(executor, userId);

  if (!admin) {
    throw new HTTPException(403, { message: NOT_ASSIGNABLE });
  }
}

export async function getProjectWorkspaceId(
  projectId: string,
  executor: DbOrTx = db,
): Promise<string> {
  const [project] = await getLiveProjectWorkspace(executor, projectId);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return project.workspaceId;
}
