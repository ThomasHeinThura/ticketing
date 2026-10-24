import {
  BUILT_IN_ROLES,
  CAPABILITIES,
  expandCapabilities,
  roleScopeTier,
} from "@taskdesk/permissions";
import type { SQLWrapper } from "drizzle-orm";
import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { canonicalScopedRoleMembership } from "../database/repositories/identity-scope.repository";
import { notificationTable, projectTable, taskTable } from "../database/schema";

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
  // decision, 23 Oct): `owner` stays compiled, every other key reads its row's capabilities. A
  // custom row squatting on a built-in key is never trusted as that built-in (issue #318).
  const builtInKeys = Object.keys(BUILT_IN_ROLES);
  const legacyWorkspaceRoleCanRead = exists(
    executor
      .select({ id: schema.workspaceUserTable.id })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.userId, userId),
          eq(schema.workspaceUserTable.workspaceId, projectTable.workspaceId),
          sql`not exists (select 1 from ${schema.workspaceUserTable} duplicate_member
          where duplicate_member.user_id = ${userId}
          and duplicate_member.workspace_id = ${projectTable.workspaceId}
          and duplicate_member.id <> ${schema.workspaceUserTable.id})`,
          or(
            eq(schema.workspaceUserTable.role, "owner"),
            exists(
              executor
                .select({ id: schema.roleTable.id })
                .from(schema.roleTable)
                .where(
                  and(
                    eq(schema.roleTable.scope, "workspace"),
                    eq(schema.roleTable.workspaceId, projectTable.workspaceId),
                    eq(schema.roleTable.key, schema.workspaceUserTable.role),
                    or(
                      eq(schema.roleTable.isSystem, true),
                      sql`${schema.roleTable.key} not in (${sql.join(
                        builtInKeys.map((key) => sql`${key}`),
                        sql`, `,
                      )})`,
                    ),
                    storedTaskRead(
                      schema.roleTable.capabilities,
                      roleScopeTier("workspace"),
                    ),
                  ),
                ),
            ),
          ),
        ),
      ),
  );
  // PR-2/PR-3: a project row on an ANCESTOR is the override for this project when there is
  // none here, so the workspace role must not stand in for it. This SQL does not evaluate the
  // inherited role itself (conservative: such a caller is simply not matched here, never
  // widened to their workspace role); the native work-item paths do evaluate it.
  const ancestorMembership = exists(
    executor
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.membershipTable.personId),
      )
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.membershipTable.scope, "project"),
          sql`${schema.membershipTable.scopeId} IN (
            WITH RECURSIVE reach_chain(id, parent_id, depth) AS (
              SELECT chain_start.id, chain_start.parent_id, 1
              FROM ${projectTable} AS chain_start
              WHERE chain_start.id = ${projectTable.id}
                AND chain_start.workspace_id = ${projectTable.workspaceId}
              UNION ALL
              SELECT chain_next.id, chain_next.parent_id, reach_chain.depth + 1
              FROM ${projectTable} AS chain_next
              INNER JOIN reach_chain ON chain_next.id = reach_chain.parent_id
              WHERE chain_next.workspace_id = ${projectTable.workspaceId}
                AND chain_next.deleted_at IS NULL
                AND reach_chain.depth < 4
            )
            SELECT reach_chain.id FROM reach_chain WHERE reach_chain.depth > 1
          )`,
        ),
      ),
  );
  const effectiveRead = or(
    projectRoleCanRead,
    and(
      sql`not ${projectMembership}`,
      sql`not ${ancestorMembership}`,
      or(workspaceRoleCanRead, legacyWorkspaceRoleCanRead),
    ),
  );
  const allWorkspaceMembership = exists(
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
          eq(schema.membershipTable.seesAll, true),
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
            projectTable.workspaceId,
          ),
          validCapabilities(schema.roleTable.capabilities),
        ),
      ),
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
    and(projectMembership, effectiveRead),
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
): Promise<boolean> {
  const [row] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        isNull(projectTable.deletedAt),
        projectReachPredicate(userId, db),
      ),
    )
    .limit(1);
  return row !== undefined;
}
