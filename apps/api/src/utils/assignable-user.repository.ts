import { and, eq, inArray, isNull } from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  projectTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";

/**
 * Query ownership for assignee validation (issue #580). Moved verbatim from
 * `assert-assignable-user.ts`: the same predicates and, for the locking variants, the same
 * `FOR UPDATE` / `FOR SHARE` row locks on the caller's transaction handle. Every function
 * awaits and returns rows; the 403/404 decisions stay in the caller.
 */

/** User ids among `userIds` that hold a membership row in the workspace. */
export async function listWorkspaceMemberUserIds(
  userIds: string[],
  workspaceId: string,
  executor?: Executor,
) {
  return executorOrDefault(executor)
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        inArray(workspaceUserTable.userId, userIds),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    );
}

/** User ids among `userIds` that are global admins. */
export async function listAdminUserIds(userIds: string[], executor?: Executor) {
  return executorOrDefault(executor)
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(inArray(userTable.id, userIds), eq(userTable.role, "admin")));
}

/** The user's workspace membership row, locked `FOR UPDATE` on the caller's transaction. */
export async function lockWorkspaceMembershipRow(
  executor: Executor,
  userId: string,
  workspaceId: string,
) {
  return executor
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .for("update");
}

/** The user's row when they are a global admin, locked `FOR SHARE` on the transaction. */
export async function shareLockAdminUser(executor: Executor, userId: string) {
  const [admin] = await executor
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(eq(userTable.id, userId), eq(userTable.role, "admin")))
    .for("share");
  return admin;
}

/** The workspace of a live (not soft-deleted) project, or `undefined`. */
export async function findLiveProjectWorkspaceId(
  projectId: string,
  executor?: Executor,
) {
  const [project] = await executorOrDefault(executor)
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    // #187: a soft-deleted project is treated as gone everywhere in ordinary use,
    // matching `get-project.ts`'s convention -- every caller of this helper (task
    // creation and updates included) gets that for free instead of re-deriving it.
    .where(and(eq(projectTable.id, projectId), isNull(projectTable.deletedAt)))
    .limit(1);
  return project;
}
