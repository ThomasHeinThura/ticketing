import { type BuiltInRoleName, builtInRoles } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { isInstanceAdmin } from "./is-instance-admin";
import {
  type MembershipRoleResolution,
  resolveMembershipRole,
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

  // ALL rows for the pair; refuse to answer if there is more than one, and --
  // issue #82 -- refuse to answer if the one value is not exactly one role.
  //
  // The row-count half used to be `.limit(1)` with no `ORDER BY`, so the
  // evaluator could select either row of a duplicated membership and therefore
  // grant or deny NONDETERMINISTICALLY -- measured at owner-row-first 200
  // versus viewer-row-first 403, stable over twelve runs. Three independent
  // reviewers of this pull request and of #77 converged on it. #88 tracks the
  // `UNIQUE (workspace_id, user_id)` constraint that makes it unreachable.
  //
  // The VALUE half is issue #82: `"owner,admin"` is one row, so the count check
  // passes it through, and the exact-match lookups below then deny it by
  // accident rather than by decision -- `"owner,admin" in builtInRoles` is
  // false and no `workspace_role` row is named that either. Accident is not
  // good enough for a P0 authorization surface: it is invisible to an operator,
  // it says nothing about intent, and it would silently become a GRANT the day
  // someone created a custom role literally named `"owner,admin"` -- which
  // better-auth's `create-role` allows, since it normalises a new role name
  // with nothing but `.toLowerCase()` (`crud-access-control.mjs:9`). So the
  // malformed value is now refused explicitly, by name, before any lookup runs.
  //
  // Both halves are the same rule and share one resolution
  // (`resolveMembershipRole`) with `require-workspace-role-authority.ts`, so
  // the two evaluators cannot reduce the same rows differently.
  const membership = await resolveMembershipRole(db, workspaceId, userId);
  if (!membership.ok) return false;
  const role = membership.role;

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
    role === "owner"
      ? builtInRoleStatements("owner")
      : await customRoleStatements(workspaceId, role);

  return Boolean(statements && satisfies(statements, permissions));
}

/**
 * The membership resolution `hasWorkspacePermission` would use for THIS caller, or `null`
 * when it would not consult a membership row at all — issue #82.
 *
 * WHY THIS IS EXPORTED, and why it returns `null` rather than a third failure reason.
 * Issue #82 requires `/api/capabilities` to agree with the canonical evaluator "for every
 * malformed shape", AND to make a malformed row distinguishable from a role that merely
 * lacks a capability. Those two requirements pull against each other if the endpoint
 * re-derives the caller's membership on its own: any drift between the two readings is a
 * new divergence of exactly the kind #82 is about. So the endpoint does not re-derive it —
 * it asks this function, which walks the SAME short-circuits, in the SAME order, as the
 * evaluator above.
 *
 * The `null` cases are the short-circuits, and each one means "the evaluator never looked
 * at a role value, so there is no malformed row for the endpoint to report":
 *
 *  - **no `workspaceId`** — the evaluator returns `false` before reading anything;
 *  - **an instance admin** — the bypass returns `true` without consulting the membership.
 *    That bypass is deliberately NOT re-litigated here: it is `require-workspace-role-
 *    authority.ts`'s subject and Thomas's 2026-09-08 decision, and an instance admin
 *    already holds the authority a corrupt row could confer, so a malformed value adds no
 *    privilege for them. What matters for #82 is that the endpoint and the evaluator make
 *    the same call, and routing both through this function is what guarantees it;
 *  - **no `userId`** — unauthenticated, refused earlier by the route's own middleware.
 */
export async function callerMembershipResolution(
  c: Context,
): Promise<MembershipRoleResolution | null> {
  const workspaceId = c.get("workspaceId");
  if (!workspaceId) return null;

  // Deliberately NOT short-circuited on an API key's scope: `hasWorkspacePermission` tests
  // that scope against ONE permission map, and this endpoint asks sixteen different ones,
  // so there is no single answer to short-circuit on. A scoped key calling into a corrupt
  // membership therefore gets the same explicit refusal as a session caller, which is both
  // the fail-closed direction and the honest one.
  if (await isInstanceAdmin(c)) return null;

  const userId = c.get("userId");
  if (!userId) return null;

  return resolveMembershipRole(db, workspaceId, userId);
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
