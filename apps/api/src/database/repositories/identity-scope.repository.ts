import { BUILT_IN_ROLES, type ResolvedIdentity } from "@taskdesk/permissions";
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
import db from "..";
import type { Executor } from "../executor";
import {
  membershipTable,
  organisationTable,
  personTable,
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

/**
 * Current persisted identity admission corresponding to the canonical facts captured by
 * resolveIdentity. Caller-specific predicates use this beside their own resource check so a
 * resolved snapshot cannot outlive person, account, organisation, or customer-role revocation.
 */
export function currentResolvedIdentityPredicate(
  identity: ResolvedIdentity,
  executor: Executor = db,
) {
  const currentPerson = exists(
    executor
      .select({ one: sql`1` })
      .from(userTable)
      .innerJoin(personTable, eq(personTable.userId, userTable.id))
      .where(
        and(
          eq(userTable.id, identity.userId),
          eq(personTable.id, identity.personId),
          eq(personTable.side, identity.side),
          eq(personTable.active, true),
          sql`coalesce(${userTable.banned}, false) = false`,
          identity.side === "customer"
            ? eq(personTable.organisationId, identity.organisationId)
            : sql`true`,
        ),
      ),
  );

  if (identity.side === "staff") return currentPerson;
  if (identity.reach.kind !== "organisation") return sql`false`;

  const currentOrganisation = exists(
    executor
      .select({ one: sql`1` })
      .from(organisationTable)
      .where(
        and(
          eq(organisationTable.id, identity.organisationId),
          eq(organisationTable.active, true),
          eq(organisationTable.portalAccess, true),
          isNull(organisationTable.deletedAt),
        ),
      ),
  );
  const canonicalOwnMembership = exists(
    executor
      .select({ one: sql`1` })
      .from(membershipTable)
      .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
      .where(
        and(
          eq(membershipTable.personId, identity.personId),
          eq(membershipTable.scope, "organisation"),
          eq(membershipTable.scopeId, identity.organisationId),
          eq(membershipTable.seesAll, false),
          sql`length(${roleTable.id}) > 0`,
          eq(roleTable.key, BUILT_IN_ROLES.customer.key),
          eq(roleTable.scope, BUILT_IN_ROLES.customer.scope),
          isNull(roleTable.workspaceId),
          eq(roleTable.isSystem, true),
          eq(roleTable.rank, BUILT_IN_ROLES.customer.rank),
          eq(roleTable.capabilities, [...BUILT_IN_ROLES.customer.capabilities]),
        ),
      ),
  );
  const noOtherOrganisationMembership = not(
    exists(
      executor
        .select({ one: sql`1` })
        .from(membershipTable)
        .where(
          and(
            eq(membershipTable.personId, identity.personId),
            eq(membershipTable.scope, "organisation"),
            ne(membershipTable.scopeId, identity.organisationId),
          ),
        ),
    ),
  );

  return and(
    currentPerson,
    currentOrganisation,
    canonicalOwnMembership,
    noOtherOrganisationMembership,
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
