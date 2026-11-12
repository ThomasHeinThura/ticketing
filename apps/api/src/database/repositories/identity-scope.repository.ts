import { BUILT_IN_ROLES, type ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  ne,
  not,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isBuiltInWorkspaceRoleKey } from "../../permissions/resolve-identity";
import { WORKSPACE_PROJECT_SEE_ALL_ROLES } from "../../permissions/workspace-project-reach";
import db from "..";
import type { Executor } from "../executor";
import {
  membershipTable,
  personTable,
  projectTable,
  roleTable,
  userTable,
  workspaceRoleTable,
  workspaceUserTable,
} from "../schema";

/** Role facts admitted by resolveIdentity's scoped-role membership loader. */
export function canonicalScopedRoleMembership(
  scope: SQLWrapper,
  roleId: SQLWrapper,
  roleScope: SQLWrapper,
  roleWorkspaceId: SQLWrapper,
  roleKey: SQLWrapper,
  roleRank: SQLWrapper,
  capabilities: SQLWrapper,
  scopeWorkspaceId: SQLWrapper,
) {
  return and(
    eq(scope, roleScope),
    inArray(roleScope, ["project", "workspace"]),
    sql`length(${roleId}) > 0`,
    eq(roleWorkspaceId, scopeWorkspaceId),
    sql`length(${roleKey}) > 0`,
    wellFormedRoleRow(roleRank, capabilities),
  );
}

/** resolveIdentity's role-row shape check: a 32-bit rank and an array of string capabilities. */
function wellFormedRoleRow(roleRank: SQLWrapper, capabilities: SQLWrapper) {
  return and(
    sql`${roleRank} BETWEEN -2147483648 AND 2147483647`,
    sql`CASE WHEN jsonb_typeof(${capabilities}) = 'array' THEN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${capabilities}) AS scoped_capability(value)
      WHERE jsonb_typeof(scoped_capability.value) <> 'string'
    ) ELSE false END`,
  );
}

/**
 * Does a `workspace_member.role` key grant a workspace role in `workspaceId`? The precedence of
 * resolveIdentity's legacy membership branch, read from the current rows. The canonical row is
 * keyed exactly as resolveIdentity's loader keys it (scope, workspace, key), so a malformed
 * canonical row still blocks the legacy fallback.
 */
function legacyWorkspaceKeyAdmitted(
  roleKey: string,
  workspaceId: SQLWrapper,
  executor: Executor,
) {
  if (roleKey === "owner") return sql`true`;
  const isBuiltInKey = Object.hasOwn(BUILT_IN_ROLES, roleKey);
  // `instance_admin` and `customer` are built-ins of another scope, never a workspace role.
  if (isBuiltInKey && !isBuiltInWorkspaceRoleKey(roleKey)) return sql`false`;

  const canonicalRow = and(
    eq(roleTable.scope, "workspace"),
    eq(roleTable.workspaceId, workspaceId),
    eq(roleTable.key, roleKey),
  );
  const canonicalRowExists = exists(
    executor.select({ one: sql`1` }).from(roleTable).where(canonicalRow),
  );
  // A custom row that shares a built-in key is never trusted as that built-in (issue #318).
  const canonicalRowAdmits = exists(
    executor
      .select({ one: sql`1` })
      .from(roleTable)
      .where(
        and(
          canonicalRow,
          wellFormedRoleRow(roleTable.rank, roleTable.capabilities),
          isBuiltInKey ? eq(roleTable.isSystem, true) : undefined,
        ),
      ),
  );
  // Only viewer, member and admin have a legacy row; a custom key never falls back to one.
  const legacySystemRowAdmits = isBuiltInKey
    ? exists(
        executor
          .select({ one: sql`1` })
          .from(workspaceRoleTable)
          .where(
            and(
              eq(workspaceRoleTable.workspaceId, workspaceId),
              eq(workspaceRoleTable.role, roleKey),
              eq(workspaceRoleTable.isSystem, true),
            ),
          ),
      )
    : sql`false`;

  return sql`CASE WHEN ${canonicalRowExists} THEN ${canonicalRowAdmits} ELSE ${legacySystemRowAdmits} END`;
}

