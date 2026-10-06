import { statement } from "@taskdesk/permissions";
import type { schema } from "../../database";
import { listWorkspaceRolesQuery } from "../repository";

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
 *
 * Only keys present in `statement` (the current, code-level resource set) are returned. Issue
 * #8 rekey migration 0071 keeps a legacy `task` key alongside `work_item` in already-migrated
 * rows for the rolling-deploy window (old pods still read `task`) — but `task` is not a
 * resource `create-workspace-role.ts`/`update-workspace-role.ts` accept. Returning it here fed
 * it straight back into the settings UI's edit form, which round-tripped it on save and hit
 * "Unknown permission resource(s): task" on every migrated role (E1, Opus review of #392).
 */
function parsePermission(raw: string): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const result: Record<string, string[]> = {};
      for (const [resource, actions] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (!Object.hasOwn(statement, resource)) continue;
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
  const rows = await listWorkspaceRolesQuery(workspaceId);

  return rows.map((row) => ({
    ...row,
    permission: parsePermission(row.permission),
  }));
}

export default listWorkspaceRoles;
