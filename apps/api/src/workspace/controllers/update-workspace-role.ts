import { statement } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import type { WorkspaceRoleRow } from "./list-workspace-roles";
import { WorkspaceRoleNotFoundError } from "./workspace-membership-errors";
import {
  InsufficientPermissionToGrantError,
  InvalidPermissionResourceError,
  RoleNameReservedError,
} from "./workspace-role-errors";
import { WORKSPACE_ROLE_LOCK_NAMESPACE } from "./workspace-role-lock";

const VALID_PERMISSION_RESOURCES = new Set(Object.keys(statement));

export type UpdateWorkspaceRoleInput = {
  workspaceId: string;
  /** The row's opaque id, not its name — see Ambiguity Q1 in the S7 blueprint. */
  roleId: string;
  permission: Record<string, string[]>;
  /** Same contract as `CreateWorkspaceRoleInput.callerStatements`. */
  callerStatements: Record<string, readonly string[]> | null;
};

function invalidResources(permission: Record<string, string[]>): string[] {
  return Object.keys(permission).filter(
    (resource) => !VALID_PERMISSION_RESOURCES.has(resource),
  );
}

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
 * Replace (never merge) one role's `permission` JSON wholesale — matches better-auth's own
 * `updateRole` exactly (S7 blueprint §0, §2, Finding F5: a future API consumer could
 * reasonably assume PATCH means merge; it does not, here). Identified by the row's opaque
 * `id`, not its name (Thomas's decision, blueprint Ambiguity Q1).
 *
 * Same checks as create, in the same order, against the NEW permission set — except there is
 * no reserved-name or uniqueness check here: the name itself is never changed by this route.
 */
async function updateWorkspaceRole(
  input: UpdateWorkspaceRoleInput,
): Promise<WorkspaceRoleRow> {
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

    const [existing] = await tx
      .select()
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, input.workspaceId),
          eq(schema.workspaceRoleTable.id, input.roleId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new WorkspaceRoleNotFoundError(input.roleId);
    }
    // Defensive only — `owner` is never seeded a `workspace_role` row (retrofit plan R5), so
    // this can never be reached through any known write path today. Kept for symmetry with
    // delete's own defensive check, in case a future bug ever inserts one.
    if (existing.role === "owner") {
      throw new RoleNameReservedError();
    }

    const now = new Date();
    const [updated] = await tx
      .update(schema.workspaceRoleTable)
      .set({ permission: JSON.stringify(input.permission), updatedAt: now })
      .where(eq(schema.workspaceRoleTable.id, input.roleId))
      .returning();
    if (!updated) {
      throw new Error("workspace_role update returned no row");
    }

    return { ...updated, permission: input.permission };
  });
}

export default updateWorkspaceRole;