export function currentInstanceAdminPredicate(
  identity: ResolvedIdentity,
  executor: Executor,
) {
  if (identity.side !== "staff" || identity.reach.kind !== "all") {
    return sql`false`;
  }
  return exists(
    executor
      .select({ one: sql`1` })
      .from(userTable)
      .innerJoin(personTable, eq(personTable.userId, userTable.id))
      .where(
        and(
          eq(userTable.id, identity.userId),
          eq(personTable.id, identity.personId),
          eq(userTable.role, "admin"),
          sql`coalesce(${userTable.banned}, false) = false`,
          eq(personTable.side, "staff"),
          eq(personTable.active, true),
        ),
      ),
  );
}

/** Project visibility facts from the current canonical role tables, scoped to this caller. */
export function currentProjectReachPredicate(
  identity: ResolvedIdentity,
  projectId: SQLWrapper,
  projectWorkspaceId: SQLWrapper,
  projectOrganisationId: SQLWrapper,
  executor: Executor = db,
) {
  if (identity.side === "customer") {
    return identity.reach.kind === "organisation"
      ? eq(projectOrganisationId, identity.organisationId)
      : sql`false`;
  }

  const directProjectMembership = exists(
    executor
      .select({ one: sql`1` })
      .from(membershipTable)
      .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
      .where(
        and(
          eq(membershipTable.personId, identity.personId),
          eq(membershipTable.scope, "project"),
          eq(membershipTable.scopeId, projectId),
          canonicalScopedRoleMembership(
            membershipTable.scope,
            roleTable.id,
            roleTable.scope,
            roleTable.workspaceId,
            roleTable.key,
            roleTable.rank,
            roleTable.capabilities,
            projectWorkspaceId,
          ),
        ),
      ),
  );
  // PR-2 / reach step 4: membership of an ANCESTOR project, read at query time (no
  // materialised inherited rows). The chain is walked inside the project's own workspace only
  // (tenant boundary), stops at a soft-deleted ancestor, and is bounded by the depth cap
  // (`MAX_PROJECT_DEPTH` = 4 levels = at most 3 ancestors), so a stored cycle terminates.
  // Mirrors `reachAncestorIds` (project/hierarchy.ts). Customer callers returned above.
  const ancestorProjectMembership = exists(
    executor
      .select({ one: sql`1` })
      .from(membershipTable)
      .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
      .where(
        and(
          eq(membershipTable.personId, identity.personId),
          eq(membershipTable.scope, "project"),
          sql`${membershipTable.scopeId} IN (
            WITH RECURSIVE reach_chain(id, parent_id, depth) AS (
              SELECT chain_start.id, chain_start.parent_id, 1
              FROM ${projectTable} AS chain_start
              WHERE chain_start.id = ${projectId}
                AND chain_start.workspace_id = ${projectWorkspaceId}
              UNION ALL
              SELECT chain_next.id, chain_next.parent_id, reach_chain.depth + 1
              FROM ${projectTable} AS chain_next
              INNER JOIN reach_chain ON chain_next.id = reach_chain.parent_id
              WHERE chain_next.workspace_id = ${projectWorkspaceId}
                AND chain_next.deleted_at IS NULL
                AND reach_chain.depth < 4
            )
            SELECT reach_chain.id FROM reach_chain WHERE reach_chain.depth > 1
          )`,
          canonicalScopedRoleMembership(
            membershipTable.scope,
            roleTable.id,
            roleTable.scope,
            roleTable.workspaceId,
            roleTable.key,
            roleTable.rank,
            roleTable.capabilities,
            projectWorkspaceId,
          ),
        ),
      ),
  );
  const workspaceSeesAll = exists(
    executor
      .select({ one: sql`1` })
      .from(membershipTable)
      .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
      .where(
        and(
          eq(membershipTable.personId, identity.personId),
          eq(membershipTable.scope, "workspace"),
          eq(membershipTable.scopeId, projectWorkspaceId),
          eq(membershipTable.seesAll, true),
          canonicalScopedRoleMembership(
            membershipTable.scope,
            roleTable.id,
            roleTable.scope,
            roleTable.workspaceId,
            roleTable.key,
            roleTable.rank,
            roleTable.capabilities,
            projectWorkspaceId,
          ),
        ),
      ),
  );

  // D-E derives reach from the current, unambiguous workspace role, even when older
  // memberships have no persisted sees_all flag. Use the same role admission as identity.
  const duplicateMember = alias(workspaceUserTable, "see_all_duplicate_member");
  const workspaceRoleSeesAll = exists(
    executor
      .select({ one: sql`1` })
      .from(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.workspaceId, projectWorkspaceId),
          eq(workspaceUserTable.userId, identity.userId),
          not(
            exists(
              executor
                .select({ one: sql`1` })
                .from(duplicateMember)
                .where(
                  and(
                    eq(duplicateMember.workspaceId, projectWorkspaceId),
                    eq(duplicateMember.userId, identity.userId),
                    ne(duplicateMember.id, workspaceUserTable.id),
                  ),
                ),
            ),
          ),
          or(
            ...WORKSPACE_PROJECT_SEE_ALL_ROLES.map((key) =>
              and(
                eq(workspaceUserTable.role, key),
                legacyWorkspaceKeyAdmitted(key, projectWorkspaceId, executor),
              ),
            ),
          ),
        ),
      ),
  );

  // TM-4 / reach step 5: the caller is an active member of the team that owns the project.
  // `identity.teamIds` is already limited to teams of workspaces the person currently belongs
  // to; the same-workspace check below keeps a stale team id from reaching across tenants.
  const ownerProject = alias(projectTable, "reach_owner_project");
  const ownerTeamReach =
    Array.isArray(identity.teamIds) && identity.teamIds.length > 0
      ? exists(
          executor
            .select({ one: sql`1` })
            .from(ownerProject)
            .where(
              and(
                eq(ownerProject.id, projectId),
                eq(ownerProject.workspaceId, projectWorkspaceId),
                inArray(ownerProject.ownerTeamId, [...identity.teamIds]),
              ),
            ),
        )
      : sql`false`;

  return or(
    currentInstanceAdminPredicate(identity, executor),
    directProjectMembership,
    ancestorProjectMembership,
    workspaceSeesAll,
    workspaceRoleSeesAll,
    ownerTeamReach,
  );
}

