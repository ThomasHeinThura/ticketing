import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type DatabaseInstance, schema } from "../../database";

type WorkspaceDeletionTransaction = Parameters<
  Parameters<DatabaseInstance["transaction"]>[0]
>[0];

/**
 * THE one definition of which `membership` and `membership_grant` rows belong to a workspace
 * (its role set, its scope set and, for grants, the group mappings that belong to it). Both
 * workspace deletion (which removes these rows) and the account-erasure access check (which
 * refuses to remove them while another person holds one, #734) are built from it, so what
 * deletion removes and what erasure protects cannot drift apart.
 *
 * A row qualifies when its role is owned by one of the workspaces, or its scope is one of them
 * or one of their projects. A grant also qualifies when it derives from an OIDC or SCIM group
 * mapping that itself qualifies by the same two rules.
 */
export function workspaceDependentPredicates(
  tx: WorkspaceDeletionTransaction,
  workspaceIds: readonly string[],
) {
  const ids = [...workspaceIds];
  const workspaceRoleIds = tx
    .select({ id: schema.roleTable.id })
    .from(schema.roleTable)
    .where(inArray(schema.roleTable.workspaceId, ids));
  const projectIds = tx
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(inArray(schema.projectTable.workspaceId, ids));

  // `scope`/`scope_id` is polymorphic (no FK), so a row is "in" the workspace when it
  // targets the workspace or one of its projects.
  const inWorkspaceScope = (
    scope: AnyPgColumn,
    scopeId: AnyPgColumn,
  ): SQL | undefined =>
    or(
      and(eq(scope, "workspace"), inArray(scopeId, ids)),
      and(eq(scope, "project"), inArray(scopeId, projectIds)),
    );

  const oidcMappingIds = tx
    .select({ id: schema.oidcGroupMappingTable.id })
    .from(schema.oidcGroupMappingTable)
    .where(
      or(
        inArray(schema.oidcGroupMappingTable.roleId, workspaceRoleIds),
        inWorkspaceScope(
          schema.oidcGroupMappingTable.scope,
          schema.oidcGroupMappingTable.scopeId,
        ),
      ),
    );
  const scimMappingIds = tx
    .select({ id: schema.scimGroupMappingTable.id })
    .from(schema.scimGroupMappingTable)
    .where(
      or(
        inArray(schema.scimGroupMappingTable.roleId, workspaceRoleIds),
        inWorkspaceScope(
          schema.scimGroupMappingTable.scope,
          schema.scimGroupMappingTable.scopeId,
        ),
      ),
    );

  const membershipWhere = or(
    inArray(schema.membershipTable.roleId, workspaceRoleIds),
    inWorkspaceScope(
      schema.membershipTable.scope,
      schema.membershipTable.scopeId,
    ),
  );
  const grantWhere = or(
    inArray(schema.membershipGrantTable.roleId, workspaceRoleIds),
    inWorkspaceScope(
      schema.membershipGrantTable.scope,
      schema.membershipGrantTable.scopeId,
    ),
    inArray(schema.membershipGrantTable.oidcGroupMappingId, oidcMappingIds),
    inArray(schema.membershipGrantTable.scimGroupMappingId, scimMappingIds),
  );
  return {
    oidcMappingIds,
    scimMappingIds,
    membershipWhere,
    grantWhere,
    workspaceRoleIds,
    inWorkspaceScope,
  };
}

/**
 * Explicitly remove every row that holds a RESTRICT reference to a role owned by
 * the workspace(s) being deleted, or that is scoped to the workspace or one of its
 * projects, BEFORE the workspace row itself is deleted (issue #180).
 *
 * Why this exists: `role.workspace_id` is `ON DELETE CASCADE`, but `membership.role_id`,
 * `membership_grant.role_id`, `oidc_group_mapping.role_id` and
 * `scim_group_mapping.role_id` are deliberately `ON DELETE RESTRICT` (a single role
 * delete must never silently strip people's authority). Postgres therefore refuses the
 * cascade as soon as any membership references a workspace-owned role -- a 500 on the
 * route. Workspace deletion is the one place where that authority is meant to go, so
 * it is removed here, explicitly, in dependency order. The RESTRICT constraints stay.
 *
 * Reversal path: switch those FKs to `ON DELETE CASCADE` in a migration, then delete
 * this helper and its two call sites (`delete-workspace.ts`, `delete-account-data.ts`).
 *
 * Delete order (children first):
 *   1. `scim_group_member`   -- RESTRICT to `membership_grant` / `scim_group_mapping`
 *   2. `membership_grant`    -- RESTRICT to `role` / `*_group_mapping`
 *   3. `oidc_group_mapping`, `scim_group_mapping` -- RESTRICT to `role`
 *   4. `membership`          -- RESTRICT to `role`
 * Only rows that belong to the given workspaces are touched: a row qualifies when its
 * role is owned by one of them, or its scope is one of them / one of their projects.
 * Rows of other workspaces -- including the same person's memberships elsewhere --
 * are untouched.
 */
export async function deleteWorkspaceRoleDependents(
  tx: WorkspaceDeletionTransaction,
  workspaceIds: readonly string[],
): Promise<void> {
  if (workspaceIds.length === 0) return;
  const { oidcMappingIds, scimMappingIds, membershipWhere, grantWhere } =
    workspaceDependentPredicates(tx, workspaceIds);
  const grantIds = tx
    .select({ id: schema.membershipGrantTable.id })
    .from(schema.membershipGrantTable)
    .where(grantWhere);

  // Materialise the id sets before the first delete so every later statement works
  // from the same snapshot regardless of delete order.
  const grantIdList = (await grantIds).map((row) => row.id);
  const oidcIdList = (await oidcMappingIds).map((row) => row.id);
  const scimIdList = (await scimMappingIds).map((row) => row.id);

  // 1. `scim_group_member` rows keyed to a doomed grant or mapping.
  if (grantIdList.length > 0) {
    await tx
      .delete(schema.scimGroupMemberTable)
      .where(
        inArray(schema.scimGroupMemberTable.membershipGrantId, grantIdList),
      );
  }
  if (scimIdList.length > 0) {
    await tx
      .delete(schema.scimGroupMemberTable)
      .where(
        inArray(schema.scimGroupMemberTable.scimGroupMappingId, scimIdList),
      );
  }

  // 2. Grants.
  if (grantIdList.length > 0) {
    await tx
      .delete(schema.membershipGrantTable)
      .where(inArray(schema.membershipGrantTable.id, grantIdList));
  }

  // 3. Group mappings.
  if (oidcIdList.length > 0) {
    await tx
      .delete(schema.oidcGroupMappingTable)
      .where(inArray(schema.oidcGroupMappingTable.id, oidcIdList));
  }
  if (scimIdList.length > 0) {
    await tx
      .delete(schema.scimGroupMappingTable)
      .where(inArray(schema.scimGroupMappingTable.id, scimIdList));
  }

  // 4. Memberships: those holding a workspace-owned role, plus any scoped to the
  // workspace or its projects.
  await tx.delete(schema.membershipTable).where(membershipWhere);
}
