import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { schema } from "../database";
import type { Executor } from "../database/executor";
import { automationTable } from "../database/schema";

/**
 * Statement ownership for the canonical workspace-role surface (owner decision, 23 Oct:
 * capabilities live in `role`; `workspace_member.role` holds the role key). Every function takes
 * the caller's executor so create/update/delete/reassign share one transaction and lock order.
 */

type RoleRow = typeof schema.roleTable.$inferSelect;

export type RoleWithHolders = RoleRow & { holderCount: number };

const workspaceScope = (workspaceId: string) =>
  and(
    eq(schema.roleTable.scope, "workspace"),
    eq(schema.roleTable.workspaceId, workspaceId),
  );

export async function listRolesWithHolderCounts(
  executor: Executor,
  workspaceId: string,
): Promise<RoleWithHolders[]> {
  const roles = await executor
    .select()
    .from(schema.roleTable)
    .where(workspaceScope(workspaceId))
    .orderBy(desc(schema.roleTable.rank), schema.roleTable.key);
  const counts = await executor
    .select({
      role: schema.workspaceUserTable.role,
      holders: count(),
    })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.workspaceId, workspaceId))
    .groupBy(schema.workspaceUserTable.role);
  const byKey = new Map(counts.map((row) => [row.role, Number(row.holders)]));
  return roles.map((role) => ({
    ...role,
    holderCount: byKey.get(role.key) ?? 0,
  }));
}

export async function getRoleWithHolderCount(
  executor: Executor,
  workspaceId: string,
  roleId: string,
): Promise<RoleWithHolders | undefined> {
  const [role] = await executor
    .select()
    .from(schema.roleTable)
    .where(and(workspaceScope(workspaceId), eq(schema.roleTable.id, roleId)))
    .limit(1);
  if (!role) return undefined;
  return {
    ...role,
    holderCount: await countRoleHolders(executor, workspaceId, role.key),
  };
}

export async function lockRoleRow(
  tx: Executor,
  workspaceId: string,
  roleId: string,
): Promise<RoleRow | undefined> {
  const [role] = await tx
    .select()
    .from(schema.roleTable)
    .where(and(workspaceScope(workspaceId), eq(schema.roleTable.id, roleId)))
    .for("update")
    .limit(1);
  return role;
}

/** Custom (non-system) roles only: the 25-role ceiling is a custom-role ceiling. */
export async function countCustomRoles(
  tx: Executor,
  workspaceId: string,
): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(schema.roleTable)
    .where(
      and(workspaceScope(workspaceId), eq(schema.roleTable.isSystem, false)),
    );
  return Number(row?.value ?? 0);
}

export async function insertRoleRow(
  tx: Executor,
  values: typeof schema.roleTable.$inferInsert,
): Promise<RoleRow> {
  const [created] = await tx
    .insert(schema.roleTable)
    .values(values)
    .returning();
  if (!created) throw new Error("role insert returned no row");
  return created;
}

export async function updateRoleRow(
  tx: Executor,
  roleId: string,
  set: Partial<
    Pick<
      typeof schema.roleTable.$inferInsert,
      "name" | "description" | "rank" | "capabilities"
    >
  >,
): Promise<RoleRow> {
  const [updated] = await tx
    .update(schema.roleTable)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(schema.roleTable.id, roleId))
    .returning();
  if (!updated) throw new Error("role update returned no row");
  return updated;
}

export async function deleteRoleRow(
  tx: Executor,
  workspaceId: string,
  roleId: string,
): Promise<boolean> {
  const deleted = await tx
    .delete(schema.roleTable)
    .where(and(workspaceScope(workspaceId), eq(schema.roleTable.id, roleId)))
    .returning({ id: schema.roleTable.id });
  return deleted.length > 0;
}

/** The legacy statement row of a built-in default role (`viewer` / `member` / `admin`). */
export async function lockLegacySystemPermission(
  tx: Executor,
  workspaceId: string,
  key: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, key),
        eq(schema.workspaceRoleTable.isSystem, true),
      ),
    )
    .for("update")
    .limit(1);
  return row?.permission ?? null;
}

export async function setLegacySystemPermission(
  tx: Executor,
  workspaceId: string,
  key: string,
  permission: string,
): Promise<void> {
  await tx
    .update(schema.workspaceRoleTable)
    .set({ permission, updatedAt: new Date() })
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, key),
        eq(schema.workspaceRoleTable.isSystem, true),
      ),
    );
}

/** The legacy `workspace_role` row of a deleted canonical role: kept readable, never stale. */
export async function deleteLegacyWorkspaceRoleRow(
  tx: Executor,
  workspaceId: string,
  key: string,
): Promise<void> {
  await tx
    .delete(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, key),
        eq(schema.workspaceRoleTable.isSystem, false),
      ),
    );
}

