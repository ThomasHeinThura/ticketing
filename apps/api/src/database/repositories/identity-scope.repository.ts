import {
  BUILT_IN_ROLES,
  CAPABILITY_NAMES,
  expandCapabilities,
  type ResolvedIdentity,
  roleScopeTier,
} from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  not,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isBuiltInWorkspaceRoleKey } from "../../permissions/resolve-identity";
import { isServicePrincipalId } from "../../permissions/service-principal";
import { WORKSPACE_PROJECT_SEE_ALL_ROLES } from "../../permissions/workspace-project-reach";
import db from "..";
import type { Executor } from "../executor";
import {
  apiKeyExtensionTable,
  apikeyTable,
  customerProjectAccessTable,
  membershipTable,
  personTable,
  projectTable,
  roleTable,
  teamMemberTable,
  teamTable,
  userTable,
  workspaceRoleTable,
  workspaceUserTable,
} from "../schema";

/**
 * D-D (Thomas, 12 Nov 2026): SQL predicate asserting `personId` currently holds explicit
 * `customer_project_access` to `projectId` AND `project` is live (`deleted_at IS NULL`) and
 * belongs to `organisationId`.
 */
export function customerProjectAccessExists(
  personId: string | SQLWrapper,
  organisationId: string | SQLWrapper,
  projectId: string | SQLWrapper,
  executor: Executor = db,
) {
  const accessProject = alias(projectTable, "customer_access_project");
  return exists(
    executor
      .select({ one: sql`1` })
      .from(customerProjectAccessTable)
      .innerJoin(
        accessProject,
        eq(accessProject.id, customerProjectAccessTable.projectId),
      )
      .where(
        and(
          eq(customerProjectAccessTable.personId, personId),
          eq(customerProjectAccessTable.projectId, projectId),
          eq(accessProject.organisationId, organisationId),
          isNull(accessProject.deletedAt),
        ),
      ),
  );
}