/**
 * Current staff reach to a workspace: instance admin, a valid workspace-scope membership row,
 * or a single legacy `workspace_member` row whose key resolveIdentity admits, with its
 * precedence (Thomas, 4 November 2026: a custom role reaches exactly as its canonical row
 * grants, the rule #1035 applied to lead and manager):
 *
 * - `owner` is compiled-in and needs no role row;
 * - otherwise the canonical workspace-scope `role` row for (workspace, key) is authoritative
 *   when it exists, system or custom: it admits only when well formed, and a built-in key only
 *   through its system row;
 * - the legacy `workspace_role` system row backs a built-in workspace key only when no
 *   canonical row exists. A custom key has no legacy fallback, and `instance_admin` or
 *   `customer` is never a workspace role.
 */
export function currentWorkspaceReachPredicate(
  identity: ResolvedIdentity,
  workspaceId: SQLWrapper,
  executor: Executor = db,
) {
  if (identity.side !== "staff") return sql`false`;
  const scopedRoleMembership = exists(
    executor
      .select({ one: sql`1` })
      .from(membershipTable)
      .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
      .where(
        and(
          eq(membershipTable.personId, identity.personId),
          eq(membershipTable.scope, "workspace"),
          eq(membershipTable.scopeId, workspaceId),
          canonicalScopedRoleMembership(
            membershipTable.scope,
            roleTable.id,
            roleTable.scope,
            roleTable.workspaceId,
            roleTable.key,
            roleTable.rank,
            roleTable.capabilities,
            workspaceId,
          ),
        ),
      ),
  );

  const legacyRoleChecks = identity.authority
    .filter((grant) => grant.scope === "workspace")
    .map((grant) => {
      const duplicateWorkspaceMember = alias(
        workspaceUserTable,
        "duplicate_workspace_member",
      );
      const roleIsCanonical = legacyWorkspaceKeyAdmitted(
        grant.roleKey,
        workspaceId,
        executor,
      );
      return and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, identity.userId),
        eq(workspaceUserTable.role, grant.roleKey),
        not(
          exists(
            executor
              .select({ one: sql`1` })
              .from(duplicateWorkspaceMember)
              .where(
                and(
                  eq(duplicateWorkspaceMember.workspaceId, workspaceId),
                  eq(duplicateWorkspaceMember.userId, identity.userId),
                  ne(duplicateWorkspaceMember.id, workspaceUserTable.id),
                ),
              ),
          ),
        ),
        roleIsCanonical,
      );
    });
  const canonicalLegacyRole =
    legacyRoleChecks.length > 0
      ? exists(
          executor
            .select({ one: sql`1` })
            .from(workspaceUserTable)
            .where(or(...legacyRoleChecks)),
        )
      : sql`false`;

  return or(
    currentInstanceAdminPredicate(identity, executor),
    scopedRoleMembership,
    canonicalLegacyRole,
  );
}
