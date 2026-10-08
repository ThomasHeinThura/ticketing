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

/** Current TaskDesk project reach for a legacy task recipient. */
function projectReachPredicate(userId: string) {
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
          sql`jsonb_typeof(${schema.roleTable.capabilities}) = 'array'`,
          validCapabilities(schema.roleTable.capabilities),
        ),
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
  const customerOrganisationReach = exists(
    db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .innerJoin(
        schema.organisationTable,
        eq(schema.organisationTable.id, schema.personTable.organisationId),
      )
      .innerJoin(
        schema.workspaceTable,
        eq(schema.workspaceTable.id, projectTable.workspaceId),
      )
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "customer"),
          sql`coalesce(${schema.userTable.banned}, false) = false`,
          eq(schema.organisationTable.active, true),
          eq(schema.organisationTable.portalAccess, true),
          isNull(schema.organisationTable.deletedAt),
          eq(
            schema.workspaceTable.organisationId,
            schema.personTable.organisationId,
          ),
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
    instanceAdmin,
    customerOrganisationReach,
    projectMembership,
    allWorkspaceMembership,
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

export function reachableTaskNotificationPredicate(userId: string) {
  return taskReachPredicate(userId);
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
