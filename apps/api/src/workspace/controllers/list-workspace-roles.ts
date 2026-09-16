import { eq } from "drizzle-orm";
import db, { schema } from "../../database";

/**
 * One `workspace_role` row, `permission` parsed back into an object — matches better-auth's
 * own `listOrgRoles`/`roleData` shape (S7 blueprint §0). Reused by the create/update
 * controllers so all four routes return the identical row shape.
 */
export type WorkspaceRoleRow = Omit<
  typeof schema.workspaceRoleTable.$inferSelect,
  "permission"
> & {
  permission: Record<string, string[]>;
};

/**
 * A stored `permission` value that fails to parse as a `{resource: string[]}` object is
 * treated as granting NOTHING rather than thrown — a defensively-read display value, matching
 * how `require-workspace-permission.ts`/`require-workspace-role-authority.ts` already treat a
 * malformed row as "no statements" for authorization purposes. One bad row must not 500 the
 * whole list.
 */
function parsePermission(raw: string): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const result: Record<string, string[]> = {};
      for (const [resource, actions] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (Array.isArray(actions)) {
          result[resource] = actions.filter(
            (action): action is string => typeof action === "string",
          );
        }
      }
      return result;
    }
  } catch {
    // fall through to the empty object below
  }
  return {};
}

/**
 * Every `workspace_role` row for a workspace. Native replacement for
 * `authClient.organization.listRoles()`.
 *
 * No `ORDER BY`, deliberately — better-auth's own `listOrgRoles` has none either, and the
 * existing web UI does not sort client-side (`roles.tsx`), so imposing an order here would be
 * a new, undocumented guarantee nothing downstream asked for (S7 blueprint §2, Ambiguity Q4).
 * `"owner"` never appears: it is never seeded a row (retrofit plan R5).
 */
async function listWorkspaceRoles(
  workspaceId: string,
): Promise<WorkspaceRoleRow[]> {
  const rows = await db
    .select()
    .from(schema.workspaceRoleTable)
    .where(eq(schema.workspaceRoleTable.workspaceId, workspaceId));

  return rows.map((row) => ({
    ...row,
    permission: parsePermission(row.permission),
  }));
}

export default listWorkspaceRoles;
