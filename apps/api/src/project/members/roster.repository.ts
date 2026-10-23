import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "../../database";
import type { Executor } from "../../database/executor";
import type { RosterRoleRef, RosterRow } from "./roster";

const { membershipTable, membershipGrantTable, personTable, roleTable } =
  schema;

/**
 * Project-scope roster roles. `project-lead` is seeded per workspace (migration 0124, written
 * on demand by `ensureProjectLeadRole`); `project-member` and `project-viewer` are the matching
 * system roles for the built-in `member` and `viewer` lists, created on first use the same way,
 * so adding a colleague to a roster never has to grant lead authority.
 */
export const ROSTER_ROLE_DEFINITIONS = {
  "project-lead": {
    name: "Project lead",
    builtIn: "lead",
    description:
      "Project-scope lead granted to the creator of a project (rbac.md built-in lead capabilities).",
  },
  "project-member": {
    name: "Project member",
    builtIn: "member",
    description:
      "Project-scope member: creates and updates work items, comments internally, self-assigns.",
  },
  "project-viewer": {
    name: "Project viewer",
    builtIn: "viewer",
    description: "Project-scope viewer: read-only.",
  },
} as const;
export type RosterRoleKey = keyof typeof ROSTER_ROLE_DEFINITIONS;
export const ROSTER_ROLE_KEYS = Object.keys(
  ROSTER_ROLE_DEFINITIONS,
) as RosterRoleKey[];

export function isRosterRoleKey(key: string): key is RosterRoleKey {
  return Object.hasOwn(ROSTER_ROLE_DEFINITIONS, key);
}

/** Project-scope `membership` rows of the given projects, joined with person and role. */
export async function loadRosterRows(
  executor: Executor,
  projectIds: readonly string[],
): Promise<Map<string, RosterRow[]>> {
  const out = new Map<string, RosterRow[]>();
  if (projectIds.length === 0) return out;
  const rows = await executor
    .select({
      projectId: membershipTable.scopeId,
      personId: personTable.id,
      displayName: sql<
        string | null
      >`coalesce(${personTable.displayName}, ${schema.userTable.name})`,
      active: personTable.active,
      jobTitle: personTable.jobTitle,
      roleId: roleTable.id,
      roleKey: roleTable.key,
      roleName: roleTable.name,
      roleRank: roleTable.rank,
      hasDirectGrant: sql<boolean>`exists (
        select 1 from ${membershipGrantTable} g
        where g.person_id = ${membershipTable.personId}
          and g.scope = 'project'
          and g.scope_id = ${membershipTable.scopeId}
          and g.source_kind = 'direct'
          and g.revoked_at is null
      )`,
    })
    .from(membershipTable)
    .innerJoin(personTable, eq(personTable.id, membershipTable.personId))
    .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
    .leftJoin(schema.userTable, eq(schema.userTable.id, personTable.userId))
    .where(
      and(
        eq(membershipTable.scope, "project"),
        inArray(membershipTable.scopeId, [...projectIds]),
      ),
    )
    .orderBy(asc(personTable.id));
  for (const { projectId, ...row } of rows) {
    const list = out.get(projectId);
    if (list) list.push(row);
    else out.set(projectId, [row]);
  }
  return out;
}

export async function loadProjectNames(
  executor: Executor,
  workspaceId: string,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const rows = await executor
    .select({ id: schema.projectTable.id, name: schema.projectTable.name })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.workspaceId, workspaceId),
        inArray(schema.projectTable.id, [...projectIds]),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The workspace's project-scope roles (any key), lowest rank first. */
