import {
  BUILT_IN_ROLES,
  type BuiltInRoleName,
  builtInRoles,
  type Capability,
  expandCapabilities,
} from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { capabilitiesSatisfyLegacyStatements } from "../permissions/legacy-statements";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import { findWorkspaceRoleByKey } from "../permissions/workspace-role-authority.repository";
import { apiKeyHasPermissionScope } from "./require-api-key-permission-scope";
import {
  serviceKeyOfRequest,
  serviceKeySatisfiesStatements,
} from "./service-key-gate";
import {
  type MembershipRoleResolution,
  resolveMembershipRole,
  workspaceRoleAuthority,
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

/**
 * What this workspace's own role row grants to a legacy statement gate: a custom role is answered
 * from its canonical `role.capabilities`; a built-in default row from its legacy statements.
 * `null` is a refusal.
 */
async function roleSatisfies(
  workspaceId: string,
  role: string,
  required: PermissionMap,
): Promise<boolean> {
  const authority = await workspaceRoleAuthority(db, workspaceId, role);
  if (authority.kind === "capabilities") {
    return capabilitiesSatisfyLegacyStatements(
      authority.capabilities,
      required,
    );
  }
  if (authority.kind === "statements") {
    const statements = parsePermissionStatements(authority.permission);
    return Boolean(statements && satisfies(statements, required));
  }
  return false;
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

  if (!apiKeyHasPermissionScope(c, permissions)) return false;

  // AK-7: a workspace service key has no membership row; it holds exactly its stored subset
  // in its own workspace.
  const service = serviceKeyOfRequest(c);
  if (service)
    return serviceKeySatisfiesStatements(service, workspaceId, permissions);

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
  if (role === "owner") {
    const statements = builtInRoleStatements("owner");
    return Boolean(statements && satisfies(statements, permissions));
  }
  return roleSatisfies(workspaceId, role, permissions);
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
 * A `null` result means there is no workspace or authenticated user in context, so there is
 * no membership row to classify for the endpoint:
 *
 *  - **no `workspaceId`** — the evaluator returns `false` before reading anything;
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
  const userId = c.get("userId");
  if (!userId) return null;

  return resolveMembershipRole(db, workspaceId, userId);
}

/**
 * The caller's OWN resolved capability set in this workspace: what `RL-3` ("you cannot grant a
 * capability you do not hold yourself") tests every requested capability against.
 *
 * NO INSTANCE-ADMIN BRANCH. Instance-admin global reach does not substitute for a workspace
 * capability. `owner` is compiled; every other key resolves from its canonical `role` row.
 *
 * Returns `null` when nothing usable can be resolved (no workspaceId/userId in context, no
 * membership, an ambiguous or malformed membership row, or no role row). Callers MUST treat
 * `null` as "holds nothing", never as "skip the check".
 */
export async function resolveCallerWorkspaceCapabilities(
  c: Context,
): Promise<ReadonlySet<Capability> | null> {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  if (!workspaceId || !userId) return null;

  const membership = await resolveMembershipRole(db, workspaceId, userId);
  if (!membership.ok) return null;
  if (membership.role === "owner") {
    return expandCapabilities(BUILT_IN_ROLES.owner.capabilities, {
      tier: "workspace",
    });
  }
  const row = await findWorkspaceRoleByKey(db, workspaceId, membership.role);
  if (!row) return null;
  return expandCapabilities(row.capabilities, { tier: "workspace" });
}

export function requireWorkspacePermission(permissions: PermissionMap) {
  return async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    if (!c.get("workspaceId")) {
      throw new HTTPException(500, {
        message: "workspaceId not set in context",
      });
    }

    if (!apiKeyHasPermissionScope(c, permissions)) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Insufficient API key scope" });
    }

    if (!(await hasWorkspacePermission(c, permissions))) {
      if (!c.get("userId") && !serviceKeyOfRequest(c)) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    setShadowLegacyAuthorization(c, "allowed");
    return next();
  };
}
