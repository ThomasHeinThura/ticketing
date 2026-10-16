import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { Executor } from "./executor";
import db from "./index";
import {
  membershipTable,
  personTable,
  roleTable,
  userTable,
  workspaceRoleTable,
  workspaceUserTable,
} from "./schema";

/** Role facts admitted by resolveIdentity's scoped-role membership loader. */
export function canonicalScopedRoleMembership(
  scope: SQLWrapper,
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
