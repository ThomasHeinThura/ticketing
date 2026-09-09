import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  LastOwnerCannotLeaveError,
  MemberNotFoundError,
} from "./workspace-membership-errors";
import { WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE } from "./workspace-membership-lock";

/**
 * Remove a member from a workspace.
 *
 * Mirrors better-auth's own `removeMember` (`crud-members.mjs`): a target
 * whose role is the creator role (`owner`) can only be removed when the
 * workspace still has another owner behind them -- counted here inside the
 * SAME transaction, under `lockWorkspaceMembership`'s advisory lock, so two
 * concurrent removals of two different owners cannot both read "safe" before
 * either commits (see that file). This covers the sole owner removing
 * THEMSELVES through this route as well as `POST .../leave` -- the
 * dedicated leave route exists for the ordinary case, but nothing stops an
 * owner calling DELETE on their own membership instead, and the invariant
 * must hold either way.
 *
 * The caller's OWN authority to remove (whether they hold `member:delete`)
 * is checked by `requireWorkspacePermission`/`requireWorkspaceRoleAuthority`
 * in `apps/api/src/workspace/index.ts`, not here -- this function only
 * enforces the invariant that survives every caller.
 *
 * Any session belonging to the REMOVED user that has this workspace active
 * is cleared -- not only the calling session (contrast `deleteWorkspace`,
 * which only ever clears the caller's own session, because there the caller
 * and the affected user are always the same person). Here an admin can
 * remove someone else entirely, and a removed member's other browser tabs
 * must not keep pointing a "current workspace" selection at a workspace they
 * no longer belong to.
 */
async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<{ userId: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE}, hashtext(${workspaceId}))`,
    );

    const [target] = await tx
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, userId),
        ),
      )
      .limit(1);
    if (!target) {
      throw new MemberNotFoundError();
    }

    if (target.role === "owner") {
      const owners = await tx
        .select({ userId: schema.workspaceUserTable.userId })
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspaceId),
            eq(schema.workspaceUserTable.role, "owner"),
          ),
        );
      if (owners.length <= 1) {
        throw new LastOwnerCannotLeaveError();
      }
    }

    await tx
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, userId),
        ),
      );

    await tx
      .update(schema.sessionTable)
      .set({ activeOrganizationId: null, activeTeamId: null })
      .where(
        and(
          eq(schema.sessionTable.userId, userId),
          eq(schema.sessionTable.activeOrganizationId, workspaceId),
        ),
      );

    return { userId };
  });
}

export default removeWorkspaceMember;
