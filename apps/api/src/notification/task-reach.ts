import {
  BUILT_IN_ROLES,
  CAPABILITIES,
  expandCapabilities,
  roleScopeTier,
} from "@taskdesk/permissions";
import type { SQLWrapper } from "drizzle-orm";
import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import db, { schema } from "../database";
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
export function projectReachPredicate(userId: string) {
  const projectMembership = exists(
    db
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
          sql`${schema.roleTable.key} <> ''`,
          validCapabilities(schema.roleTable.capabilities),
        ),
      ),
  );
  const projectRoleCanRead = exists(
    db
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
          sql`${schema.roleTable.key} <> ''`,
          storedTaskRead(
            schema.roleTable.capabilities,
            roleScopeTier("project"),
          ),
        ),
      ),
  );
  const workspaceRoleCanRead = exists(
    db
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
          sql`${schema.roleTable.key} <> ''`,
          storedTaskRead(
            schema.roleTable.capabilities,
            roleScopeTier("workspace"),
          ),
        ),
      ),
  );
  const legacyReadableRoles = Object.entries(BUILT_IN_ROLES)
    .filter(
      ([key, role]) =>
        key !== "instance_admin" &&
        role.scope === "workspace" &&
        expandCapabilities(role.capabilities, {
          tier: roleScopeTier("workspace"),
        }).has("work_item:read"),
    )
    .map(([key]) => key);
  const legacyWorkspaceRoleCanRead = exists(
    db
      .select({ id: schema.workspaceUserTable.id })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.userId, userId),
          eq(schema.workspaceUserTable.workspaceId, projectTable.workspaceId),
          sql`${schema.workspaceUserTable.role} in (${sql.join(
            legacyReadableRoles.map((key) => sql`${key}`),
            sql`, `,
          )})`,
          sql`not exists (select 1 from ${schema.workspaceUserTable} duplicate_member
          where duplicate_member.user_id = ${userId}
          and duplicate_member.workspace_id = ${projectTable.workspaceId}
          and duplicate_member.id <> ${schema.workspaceUserTable.id})`,
          sql`(${schema.workspaceUserTable.role} = 'owner' or exists (
          select 1 from ${schema.workspaceRoleTable} legacy_role
          where legacy_role.workspace_id = ${projectTable.workspaceId}
          and legacy_role.role = ${schema.workspaceUserTable.role}
          and legacy_role.is_system = true
        ))`,
        ),
      ),
  );
  const effectiveRead = or(
    projectRoleCanRead,
    and(
      sql`not ${projectMembership}`,
      or(workspaceRoleCanRead, legacyWorkspaceRoleCanRead),
    ),
  );
  const allWorkspaceMembership = exists(
    db
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
          validCapabilities(schema.roleTable.capabilities),
        ),
      ),
  );
  const instanceAdmin = exists(
    db
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
function taskReachPredicate(userId: string) {
  return exists(
    db
      .select({ id: taskTable.id })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, notificationTable.resourceId),
          isNull(projectTable.deletedAt),
          projectReachPredicate(userId),
        ),
      ),
  );
}

export function reachableTaskNotificationPredicate(
  userId: string,
  credentialCanReadTask = true,
) {
  return credentialCanReadTask ? taskReachPredicate(userId) : sql`false`;
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
        projectReachPredicate(userId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
