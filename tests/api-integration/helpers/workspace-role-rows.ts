import { randomUUID } from "node:crypto";
import { BUILT_IN_ROLES, DEFAULT_ROLE_NAMES } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { capabilitiesFromLegacyStatements } from "../../../apps/api/src/permissions/legacy-statements";

/**
 * Write one role the way production now stores it (owner decision, 23 Oct): the canonical
 * workspace-scope `role` row carries the capabilities, and the legacy `workspace_role` row stays
 * as the readable statement source for the three default roles. Fixtures that used to insert only
 * a `workspace_role` row call this instead, so a custom role has a canonical row to resolve.
 *
 * `permission` is the legacy statement payload (object or raw text). A malformed payload yields a
 * role with no capabilities, exactly as the application parses it.
 */
export async function upsertWorkspaceRoleRows(
  workspaceId: string,
  role: string,
  permission: Record<string, unknown> | string,
  options: { id?: string; system?: boolean; rank?: number } = {},
): Promise<{ id: string }> {
  const raw =
    typeof permission === "string" ? permission : JSON.stringify(permission);
  const isDefault = (DEFAULT_ROLE_NAMES as readonly string[]).includes(role);
  const system = options.system ?? isDefault;
  const id = options.id ?? `role-${randomUUID()}`;

  let statements: Record<string, string[]> = {};
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [resource, actions] of Object.entries(value)) {
        if (
          Array.isArray(actions) &&
          actions.every((a) => typeof a === "string")
        )
          statements[resource] = actions as string[];
      }
    }
  } catch {
    statements = {};
  }

  await db
    .delete(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
  await db
    .delete(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.key, role),
      ),
    );
  await db.insert(schema.workspaceRoleTable).values({
    id,
    workspaceId,
    role,
    permission: raw,
    isSystem: system,
  });
  const builtIn = Object.hasOwn(BUILT_IN_ROLES, role)
    ? BUILT_IN_ROLES[role as keyof typeof BUILT_IN_ROLES]
    : undefined;
  await db.insert(schema.roleTable).values({
    id,
    scope: "workspace",
    workspaceId,
    key: role,
    name: role,
    rank: options.rank ?? builtIn?.rank ?? 30,
    capabilities: capabilitiesFromLegacyStatements(statements),
    isSystem: system,
    isEditable: builtIn ? builtIn.isEditable : true,
  });
  return { id };
}
