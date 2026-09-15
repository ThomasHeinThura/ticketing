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
 * Like `POST /api/workspace/{workspaceId}/members` and the role-update route above,
 * `workspace:transfer_ownership` sits in `AUTHORITY_GRANTING`'s SHADOW but not the set
 * itself: it obviously mints authority (it hands over the single most powerful role in the
 * workspace), but rbac.md's single elevated-action table does not carry a row for ownership
 * transfer, and `AUTHORITY_GRANTING` (`elevated.ts`) is exactly the capabilities that table's
 * rows are reachable through — adding it there without a corresponding table row would be
 * this lane deciding, unilaterally, a question rbac.md leaves open. `elevated: false` is kept
 * below for the same reason it was kept before: no step-up mechanism
 * (`POST /api/me/step-up`) exists anywhere in this codebase to enforce `elevated: true`
 * honestly against, and whether ownership transfer SHOULD require step-up once one exists is
 * recorded as a judgement call for Thomas, not decided here.
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
  // pair. Declared `capability` with `workspace:transfer_ownership` (rbac.md § Capabilities,
  // granted to `owner` alone) — the runtime check, `requireWorkspaceCapability` in this
  // route's own middleware, now evaluates that exact capability. See the file comment for
  // the defect this closes (the declaration used to say `workspace:manage_members` while the
  // runtime enforced a hardcoded `role === "owner"` check with no capability check at all)
  // and for why the in-transaction re-read stays, as a race-safety check alongside this gate
  // rather than the only one.
  //
  // `workspace:transfer_ownership` is NOT in `AUTHORITY_GRANTING` (`elevated.ts`) — that set
  // is exactly the capabilities rbac.md's single elevated-action table has a row for, and
  // that table has no row for ownership transfer. Adding it to `AUTHORITY_GRANTING`
  // unilaterally, without rbac.md settling the question, would be inventing a step-up policy
  // this lane was told not to invent. Recorded here as a JUDGEMENT CALL rather than an
  // obvious exemption: this route hands over the single most powerful role in the workspace,
  // and an argument that it SHOULD be `elevated: true` the moment `POST /api/me/step-up`
  // exists is reasonable — that decision is Thomas's, not this lane's to make by picking
  // `false` here.
  "POST /api/workspace/{workspaceId}/transfer-ownership": {
    capability: "workspace:transfer_ownership",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    sessionOnly: true,
    elevated: false,
    elevationExemptionReason:
      "hands over the owner role atomically; workspace:transfer_ownership is not in AUTHORITY_GRANTING because rbac.md's elevated-action table carries no row for ownership transfer, and no step-up mechanism exists in this codebase yet to enforce elevated: true honestly -- flagged as a judgement call for a human decision once that mechanism lands, given this is the single most powerful role transfer a workspace has",
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
} as const satisfies PolicyMap;
