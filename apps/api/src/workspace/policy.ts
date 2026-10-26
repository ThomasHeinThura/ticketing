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
 * routes only, the canonical capability check requires the caller's own workspace role even
 * when global reach permits the instance administrator to address that workspace. The
 * separate role-authority middleware retains stricter malformed/missing-row handling on
 * designated mutations.
 *
 * **`GET /api/workspace/{workspaceId}/members` is now classified below, by #8.** It predates
 * this batch (retrofit plan §3, S2 row: "already exists") and was left for #8's pass, as
 * `tests/permissions/inherited-uncovered.json` recorded. Same capability, scope and
 * `scopeSource` as its sibling `GET /api/workspace/{workspaceId}/invitations` immediately
 * below it, and for the same reason: `getWorkspaceMembersCtrl` (`apps/api/src/workspace/
 * controllers/get-workspace-members.ts`) queries `workspace_user`/`user` by the path's own
 * `workspaceId` and loads no `workspace` row itself, but it is the identical query the compound
 * `GET /api/workspace/{workspaceId}` detail route already runs and returns embedded — that
 * route's own `getWorkspaceDetail` (`get-workspace-detail.ts`) calls the very same
 * `getWorkspaceMembers` function after loading the workspace row and 404ing if it is gone. A
 * standalone call for the same slice cannot reasonably need more authority than the compound
 * one already grants, so this reuses `scopeSource: "row"` by the same analogy the invitations
 * route below uses, not because this route's own query loads a `workspace` row.
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
 * **`POST /api/workspace/{workspaceId}/transfer-ownership` declares `capability` (kind 1)
 * with `workspace:transfer_ownership` — NOT `workspace:manage_members`, and this is the one
 * capability-kind entry in this file where the declaration now matches the runtime exactly.**
 *
 * It used to declare `workspace:manage_members` (the closest match the `Capability` union
 * admitted at the time) while the actual runtime check was a hardcoded string comparison
 * inside `transferWorkspaceOwnership`'s transaction — `caller.role !== "owner"` — with no
 * capability check anywhere on the path. That produced three different answers to "who may
 * transfer ownership": the route policy said `workspace:manage_members`, the permission-matrix
 * fixture (generated FROM the route policy) therefore read `manager → allow`, and the only
 * role that could actually call the route successfully was `owner`. `workspace:manage_members`
 * is a real, separate capability — `manager` holds it (rbac.md:187) and legitimately adds and
 * removes ordinary members — but ownership transfer is a different, narrower authority, so
 * reusing that name here was the defect, not merely an imprecise label.
 *
 * `workspace:transfer_ownership` (rbac.md § Capabilities) is granted to `owner` alone —
 * `admin`, `manager`, `lead`, `member`, `viewer`, `customer` and instance-admin all lack it.
 * `apps/api/src/utils/require-workspace-capability.ts` evaluates that exact capability, before
 * the handler runs, against the caller's OWN freshly-read `workspace_member.role` — reusing
 * the same compiled `BUILT_IN_ROLES` capability data the permission-matrix fixture and this
 * policy declaration both draw from, so all three can no longer independently drift.
 * `transferWorkspaceOwnership`'s in-transaction re-read of that same role, under
 * `pg_advisory_xact_lock`, stays exactly where it was — it is what makes two concurrent
 * transfers from the same owner mutually exclusive — but it is now a race-safety / invariant
 * check ALONGSIDE the capability gate, not the only authority check on this path. Both call
 * the identical `builtInRoleHasCapability` function, so they cannot disagree.
 *
 * `workspace:transfer_ownership` is in `AUTHORITY_GRANTING` (`elevated.ts`) and the route is
 * `elevated: true`: it hands over the single most powerful role in the workspace, and
 * retained-constraints.md requires real operation-bound step-up for it once the mechanism exists
 * (permissions.md's elevated table carries the row).
 *
 * There remains no instance-admin bypass to close on this route, and that is unchanged and
 * deliberate: `requireWorkspaceCapability` never calls `isInstanceAdmin`, exactly like the
 * hardcoded check it replaces — see that file's own doc comment for why adding one now would
 * be inventing new behaviour this route never had, not preserving old behaviour.
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
  // `workspaceAccess.fromParam` applies the native reach check. The strict endpoint
  // boundary then loads this exact workspace row before evaluating the policy; the
  // controller independently re-loads it and 404s if it is gone. The evaluator therefore
  // receives row-derived scope evidence, not the path id relabelled as a row.
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

  // Issue #8 — a workspace's member list, with roles. See the file comment above for why this
  // reuses `workspace:read` / `scope: "workspace"` / `scopeSource: "row"` from its siblings.
  // The strict endpoint boundary loads the addressed workspace row before evaluation even
  // though this list query itself only reads membership/user rows.
  // `requireSessionOnly()` is wired into this route's own middleware
  // (`apps/api/src/workspace/index.ts`, `getWorkspaceMembersRoute`) specifically so runtime
  // enforcement would not lag this declaration — see that route's own doc comment.
  "GET /api/workspace/{workspaceId}/members": {
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
  // `workspaceAccess.fromParam` applies the native reach check. The strict endpoint boundary
  // loads the addressed workspace row before policy evaluation; the update controller
  // independently re-checks existence and 404s if it is gone. The policy scope therefore
  // uses row-derived evidence, matching the read route above.
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

  // S8a — set the caller's own active workspace, by path id. `self`, kind 2, same shape as
  // `POST /api/workspace/{workspaceId}/leave` below: the route writes only the CALLING
  // session's own `activeOrganizationId` column (`activate-workspace.ts`), never another
  // user's row, so there is no capability to check against a separate resource — membership
  // in the target workspace is enforced by this route's own middleware
  // (`workspaceAccess.fromParam` + `requireWorkspaceMembership`), the same restored
  // precondition the two mutation routes above use, mirroring the plugin's own
  // `checkMembership` refusal on `/organization/set-active`.
  "POST /api/workspace/{workspaceId}/activate": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "sets the caller's own active workspace pointer; the route names no person parameter because the caller is the person",
    },
    sessionOnly: true,
  },

  // S5 — add an existing platform user directly to a workspace. Runtime check is
  // `requireWorkspacePermission({ member: ["create"] })`; see the file comment for the
  // capability-name gap.
  //
  // `workspace:manage_members` is in `AUTHORITY_GRANTING` (`elevated.ts`), so the elevation
  // coverage test demands a declaration either way. The ONE elevated action permissions.md lists
  // under this capability is granting `sees_all` on a membership (`PATCH
  // /api/workspaces/{id}/members/{personId}` with `sees_all: true`), a different route that is
  // not mounted (`workspace_member` has no `sees_all` column). This route only inserts an
  // ordinary membership row with an existing role and mints no reach, and permissions.md's
  // elevated table carries no row for it, so it is declared `elevated: false` with that reason
  // (contract and map agree; the step-up mechanism exists, the contract just does not ask for it).
  "POST /api/workspace/{workspaceId}/members": {
    capability: "workspace:manage_members",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: false,
    elevationExemptionReason:
      "inserts an ordinary member row with an existing role; grants no sees_all/reach change (permissions.md's one elevated action under workspace:manage_members) and the elevated table carries no row for member add",
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
  // Same `AUTHORITY_GRANTING` / elevation reasoning as the route above: no `sees_all` column
  // or write, and permissions.md's elevated table carries no row for a member role change.
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
      "reassigns a member between this workspace's own existing editable roles; grants no sees_all/reach change and permissions.md's elevated table carries no row for a member role change",
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
  // pair. Declared `capability` with `workspace:transfer_ownership` (rbac.md § Capabilities,
  // granted to `owner` alone) — the runtime check, `requireWorkspaceCapability` in this
  // route's own middleware, evaluates that exact capability.
  //
  // `elevated: true`: retained-constraints.md requires "real operation-bound elevation ... when
  // the supported step-up mechanism exists", and it now does. The handler spends a one-use
  // PA-15 proof (`workspace_ownership_transfer`, bound to the workspace and the new owner) in
  // the transfer's own transaction (`runWithStepUp`, `auth/step-up-spend.ts`).
  "POST /api/workspace/{workspaceId}/transfer-ownership": {
    capability: "workspace:transfer_ownership",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: true,
  },

  // S6a — invite a user, by email, into the workspace (issue #6, retrofit plan §3, S6a row).
  // `member:invite` is an exact match in rbac.md's Members group. Runtime check is
  // `requireWorkspacePermission({ invitation: ["create"] })` against the INHERITED
  // `invitation` resource the seeded `workspace_role` rows actually carry (better-auth's own
  // `defaultStatements.invitation`, `packages/permissions/src/
  // legacy-better-auth-access-control.ts`) -- same transitional gap as `workspace:update`
  // above: re-keying to the canonical vocabulary is #7's, not this lane's.
  //
  // `scopeSource: "request"`: the controller (`invite-workspace-member.ts`) never loads the
  // `workspace` row for authority purposes, only `workspaceId` off the path -- same shape as
  // the S5 member routes above.
  //
  // `member:invite` is NOT in `AUTHORITY_GRANTING` (`elevated.ts`), so no `elevated` field is
  // declared -- this route mints no fresh authority the elevation-coverage test would demand
  // a written exemption for; it only creates a pending, revocable invitation row.
  "POST /api/workspace/{workspaceId}/invitations": {
    capability: "member:invite",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
  },

  // S7 — list a workspace's roles (issue #6, retrofit plan §3, S7 row). Runtime check is
  // `requireWorkspacePermission({ac:["read"]})` against the INHERITED `ac` resource -- same
  // transitional gap as `workspace:update` above: re-keying to the canonical vocabulary is
  // #7's, not this stage's. `scopeSource: "request"`: `list-workspace-roles.ts` never loads
  // the `workspace` row itself, only queries `workspace_role` by the path's own `workspaceId`
  // -- same shape as the S5/S6a routes above. `workspace:read` is NOT in `AUTHORITY_GRANTING`,
  // so no `elevated` field is declared.
  "GET /api/workspace/{workspaceId}/roles": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
  },

  // S7 — create/update/delete a workspace role (issue #6, retrofit plan §3, S7 row; the last
  // item on the organization()-retrofit critical path). Runtime checks are
  // `requireWorkspacePermission({ac:[...]})` against the INHERITED `ac` resource (translated
  // to `workspace:manage_roles` for a custom role, `permissions/legacy-statements.ts`), plus
  // -- for create/update -- `RL-3`'s "cannot grant a capability you do not hold" ceiling,
  // `RL-4`/`RL-14`'s rank guards and `RL-7`'s last-manager guard (`role-service.ts`). Role
  // capabilities live in the canonical `role` row (owner decision, 23 Oct).
  //
  // `elevated: true` is REQUIRED, not optional, on all three: `workspace:manage_roles` is
  // already in `AUTHORITY_GRANTING` (`elevated.ts`) -- "a role editor can mint authority up to
  // the editor's own rank" -- and `elevationViolations()` checks `entry.policy.elevated ===
  // true` by strict equality, so omitting the field does NOT satisfy it and fails
  // `tests/permissions/elevated-actions.test.ts`.
  "POST /api/workspace/{workspaceId}/roles": {
    capability: "workspace:manage_roles",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: true,
  },
  "PATCH /api/workspace/{workspaceId}/roles/{roleId}": {
    capability: "workspace:manage_roles",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: true,
  },
  "DELETE /api/workspace/{workspaceId}/roles/{roleId}": {
    capability: "workspace:manage_roles",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: true,
  },

  // RL read surface (P4): one role, its holders, its audit history and the draft-set preview.
  // All four read the path's own `workspaceId` and never load a `workspace` row for authority,
  // the same shape as the role list above. `POST .../preview` is a POST only because the draft
  // capability set travels in the body: it reads nothing about any person and persists nothing.
  "GET /api/workspace/{workspaceId}/roles/{roleId}": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
  },
  "GET /api/workspace/{workspaceId}/roles/{roleId}/holders": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
  },
  "GET /api/workspace/{workspaceId}/roles/{roleId}/history": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
  },
  "POST /api/workspace/{workspaceId}/roles/{roleId}/preview": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
  },

  // RL-8 bulk reassignment: moves people between the workspace's own existing roles, bounded by
  // the caller's rank (neither side may be at or above it) and never touching `owner`. Same
  // authority and the same written exemption as the single-member role change above.
  "POST /api/workspace/{workspaceId}/roles/{roleId}/reassign": {
    capability: "workspace:manage_members",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: false,
    elevationExemptionReason:
      "moves people between this workspace's own existing roles, never to or from a role at or above the caller's rank and never owner; grants no sees_all beyond what the target role's own owner/admin reach rule already derives, and permissions.md's elevated table carries no row for bulk reassignment (RL-8)",
  },
  "GET /api/workspace/{workspaceId}/project-settings": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
  "PATCH /api/workspace/{workspaceId}/project-settings": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
  "GET /api/workspace/{workspaceId}/state-templates": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
  "POST /api/workspace/{workspaceId}/state-templates": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
  "PATCH /api/workspace/{workspaceId}/state-templates/{stateTemplateId}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
