import {
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  CAPABILITIES,
  expandCapabilities,
  roleScopeTier,
  WORKSPACE_PROJECT_SEE_ALL_ROLES,
} from "@taskdesk/permissions";
import type { SQLWrapper } from "drizzle-orm";
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import {
  canonicalScopedRoleMembership,
  legacyWorkspaceKeyAdmitted,
} from "../database/repositories/identity-scope.repository";
import { notificationTable, projectTable, taskTable } from "../database/schema";
import { isBuiltInWorkspaceRoleKey } from "../permissions/resolve-identity";

function validCapabilities(capabilities: SQLWrapper) {
  return sql`jsonb_typeof(${capabilities}) = 'array' and not exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(${capabilities}) = 'array'
          then ${capabilities}
        else '[]'::jsonb
      end
    ) as capability(value)
    where jsonb_typeof(capability.value) <> 'string'
  )`;
}

// Derive stored source capabilities from the canonical evaluator, including implications
// and each role scope's tier clamp. This keeps SQL row filtering in step with `can()`.
function sourceCapabilitiesGrantingTaskRead(
  tier: ReturnType<typeof roleScopeTier>,
) {
  return Object.keys(CAPABILITIES).filter((capability) =>
    expandCapabilities([capability], { tier }).has("work_item:read"),
  );
}

function storedTaskRead(
  capabilities: SQLWrapper,
  tier: ReturnType<typeof roleScopeTier>,
) {
  const sources = sourceCapabilitiesGrantingTaskRead(tier);
  return and(
    validCapabilities(capabilities),
    sql`exists (
      select 1
      from jsonb_array_elements_text(
        case when jsonb_typeof(${capabilities}) = 'array'
          then ${capabilities} else '[]'::jsonb end
      ) as stored_capability(value)
      where stored_capability.value in (${sql.join(
        sources.map((source) => sql`${source}`),
        sql`, `,
      )})
    )`,
  );
}

function builtInWorkspaceRoleHasTaskRead(key: BuiltInRoleKey): boolean {
  return expandCapabilities(BUILT_IN_ROLES[key].capabilities, {
    tier: roleScopeTier("workspace"),
  }).has("work_item:read");
}

function legacyBuiltInWorkspaceKeyCanRead(
  key: BuiltInRoleKey,
  workspaceId: SQLWrapper,
  executor: Executor,
) {
  if (key === "owner") {
    return builtInWorkspaceRoleHasTaskRead("owner") ? sql`true` : sql`false`;
  }
  const canonicalRow = and(
    eq(schema.roleTable.scope, "workspace"),
    eq(schema.roleTable.workspaceId, workspaceId),
    eq(schema.roleTable.key, key),
  );
  const canonicalRowExists = exists(
    executor.select({ one: sql`1` }).from(schema.roleTable).where(canonicalRow),
  );
  const canonicalRowCanRead = exists(
    executor
      .select({ one: sql`1` })
      .from(schema.roleTable)
      .where(
        and(
          canonicalRow,
          eq(schema.roleTable.isSystem, true),
          storedTaskRead(
            schema.roleTable.capabilities,
            roleScopeTier("workspace"),
          ),
        ),
      ),
  );
  const compiledCanRead = builtInWorkspaceRoleHasTaskRead(key)
    ? sql`true`
    : sql`false`;
  return and(
    legacyWorkspaceKeyAdmitted(key, workspaceId, executor),
    sql`CASE WHEN ${canonicalRowExists} THEN ${canonicalRowCanRead} ELSE ${compiledCanRead} END`,
  );
}

