import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

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

  const memberships = await executor
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        inArray(schema.workspaceUserTable.userId, userIds),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    );

  const assignable = new Set(memberships.map((row) => row.userId));
  const remaining = userIds.filter((id) => !assignable.has(id));

  if (remaining.length === 0) {
    return assignable;
  }

  const admins = await executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(
      and(
        inArray(schema.userTable.id, remaining),
        eq(schema.userTable.role, "admin"),
      ),
    );

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
  const memberships = await executor
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .for("update");

  if (memberships.length > 0) return;

  await assertAssignableUser(userId, workspaceId, executor);
}

export async function getProjectWorkspaceId(
  projectId: string,
  executor: DbOrTx = db,
): Promise<string> {
  const [project] = await executor
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    // #187: a soft-deleted project is treated as gone everywhere in ordinary use,
    // matching `get-project.ts`'s convention -- every caller of this helper (task
    // creation and updates included) gets that for free instead of re-deriving it.
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return project.workspaceId;
}