/** Rows that make a role un-deletable at the database level (`ON DELETE RESTRICT`). */
export async function countRoleReferences(
  tx: Executor,
  roleId: string,
): Promise<{
  grants: number;
  memberships: number;
  oidcMappings: number;
  scimMappings: number;
  automations: number;
  workflowTransitions: number;
}> {
  const one = async (
    table:
      | typeof schema.membershipGrantTable
      | typeof schema.membershipTable
      | typeof schema.oidcGroupMappingTable
      | typeof schema.scimGroupMappingTable
      | typeof automationTable
      | typeof schema.workflowTransitionTable,
    column: Parameters<typeof eq>[0],
  ): Promise<number> => {
    const [row] = await tx
      .select({ value: count() })
      .from(table)
      .where(eq(column, roleId));
    return Number(row?.value ?? 0);
  };
  return {
    grants: await one(
      schema.membershipGrantTable,
      schema.membershipGrantTable.roleId,
    ),
    memberships: await one(
      schema.membershipTable,
      schema.membershipTable.roleId,
    ),
    oidcMappings: await one(
      schema.oidcGroupMappingTable,
      schema.oidcGroupMappingTable.roleId,
    ),
    scimMappings: await one(
      schema.scimGroupMappingTable,
      schema.scimGroupMappingTable.roleId,
    ),
    automations: await one(automationTable, automationTable.effectiveRoleId),
    workflowTransitions: await one(
      schema.workflowTransitionTable,
      schema.workflowTransitionTable.roleId,
    ),
  };
}

/**
 * Identity-managed references: a capability or rank edit must re-run the IP-22 closure. Only
 * EXTERNALLY sourced grants count (OIDC, SCIM, JIT) plus group mappings. A direct grant,
 * including the `system_backfill` reach grant owner/admin hold, reads the role row at
 * evaluation time and is not a provisioning projection, so it never blocks an edit. Deletion
 * uses the full `countRoleReferences`.
 */
export async function countIdentityRoleReferences(
  tx: Executor,
  roleId: string,
): Promise<number> {
  const [external] = await tx
    .select({ value: count() })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.roleId, roleId),
        ne(schema.membershipGrantTable.sourceKind, "direct"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    );
  const refs = await countRoleReferences(tx, roleId);
  return Number(external?.value ?? 0) + refs.oidcMappings + refs.scimMappings;
}

export async function countRoleHolders(
  executor: Executor,
  workspaceId: string,
  key: string,
): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.role, key),
      ),
    );
  return Number(row?.value ?? 0);
}

export type RoleHolderRow = {
  userId: string;
  personId: string | null;
  name: string;
  email: string;
  image: string | null;
  active: boolean;
  suspended: boolean;
  joinedAt: Date;
};

export async function listRoleHolders(
  executor: Executor,
  workspaceId: string,
  key: string,
  limit: number,
): Promise<RoleHolderRow[]> {
  const rows = await executor
    .select({
      userId: schema.workspaceUserTable.userId,
      personId: schema.personTable.id,
      name: schema.userTable.name,
      email: schema.userTable.email,
      image: schema.userTable.image,
      personActive: schema.personTable.active,
      suspended: sql<boolean>`(${schema.userTable.banned} is true and (${schema.userTable.banExpires} is null or ${schema.userTable.banExpires} > now()))`,
      joinedAt: schema.workspaceUserTable.joinedAt,
    })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.workspaceUserTable.userId),
    )
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.workspaceUserTable.userId),
    )
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.role, key),
      ),
    )
    .orderBy(schema.userTable.name, schema.workspaceUserTable.userId)
    .limit(limit);
  return rows.map((row) => ({
    userId: row.userId,
    personId: row.personId,
    name: row.name,
    email: row.email,
    image: row.image,
    active: row.personActive !== false,
    suspended: row.suspended === true,
    joinedAt: row.joinedAt,
  }));
}

/** Holders of `fromKey`, optionally restricted to a user-id subset, locked for the move. */
export async function lockRoleHolderUserIds(
  tx: Executor,
  workspaceId: string,
  fromKey: string,
  userIds: readonly string[] | null,
): Promise<string[]> {
  const rows = await tx
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.role, fromKey),
        userIds === null
          ? undefined
          : inArray(schema.workspaceUserTable.userId, [...userIds]),
      ),
    )
    .orderBy(schema.workspaceUserTable.userId)
    .for("update");
  return rows.map((row) => row.userId);
}

export async function setHolderRole(
  tx: Executor,
  workspaceId: string,
  userIds: readonly string[],
  toKey: string,
): Promise<void> {
  if (userIds.length === 0) return;
  await tx
    .update(schema.workspaceUserTable)
    .set({ role: toKey })
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        inArray(schema.workspaceUserTable.userId, [...userIds]),
      ),
    );
}

export type RoleHistoryRow = {
  id: string;
  action: string;
  actorId: string | null;
  actorType: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
};

export async function listRoleHistory(
  executor: Executor,
  workspaceId: string,
  roleId: string,
  limit: number,
): Promise<RoleHistoryRow[]> {
  return executor
    .select({
      id: schema.auditLogTable.id,
      action: schema.auditLogTable.action,
      actorId: schema.auditLogTable.actorId,
      actorType: schema.auditLogTable.actorType,
      before: schema.auditLogTable.before,
      after: schema.auditLogTable.after,
      createdAt: schema.auditLogTable.createdAt,
    })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.workspaceId, workspaceId),
        eq(schema.auditLogTable.entityType, "workspace_role"),
        eq(schema.auditLogTable.entityId, roleId),
      ),
    )
    .orderBy(desc(schema.auditLogTable.createdAt))
    .limit(limit);
}

export async function listPersonNames(
  executor: Executor,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await executor
    .select({ id: schema.userTable.id, name: schema.userTable.name })
    .from(schema.userTable)
    .where(inArray(schema.userTable.id, [...userIds]));
  return new Map(rows.map((row) => [row.id, row.name]));
}
