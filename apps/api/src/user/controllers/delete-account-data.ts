import { APIError } from "better-auth/api";
import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import {
  userTable,
  workflowTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import {
  AccountDeletionRetryError,
  currentAccountDeletionTransaction,
  hasAccountDeletionTransaction,
  invalidateAccountDeletionCredentials,
  requestAccountDeletionRetry,
} from "../../pending-action/credential-invalidation";
import { deleteWorkspaceRoleDependents } from "../../workspace/controllers/delete-workspace-role-dependents";
import { lockWorkspaceRoleAssignment } from "../../workspace/controllers/workspace-role-assignment-lock";
import { syncWorkspaceAdminReach } from "../../workspace/workspace-admin-reach";

type AccountDeletionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

import {
  formatBlockedWorkspacesMessage,
  hasOwnerRole,
  holdsOwnerExactly,
  planAccountDeletion,
  type WorkspaceMembershipSummary,
} from "../account-deletion";

async function collectMemberships(
  database: AccountDeletionTransaction | typeof db,
  userId: string,
): Promise<WorkspaceMembershipSummary[]> {
  const memberships = await database
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

  const members = await database
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
  if (!hasAccountDeletionTransaction()) {
    return db.transaction((tx) =>
      deleteAccountDataInTransaction(userId, tx, false),
    );
  }
  return deleteAccountDataInTransaction(
    userId,
    currentAccountDeletionTransaction(),
    true,
  );
}

async function deleteAccountDataInTransaction(
  userId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  accountDeletion: boolean,
) {
  const before = await collectMemberships(tx, userId);
  for (const workspaceId of [
    ...new Set(before.map((row) => row.workspaceId)),
  ].sort()) {
    await lockWorkspaceRoleAssignment(tx, workspaceId);
  }
  await tx
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .for("update");
  const memberships = await collectMemberships(tx, userId);
  const beforeIds = before.map((row) => row.workspaceId).sort();
  const afterIds = memberships.map((row) => row.workspaceId).sort();
  if (
    beforeIds.length !== afterIds.length ||
    beforeIds.some((id, index) => id !== afterIds[index])
  ) {
    if (accountDeletion) requestAccountDeletionRetry();
    throw new AccountDeletionRetryError();
  }
  const plan = planAccountDeletion(memberships);

  if (plan.blockedWorkspaceNames.length > 0) {
    throw new APIError("CONFLICT", {
      message: formatBlockedWorkspacesMessage(plan.blockedWorkspaceNames),
    });
  }

  if (accountDeletion) await invalidateAccountDeletionCredentials(userId, tx);

  if (plan.workspaceIdsToDelete.length > 0) {
    // Same `ON DELETE RESTRICT` ordering problem `delete-workspace.ts` documents:
    // `workflow` must go first, explicitly, so its cascade clears
    // `workflow_version`/`workflow_transition`/`scheduled_transition` before the
    // workspace delete cascades into the `state_template`/`role` rows those
    // transitions restrict against.
    await tx
      .delete(workflowTable)
      .where(inArray(workflowTable.workspaceId, plan.workspaceIdsToDelete));

    // Issue #180: RESTRICT role FKs (membership, grants, group mappings) must be
    // cleared explicitly or the workspace delete below 500s.
    await deleteWorkspaceRoleDependents(tx, plan.workspaceIdsToDelete);

    await tx
      .delete(workspaceTable)
      .where(inArray(workspaceTable.id, plan.workspaceIdsToDelete));
  }

  if (plan.workspaceIdsToLeave.length > 0) {
    await tx
      .delete(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.userId, userId),
          inArray(workspaceUserTable.workspaceId, plan.workspaceIdsToLeave),
        ),
      );
    for (const workspaceId of plan.workspaceIdsToLeave) {
      await syncWorkspaceAdminReach(tx, workspaceId, userId);
    }
  }

  return plan;
}

export default deleteAccountData;
