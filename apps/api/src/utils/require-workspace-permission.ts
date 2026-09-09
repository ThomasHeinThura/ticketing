import { type BuiltInRoleName, builtInRoles } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { isInstanceAdmin } from "./is-instance-admin";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "./workspace-member-roles";

type PermissionMap = Record<string, string[]>;

function builtInRoleStatements(
  role: string,
): Record<string, readonly string[]> | null {
  if (role in builtInRoles) {
    return builtInRoles[role as BuiltInRoleName].statements as Record<
      string,
      readonly string[]
    >;
  }
  return null;
}

function parsePermissionStatements(
  raw: string,
): Record<string, readonly string[]> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  // Only keep entries shaped like { [resource: string]: string[] }.
  // Anything malformed is dropped so `satisfies()` never calls
  // `.includes()` on a non-array.
  const result: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(actions)) continue;
    const filtered = actions.filter(
      (action): action is string => typeof action === "string",
    );
    if (filtered.length > 0) {
      result[resource] = filtered;
    }
  }
  return result;
}

async function customRoleStatements(
  workspaceId: string,
  role: string,
): Promise<Record<string, readonly string[]> | null> {
  const [row] = await db
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    )
    .limit(1);

  if (!row?.permission) return null;

  return parsePermissionStatements(row.permission);
}

function satisfies(
  statements: Record<string, readonly string[]>,
  required: PermissionMap,
): boolean {
  for (const [resource, actions] of Object.entries(required)) {
    const granted = statements[resource];
    if (!granted) return false;
    for (const action of actions) {
      if (!granted.includes(action)) return false;
    }
  }
  return true;
}

export async function hasWorkspacePermission(
  c: Context,
  permissions: PermissionMap,
) {
  const workspaceId = c.get("workspaceId");
  if (!workspaceId) return false;

  const apiKey = c.get("apiKey") as
    | { permissions?: Record<string, string[]> | null }
    | undefined;
  if (apiKey?.permissions && !satisfies(apiKey.permissions, permissions)) {
    return false;
  }

  if (await isInstanceAdmin(c)) {
    return true;
  }

  const userId = c.get("userId");
  if (!userId) return false;

  // ALL rows for the pair, and refuse to answer if there is more than one.
  // This used to be `.limit(1)` with no `ORDER BY`, so the evaluator could
  // select either row of a duplicated membership and therefore grant or deny
  // NONDETERMINISTICALLY -- measured at owner-row-first 200 versus
  // viewer-row-first 403, stable over twelve runs. Three independent reviewers
  // of this pull request and of #77 converged on it. Fail-closed: a corrupt
  // membership state is refused, never resolved by guessing. #88 tracks the
  // `UNIQUE (workspace_id, user_id)` constraint that makes it unreachable.
  const roles = await workspaceMemberRoles(db, workspaceId, userId);
  if (!isUnambiguousMembership(roles)) return false;
  const member = { role: roles[0] };

  if (!member?.role) return false;

  // Issue #66. `owner` is deliberately the ONE role never seeded a
  // `workspace_role` row (retrofit plan R5): its authority stays
  // compiled-in so an admin can never edit the workspace creator's own
  // authority away. For every other role name -- the three seeded
  // defaults (viewer/member/admin) and any custom role -- a missing row
  // means DENY, not "fall back to the compiled definition". The previous
  // behavior here fell back to `builtInRoleStatements` whenever no row
  // matched, which meant deleting (or simply never seeding) a role's row
  // silently RESTORED that role's full compiled-in privileges -- undoing
  // any narrowing an admin had made, and reachable with nothing more than
  // a missing/removed database row. See
  // `apps/api/src/utils/require-workspace-role-authority.ts` for the twin
  // implementation of this exact rule, written first for the two S4
  // mutation routes while this shared file's fallback was still someone
  // else's to fix.
  //
  // This is safe to fail closed on because default-role seeding is now
  // guaranteed at every creation path this codebase controls: the native
  // `POST /api/workspace` seeds inside its own transaction
  // (`workspace/controllers/create-workspace.ts`), and the still-mounted
  // `organization()` plugin's `afterCreateOrganization` hook (`auth.ts`)
  // no longer swallows a seed failure -- it now rolls the workspace back
  // and reports the failure to the caller instead of returning success
  // for a workspace with no role rows behind it.
  const statements =
    member.role === "owner"
      ? builtInRoleStatements("owner")
      : await customRoleStatements(workspaceId, member.role);

  return Boolean(statements && satisfies(statements, permissions));
}

export function requireWorkspacePermission(permissions: PermissionMap) {
  return async (c: Context, next: Next) => {
    if (!c.get("workspaceId")) {
      throw new HTTPException(500, {
        message: "workspaceId not set in context",
      });
    }

    const apiKey = c.get("apiKey") as
      | { permissions?: Record<string, string[]> | null }
      | undefined;
    if (apiKey?.permissions && !satisfies(apiKey.permissions, permissions)) {
      throw new HTTPException(403, { message: "Insufficient API key scope" });
    }

    if (!(await hasWorkspacePermission(c, permissions))) {
      if (!c.get("userId")) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    return next();
  };
}
