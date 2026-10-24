import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema } from "../database";
import type { Executor } from "../database/executor";

/**
 * The six workspace-scope built-in roles as real, capability-bearing `role` rows (owner decision,
 * 23 Oct). Automations pick an effective role from these rows, and a custom role is cloned from
 * one. Their capability lists are the compiled `BUILT_IN_ROLES` lists, stored verbatim.
 *
 * `is_editable` follows the compiled definition (every built-in but `owner`). The legacy
 * statement gates still read the inherited `viewer` / `member` / `admin` rows, so an edit of one of
 * those three also moves that legacy row by delta (see `role-service.ts`); `manager` and `lead`
 * have no legacy row and are answered from their canonical capabilities. Migration `0145`
 * backfills the same six keys with the same values.
 *
 * `owner` and `admin` rows pre-date this (migration `0123` created them as empty-capability
 * `sees_all` carriers). They are filled in place; their ids are kept, because
 * `membership_grant.role_id` points at them.
 */
export const WORKSPACE_BUILT_IN_ROLE_KEYS = [
  "owner",
  "admin",
  "manager",
  "lead",
  "member",
  "viewer",
] as const;

export type WorkspaceBuiltInRoleKey =
  (typeof WORKSPACE_BUILT_IN_ROLE_KEYS)[number];

function displayName(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function builtInRow(workspaceId: string, key: WorkspaceBuiltInRoleKey) {
  const builtIn = BUILT_IN_ROLES[key];
  return {
    scope: "workspace",
    workspaceId,
    key,
    name: displayName(key),
    description: builtIn.intent,
    rank: builtIn.rank,
    capabilities: [...builtIn.capabilities].sort(),
    isSystem: true,
    isEditable: builtIn.isEditable,
  };
}

/**
 * Idempotently make the six rows exist and carry their capabilities for one workspace. Safe to
 * call from concurrent writers and at every boot: a missing row is inserted with
 * `ON CONFLICT DO NOTHING`, and an existing empty-capability carrier is filled in place. A
 * non-empty system row is never overwritten.
 */
export async function seedWorkspaceBuiltInRoles(
  executor: Executor,
  workspaceId: string,
): Promise<void> {
  await seedWorkspaceBuiltInRolesFor(executor, [workspaceId]);
}

export async function seedWorkspaceBuiltInRolesFor(
  executor: Executor,
  workspaceIds: readonly string[],
): Promise<void> {
  if (workspaceIds.length === 0) return;
  const BATCH = 500;
  for (let offset = 0; offset < workspaceIds.length; offset += BATCH) {
    const batch = workspaceIds.slice(offset, offset + BATCH);
    const existing = await executor
      .select({
        workspaceId: schema.roleTable.workspaceId,
        key: schema.roleTable.key,
      })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "workspace"),
          inArray(schema.roleTable.workspaceId, [...batch]),
          inArray(schema.roleTable.key, [...WORKSPACE_BUILT_IN_ROLE_KEYS]),
        ),
      );
    const present = new Set(
      existing.map((row) => `${row.workspaceId}\u0000${row.key}`),
    );
    const rows = [];
    for (const workspaceId of batch) {
      for (const key of WORKSPACE_BUILT_IN_ROLE_KEYS) {
        if (present.has(`${workspaceId}\u0000${key}`)) continue;
        rows.push({ id: createId(), ...builtInRow(workspaceId, key) });
      }
    }
    for (let i = 0; i < rows.length; i += 1000) {
      await executor
        .insert(schema.roleTable)
        .values(rows.slice(i, i + 1000))
        .onConflictDoNothing();
    }
  }

  // Fill only the empty reach carriers (`owner` / `admin` from migration 0123) in place.
  for (const key of ["owner", "admin"] as const) {
    const row = builtInRow("", key);
    await executor
      .update(schema.roleTable)
      .set({
        name: row.name,
        description: row.description,
        capabilities: row.capabilities,
        isEditable: row.isEditable,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.roleTable.scope, "workspace"),
          eq(schema.roleTable.key, key),
          eq(schema.roleTable.isSystem, true),
          sql`${schema.roleTable.capabilities} = '[]'::jsonb`,
        ),
      );
  }
}

/** Every workspace id; the boot backfill's input. */
export async function listAllWorkspaceIdsForRoleSeed(
  executor: Executor,
): Promise<string[]> {
  const rows = await executor
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable);
  return rows.map((row) => row.id);
}
