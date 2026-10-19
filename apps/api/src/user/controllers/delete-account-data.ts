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
import { syncWorkspaceAdminReach } from "../../workspace/workspace-admin-reach";
import { lockWorkspaceRoleAssignment } from "../../workspace/workspace-role-assignment.repository";

import {
  formatBlockedWorkspacesMessage,
  planAccountDeletion,
  type WorkspaceMembershipSummary,
} from "../account-deletion";
import {
  deleteUserMemberships,
  deleteWorkflowsInWorkspaces,
  deleteWorkspacesByIds,
  listAccountErasureMembershipSummaries,
  lockUserRow,
} from "../repository";

async function collectMemberships(
  database: Executor,
  userId: string,
): Promise<WorkspaceMembershipSummary[]> {
  return await listAccountErasureMembershipSummaries(database, userId);
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
    await deleteWorkflowsInWorkspaces(tx, userId, plan.workspaceIdsToDelete);

    // Issue #180: RESTRICT role FKs (membership, grants, group mappings) must be
    // cleared explicitly or the workspace delete below 500s.
    await deleteWorkspaceRoleDependents(tx, plan.workspaceIdsToDelete);

    await deleteWorkspacesByIds(tx, userId, plan.workspaceIdsToDelete);
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
