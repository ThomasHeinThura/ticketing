import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Search route policy (issue #8, `search` lane).
 *
 * Mounted at `apps/api/src/index.ts:794`, below the app-wide auth guard (line 755) — H2 does
 * not constrain this route.
 *
 * **`GET /api/search` searches tasks, projects, workspaces, comments and activities within ONE
 * workspace**, named by the required `workspaceId` query parameter (`searchQuery`,
 * `./schema.ts` — `z.string().min(1)`, not optional). Confirmed against the actual controller
 * (`./controllers/global-search.ts`), not assumed from the route's own description: every
 * per-entity sub-query (`workspaceFilter`) restricts to `projectTable.workspaceId ===
 * :workspaceId` (or, when `workspaceId` is absent, to every workspace the resolved caller
 * belongs to — but the route schema makes `workspaceId` required, so that branch is dead at
 * this route today), and the standalone workspace search additionally filters to
 * `inArray(workspaceTable.id, accessibleWorkspaceIds)`, the caller's own memberships.
 *
 * **The only gate is `workspaceAccess.fromQuery()`** (`apps/api/src/search/index.ts`'s only
 * middleware) — resolving to `validateWorkspaceAccess` (`apps/api/src/utils/
 * validate-workspace-access.ts`), which checks plain membership in the named workspace (or the
 * instance-admin bypass) and nothing more granular: no per-entity-type capability, no
 * project-level reach narrowing beyond "is a member of this workspace at all". `workspace:read`
 * is the target capability — every built-in role from `viewer` up holds it, matching that any
 * member can search, and there is no dedicated `search:*` capability in `docs/01-architecture/
 * rbac.md` to declare instead.
 *
 * This is a collection query, not a single-resource lookup, but it is scoped to exactly one
 * addressed workspace via the request's own `workspaceId` — the same shape
 * `workspace/policy.ts` already classifies `scopeSource: "request"` for
 * `GET /api/workspace/{workspaceId}/roles` ("the controller never loads the `workspace` row
 * itself, only queries ... by the path's own `workspaceId`"): `workspaceAccess.fromQuery()`
 * validates membership against the id directly, it does not load and re-verify a `workspace`
 * row the way `workspaceAccess.fromParam()` does for `GET /api/workspace/{workspaceId}` itself.
 * `reach: "required"` — the route does address one resource (the workspace being searched),
 * even though its response is a heterogeneous list.
 *
 * **The controller's own `userEmail`-based fallback (`globalSearch`'s `resolvedUserId`) is
 * unreachable through this route.** `apps/api/src/search/index.ts` always passes `userId:
 * c.get("userId")` — the caller's own resolved identity, set by the app-wide auth guard before
 * any route below it runs — so `globalSearch`'s `if (!resolvedUserId && userEmail)` branch can
 * only fire if `c.get("userId")` were ever falsy for an authenticated request, which the guard
 * does not allow. Not a defect, and not this route's authority model (`userEmail` only narrows
 * the caller's OWN accessible-workspace set if `userId` were absent) — noted so the security
 * review does not mistake it for a caller-controlled identity switch; it is not one.
 *
 * No `AUTHORITY_GRANTING` concern (`workspace:read` mints no authority) and no `sessionOnly`
 * (kaneo-native route, same reasoning as the rest of this lane — see `comment/policy.ts`'s file
 * comment).
 */
export const searchPolicies = {
  "GET /api/search": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
} as const satisfies PolicyMap;
