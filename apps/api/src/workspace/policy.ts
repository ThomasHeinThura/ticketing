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
 *
 * **Also covers the five native S5 membership-write routes** (retrofit plan §3, S5 row, issue
 * #6): adding a member, removing one, changing a member's role, leaving, and the atomic
 * ownership-transfer endpoint that replaces the client's promote/demote pair. Same
 * `sessionOnly` reasoning and enforcement as every route above.
 *
 * **None of the five loads the `workspace` row itself.** Every S5 controller
 * (`apps/api/src/workspace/controllers/*`) reads and writes only `workspace_member` and
 * `workspace_role` — `workspaceTable` is never selected from. `scopeSource: "request"` follows
 * the same reasoning `apps/api/src/capabilities/policy.ts` already states for exactly this
 * shape: the scope id is the path's own `workspaceId`, not one read back off a loaded row.
 *
 * **Capability strings are, again, the TARGET vocabulary and do not all have a clean home.**
 * `DELETE /api/workspace/{workspaceId}/members/{userId}` declares `member:remove` — an exact
 * name-for-name match in `docs/01-architecture/rbac.md`'s Members group ("Remove people"). The
 * other three capability-kind entries below have no equally exact match: rbac.md names
 * `member:invite` (for S6a's invitation route, not this one) and `member:remove`, but nothing
 * for "add an existing user directly" or "change a member's assigned role". `workspace:manage_members`
 * ("Add and remove workspace members", Workspace group) is the closest fit and is declared for
 * both — recorded here as a gap for #7 to resolve, the same way S4 recorded its
 * `organization:update`/`workspace:update` mismatch rather than inventing a capability name
 * ahead of that migration. The RUNTIME check on all three is `requireWorkspacePermission`
 * against the INHERITED `member` resource (`create`/`update`/`delete` — the same actions
 * better-auth's own `addMember`/`updateMemberRole`/`removeMember` gate on, confirmed by reading
 * `crud-members.mjs`), which is what the seeded `workspace_role` rows actually carry today.
 *
 * **`POST /api/workspace/{workspaceId}/leave` is `self`, kind 2** — the caller acts only on
 * their own membership row, exactly like `POST /api/workspace` (create) above. No capability
 * check: leaving is a self-action every member has, including a `viewer`
 * (`apps/api/src/workspace/controllers/leave-workspace.ts`).
 *
 * **`POST /api/workspace/{workspaceId}/transfer-ownership` is declared `capability` (kind 1)
 * with `workspace:manage_members`, but the RUNTIME check is not a capability check at all.**
 * `transfer-workspace-ownership.ts` reads the caller's OWN `workspace_member.role` fresh from
 * the database and requires it to literally equal `"owner"` — there is no `workspace_role` row
 * for `owner` to check against (R5: it is never seeded one) and therefore no capability string
 * that could gate it honestly. `workspace:manage_members` is declared here only because the
 * `Capability` union has no better match and every capability-kind policy requires one; this is
 * the same category of declared/enforced mismatch as the two points above, recorded rather than
 * invented around. One consequence worth stating plainly: because this route never calls
 * `hasWorkspacePermission`/`isInstanceAdmin` at all, it is NOT gated by
 * `requireWorkspaceRoleAuthority` the way the two S4 mutation routes and the three sibling S5
 * writes above are — there is no instance-admin bypass to close here, because there is no
 * bypass-capable check on this path in the first place.
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

  // S5 — add an existing platform user directly to a workspace. Runtime check is
  // `requireWorkspacePermission({ member: ["create"] })`; see the file comment for the
  // capability-name gap.
  //
  // `workspace:manage_members` is in `AUTHORITY_GRANTING` (`elevated.ts`), so the elevation
  // coverage test demands a declaration either way — but the ONE elevated action rbac.md lists
  // under this capability is granting `sees_all` on a membership (`PATCH
  // /api/workspaces/{id}/members/{personId}` with `sees_all: true`), a DIFFERENT, not-yet-built
  // route (P1/P4) that this batch does not touch: `workspace_member` has no `sees_all` column
  // today. This route only inserts an ordinary membership row with an existing role; it mints
  // no reach. `elevated: true` would also be dishonest for a second, independent reason: no
  // step-up mechanism (`POST /api/me/step-up`, `pending-actions.md`) exists anywhere in this
  // codebase yet, so declaring it would be a control that runs nowhere — exactly the
  // declared-and-inert shape this registry exists to refuse.
  "POST /api/workspace/{workspaceId}/members": {
    capability: "workspace:manage_members",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: false,
    elevationExemptionReason:
      "inserts an ordinary member row with an existing role; grants no sees_all/reach change (rbac.md's one elevated action under workspace:manage_members) and no step-up mechanism exists in this codebase to enforce elevated: true honestly",
  },

  // S5 — remove a member. `member:remove` is an exact match in rbac.md; runtime check is
  // `requireWorkspacePermission({ member: ["delete"] })`.
  "DELETE /api/workspace/{workspaceId}/members/{userId}": {
    capability: "member:remove",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
  },

  // S5 — change a member's assigned role. Runtime check is
  // `requireWorkspacePermission({ member: ["update"] })`; see the file comment for the
  // capability-name gap. Can never grant or touch the `owner` role — see
  // `update-workspace-member-role.ts`.
  //
  // Same `AUTHORITY_GRANTING` / elevation reasoning as the route above: no `sees_all` column,
  // no `sees_all` write, and no step-up mechanism to enforce `elevated: true` honestly against.
  // Reassigning a member between the workspace's own EDITABLE roles is bounded by whatever
  // capabilities that role already carries — it is not a fresh authority mint the way creating
  // or editing a ROLE DEFINITION (`workspace:manage_roles`, a different capability, also
  // AUTHORITY_GRANTING) would be.
  "PATCH /api/workspace/{workspaceId}/members/{userId}/role": {
    capability: "workspace:manage_members",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: false,
    elevationExemptionReason:
      "reassigns a member between this workspace's own existing editable roles; grants no sees_all/reach change and no step-up mechanism exists in this codebase to enforce elevated: true honestly",
  },

  // S5 — a member leaves of their own accord. `self`, kind 2: the caller acts only on their
  // own membership row, same shape as `POST /api/workspace` above. No capability check — every
  // member, including a `viewer`, may leave.
  "POST /api/workspace/{workspaceId}/leave": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "removes the caller's own membership row; the route names no person parameter because the caller is the person",
    },
    sessionOnly: true,
  },

  // S5 — the atomic ownership-transfer endpoint that replaces the client's promote/demote
  // pair. Declared `capability` because every capability-kind policy requires one, but the
  // runtime check is NOT a capability check at all — see the file comment.
  //
  // Same `AUTHORITY_GRANTING` mechanics as the two routes above (`workspace:manage_members` is
  // on that list), and the same absence of a built step-up mechanism to enforce `elevated: true`
  // against honestly. Recorded here as a JUDGEMENT CALL rather than an obvious exemption,
  // because unlike the other two this route hands over the single most powerful role in the
  // workspace: an argument that this SHOULD be `elevated: true` the moment `POST
  // /api/me/step-up` exists is reasonable, and is a human decision, not one this lane makes
  // unilaterally by picking `false` here.
  "POST /api/workspace/{workspaceId}/transfer-ownership": {
    capability: "workspace:manage_members",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: false,
    elevationExemptionReason:
      "hands over the owner role atomically; grants no sees_all/reach change (rbac.md's one elevated action under workspace:manage_members) and no step-up mechanism exists in this codebase yet to enforce elevated: true honestly -- flagged as a judgement call for a human decision once that mechanism lands, given this is the single most powerful role transfer a workspace has",
  },
} as const satisfies PolicyMap;
