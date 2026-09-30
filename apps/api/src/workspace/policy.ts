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
 * **Also covers the three native S4 write routes** (retrofit plan §3, S4 row, issue #6):
 * creating a workspace, updating one, and deleting one. Same `sessionOnly` reasoning as the
 * three reads above, enforced the same way — directly, by
 * `apps/api/src/utils/require-session-only.ts`, wired into all three routes' own middleware.
 *
 * **The capability strings below are the TARGET vocabulary, and do not match what actually
 * gates the request today.** `PATCH`/`DELETE /api/workspace/{workspaceId}` declare
 * `workspace:update`/`workspace:delete` here because those are the only strings the
 * `Capability` union admits — but the runtime check on both routes is
 * `requireWorkspacePermission({ organization: ["update"|"delete"] })`
 * (`apps/api/src/utils/require-workspace-permission.ts`), which reads the INHERITED
 * better-auth-shaped `organization` key the seeded `workspace_role` rows actually carry.
 * Re-keying the seeded rows (and this evaluator) to `workspace:*` is #7's capability
 * migration (retrofit plan §3.1 item 1) — declaring a different key here would not close
 * that gap, it would just make the declaration and the enforcement disagree about which
 * string means "may update this workspace", which is worse than the gap being visible. This
 * is the same transitional state R4 already describes for the S2 reads; it is recorded here
 * rather than pretended away, and it closes automatically the day #7 re-keys the evaluator —
 * nothing here will need to change to benefit from that, only the enforcement will start
 * checking the string this file already declares.
 *
 * **`sessionOnly` and workspace-role authority are two independent boundaries, and this
 * batch enforces both directly.** `sessionOnly` refuses a non-session credential before the
 * route's own logic runs at all (`require-session-only.ts`). Separately, on the two mutation
 * routes only, `apps/api/src/utils/require-workspace-role-authority.ts` refuses an instance
 * admin whose OWN workspace role does not grant the capability, closing the
 * `hasWorkspacePermission` instance-admin bypass rather than inheriting it onto a route this
 * batch adds. See that file for the full reasoning, including why it is not #66 despite
 * touching the same permission rows.
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

  // Creates a workspace. There is no existing workspace to check authority against — the
  // caller becomes the owner of a brand-new one, which is exactly the `self` kind's shape:
  // the resulting rows are keyed to the caller's own identity (the owner `workspace_member`
  // row, the new workspace itself), not to a capability held in some other scope. This is
  // also why there is no `workspace:create` entry in the capability list at all (rbac.md):
  // creation is gated only by authentication plus the instance-wide
  // `DISABLE_WORKSPACE_CREATION` admin flag (`requireWorkspaceCreationAllowed`), which is a
  // route-level business rule, not a capability check, and so is not itself a distinct policy
  // kind.
  "POST /api/workspace": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "creates a new workspace that the caller becomes the owner of; the route names no person parameter because the caller is the person",
    },
    sessionOnly: true,
  },

  // Updates one workspace's own fields (name, slug, logo, description) by path id.
  // `workspaceAccess.fromParam` resolves membership and loads the row; the update controller
  // re-checks existence itself and 404s if it is gone, so the scope id is read from that same
  // loaded row — `scopeSource: "row"`, same as the read route above.
  "PATCH /api/workspace/{workspaceId}": {
    capability: "workspace:update",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },

  // Deletes one workspace and everything cascading off it, by path id. Same scope shape as
  // update; a strictly narrower capability (delete implies update in rbac.md's implication
  // table), and the seeded `workspace_role` rows reflect that narrowing today (only `owner`'s
  // compiled definition — never a DB row, retrofit plan R5 — carries `organization:delete`).
  "DELETE /api/workspace/{workspaceId}": {
    capability: "workspace:delete",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
