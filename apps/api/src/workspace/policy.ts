import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Workspace route policies.
 *
 * Covers the three native S2 read routes this batch adds (retrofit plan §3, issue #6):
 * listing the caller's own workspaces, reading one workspace's detail (workspace + members +
 * pending invitations), and reading one workspace's pending invitations on their own. All
 * three declare `sessionOnly: true`, and — because nothing in `apps/api/src/index.ts` wires
 * `policyRegistry`/`evaluatePolicy` into the live request path yet (`apps/api/src/
 * policy-registry.ts`'s own docstring; that wiring is issue #8's) — the restriction is also
 * enforced directly, in these routes' own middleware, by
 * `apps/api/src/utils/require-session-only.ts`. The inherited better-auth `organization()`
 * plugin these routes replace never admitted an API key
 * (`enableSessionForAPIKeys: false`, `apps/api/src/auth.ts`) — every route mounted below the
 * app-wide auth guard *is* reachable by API key (retrofit plan risk R10), so without this,
 * these four new routes would silently widen reach relative to what they replace. The
 * 2026-09-08 architecture default is to preserve that inherited restriction, not widen it
 * ahead of a deliberate runtime-policy decision.
 *
 * **`GET /api/workspace/{id}/members` is deliberately absent from this file.** It predates
 * this batch (retrofit plan §3, S2 row: "already exists") and is classified by #8 alongside
 * the rest of the inherited surface — it is listed in
 * `tests/permissions/inherited-uncovered.json`, unmodified by this batch.
 */
export const workspacePolicies = {
  // List the caller's own workspace memberships. There is no separate resource this addresses
  // — the query is inherently "my own rows" — so this is the `self` kind (kind 2), not a
  // capability check against a scope: the controller (`get-user-workspaces.ts`) filters on
  // `workspace_member.userId = userId` and nothing else, so any authenticated identity is
  // correctly allowed and the row-level scoping is structural, not a further authority
  // decision. `personParam` states the `no_person_parameter` exemption because the route
  // takes no path/query parameter naming a person at all — the caller IS the person.
  "GET /api/workspace": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns the caller's own workspace memberships; the route names no person parameter because the caller is the person",
    },
    sessionOnly: true,
  },

  // Reads one workspace (plus its members and pending invitations) by path id.
  // `workspaceAccess.fromParam` resolves membership first; the controller re-loads the
  // workspace row itself and 404s if it is gone (`get-workspace-detail.ts`), so the scope id
  // is read from that same loaded row — `scopeSource: "row"`.
  "GET /api/workspace/{workspaceId}": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },

  // Same resource family as the route above — one workspace's pending invitations, addressed
  // by the same path id and gated by the same capability. `workspace:read` covers this: the
  // compound detail route above already returns the identical invitation rows embedded in one
  // response, so a standalone call for the same slice cannot reasonably need more authority
  // than the compound one does.
  "GET /api/workspace/{workspaceId}/invitations": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