export async function listProjectScopeRoles(
  executor: Executor,
  workspaceId: string,
): Promise<Array<RosterRoleRef & { isSystem: boolean }>> {
  const rows = await executor
    .select({
      roleId: roleTable.id,
      roleKey: roleTable.key,
      roleName: roleTable.name,
      roleRank: roleTable.rank,
      isSystem: roleTable.isSystem,
    })
    .from(roleTable)
    .where(
      and(
        eq(roleTable.scope, "project"),
        eq(roleTable.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(roleTable.rank), asc(roleTable.key));
  return rows;
}

/**
 * The role to grant for `key`: an existing project-scope role of the workspace, or - for the
 * three canonical roster keys only - a system role created on first use. A same-keyed row that
 * is not `is_system` is never trusted (fail closed), exactly like `ensureProjectLeadRole`.
 */
export async function resolveRosterRole(
  executor: Executor,
  workspaceId: string,
  key: string,
): Promise<RosterRoleRef | null> {
  const find = async () => {
    const [row] = await executor
      .select({
        roleId: roleTable.id,
        roleKey: roleTable.key,
        roleName: roleTable.name,
        roleRank: roleTable.rank,
        isSystem: roleTable.isSystem,
      })
      .from(roleTable)
      .where(
        and(
          eq(roleTable.scope, "project"),
          eq(roleTable.workspaceId, workspaceId),
          eq(roleTable.key, key),
        ),
      )
      .limit(1);
    return row;
  };
  let row = await find();
  if (!row && isRosterRoleKey(key)) {
    const definition = ROSTER_ROLE_DEFINITIONS[key];
    const builtIn = BUILT_IN_ROLES[definition.builtIn];
    await executor
      .insert(roleTable)
      .values({
        id: createId(),
        scope: "project",
        workspaceId,
        key,
        name: definition.name,
        description: definition.description,
        rank: builtIn.rank,
        capabilities: [...builtIn.capabilities],
        isSystem: true,
        isEditable: true,
      })
      .onConflictDoNothing();
    row = await find();
  }
  if (!row?.isSystem) return null;
  const { isSystem: _isSystem, ...ref } = row;
  return ref;
}

/** The person row, locked `FOR UPDATE` (first in the repo-wide lock order). */
export async function lockPersonById(executor: Executor, personId: string) {
  const [person] = await executor
    .select({
      id: personTable.id,
      userId: personTable.userId,
      side: personTable.side,
      active: personTable.active,
      organisationId: personTable.organisationId,
    })
    .from(personTable)
    .where(eq(personTable.id, personId))
    .for("update")
    .limit(1);
  return person;
}

/** Whether the person's login is a member of the workspace (people are added from there). */
export async function isWorkspaceMemberPerson(
  executor: Executor,
  workspaceId: string,
  userId: string | null,
): Promise<boolean> {
  if (userId === null) return false;
  const [row] = await executor
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function findActiveDirectGrant(
  executor: Executor,
  personId: string,
  projectId: string,
) {
  const [row] = await executor
    .select({
      id: membershipGrantTable.id,
      roleId: membershipGrantTable.roleId,
    })
    .from(membershipGrantTable)
    .where(
      and(
        eq(membershipGrantTable.personId, personId),
        eq(membershipGrantTable.scope, "project"),
        eq(membershipGrantTable.scopeId, projectId),
        eq(membershipGrantTable.sourceKind, "direct"),
        isNull(membershipGrantTable.revokedAt),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

/** An admin-made direct grant (`direct_origin = 'admin'` requires the granting person). */
export async function insertAdminProjectGrant(
  executor: Executor,
  input: {
    personId: string;
    projectId: string;
    roleId: string;
    grantedByPersonId: string;
  },
): Promise<void> {
  await executor.insert(membershipGrantTable).values({
    id: createId(),
    personId: input.personId,
    scope: "project",
    scopeId: input.projectId,
    roleId: input.roleId,
    sourceKind: "direct",
    directOrigin: "admin",
    grantedByPersonId: input.grantedByPersonId,
    seesAll: false,
  });
}

export async function setDirectGrantRole(
  executor: Executor,
  grantId: string,
  roleId: string,
): Promise<void> {
  await executor
    .update(membershipGrantTable)
    .set({ roleId, updatedAt: new Date() })
    .where(eq(membershipGrantTable.id, grantId));
}

export async function revokeDirectGrant(
  executor: Executor,
  grantId: string,
): Promise<void> {
  const now = new Date();
  await executor
    .update(membershipGrantTable)
    .set({
      revokedAt: now,
      revocationReason: "direct_removed",
      membershipId: null,
      updatedAt: now,
    })
    .where(eq(membershipGrantTable.id, grantId));
}

export type RosterCandidate = {
  personId: string;
  displayName: string | null;
  email: string | null;
  workspaceRole: string;
};

/** Active staff people of the workspace (by workspace membership) with no direct roster row. */
export async function listRosterCandidates(
  executor: Executor,
  workspaceId: string,
  projectId: string,
): Promise<RosterCandidate[]> {
  return executor
    .select({
      personId: personTable.id,
      displayName: sql<
        string | null
      >`coalesce(${personTable.displayName}, ${schema.userTable.name})`,
      email: schema.userTable.email,
      workspaceRole: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .innerJoin(
      personTable,
      eq(personTable.userId, schema.workspaceUserTable.userId),
    )
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.workspaceUserTable.userId),
    )
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(personTable.side, "staff"),
        eq(personTable.active, true),
        sql`not exists (
          select 1 from ${membershipTable} m
          where m.person_id = ${personTable.id}
            and m.scope = 'project' and m.scope_id = ${projectId}
            and exists (
              select 1 from ${membershipGrantTable} g
              where g.person_id = m.person_id and g.scope = 'project'
                and g.scope_id = m.scope_id and g.source_kind = 'direct'
                and g.revoked_at is null
            )
        )`,
      ),
    )
    .orderBy(asc(personTable.displayName), asc(personTable.id));
}
