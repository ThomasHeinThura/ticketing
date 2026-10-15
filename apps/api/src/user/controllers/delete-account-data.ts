import { APIError } from "better-auth/api";
import db from "../../database";
import type { Executor, Transaction } from "../../database/executor";
import {
  AccountDeletionRetryError,
  currentAccountDeletionTransaction,
  hasAccountDeletionTransaction,
  invalidateAccountDeletionCredentials,
  requestAccountDeletionRetry,
} from "../../pending-action/credential-invalidation";
import { revokeProjectCreatorGrantsForMember } from "../../project/project-creator-grant";
import { deleteWorkspaceRoleDependents } from "../../workspace/controllers/delete-workspace-role-dependents";
import { lockWorkspaceRoleAssignment } from "../../workspace/controllers/workspace-role-assignment-lock";
import { syncWorkspaceAdminReach } from "../../workspace/workspace-admin-reach";

import {
  formatBlockedWorkspacesMessage,
  hasOwnerRole,
  holdsOwnerExactly,
  planAccountDeletion,
  type WorkspaceMembershipSummary,
} from "../account-deletion";
import {
  deleteUserMemberships,
  deleteWorkflowsInWorkspaces,
  deleteWorkspacesByIds,
  listMembersOfWorkspaces,
  listUserMemberships,
  lockUserRow,
} from "../repository";

async function collectMemberships(
  database: Executor,
  userId: string,
): Promise<WorkspaceMembershipSummary[]> {
  const memberships = await listUserMemberships(database, userId);

  if (memberships.length === 0) {
    return [];
  }

  const workspaceIds = memberships.map((membership) => membership.workspaceId);

  const members = await listMembersOfWorkspaces(database, workspaceIds);

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
  tx: Transaction,
  accountDeletion: boolean,
) {
  const before = await collectMemberships(tx, userId);
  for (const workspaceId of [
    ...new Set(before.map((row) => row.workspaceId)),
  ].sort()) {
    await lockWorkspaceRoleAssignment(tx, workspaceId);
  }
  await lockUserRow(tx, userId);
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
    await deleteWorkflowsInWorkspaces(tx, plan.workspaceIdsToDelete);

    // Issue #180: RESTRICT role FKs (membership, grants, group mappings) must be
    // cleared explicitly or the workspace delete below 500s.
    await deleteWorkspaceRoleDependents(tx, plan.workspaceIdsToDelete);

    await deleteWorkspacesByIds(tx, plan.workspaceIdsToDelete);
  }

  if (plan.workspaceIdsToLeave.length > 0) {
    await deleteUserMemberships(tx, userId, plan.workspaceIdsToLeave);
    for (const workspaceId of plan.workspaceIdsToLeave) {
      await syncWorkspaceAdminReach(tx, workspaceId, userId);
      await revokeProjectCreatorGrantsForMember(tx, workspaceId, userId);
    }
  }

  return plan;
}

export default deleteAccountData;
