import type { ResolvedIdentity } from "@taskdesk/permissions";
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
    sql`${roleRank} BETWEEN -2147483648 AND 2147483647`,
    sql`CASE WHEN jsonb_typeof(${capabilities}) = 'array' THEN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${capabilities}) AS scoped_capability(value)
      WHERE jsonb_typeof(scoped_capability.value) <> 'string'
    ) ELSE false END`,
  );
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

  return or(
    currentInstanceAdminPredicate(identity, executor),
    directProjectMembership,
    ancestorProjectMembership,
    workspaceSeesAll,
  );
}

/** Current staff reach to a workspace, including only canonical legacy workspace roles. */
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
      const roleIsCanonical =
        grant.roleKey === "owner"
          ? sql`true`
          : exists(
              executor
                .select({ one: sql`1` })
                .from(workspaceRoleTable)
                .where(
                  and(
                    eq(workspaceRoleTable.workspaceId, workspaceId),
                    eq(workspaceRoleTable.role, grant.roleKey),
                    eq(workspaceRoleTable.isSystem, true),
                  ),
                ),
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