/** Current TaskDesk project reach for a legacy task recipient. */
export function projectReachPredicate(userId: string, executor: Executor = db) {
  const projectMembership = exists(
    executor
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.membershipTable.personId),
      )
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .innerJoin(
        schema.roleTable,
        eq(schema.roleTable.id, schema.membershipTable.roleId),
      )
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, projectTable.id),
          eq(schema.roleTable.scope, "project"),
          eq(schema.roleTable.workspaceId, projectTable.workspaceId),
          canonicalScopedRoleMembership(
            schema.membershipTable.scope,
            schema.roleTable.id,
            schema.roleTable.scope,
            schema.roleTable.workspaceId,
            schema.roleTable.key,
            schema.roleTable.rank,
            schema.roleTable.capabilities,
            schema.roleTable.isSystem,
            projectTable.workspaceId,
          ),
          eq(schema.membershipTable.scope, schema.roleTable.scope),
          sql`${schema.roleTable.key} <> ''`,
          validCapabilities(schema.roleTable.capabilities),
        ),
      ),
  );
  const projectRoleCanRead = exists(
    executor
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.membershipTable.personId),
      )
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .innerJoin(
        schema.roleTable,
        eq(schema.roleTable.id, schema.membershipTable.roleId),
      )
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, projectTable.id),
          eq(schema.roleTable.scope, "project"),
          eq(schema.roleTable.workspaceId, projectTable.workspaceId),
          eq(schema.membershipTable.scope, schema.roleTable.scope),
          canonicalScopedRoleMembership(
            schema.membershipTable.scope,
            schema.roleTable.id,
            schema.roleTable.scope,
            schema.roleTable.workspaceId,
            schema.roleTable.key,
            schema.roleTable.rank,
            schema.roleTable.capabilities,
            schema.roleTable.isSystem,
            projectTable.workspaceId,
          ),
          sql`${schema.roleTable.key} <> ''`,
          storedTaskRead(
            schema.roleTable.capabilities,
            roleScopeTier("project"),
          ),
        ),
      ),
  );
  const workspaceRoleCanRead = exists(
    executor
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.membershipTable.personId),
      )
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .innerJoin(
        schema.roleTable,
        eq(schema.roleTable.id, schema.membershipTable.roleId),
      )
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, projectTable.workspaceId),
          eq(schema.roleTable.scope, "workspace"),
          eq(schema.roleTable.workspaceId, projectTable.workspaceId),
          eq(schema.membershipTable.scope, schema.roleTable.scope),
          canonicalScopedRoleMembership(
            schema.membershipTable.scope,
            schema.roleTable.id,
            schema.roleTable.scope,
            schema.roleTable.workspaceId,
            schema.roleTable.key,
            schema.roleTable.rank,
            schema.roleTable.capabilities,
            schema.roleTable.isSystem,
            projectTable.workspaceId,
          ),
          sql`${schema.roleTable.key} <> ''`,
          storedTaskRead(
            schema.roleTable.capabilities,
            roleScopeTier("workspace"),
          ),
        ),
      ),
  );
  // The `workspace_member.role` key points at a canonical workspace-scope `role` row (owner
  // decision, 23 Oct): `owner` stays compiled, every other key reads its row's capabilities (or
  // compiled built-in capabilities when backed solely by a system `workspace_role` row). A
  // custom row squatting on a built-in key is never trusted as that built-in (issue #318).
  const builtInKeys = Object.keys(BUILT_IN_ROLES);
  const builtInWorkspaceKeys = builtInKeys.filter(isBuiltInWorkspaceRoleKey);
  const duplicateLegacyMember = alias(
    schema.workspaceUserTable,
    "task_reach_legacy_duplicate_member",
  );
  const legacyWorkspaceMember = (roleConstraint: SQLWrapper | undefined) =>
    exists(
      executor
        .select({ id: schema.workspaceUserTable.id })
        .from(schema.workspaceUserTable)
        .innerJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.workspaceUserTable.userId),
        )
        .innerJoin(
          schema.personTable,
          eq(schema.personTable.userId, schema.userTable.id),
        )
        .where(
          and(
            eq(schema.workspaceUserTable.userId, userId),
            eq(schema.workspaceUserTable.workspaceId, projectTable.workspaceId),
            eq(schema.personTable.active, true),
            eq(schema.personTable.side, "staff"),
            sql`coalesce(${schema.userTable.banned}, false) = false`,
            not(
              exists(
                executor
                  .select({ one: sql`1` })
                  .from(duplicateLegacyMember)
                  .where(
                    and(
                      eq(duplicateLegacyMember.userId, userId),
                      eq(
                        duplicateLegacyMember.workspaceId,
                        projectTable.workspaceId,
                      ),
                      ne(
                        duplicateLegacyMember.id,
                        schema.workspaceUserTable.id,
                      ),
                    ),
                  ),
              ),
            ),
            roleConstraint,
          ),
        ),
    );
  const legacyWorkspaceRoleCanRead = legacyWorkspaceMember(
    or(
      ...builtInWorkspaceKeys.map((key) =>
        and(
          eq(schema.workspaceUserTable.role, key),
          legacyBuiltInWorkspaceKeyCanRead(
            key,
            projectTable.workspaceId,
            executor,
          ),
        ),
      ),
      exists(
        executor
          .select({ id: schema.roleTable.id })
          .from(schema.roleTable)
          .where(
            and(
              eq(schema.roleTable.scope, "workspace"),
              eq(schema.roleTable.workspaceId, projectTable.workspaceId),
              eq(schema.roleTable.key, schema.workspaceUserTable.role),
              not(inArray(schema.roleTable.key, builtInKeys)),
              sql`${schema.roleTable.rank} BETWEEN -2147483648 AND 2147483647`,
              storedTaskRead(
                schema.roleTable.capabilities,
                roleScopeTier("workspace"),
              ),
            ),
          ),
      ),
    ),
  );
  // D-E / #1152 (Thomas, 12 Nov 2026): validated system workspace owner/admin/manager grants
  // retain additive workspace authority even when a narrower project or ancestor grant exists.
  const scopedAdditiveWorkspaceRole = exists(
    executor
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.membershipTable.personId),
      )
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .innerJoin(
        schema.roleTable,
        eq(schema.roleTable.id, schema.membershipTable.roleId),
      )
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, projectTable.workspaceId),
          inArray(schema.roleTable.key, [...WORKSPACE_PROJECT_SEE_ALL_ROLES]),
          canonicalScopedRoleMembership(
            schema.membershipTable.scope,
            schema.roleTable.id,
            schema.roleTable.scope,
            schema.roleTable.workspaceId,
            schema.roleTable.key,
            schema.roleTable.rank,
            schema.roleTable.capabilities,
            schema.roleTable.isSystem,
            projectTable.workspaceId,
          ),
          validCapabilities(schema.roleTable.capabilities),
        ),
      ),
  );
  const legacyAdditiveWorkspaceRole = legacyWorkspaceMember(
    or(
      ...WORKSPACE_PROJECT_SEE_ALL_ROLES.map((key) =>
        and(
          eq(schema.workspaceUserTable.role, key),
          legacyWorkspaceKeyAdmitted(key, projectTable.workspaceId, executor),
        ),
      ),
    ),
  );
  const anyWorkspaceCanRead = or(
    workspaceRoleCanRead,
    legacyWorkspaceRoleCanRead,
  );
  const additiveWorkspaceRead = and(
    or(scopedAdditiveWorkspaceRole, legacyAdditiveWorkspaceRole),
    anyWorkspaceCanRead,
  );
  // The nearest ancestor with a valid grant replaces workspace grants, just as in can().
  const ancestorGrants = sql`
    WITH RECURSIVE reach_chain(id, parent_id, depth, seen) AS (
      SELECT chain_start.id, chain_start.parent_id, 1, ARRAY[chain_start.id]
      FROM ${projectTable} AS chain_start
      WHERE chain_start.id = ${projectTable.id}
        AND chain_start.workspace_id = ${projectTable.workspaceId}
      UNION ALL
      SELECT chain_next.id, chain_next.parent_id, reach_chain.depth + 1,
        reach_chain.seen || chain_next.id
      FROM ${projectTable} AS chain_next
      INNER JOIN reach_chain ON chain_next.id = reach_chain.parent_id
      WHERE chain_next.workspace_id = ${projectTable.workspaceId}
        AND chain_next.deleted_at IS NULL
        AND reach_chain.depth < 4
        AND NOT chain_next.id = ANY(reach_chain.seen)
    ), valid_ancestor_grants AS (
      SELECT reach_chain.depth, ${schema.roleTable.capabilities} AS capabilities
      FROM reach_chain
      INNER JOIN ${schema.membershipTable} ON ${schema.membershipTable.scopeId} = reach_chain.id
      INNER JOIN ${schema.personTable} ON ${schema.personTable.id} = ${schema.membershipTable.personId}
      INNER JOIN ${schema.userTable} ON ${schema.userTable.id} = ${schema.personTable.userId}
      INNER JOIN ${schema.roleTable} ON ${schema.roleTable.id} = ${schema.membershipTable.roleId}
      WHERE reach_chain.depth > 1
        AND ${and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          eq(schema.membershipTable.scope, "project"),
          canonicalScopedRoleMembership(
            schema.membershipTable.scope,
            schema.roleTable.id,
            schema.roleTable.scope,
            schema.roleTable.workspaceId,
            schema.roleTable.key,
            schema.roleTable.rank,
            schema.roleTable.capabilities,
            schema.roleTable.isSystem,
            projectTable.workspaceId,
          ),
          sql`${schema.roleTable.key} <> ''`,
          validCapabilities(schema.roleTable.capabilities),
        )}
    )`;
  const ancestorMembership = sql`exists (${ancestorGrants} SELECT 1 FROM valid_ancestor_grants)`;
  const ancestorRoleCanRead = sql`exists (
    ${ancestorGrants}
    SELECT 1 FROM valid_ancestor_grants
    WHERE depth = (SELECT min(depth) FROM valid_ancestor_grants)
      AND ${storedTaskRead(sql`valid_ancestor_grants.capabilities`, roleScopeTier("project"))}
  )`;
  const effectiveRead = or(
    projectRoleCanRead,
    additiveWorkspaceRead,
    and(not(projectMembership), ancestorRoleCanRead),
    and(
      sql`not ${projectMembership}`,
      sql`not ${ancestorMembership}`,
      anyWorkspaceCanRead,
    ),
  );
  const scopedWorkspaceSeesAll = exists(
    executor
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.membershipTable.personId),
      )
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .innerJoin(
        schema.roleTable,
        eq(schema.roleTable.id, schema.membershipTable.roleId),
      )
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, projectTable.workspaceId),
          or(
            eq(schema.membershipTable.seesAll, true),
            inArray(schema.roleTable.key, [...WORKSPACE_PROJECT_SEE_ALL_ROLES]),
          ),
          eq(schema.roleTable.scope, "workspace"),
          eq(schema.roleTable.workspaceId, projectTable.workspaceId),
          sql`${schema.roleTable.key} <> ''`,
          sql`jsonb_typeof(${schema.roleTable.capabilities}) = 'array'`,
          canonicalScopedRoleMembership(
            schema.membershipTable.scope,
            schema.roleTable.id,
            schema.roleTable.scope,
            schema.roleTable.workspaceId,
            schema.roleTable.key,
            schema.roleTable.rank,
            schema.roleTable.capabilities,
            schema.roleTable.isSystem,
            projectTable.workspaceId,
          ),
          validCapabilities(schema.roleTable.capabilities),
        ),
      ),
  );
  const legacyWorkspaceSeesAll = legacyAdditiveWorkspaceRole;
  const ownerTeamReach = exists(
    executor
      .select({ id: schema.teamMemberTable.id })
      .from(schema.teamMemberTable)
      .innerJoin(
        schema.teamTable,
        and(
          eq(schema.teamTable.id, schema.teamMemberTable.teamId),
          eq(schema.teamTable.workspaceId, projectTable.workspaceId),
        ),
      )
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.teamMemberTable.userId),
      )
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.userId, schema.userTable.id),
      )
      .where(
        and(
          eq(schema.teamMemberTable.userId, userId),
          eq(schema.teamMemberTable.teamId, projectTable.ownerTeamId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          or(
            exists(
              executor
                .select({ one: sql`1` })
                .from(schema.workspaceUserTable)
                .where(
                  and(
                    eq(schema.workspaceUserTable.userId, userId),
                    eq(
                      schema.workspaceUserTable.workspaceId,
                      projectTable.workspaceId,
                    ),
                  ),
                ),
            ),
            exists(
              executor
                .select({ one: sql`1` })
                .from(schema.membershipTable)
                .innerJoin(
                  schema.roleTable,
                  eq(schema.roleTable.id, schema.membershipTable.roleId),
                )
                .where(
                  and(
                    eq(schema.membershipTable.personId, schema.personTable.id),
                    eq(schema.membershipTable.scope, "workspace"),
                    eq(
                      schema.membershipTable.scopeId,
                      projectTable.workspaceId,
                    ),
                    canonicalScopedRoleMembership(
                      schema.membershipTable.scope,
                      schema.roleTable.id,
                      schema.roleTable.scope,
                      schema.roleTable.workspaceId,
                      schema.roleTable.key,
                      schema.roleTable.rank,
                      schema.roleTable.capabilities,
                      schema.roleTable.isSystem,
                      projectTable.workspaceId,
                    ),
                  ),
                ),
            ),
          ),
        ),
      ),
  );
  const allWorkspaceMembership = or(
    scopedWorkspaceSeesAll,
    legacyWorkspaceSeesAll,
    ownerTeamReach,
  );
  const instanceAdmin = exists(
    executor
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.userId, schema.userTable.id),
      )
      .where(
        and(
          eq(schema.userTable.id, userId),
          eq(schema.userTable.role, "admin"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          eq(schema.personTable.side, "staff"),
          eq(schema.personTable.active, true),
        ),
      ),
  );

  return or(
    and(
      instanceAdmin,
      sql`${expandCapabilities(BUILT_IN_ROLES.instance_admin.capabilities, { tier: "instance" }).has("work_item:read")}`,
    ),
    and(or(projectMembership, ancestorMembership), effectiveRead),
    and(allWorkspaceMembership, effectiveRead),
  );
}

/** Current TaskDesk project reach for a legacy task resource, correlated to its recipient. */
function taskReachPredicate(userId: string, executor: Executor) {
  return exists(
    executor
      .select({ id: taskTable.id })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, notificationTable.resourceId),
          isNull(projectTable.deletedAt),
          projectReachPredicate(userId, executor),
        ),
      ),
  );
}

export function reachableTaskNotificationPredicate(
  userId: string,
  credentialCanReadTask = true,
  executor: Executor = db,
) {
  return credentialCanReadTask
    ? taskReachPredicate(userId, executor)
    : sql`false`;
}

export async function userCanReachTask(
  userId: string,
  taskId: string,
  executor: Executor = db,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        isNull(projectTable.deletedAt),
        projectReachPredicate(userId, executor),
      ),
    )
    .limit(1);
  return row !== undefined;
}