/** Role facts admitted by resolveIdentity's scoped-role membership loader. */
export function canonicalScopedRoleMembership(
  scope: SQLWrapper,
  roleId: SQLWrapper,
  roleScope: SQLWrapper,
  roleWorkspaceId: SQLWrapper,
  roleKey: SQLWrapper,
  roleRank: SQLWrapper,
  capabilities: SQLWrapper,
  roleIsSystem: SQLWrapper,
  scopeWorkspaceId: SQLWrapper,
) {
  return and(
    eq(scope, roleScope),
    inArray(roleScope, ["project", "workspace"]),
    sql`length(${roleId}) > 0`,
    eq(roleWorkspaceId, scopeWorkspaceId),
    sql`length(${roleKey}) > 0`,
    wellFormedRoleRow(roleRank, capabilities),
    // Match resolveIdentity: reserved workspace role keys require a genuine system row.
    or(
      ne(scope, "workspace"),
      not(inArray(roleKey, [...WORKSPACE_PROJECT_SEE_ALL_ROLES])),
      eq(roleIsSystem, true),
    ),
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
export function legacyWorkspaceKeyAdmitted(
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
    if (identity.reach.kind !== "organisation") return sql`false`;
    return and(
      eq(projectOrganisationId, identity.organisationId),
      customerProjectAccessExists(
        identity.personId,
        identity.organisationId,
        projectId,
        executor,
      ),
    );
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
            roleTable.isSystem,
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
            roleTable.isSystem,
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
          or(
            eq(membershipTable.seesAll, true),
            inArray(roleTable.key, [...WORKSPACE_PROJECT_SEE_ALL_ROLES]),
          ),
          canonicalScopedRoleMembership(
            membershipTable.scope,
            roleTable.id,
            roleTable.scope,
            roleTable.workspaceId,
            roleTable.key,
            roleTable.rank,
            roleTable.capabilities,
            roleTable.isSystem,
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

  // TM-4/S5: team reach needs a current team row and raw or trusted scoped workspace membership.
  const ownerProject = alias(projectTable, "reach_owner_project");
  const ownerTeam = alias(teamTable, "reach_owner_team");
  const ownerTeamMember = alias(teamMemberTable, "reach_owner_team_member");
  const ownerUser = alias(userTable, "reach_owner_user");
  const ownerPerson = alias(personTable, "reach_owner_person");
  const ownerWorkspaceMember = alias(
    workspaceUserTable,
    "reach_owner_workspace_member",
  );
  const ownerScopedMembership = alias(
    membershipTable,
    "reach_owner_scoped_membership",
  );
  const ownerScopedRole = alias(roleTable, "reach_owner_scoped_role");
  const ownerTeamReach =
    Array.isArray(identity.teamIds) && identity.teamIds.length > 0
      ? exists(
          executor
            .select({ one: sql`1` })
            .from(ownerProject)
            .innerJoin(ownerTeam, eq(ownerTeam.id, ownerProject.ownerTeamId))
            .innerJoin(
              ownerTeamMember,
              eq(ownerTeamMember.teamId, ownerTeam.id),
            )
            .innerJoin(ownerUser, eq(ownerUser.id, ownerTeamMember.userId))
            .innerJoin(ownerPerson, eq(ownerPerson.userId, ownerUser.id))
            .where(
              and(
                eq(ownerProject.id, projectId),
                eq(ownerProject.workspaceId, projectWorkspaceId),
                eq(ownerTeam.workspaceId, projectWorkspaceId),
                inArray(ownerTeam.id, [...identity.teamIds]),
                eq(ownerUser.id, identity.userId),
                sql`coalesce(${ownerUser.banned}, false) = false`,
                eq(ownerPerson.id, identity.personId),
                eq(ownerPerson.side, "staff"),
                eq(ownerPerson.active, true),
                or(
                  exists(
                    executor
                      .select({ one: sql`1` })
                      .from(ownerWorkspaceMember)
                      .where(
                        and(
                          eq(
                            ownerWorkspaceMember.workspaceId,
                            ownerTeam.workspaceId,
                          ),
                          eq(ownerWorkspaceMember.userId, identity.userId),
                        ),
                      ),
                  ),
                  exists(
                    executor
                      .select({ one: sql`1` })
                      .from(ownerScopedMembership)
                      .innerJoin(
                        ownerScopedRole,
                        eq(ownerScopedRole.id, ownerScopedMembership.roleId),
                      )
                      .where(
                        and(
                          eq(ownerScopedMembership.personId, identity.personId),
                          eq(ownerScopedMembership.scope, "workspace"),
                          eq(
                            ownerScopedMembership.scopeId,
                            ownerTeam.workspaceId,
                          ),
                          eq(ownerScopedRole.scope, "workspace"),
                          eq(
                            ownerScopedRole.workspaceId,
                            ownerTeam.workspaceId,
                          ),
                          sql`length(${ownerScopedRole.id}) > 0`,
                          sql`length(${ownerScopedRole.key}) > 0`,
                          wellFormedRoleRow(
                            ownerScopedRole.rank,
                            ownerScopedRole.capabilities,
                          ),
                        ),
                      ),
                  ),
                ),
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
  if (isServicePrincipalId(identity.userId)) {
    const apiKeyId = identity.userId.slice("service-key:".length);
    const permittedWorkspaceIds = identity.memberships
      .filter((membership) => membership.scope === "workspace")
      .map((membership) => membership.scopeId);
    if (!apiKeyId || permittedWorkspaceIds.length === 0) return sql`false`;
    return (
      and(
        inArray(workspaceId, permittedWorkspaceIds),
        exists(
          executor
            .select({ one: sql`1` })
            .from(apikeyTable)
            .innerJoin(
              apiKeyExtensionTable,
              eq(apiKeyExtensionTable.apikeyId, apikeyTable.id),
            )
            .where(
              and(
                eq(apikeyTable.id, apiKeyId),
                eq(apikeyTable.enabled, true),
                or(
                  isNull(apikeyTable.expiresAt),
                  sql`${apikeyTable.expiresAt} > now()`,
                ),
                eq(apiKeyExtensionTable.workspaceId, workspaceId),
                isNull(apiKeyExtensionTable.personId),
                isNull(apiKeyExtensionTable.disabledAt),
              ),
            ),
        ),
      ) ?? sql`false`
    );
  }
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
            roleTable.isSystem,
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

const WORK_ITEM_READ_SOURCES = CAPABILITY_NAMES.filter((capability) =>
  expandCapabilities([capability], { tier: roleScopeTier("workspace") }).has(
    "work_item:read",
  ),
);
const WORKSPACE_BUILTIN_KEYS = Object.values(BUILT_IN_ROLES)
  .filter((role) => role.scope === "workspace")
  .map((role) => role.key);
const NON_WORKSPACE_BUILTIN_KEYS = Object.values(BUILT_IN_ROLES)
  .filter((role) => role.scope !== "workspace")
  .map((role) => role.key);
const LEGACY_WORK_ITEM_READ_KEYS = Object.values(BUILT_IN_ROLES)
  .filter(
    (role) =>
      role.scope === "workspace" &&
      role.key !== "owner" &&
      expandCapabilities(role.capabilities, {
        tier: roleScopeTier("workspace"),
      }).has("work_item:read"),
  )
  .map((role) => role.key);

/** Current workspace work-item read authority, matching the resolver's canonical/legacy role precedence. */
export function currentWorkspaceWorkItemReadPredicate(
  identity: ResolvedIdentity,
  workspaceId: SQLWrapper,
  executor: Executor = db,
) {
  if (identity.side !== "staff" || isServicePrincipalId(identity.userId))
    return sql`false`;
  const roleHasRead = sql`${roleTable.capabilities} ?| ARRAY[${sql.join(
    WORK_ITEM_READ_SOURCES.map((capability) => sql`${capability}`),
    sql`, `,
  )}]::text[]`;
  const currentStaff = exists(
    executor
      .select({ one: sql`1` })
      .from(userTable)
      .innerJoin(personTable, eq(personTable.userId, userTable.id))
      .where(
        and(
          eq(userTable.id, identity.userId),
          eq(personTable.id, identity.personId),
          eq(personTable.side, "staff"),
          eq(personTable.active, true),
          sql`coalesce(${userTable.banned}, false) = false`,
        ),
      ),
  );
  const scopedRead = exists(
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
            roleTable.isSystem,
            workspaceId,
          ),
          roleHasRead,
        ),
      ),
  );
  const canonicalLegacyRole = and(
    eq(roleTable.scope, "workspace"),
    eq(roleTable.workspaceId, workspaceId),
    eq(roleTable.key, workspaceUserTable.role),
  );
  const duplicateReadMember = alias(
    workspaceUserTable,
    "duplicate_read_member",
  );
  const legacyRead = exists(
    executor
      .select({ one: sql`1` })
      .from(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.workspaceId, workspaceId),
          eq(workspaceUserTable.userId, identity.userId),
          not(
            exists(
              executor
                .select({ one: sql`1` })
                .from(duplicateReadMember)
                .where(
                  and(
                    eq(duplicateReadMember.workspaceId, workspaceId),
                    eq(duplicateReadMember.userId, identity.userId),
                    ne(duplicateReadMember.id, workspaceUserTable.id),
                  ),
                ),
            ),
          ),
          or(
            eq(workspaceUserTable.role, "owner"),
            exists(
              executor
                .select({ one: sql`1` })
                .from(roleTable)
                .where(
                  and(
                    canonicalLegacyRole,
                    ne(workspaceUserTable.role, "owner"),
                    not(inArray(roleTable.key, NON_WORKSPACE_BUILTIN_KEYS)),
                    wellFormedRoleRow(roleTable.rank, roleTable.capabilities),
                    or(
                      not(inArray(roleTable.key, WORKSPACE_BUILTIN_KEYS)),
                      eq(roleTable.isSystem, true),
                    ),
                    roleHasRead,
                  ),
                ),
            ),
            and(
              inArray(workspaceUserTable.role, LEGACY_WORK_ITEM_READ_KEYS),
              not(
                exists(
                  executor
                    .select({ one: sql`1` })
                    .from(roleTable)
                    .where(canonicalLegacyRole),
                ),
              ),
              exists(
                executor
                  .select({ one: sql`1` })
                  .from(workspaceRoleTable)
                  .where(
                    and(
                      eq(workspaceRoleTable.workspaceId, workspaceId),
                      eq(workspaceRoleTable.role, workspaceUserTable.role),
                      eq(workspaceRoleTable.isSystem, true),
                    ),
                  ),
              ),
            ),
          ),
        ),
      ),
  );
  return and(currentStaff, or(scopedRead, legacyRead));
}

/** Current workspace capability; reach is checked separately. */
function currentWorkspaceSettingsCapability(
  identity: ResolvedIdentity,
  workspaceId: SQLWrapper,
  capability: "workspace:manage_settings" | "project:read" | "api_key:manage",
  executor: Executor,
  allowedKeys?: readonly string[],
  memberRowOnly = false,
) {
  if (identity.side !== "staff") return sql`false`;
  const sources = CAPABILITY_NAMES.filter((source) =>
    expandCapabilities([source], { tier: roleScopeTier("workspace") }).has(
      capability,
    ),
  );
  const hasCapability = sql`${roleTable.capabilities} ?| ARRAY[${sql.join(
    sources.map((source) => sql`${source}`),
    sql`, `,
  )}]::text[]`;
  if (isServicePrincipalId(identity.userId)) {
    if (allowedKeys || memberRowOnly) return sql`false`;
    return and(
      currentWorkspaceReachPredicate(identity, workspaceId, executor),
      exists(
        executor
          .select({ one: sql`1` })
          .from(apiKeyExtensionTable)
          .where(
            and(
              eq(
                apiKeyExtensionTable.apikeyId,
                identity.userId.slice("service-key:".length),
              ),
              eq(apiKeyExtensionTable.workspaceId, workspaceId),
              sql`${apiKeyExtensionTable.capabilities} ?| ARRAY[${sql.join(
                sources.map((source) => sql`${source}`),
                sql`, `,
              )}]::text[]`,
            ),
          ),
      ),
    );
  }
  const currentStaff = exists(
    executor
      .select({ one: sql`1` })
      .from(userTable)
      .innerJoin(personTable, eq(personTable.userId, userTable.id))
      .where(
        and(
          eq(userTable.id, identity.userId),
          eq(personTable.id, identity.personId),
          eq(personTable.side, "staff"),
          eq(personTable.active, true),
          sql`coalesce(${userTable.banned}, false) = false`,
        ),
      ),
  );
  const scoped = exists(
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
            roleTable.isSystem,
            workspaceId,
          ),
          allowedKeys ? inArray(roleTable.key, [...allowedKeys]) : undefined,
          hasCapability,
        ),
      ),
  );
  const duplicate = alias(workspaceUserTable, "p4_duplicate_workspace_member");
  const currentMember = and(
    eq(workspaceUserTable.workspaceId, workspaceId),
    eq(workspaceUserTable.userId, identity.userId),
    allowedKeys
      ? inArray(workspaceUserTable.role, [...allowedKeys])
      : undefined,
    not(
      exists(
        executor
          .select({ one: sql`1` })
          .from(duplicate)
          .where(
            and(
              eq(duplicate.workspaceId, workspaceId),
              eq(duplicate.userId, identity.userId),
              ne(duplicate.id, workspaceUserTable.id),
            ),
          ),
      ),
    ),
  );
  const canonical = and(
    eq(roleTable.scope, "workspace"),
    eq(roleTable.workspaceId, workspaceId),
    eq(roleTable.key, workspaceUserTable.role),
  );
  const builtInKeys = Object.values(BUILT_IN_ROLES)
    .filter(
      (role) =>
        role.scope === "workspace" &&
        role.key !== "owner" &&
        expandCapabilities(role.capabilities, {
          tier: roleScopeTier("workspace"),
        }).has(capability),
    )
    .map((role) => role.key);
  const legacy = exists(
    executor
      .select({ one: sql`1` })
      .from(workspaceUserTable)
      .where(
        and(
          currentMember,
          or(
            expandCapabilities(BUILT_IN_ROLES.owner.capabilities, {
              tier: roleScopeTier("workspace"),
            }).has(capability)
              ? eq(workspaceUserTable.role, "owner")
              : sql`false`,
            exists(
              executor
                .select({ one: sql`1` })
                .from(roleTable)
                .where(
                  and(
                    canonical,
                    ne(workspaceUserTable.role, "owner"),
                    not(inArray(roleTable.key, NON_WORKSPACE_BUILTIN_KEYS)),
                    wellFormedRoleRow(roleTable.rank, roleTable.capabilities),
                    or(
                      not(inArray(roleTable.key, WORKSPACE_BUILTIN_KEYS)),
                      eq(roleTable.isSystem, true),
                    ),
                    hasCapability,
                  ),
                ),
            ),
            and(
              inArray(workspaceUserTable.role, builtInKeys),
              not(
                exists(
                  executor
                    .select({ one: sql`1` })
                    .from(roleTable)
                    .where(canonical),
                ),
              ),
              exists(
                executor
                  .select({ one: sql`1` })
                  .from(workspaceRoleTable)
                  .where(
                    and(
                      eq(workspaceRoleTable.workspaceId, workspaceId),
                      eq(workspaceRoleTable.role, workspaceUserTable.role),
                      eq(workspaceRoleTable.isSystem, true),
                    ),
                  ),
              ),
            ),
          ),
        ),
      ),
  );
  return and(currentStaff, memberRowOnly ? legacy : or(scoped, legacy));
}

