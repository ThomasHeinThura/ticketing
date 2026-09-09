import { APIError } from "better-auth/api";
import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { workspaceTable, workspaceUserTable } from "../../database/schema";
import {
  formatBlockedWorkspacesMessage,
  hasOwnerRole,
  holdsOwnerExactly,
  planAccountDeletion,
  type WorkspaceMembershipSummary,
} from "../account-deletion";

async function collectMemberships(
  userId: string,
): Promise<WorkspaceMembershipSummary[]> {
  const memberships = await db
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));

  if (memberships.length === 0) {
    return [];
  }

  const workspaceIds = memberships.map((membership) => membership.workspaceId);

  const members = await db
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

  return memberships.map((membership) => {
    const workspaceMembers = members.filter(
      (member) => member.workspaceId === membership.workspaceId,
    );

    return {
      workspaceId: membership.workspaceId,
      workspaceName: workspaceMembers[0]?.workspaceName ?? "workspace",
      isOwner: hasOwnerRole(membership.role),
      memberCount: workspaceMembers.length,
      // EXACT, not `hasOwnerRole`. Over-counting owners makes
      // `ownerCount <= 1` false, which skips `planAccountDeletion`'s block and
      // lets a sole owner orphan the workspace. `isOwner` above keeps the
      // inclusive reading, deliberately -- see `holdsOwnerExactly`'s comment.
      ownerCount: workspaceMembers.filter((member) =>
        holdsOwnerExactly(member.role),
      ).length,
    };
  });
}

export async function deleteAccountData(userId: string) {
  const plan = planAccountDeletion(await collectMemberships(userId));

  if (plan.blockedWorkspaceNames.length > 0) {
    throw new APIError("CONFLICT", {
      message: formatBlockedWorkspacesMessage(plan.blockedWorkspaceNames),
    });
  }

  if (plan.workspaceIdsToDelete.length > 0) {
    await db
      .delete(workspaceTable)
      .where(inArray(workspaceTable.id, plan.workspaceIdsToDelete));
  }

  if (plan.workspaceIdsToLeave.length > 0) {
    await db
      .delete(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.userId, userId),
          inArray(workspaceUserTable.workspaceId, plan.workspaceIdsToLeave),
        ),
      );
  }

  return plan;
}

export default deleteAccountData;
