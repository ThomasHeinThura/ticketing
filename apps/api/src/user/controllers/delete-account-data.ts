import { APIError } from "better-auth/api";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import db from "../../database";
import type { Executor, Transaction } from "../../database/executor";
import {
  membershipGrantTable,
  membershipTable,
  personTable,
  projectTable,
  workspaceTable,
} from "../../database/schema";
import {
  AccountDeletionRetryError,
  currentAccountDeletionTransaction,
  hasAccountDeletionTransaction,
  invalidateAccountDeletionCredentials,
  requestAccountDeletionRetry,
} from "../../pending-action/credential-invalidation";
import { revokeProjectCreatorGrantsForMember } from "../../project/project-creator-grant";
import { isLockNotAvailable } from "../../utils/is-lock-not-available";
import {
  deleteWorkspaceRoleDependents,
  workspaceDependentPredicates,
} from "../../workspace/controllers/delete-workspace-role-dependents";
import { syncWorkspaceAdminReach } from "../../workspace/workspace-admin-reach";
import { lockWorkspaceRoleAssignment } from "../../workspace/workspace-role-assignment.repository";

import {
  formatBlockedWorkspacesMessage,
  formatOtherAccessMessage,
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

/**
 * Workspaces among `workspaceIds` that someone other than the erasing user can still reach
 * (owner decision, 2026-10-15, #734: nobody else loses access silently).
 *
 * The legacy `workspace_member` count only sees people added the legacy way. Erasing a
 * "sole member" workspace also deletes everything `deleteWorkspaceRoleDependents` removes, so
 * the check is built from the SAME predicates (`workspaceDependentPredicates`): any
 * `membership` row, or non-revoked `membership_grant` row (direct, JIT, OIDC or SCIM, including
 * one that only derives from one of the workspace's group mappings), that the deletion would
 * remove and that belongs to another person, blocks it. Rows of another scope that merely share
 * the workspace id are not in that set and do not count.
 *
 * Customers are counted too: a project bound to a customer organisation gives that
 * organisation's signed-in people reach to it (rbac.md, Reach step 6), and deleting the
 * workspace deletes the project and its work items, so those people would lose access.
 */
async function workspacesWithOtherAccess(
  tx: Transaction,
  workspaceIds: readonly string[],
  userId: string,
): Promise<{ id: string; name: string }[]> {
  if (workspaceIds.length === 0) return [];
  const ownPersonIds = (
    await tx
      .select({ id: personTable.id })
      .from(personTable)
      .where(eq(personTable.userId, userId))
  ).map((row) => row.id);
  const blocked: { id: string; name: string }[] = [];
  for (const workspaceId of workspaceIds) {
    const { membershipWhere, grantWhere } = workspaceDependentPredicates(tx, [
      workspaceId,
    ]);
    const others = (personId: AnyPgColumn) =>
      ownPersonIds.length > 0 ? notInArray(personId, ownPersonIds) : undefined;
    const [membership] = await tx
      .select({ id: membershipTable.id })
      .from(membershipTable)
      .where(and(membershipWhere, others(membershipTable.personId)))
      .limit(1);
    const [grant] = membership
      ? []
      : await tx
          .select({ id: membershipGrantTable.id })
          .from(membershipGrantTable)
          .where(
            and(
              grantWhere,
              others(membershipGrantTable.personId),
              // A revoked grant is no longer access.
              isNull(membershipGrantTable.revokedAt),
            ),
          )
          .limit(1);
    const [customer] =
      membership || grant
        ? []
        : await tx
            .select({ id: personTable.id })
            .from(personTable)
            .where(
              and(
                eq(personTable.side, "customer"),
                eq(personTable.active, true),
                isNotNull(personTable.userId),
                ne(personTable.userId, userId),
                inArray(
                  personTable.organisationId,
                  tx
                    .select({ id: projectTable.organisationId })
                    .from(projectTable)
                    .where(
                      and(
                        eq(projectTable.workspaceId, workspaceId),
                        isNotNull(projectTable.organisationId),
                      ),
                    ) as never,
                ),
              ),
            )
            .limit(1);
    if (membership || grant || customer) {
      const [workspace] = await tx
        .select({ name: workspaceTable.name })
        .from(workspaceTable)
        .where(eq(workspaceTable.id, workspaceId));
      blocked.push({ id: workspaceId, name: workspace?.name ?? "workspace" });
    }
  }
  return blocked;
}

/** Longest this request waits for the identity-table write lock below. */
export const ERASURE_LOCK_TIMEOUT_MS = 3000;
const ERASURE_LOCK_BUSY_MESSAGE =
  "Your account cannot be deleted right now because the system is busy updating access. Nothing was deleted; try again in a moment.";

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

  // Before anything is deleted or invalidated: a workspace others still reach through
  // SCIM/OIDC provisioning must be transferred or removed first, never erased around them.
  // First pass WITHOUT the table lock: a refused erasure must not take an instance-wide lock,
  // or any user could repeat a refused call to stall every provisioning writer. Only an erasure
  // that passes this cheap check goes on to lock, and the same check is then re-run under the
  // lock, so the race guard below is unchanged.
  const refuseIfOthersHaveAccess = async () => {
    const withOtherAccess = await workspacesWithOtherAccess(
      tx,
      plan.workspaceIdsToDelete,
      userId,
    );
    if (withOtherAccess.length > 0) {
      throw new APIError("CONFLICT", {
        message: formatOtherAccessMessage(
          withOtherAccess.map((workspace) => workspace.name),
        ),
      });
    }
  };
  await refuseIfOthersHaveAccess();

  if (plan.workspaceIdsToDelete.length > 0) {
    // Nothing may grant access between the check and the delete. The writers that create
    // identity-provisioned, direct and project-scope rows take no workspace-level lock (and
    // some of these rows have no foreign key to lock through), so the tables themselves are
    // locked against writes for the rest of this transaction. Reads are unaffected, and only an
    // erasure that is about to delete a workspace takes it.
    //
    // Lock order is `person`, `membership_grant`, `membership`: the order the provisioning
    // writers already take (OIDC JIT login and SCIM user create/update write `person` first;
    // `workspace-admin-reach` locks `person` then grants; the IP-22 SCIM/OIDC closure locks
    // grants parent-first, and only then projects into `membership` in
    // `identity/repository.ts`). Taking them in any other order can deadlock against a writer.
    //
    // The wait is bounded: one slow writer must not queue every later writer on these tables
    // behind this request. On timeout (55P03) nothing has been deleted and the transaction
    // rolls back; the caller gets the same 409 mechanism as the other refusals here.
    const priorLockTimeout = (
      await tx.execute(sql`SELECT current_setting('lock_timeout') AS value`)
    ).rows[0]?.value;
    await tx.execute(
      sql`SELECT set_config('lock_timeout', ${`${ERASURE_LOCK_TIMEOUT_MS}ms`}, true)`,
    );
    try {
      await tx.execute(
        sql`LOCK TABLE person, membership_grant, membership IN SHARE ROW EXCLUSIVE MODE`,
      );
    } catch (error) {
      if (isLockNotAvailable(error)) {
        throw new APIError("CONFLICT", {
          message: ERASURE_LOCK_BUSY_MESSAGE,
        });
      }
      throw error;
    }
    // The bound is for acquiring this lock only; later statements get the prior setting back.
    await tx.execute(
      sql`SELECT set_config('lock_timeout', ${String(priorLockTimeout ?? "0")}, true)`,
    );
  }
  // Re-run under the lock (a no-op repeat when no workspace is being deleted).
  if (plan.workspaceIdsToDelete.length > 0) await refuseIfOthersHaveAccess();

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