/** The service-key list reads the caller's one current workspace-member role. */
export function currentWorkspaceApiKeyManagePredicate(
  identity: ResolvedIdentity,
  workspaceId: SQLWrapper,
  executor: Executor = db,
) {
  return currentWorkspaceSettingsCapability(
    identity,
    workspaceId,
    "api_key:manage",
    executor,
    undefined,
    true,
  );
}

export function currentWorkspaceManageSettingsPredicate(
  identity: ResolvedIdentity,
  workspaceId: SQLWrapper,
  executor: Executor = db,
) {
  return currentWorkspaceSettingsCapability(
    identity,
    workspaceId,
    "workspace:manage_settings",
    executor,
  );
}

export function currentProjectReadPredicate(
  identity: ResolvedIdentity,
  projectId: SQLWrapper,
  workspaceId: SQLWrapper,
  executor: Executor = db,
) {
  if (identity.side !== "staff" || isServicePrincipalId(identity.userId))
    return sql`false`;
  const sources = CAPABILITY_NAMES.filter((source) =>
    expandCapabilities([source], { tier: roleScopeTier("project") }).has(
      "project:read",
    ),
  );
  const roleHasRead = sql`${roleTable.capabilities} ?| ARRAY[${sql.join(
    sources.map((source) => sql`${source}`),
    sql`, `,
  )}]::text[]`;
  const scopedProjectRole = (scopeId: SQLWrapper, needsRead: boolean) =>
    exists(
      executor
        .select({ one: sql`1` })
        .from(membershipTable)
        .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
        .where(
          and(
            eq(membershipTable.personId, identity.personId),
            eq(membershipTable.scope, "project"),
            eq(membershipTable.scopeId, scopeId),
            canonicalScopedRoleMembership(
              membershipTable.scope,
              roleTable.id,
              roleTable.scope,
              roleTable.workspaceId,
              roleTable.key,
              roleTable.rank,
              roleTable.capabilities,
              roleTable.isSystem,
              workspaceId,
            ),
            needsRead ? roleHasRead : undefined,
          ),
        ),
    );
  const nearestMember = alias(membershipTable, "p4_nearest_member");
  const nearestRole = alias(roleTable, "p4_nearest_role");
  const nearestAncestor = sql`(
    WITH RECURSIVE p4_chain(id, parent_id, depth) AS (
      SELECT p.id, p.parent_id, 1 FROM ${projectTable} AS p
      WHERE p.id = ${projectId} AND p.workspace_id = ${workspaceId}
      UNION ALL
      SELECT p.id, p.parent_id, p4_chain.depth + 1 FROM ${projectTable} AS p
      INNER JOIN p4_chain ON p.id = p4_chain.parent_id
      WHERE p.workspace_id = ${workspaceId} AND p.deleted_at IS NULL AND p4_chain.depth < 4
    )
    SELECT p4_chain.id FROM p4_chain WHERE p4_chain.depth > 1
      AND ${exists(
        executor
          .select({ one: sql`1` })
          .from(nearestMember)
          .innerJoin(nearestRole, eq(nearestRole.id, nearestMember.roleId))
          .where(
            and(
              eq(nearestMember.personId, identity.personId),
              eq(nearestMember.scope, "project"),
              eq(nearestMember.scopeId, sql.raw("p4_chain.id")),
              canonicalScopedRoleMembership(
                nearestMember.scope,
                nearestRole.id,
                nearestRole.scope,
                nearestRole.workspaceId,
                nearestRole.key,
                nearestRole.rank,
                nearestRole.capabilities,
                nearestRole.isSystem,
                workspaceId,
              ),
            ),
          ),
      )}
    ORDER BY p4_chain.depth LIMIT 1
  )`;
  const direct = scopedProjectRole(projectId, false);
  const workspaceRead = currentWorkspaceSettingsCapability(
    identity,
    workspaceId,
    "project:read",
    executor,
  );
  const additiveRead = currentWorkspaceSettingsCapability(
    identity,
    workspaceId,
    "project:read",
    executor,
    [...WORKSPACE_PROJECT_SEE_ALL_ROLES],
  );
  const currentStaff = exists(
    executor
      .select({ one: sql`1` })
      .from(userTable)
      .innerJoin(personTable, eq(personTable.userId, userTable.id))
      .where(
        and(
          eq(userTable.id, identity.userId),
          eq(personTable.id, identity.personId),
          eq(personTable.side, "staff"),
          eq(personTable.active, true),
          sql`coalesce(${userTable.banned}, false) = false`,
        ),
      ),
  );
  return and(
    currentStaff,
    or(
      additiveRead,
      and(direct, scopedProjectRole(projectId, true)),
      and(not(direct), scopedProjectRole(nearestAncestor, true)),
      and(not(direct), sql`${nearestAncestor} IS NULL`, workspaceRead),
    ),
  );
}
