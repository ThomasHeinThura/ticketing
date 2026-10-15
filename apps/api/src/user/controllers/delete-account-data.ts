import { APIError } from "better-auth/api";
import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import db from "../../database";
import {
  membershipGrantTable,
  membershipTable,
  personTable,
  projectTable,
  roleTable,
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
import { revokeProjectCreatorGrantsForMember } from "../../project/project-creator-grant";
import { deleteWorkspaceRoleDependents } from "../../workspace/controllers/delete-workspace-role-dependents";
import { lockWorkspaceRoleAssignment } from "../../workspace/controllers/workspace-role-assignment-lock";
import { syncWorkspaceAdminReach } from "../../workspace/workspace-admin-reach";

type AccountDeletionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

import {
  formatBlockedWorkspacesMessage,
  formatOtherAccessMessage,
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

/**
 * Workspaces among `workspaceIds` that someone other than the erasing user can still reach
 * through the identity-provisioned tables (owner decision, 2026-10-15, #734).
 *
 * The legacy `workspace_member` count only sees people added the legacy way. SCIM and OIDC
 * provisioning writes `membership` and `membership_grant` rows instead, and erasing a "sole
 * member" workspace deletes those rows with it. Erasure must not silently remove anyone's
 * access, so a workspace is only deletable when every access row that targets it (the
 * workspace, one of its projects, or a role the workspace owns) belongs to the erasing user's
 * own person. Rows scoped to something else that merely shares the id (for example an
 * organisation) are not access to the workspace and do not count.
 */
async function workspacesWithOtherAccess(
  tx: AccountDeletionTransaction,
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
    const projectIds = tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(eq(projectTable.workspaceId, workspaceId));
    const roleIds = tx
      .select({ id: roleTable.id })
      .from(roleTable)
      .where(eq(roleTable.workspaceId, workspaceId));
    const inScope = (
      scope: AnyPgColumn,
      scopeId: AnyPgColumn,
      roleId: AnyPgColumn,
    ) =>
      or(
        and(eq(scope, "workspace"), eq(scopeId, workspaceId)),
        and(eq(scope, "project"), inArray(scopeId, projectIds)),
        inArray(roleId, roleIds),
      );
    const others = (personId: AnyPgColumn) =>
      ownPersonIds.length > 0 ? notInArray(personId, ownPersonIds) : undefined;
    const [membership] = await tx
      .select({ id: membershipTable.id })
      .from(membershipTable)
      .where(
        and(
          inScope(
            membershipTable.scope,
            membershipTable.scopeId,
            membershipTable.roleId,
          ),
          others(membershipTable.personId),
        ),
      )
      .limit(1);
    const [grant] = membership
      ? []
      : await tx
          .select({ id: membershipGrantTable.id })
          .from(membershipGrantTable)
          .where(
            and(
              inScope(
                membershipGrantTable.scope,
                membershipGrantTable.scopeId,
                membershipGrantTable.roleId,
              ),
              others(membershipGrantTable.personId),
              // A revoked grant is no longer access.
              isNull(membershipGrantTable.revokedAt),
            ),
          )
          .limit(1);
    if (membership || grant) {
      const [workspace] = await tx
        .select({ name: workspaceTable.name })
        .from(workspaceTable)
        .where(eq(workspaceTable.id, workspaceId));
      blocked.push({ id: workspaceId, name: workspace?.name ?? "workspace" });
    }
  }
  return blocked;
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

  // Before anything is deleted or invalidated: a workspace others still reach through
  // SCIM/OIDC provisioning must be transferred or removed first, never erased around them.
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
      await revokeProjectCreatorGrantsForMember(tx, workspaceId, userId);
    }
  }

  return plan;
}

export default deleteAccountData;
