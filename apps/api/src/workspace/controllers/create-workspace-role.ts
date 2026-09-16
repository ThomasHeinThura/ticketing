import { statement } from "@taskdesk/permissions";
import { and, count, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import { MAX_WORKSPACE_ROLES_PER_WORKSPACE } from "../../utils/workspace-role-limits";
import type { WorkspaceRoleRow } from "./list-workspace-roles";
import {
  InsufficientPermissionToGrantError,
  InvalidPermissionResourceError,
  RoleLimitReachedError,
  RoleNameReservedError,
  RoleNameTakenError,
} from "./workspace-role-errors";
import { WORKSPACE_ROLE_LOCK_NAMESPACE } from "./workspace-role-lock";

/** Every resource key `@taskdesk/permissions`'s legacy `statement` recognizes. */
const VALID_PERMISSION_RESOURCES = new Set(Object.keys(statement));

export type CreateWorkspaceRoleInput = {
  workspaceId: string;
  role: string;
  permission: Record<string, string[]>;
  /**
   * The calling member's OWN resolved statements —
   * `resolveCallerWorkspaceStatements(c)` (`require-workspace-permission.ts`), computed once
   * in the route handler. `null` means the caller holds nothing usable, so every requested
   * grant fails the ceiling check below.
   */
  callerStatements: Record<string, readonly string[]> | null;
};

/** Every unknown resource key in `permission`, in the order they appear. */
function invalidResources(permission: Record<string, string[]>): string[] {
  return Object.keys(permission).filter(
    (resource) => !VALID_PERMISSION_RESOURCES.has(resource),
  );
}

/**
 * Every `(resource, action)` pair in `permission` the caller does not already hold, rendered
 * as `"resource:action"` — the check `RL-3` and Finding F2 require: a caller may never grant a
 * capability they do not themselves already hold.
 */
function missingGrants(
  permission: Record<string, string[]>,
  callerStatements: Record<string, readonly string[]> | null,
): string[] {
  const missing: string[] = [];
  for (const [resource, actions] of Object.entries(permission)) {
    const held = callerStatements?.[resource] ?? [];
    for (const action of actions) {
      if (!held.includes(action)) {
        missing.push(`${resource}:${action}`);
      }
    }
  }
  return missing;
}

/**
 * Create a custom role for a workspace. Native replacement for
 * `authClient.organization.createRole()`.
 *
 * Mirrors better-auth's own `createOrgRole` (S7 blueprint §0, §2): reserved-name check,
 * unknown-resource check, "cannot grant what you don't hold" check, then — inside the
 * advisory lock, which is what makes these two checks race-safe — the 25-role ceiling and a
 * name-uniqueness re-check, then the insert.
 */
async function createWorkspaceRole(
  input: CreateWorkspaceRoleInput,
): Promise<WorkspaceRoleRow> {
  // better-auth lower-cases a new role's name on create (`crud-access-control.mjs`) —
  // preserved so a role named "Owner" is refused the same way "owner" is.
  const normalizedRole = input.role.trim().toLowerCase();
  if (normalizedRole === "owner") {
    throw new RoleNameReservedError();
  }

  const badResources = invalidResources(input.permission);
  if (badResources.length > 0) {
    throw new InvalidPermissionResourceError(badResources);
  }

  const missing = missingGrants(input.permission, input.callerStatements);
  if (missing.length > 0) {
    throw new InsufficientPermissionToGrantError(missing);
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_ROLE_LOCK_NAMESPACE}, hashtext(${input.workspaceId}))`,
    );

    const [existingCountRow] = await tx
      .select({ value: count() })
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, input.workspaceId));
    if ((existingCountRow?.value ?? 0) >= MAX_WORKSPACE_ROLES_PER_WORKSPACE) {
      throw new RoleLimitReachedError(MAX_WORKSPACE_ROLES_PER_WORKSPACE);
    }

    const [existing] = await tx
      .select({ id: schema.workspaceRoleTable.id })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, input.workspaceId),
          eq(schema.workspaceRoleTable.role, normalizedRole),
        ),
      )
      .limit(1);
    if (existing) {
      throw new RoleNameTakenError(normalizedRole);
    }

    const now = new Date();
    const [created] = await tx
      .insert(schema.workspaceRoleTable)
      .values({
        workspaceId: input.workspaceId,
        role: normalizedRole,
        permission: JSON.stringify(input.permission),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) {
      throw new Error("workspace_role insert returned no row");
    }

    return { ...created, permission: input.permission };
  });
}

export default createWorkspaceRole;
