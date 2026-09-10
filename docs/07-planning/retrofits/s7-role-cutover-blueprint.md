# S7 — native role cutover: implementation blueprint

**Status: BLUEPRINT. Not implemented, and not a decision record.** S7 is the final
application caller-removal stage of the `organization()` retrofit
([`organization-plugin-retrofit.md`](organization-plugin-retrofit.md)). This document is the
architecture pass that precedes it, written so the implementation does not re-derive the same
decisions. Where it makes a design choice rather than reporting one, it says so.

**Why it is committed before the work starts.** The pass was run against `main@050a4fd` and
it found two things worth having in the repository whether or not S7 starts today — one of
which became issue #118. Leaving it in a session scratchpad would have thrown that away.

## Reconciliation — read this before acting on § 8

Two of the blueprint's own findings have moved since it was written. The body below is kept
as authored; these corrections govern.

- **F1 (`workspace_role` has no `UNIQUE (workspace_id, role)`) — CONFIRMED, and now tracked.**
  Verified against real PostgreSQL 18: the only unique constraint is `workspace_role_pkey`,
  on `id`. Two rows for one `(workspace_id, role)` pair with different `permission` payloads
  insert cleanly. Reachable without a race, because better-auth's `createOrgRole` has no
  duplicate-name check at all. Filed as **#118**. The **evaluator half** — both reads refuse
  on ambiguity instead of taking an arbitrary row — is implemented in PR #119. The
  **`UNIQUE` constraint half** is still outstanding and waits on #110 for its migration
  number. S7 must not add native write paths to that table until both halves are in.

- **F2 ("you cannot grant a capability you do not hold") — REAL AS A REQUIREMENT, WRONGLY
  RATED AS A CURRENT VULNERABILITY.** An independent verification refuted the exploit chain,
  and it was right: the controller F2 names does not exist yet, and the only live
  role-creation path today is the plugin's own `create-role`, which **already** runs
  `checkIfMemberHasPermission`. So there is no current escalation. What survives is that S7
  **must** port that ceiling check into its create *and* update controllers — and that is not
  a review finding at all, it is a pre-existing acceptance criterion: **`RL-3` in
  [`roles-and-permissions-ui.md`](../../03-features/roles-and-permissions-ui.md)** already
  says "you cannot grant a capability you do not hold yourself... the API rejects them
  independently." Cite `RL-3`, not a finding. The one confirmed half is that S5's
  `update-workspace-member-role.ts` has no authority-ceiling check of its own — harmless
  alone, but it is the second link if S7 ever ships without the ceiling check.

## A third prerequisite, found by CI rather than by reading

**S7 cannot start until `roles-and-permissions-ui.md`'s open review findings are closed.**
`pnpm check:reviews` enforces it, and it fired on the very pull request that committed this
document:

```
docs/07-planning/reviews/2026-09-05/features-governance-design.md — 1. `roles-and-permissions-ui.md`
    `roles-and-permissions-ui.md` still has open review findings (24 lines). Close them in
    the owning document first — a feature is not started while its review section is
    non-empty (AGENTS.md do-not 15).
```

This is CLAUDE.md's spec interaction rule made mechanical: *"Open findings in
`docs/07-planning/reviews/2026-09-05/` → close them before implementing — the Definition of
Done enforces it, and reviewers check it, not the author."* `roles-and-permissions-ui.md` is
the spec that owns `RL-3`, the ceiling check § 8's F2 is really about, so S7 depends on that
document twice over: for the requirement, and for its review section being empty.

The blueprint's § 4 build order does not mention this. Treat it as step 0. It is not
satisfied today, and it is a documentation task rather than an implementation one — 24 lines
of findings in the owning spec, closed by editing that spec, which is its own reviewable
change.

**Why this document's own pull request is allowed to cite the spec anyway.** A spec counts as
"named in this change" when the branch edits `docs/03-features/<spec>.md` **or** when the pull
request body's `**Spec:**` field points at one (`scripts/ci/check-reviews.mjs:13-14`). This
branch edits no feature spec, and it implements nothing, so its `**Spec:**` field is
correctly `n/a`; the `RL-3` reference lives in the prose, where it informs rather than
declares. That is the accurate answer to the question the gate asks, not an evasion of it —
the gate asks which spec a change *implements*.

## Open questions in § 7 — current status

- **Q1 (`roleId` vs role name in the path)** — **decided, and reversible.** Key on the opaque
  `roleId`. A role name may legitimately contain `/` (better-auth's `normalizeRoleName` only
  lower-cases), so `"ops/infra"` — creatable through the mounted plugin today — would be
  unaddressable as a path segment. Reverse by URL-encoding the name instead. Recorded here
  rather than in the decision log because it is an implementation choice inside an agreed
  stage, not an architecture change.
- **Q2 (does the delete-guard comma-split?)** — **still open, and still Thomas's.** Do not
  resolve it silently in either direction. #82 says "no comma-splitting" without an explicit
  carve-out for a delete-safety guard, and a delete guard is arguably answering "is this row
  still referenced" rather than "what may this member do". Blocking on ambiguity is the safe
  direction for a delete specifically.
- **Q3 (events / audit rows)** and **Q4 (pagination)** — unresolved, low stakes, and the
  blueprint states the precedent for each. Confirm against
  [`events.md`](../../01-architecture/events.md) before assuming silence is intended.

## Provenance

Authored by a Sonnet architecture pass over `main@050a4fd`, reading the S5 (`2b569a8`), S6a
(`6bfc0f4`) and S8a (`86c23b2`) implementations as the house template. Its ground-truth
section was independently confirmed: **4** executable `authClient.organization.*` callers
remain — `listRoles`, `createRole`, `updateRole`, `deleteRole` — against 53 raw grep hits
across 45 files, 49 of which are comment lines.

---


Status: COMPLETE. Built from S5 (2b569a8), S6a (6bfc0f4), S8a (86c23b2), the current apps/api/src/workspace/{index,policy,schema,response}.ts on main@050a4fd2, PR #110's head (ee3953c, fetched not checked out), better-auth 1.6.25's actual installed organization/routes/crud-access-control.mjs, and the four web hooks read in full plus their one call site (roles.tsx).


## 0. Ground truth confirmed by reading, not memory

- `apps/api/src/database/schema.ts:239-262` — `workspace_role` table: `id, workspaceId, role (text, the name), permission (text, JSON-serialized {resource: action[]}), createdAt, updatedAt`. Two plain (non-unique) indexes only — `workspace_role_workspaceId_idx`, `workspace_role_role_idx`. **No unique constraint on `(workspaceId, role)`.** Confirmed against the actual migration `apps/api/drizzle/0030_smart_umar.sql` (CREATE TABLE + two `CREATE INDEX`, no `UNIQUE`).
- `apps/api/src/auth.ts:264-320` — the still-mounted `organization()` plugin is configured with `ac` = TaskDesk's own narrow access-control (`@taskdesk/permissions`), `roles: { owner }` (ONLY owner is a compiled/static role), `dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 25 }`, and `schema.organizationRole.modelName = "workspace_role"` with `fields.organizationId = "workspaceId"`. `viewer`/`member`/`admin` are DB-backed dynamic roles seeded per workspace (`seedDefaultWorkspaceRoles` / `afterCreateOrganization`), never static.
- `packages/permissions/src/legacy-better-auth-access-control.ts` — the CURRENT (not future) capability model. `statement = {...defaultStatements, project, task, label, workspace}`. `defaultStatements.ac = ["create","read","update","delete"]` (better-auth's own meta-permission resource for role management). `viewer`/`member` inherit `ac: ["read"]` from `memberAc.statements` (never overridden); `admin`/`owner` inherit `ac: ["create","read","update","delete"]` from `adminAc`/`ownerAc.statements`. **So today, viewer and member can list/read roles; only admin and owner can create/update/delete them.** `DEFAULT_ROLE_NAMES = ["viewer","member","admin"]`; `"owner"` is never a `workspace_role` row.
- better-auth 1.6.25's real implementation, read at `node_modules/.pnpm/better-auth@1.6.25.../dist/plugins/organization/routes/crud-access-control.mjs` (installed copy in the actual project, not this worktree — read-only, not edited):
  - `listRoles`: requires membership + `ac:read`; returns every `workspace_role` row for the org with `permission` JSON-parsed back into an object. No pagination.
  - `createRole`: requires membership + `ac:create`; refuses a name already taken by `options.roles` (i.e. `"owner"` only, since `roles: {owner}`); enforces `maximumRolesPerOrganization` (**25** in this repo's config, not the library default of Infinity); `checkForInvalidResources` — every key in the submitted `permission` object must be a key of `ac.statements` (i.e. one of `organization, member, invitation, team, ac, project, task, label, workspace`) or 400 `INVALID_RESOURCE`; **`checkIfMemberHasPermission` — for every `(resource, action)` pair being granted, the CALLER must already hold that exact permission themselves, checked via the same `hasPermission` used for authorization, else 403 with a `missingPermissions` list** — this is the "cannot grant a capability you do not hold" guardrail rbac.md's future model also states in prose; refuses a duplicate name already in `workspace_role`.
  - `updateRole`: same membership + `ac:update` gate; identifies the row by `roleName` OR `roleId`; **replaces `permission` wholesale (no merge)** when `permission` is present in the body, running the identical `checkForInvalidResources` + `checkIfMemberHasPermission` pair against the NEW permission set first; can also rename the role (`data.roleName`), which the product's client hooks never use.
  - `deleteRole`: same membership + `ac:delete` gate; identifies by `roleName` or `roleId`; refuses deleting a name in `options.roles` (`"owner"` only); **refuses deleting a role that any `workspace_member.role` value currently references, matching by `member.role.split(",").map(trim).includes(roleToDelete)`** — a comma-aware, inclusive substring-piece match, not an exact-value match.
- `apps/web/src/hooks/{queries,mutations}/workspace/use-{workspace-roles,create-workspace-role,update-workspace-role,delete-workspace-role}.ts` read in full: `listRoles({query:{organizationId}})` → array mapped to `{id, workspaceId, role, permission, createdAt, updatedAt}`; `createRole({organizationId, role, permission})`; `updateRole({organizationId, roleName, data:{permission}})`; `deleteRole({organizationId, roleName})`. No hook ever sends `roleId` or renames a role. `useUpdateWorkspaceRole` also invalidates a `["workspace-capabilities", workspaceId]` query key on success — a second cache key that must be invalidated by the repointed hook too.
- The house pattern, confirmed from S5 (`2b569a8`), S6a (`6bfc0f4`), S8a (`86c23b2`) and the current `apps/api/src/workspace/{index,policy,schema,response}.ts` (main@050a4fd): one `createRoute` const per route in `workspace/index.ts`, `middleware: [requireSessionOnly(), workspaceAccess.fromParam("workspaceId"), requireWorkspaceMembership, requireWorkspacePermission({...inherited resource}), requireWorkspaceRoleAuthority({...same inherited resource})] as const` for every capability-gated mutation; one controller file per action under `workspace/controllers/`, throwing typed `Error` subclasses caught by `instanceof` in the route's `.openapi()` handler and mapped to HTTP status; shared error classes in one `*-errors.ts` file per family; a workspace-scoped `pg_advisory_xact_lock` taken as the FIRST statement of any transaction that does a check-then-write with no DB uniqueness backing it (`WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE = 4_002`, distinct from `1524` and `2026` used elsewhere); route policy declared in `workspace/policy.ts` using the TARGET `@taskdesk/permissions` `Capability` vocabulary even where it does not match the inherited runtime check, with the mismatch always documented in a comment (never silently invented); request/response Zod schemas in `schema.ts`/`response.ts`.
- PR #110 head (`ee3953c`, fetched via `git fetch origin refs/pull/110/head`, read via `git show pr110:<path>`, never checked out): adds `packages/permissions/src/membership-role-value.ts` (`membershipRoleProblem`, `isSingleMembershipRole`, `legacyMembershipRoleSegments`, `repairableMembershipRole`) and, in `apps/api/src/utils/workspace-member-roles.ts`, the new exported `resolveMembershipRoleFrom(roles: string[]): MembershipRoleResolution` (`{ok:true,role} | {ok:false,reason:"no-membership"|"ambiguous-rows"|"malformed-role"}`). It does **not** touch `require-workspace-permission.ts` or `require-workspace-role-authority.ts` — those two still call `isUnambiguousMembership`/`workspaceMemberRoles` directly on `main`, unchanged. PR #110's actual diff is scoped to `organization-plugin-role-guard.ts` (a guard on the STILL-MOUNTED PLUGIN's remaining routes, not the native ones).

## 1. File list

### CREATE (api)

| File | Purpose |
| --- | --- |
| `apps/api/src/workspace/controllers/workspace-role-errors.ts` | Shared typed errors for the four new controllers: `RoleNameReservedError` (name is `"owner"`), `RoleNameTakenError`, `InvalidPermissionResourceError`, `InsufficientPermissionToGrantError` (carries `missingPermissions: string[]`), `RoleLimitReachedError`, `RoleAssignedToMembersError`. Reuses the EXISTING `WorkspaceRoleNotFoundError` from `workspace-membership-errors.ts` rather than redefining it (see §2, DELETE/UPDATE 404). |
| `apps/api/src/workspace/controllers/workspace-role-lock.ts` | `export const WORKSPACE_ROLE_LOCK_NAMESPACE = 4_003;` — the fourth advisory-lock namespace in this codebase (`1524`, `2026`, `4_002` already taken), scoped to `workspace_role` check-then-write races. Modeled byte-for-byte on `workspace-membership-lock.ts`'s doc comment. |
| `apps/api/src/workspace/controllers/list-workspace-roles.ts` | Reads every `workspace_role` row for a workspace. |
| `apps/api/src/workspace/controllers/create-workspace-role.ts` | Validates resources, validates the caller already holds every permission being granted, enforces the 25-role ceiling, enforces name-uniqueness, inserts — all under the new advisory lock. |
| `apps/api/src/workspace/controllers/update-workspace-role.ts` | Replaces (never merges) one role's `permission` JSON wholesale, under the same validations and lock. Does not support renaming (the product's own hooks never rename; see Ambiguity Q1). |
| `apps/api/src/workspace/controllers/delete-workspace-role.ts` | Refuses `"owner"`, refuses a role currently referenced by any `workspace_member.role` value (comma-aware match, mirroring better-auth exactly), deletes under the lock. |
| `tests/api-integration/helpers/workspace-role-write-http.ts` | Thin HTTP wrappers for the four routes, mirroring `helpers/workspace-invitation-write-http.ts`. |
| `tests/api-integration/workspace-role-writes.test.ts` | The integration suite — see §5. |

### MODIFY (api)

| File | Change |
| --- | --- |
| `apps/api/src/workspace/schema.ts` | Add `workspaceRoleParam = z.object({ workspaceId: z.string(), roleId: z.string() })`, `createWorkspaceRoleBody = z.object({ role: z.string().min(1).max(100), permission: z.record(z.string(), z.array(z.string())) })`, `updateWorkspaceRoleBody = z.object({ permission: z.record(z.string(), z.array(z.string())) })`. |
| `apps/api/src/workspace/response.ts` | Add `workspaceRoleSchema = z.object({ id, workspaceId, role, permission: z.record(z.string(), z.array(z.string())), createdAt: responseTimestamp, updatedAt: responseTimestamp }).openapi("WorkspaceRole")`, `workspaceRoleListSchema = z.array(workspaceRoleSchema)`, `deletedWorkspaceRoleSchema = z.object({ id: z.string(), role: z.string() })`. |
| `apps/api/src/workspace/index.ts` | Register the four routes + handlers, following the exact `createRoute`/`.openapi()` pattern of the S5 block. |
| `apps/api/src/workspace/policy.ts` | Add four `workspacePolicies` entries — see §2 for the exact declarations. |
| `apps/api/src/utils/require-workspace-permission.ts` | **No code change required.** `hasWorkspacePermission`/`customRoleStatements` already read the `workspace_role.permission` JSON generically by resource key; `{ac:[...]}` is just another resource, already present in every seeded role's payload (`defaultRolePayloads` mirrors `.statements`, which includes `ac`). Confirmed by reading `legacy-better-auth-access-control.ts`'s `defaultRolePayloads` construction. |
| `apps/api/src/utils/require-workspace-role-authority.ts` | Same — no code change required, `{ac:[...]}` flows through `ownRoleStatements` unchanged. |
| `tests/api-contract/openapi.json` | Regenerate (adds the four operations). |
| `tests/permissions/matrix.fixture.json` | Regenerate (adds four routes' allow/deny rows against the full built-in-role table). |
| `docs/01-architecture/rbac.md` | See §6 — no NEW capability identifier is needed (`workspace:manage_roles` already exists and is already in `AUTHORITY_GRANTING`), but the "Roles are editable rows" section should gain one sentence noting that P0's role CRUD operates on the legacy `workspace_role` shape (name + permission JSON), not yet the target `role` table with `rank`/`capabilities jsonb` — matching the same transitional note S4's policy.ts already carries for `organization:update` vs `workspace:update`. |

### CREATE (web)

| File | Purpose |
| --- | --- |
| `apps/web/src/fetchers/workspace/list-workspace-roles.ts` | GET wrapper. |
| `apps/web/src/fetchers/workspace/create-workspace-role.ts` | POST wrapper. |
| `apps/web/src/fetchers/workspace/update-workspace-role.ts` | PATCH wrapper. |
| `apps/web/src/fetchers/workspace/delete-workspace-role.ts` | DELETE wrapper. |

### MODIFY (web)

| File | Change |
| --- | --- |
| `apps/web/src/hooks/queries/workspace/use-workspace-roles.ts` | Repoint from `authClient.organization.listRoles` to the new fetcher; drop `parsePermission`'s string-fallback branch (the native route always returns a parsed object, never a JSON string) but keep the object-passthrough branch defensively; map `r.id` unchanged. |
| `apps/web/src/hooks/mutations/workspace/use-create-workspace-role.ts` | Repoint to the new fetcher; same request shape (`{workspaceId, role, permission}`), same cache invalidation (`["workspace-roles", workspaceId]`). |
| `apps/web/src/hooks/mutations/workspace/use-update-workspace-role.ts` | Repoint to the new fetcher. **Request shape must change from `{roleName}` to `{roleId}`** (see Ambiguity Q1) — every call site passing `roleName` must be updated to pass the role's `id` instead. Keep both cache invalidations (`workspace-roles`, `workspace-capabilities`). |
| `apps/web/src/hooks/mutations/workspace/use-delete-workspace-role.ts` | Same `roleId` change as update. |
| Every call site of `useUpdateWorkspaceRole`/`useDeleteWorkspaceRole` (grep `useUpdateWorkspaceRole\|useDeleteWorkspaceRole` under `apps/web/src`) | Pass `roleId` (from the row already in hand from `useWorkspaceRoles`) instead of `roleName`. |

## 2. Per-route specification

All four mounted on the existing `workspace` router (`apps/api/src/workspace/index.ts`), under `/{workspaceId}/roles`. All four: `middleware: [requireSessionOnly(), workspaceAccess.fromParam("workspaceId"), requireWorkspaceMembership, requireWorkspacePermission({ac:[...]}), requireWorkspaceRoleAuthority({ac:[...]})] as const` — the identical S4/S5/S6a shape, with `ac` as the inherited resource key (see §0: this is the EXACT resource better-auth's own `hasPermission({permissions:{ac:[...]}})` checks, already present in every seeded role's `permission` JSON via `defaultRolePayloads`, so zero changes are needed to `require-workspace-permission.ts`/`require-workspace-role-authority.ts`).

### GET /api/workspace/{workspaceId}/roles — listWorkspaceRoles
- Request: `params: workspaceIdParam` (reuse existing).
- Runtime authorization: `requireWorkspacePermission({ ac: ["read"] })`. No `requireWorkspaceRoleAuthority` needed — `ac:read` is held by every legacy role including `viewer`, and `owner`'s compiled statements include it, so there is no instance-admin-bypass gap to close the way S4's mutations had (the bypass only matters when the compiled fallback would grant something a DB-backed role's row does not — here every DB-backed default role already grants `ac:read`, and preserving that is exactly the point; adding the authority check costs nothing but is also not defending against anything reachable today. Recommend adding it anyway, for symmetry with every other mutation route and because an admin CAN edit a custom role to remove `ac:read`, at which point the two checks would legitimately diverge from the instance-admin case).
- Response 200: `workspaceRoleListSchema` (array of `{id, workspaceId, role, permission, createdAt, updatedAt}`), sorted by nothing in particular (matches better-auth: no `ORDER BY` in `listOrgRoles`) — **note this for the client: do not assume stable ordering** (the existing web UI does not sort either, confirmed by scanning `roles.tsx` render — worth flagging to the implementer as a UX nit, not a blocker).
- Errors: 400 (workspace id undeterminable), 401 (no credential), 403 (no workspace access / API key / impersonation / missing `ac:read`).
- Policy (`workspace/policy.ts`): `{ capability: "workspace:read", scope: "workspace", scopeSource: "request", reach: "required", sessionOnly: true }`. No `elevated` field (omitted — `workspace:read` is not in `AUTHORITY_GRANTING`, so the elevation-coverage test does not apply here). Document the declared-vs-runtime gap exactly the way S4's `organization:update`/`workspace:update` comment does: the runtime check is `ac:read`, the declared TARGET capability is `workspace:read` (the closest existing match; there is no distinct "view roles" capability in rbac.md, and `workspace:manage_roles` would make the generated matrix fixture say viewer/member are denied when they are not, today).
- Events: none (read).

### POST /api/workspace/{workspaceId}/roles — createWorkspaceRole
- Request: `params: workspaceIdParam`, `body: createWorkspaceRoleBody = { role: string (1..100), permission: Record<string, string[]> }`.
- Runtime authorization: `requireWorkspacePermission({ ac: ["create"] })` + `requireWorkspaceRoleAuthority({ ac: ["create"] })` (closes the instance-admin bypass, same reasoning as every S4/S5/S6a mutation).
- Controller logic, in order, inside `db.transaction`, first statement `SELECT pg_advisory_xact_lock(WORKSPACE_ROLE_LOCK_NAMESPACE, hashtext(workspaceId))`:
  1. `role.trim().toLowerCase() === "owner"` → `RoleNameReservedError` (mirrors `checkIfRoleNameIsTakenByPreDefinedRole`; better-auth lower-cases the name on create — preserve that normalization).
  2. Every key of `permission` must be one of `Object.keys(statement)` from `@taskdesk/permissions`'s `legacy-better-auth-access-control.ts` (`organization, member, invitation, team, ac, project, task, label, workspace`) → else `InvalidPermissionResourceError` (mirrors `checkForInvalidResources`).
  3. **For every `(resource, action)` pair in `permission`, the caller must already hold it** — call the exported `hasWorkspacePermission(c, {[resource]:[action]})` from `require-workspace-permission.ts` for each pair (or a batched variant); collect every failing pair; if any, throw `InsufficientPermissionToGrantError(missingPermissions)` (mirrors `checkIfMemberHasPermission` — **required, see Finding F2**).
  4. Count existing `workspace_role` rows for the workspace (inside the transaction, after the lock); if `>= 25` → `RoleLimitReachedError` (mirrors `maximumRolesPerOrganization`; the `25` should be a named exported constant, not a second inline literal — see Finding F3 for where it should live).
  5. Re-check name uniqueness INSIDE the lock (`workspace_role.role = role.trim().toLowerCase()`, workspace-scoped) → `RoleNameTakenError` if found.
  6. Insert `{id: createId(), workspaceId, role: normalized, permission: JSON.stringify(permission), createdAt: now, updatedAt: now}`.
- Response 200: `workspaceRoleSchema` (the created row, `permission` returned as the parsed object, matching better-auth's own `roleData` shape and matching `WorkspaceRole`'s client type already in `use-workspace-roles.ts`).
- Errors: 400 (invalid body / reserved name / invalid resource / role limit reached), 401, 403 (no access / missing `ac:create` / **missing a permission being granted**), 404 (n/a), 409 (name already taken).
- Policy: `{ capability: "workspace:manage_roles", scope: "workspace", scopeSource: "request", reach: "required", sessionOnly: true, elevated: true }` — **`elevated: true` is REQUIRED, not optional**: `workspace:manage_roles` is in `packages/permissions/src/elevated.ts`'s `AUTHORITY_GRANTING` set, and `elevationViolations()` checks `entry.policy.elevated === true` by strict equality — omitting the field does NOT satisfy it (confirmed by reading `elevated.ts:101-113`). Skipping this fails `tests/permissions/elevated-actions.test.ts` in CI.
- Events: emit whatever this codebase's convention is for a workspace-role mutation — **no existing event key for `workspace_role` create/update/delete was found by reading `docs/01-architecture/events.md`'s workspace section** (see Ambiguity Q3 / Finding F4 — this is a new identifier that needs its authoritative home decided in `docs/01-architecture/events.md` in the SAME change, per do-not 11). If S7 follows S5/S6a's own precedent (grep of `publishEvent` calls in `add-workspace-member.ts`/`invite-workspace-member.ts` — **not yet confirmed which of the existing controllers call `publishEvent` at all**; this needs a targeted check before implementation, see Ambiguity Q3).

### PATCH /api/workspace/{workspaceId}/roles/{roleId} — updateWorkspaceRole
- Request: `params: workspaceRoleParam = {workspaceId, roleId}`, `body: updateWorkspaceRoleBody = { permission: Record<string,string[]> }`.
- Path identifies the role by its opaque `id`, NOT by `role` (the name) — see Ambiguity Q1 for why, and the required client-hook signature change.
- Runtime authorization: `requireWorkspacePermission({ ac: ["update"] })` + `requireWorkspaceRoleAuthority({ ac: ["update"] })`.
- Controller logic, same lock, same order as create for steps 2–3 (`checkForInvalidResources`, `checkIfMemberHasPermission` against the NEW permission set), then:
  1. Look up the row by `(workspaceId, id)`; 404 (reuse `WorkspaceRoleNotFoundError`, which already exists and already carries the right semantics — do not define a second "role not found" error class) if absent.
  2. `row.role === "owner"` is unreachable (owner is never a DB row) but check `role === "owner"` defensively anyway for symmetry with delete, in case a future bug ever inserts one.
  3. **Full replace, not merge**, matching better-auth's `updateData.permission = newPermission` exactly (see Finding F5: the existing web UI already computes a full new permission SET client-side via its checkbox matrix and sends the complete object, so this constraint already matches how the UI works — but the SERVER contract must say so explicitly, since "PATCH" in REST is often read as partial-merge and a future caller could reasonably assume merge semantics).
  4. Update `permission = JSON.stringify(newPermission)`, `updatedAt = now`.
- Response 200: `workspaceRoleSchema` (updated row).
- Errors: 400 (invalid body / invalid resource), 401, 403 (no access / missing `ac:update` / missing a permission being granted), 404 (role not found).
- Policy: same shape as create, `elevated: true` required for the same reason.
- Events: same open question as create (Ambiguity Q3). Also invalidate the "capability" implication: the web hook already invalidates `["workspace-capabilities", workspaceId]` on success — if that query key is now backed by a native `GET /api/capabilities`-style endpoint (mentioned in `workspace-member-roles.ts`'s PR #110 doc comment as `GET /api/capabilities`), confirm that endpoint reads live `workspace_role` rows (not a cached/derived snapshot) so the invalidation is not vacuous.

### DELETE /api/workspace/{workspaceId}/roles/{roleId} — deleteWorkspaceRole
- Request: `params: workspaceRoleParam`.
- Runtime authorization: `requireWorkspacePermission({ ac: ["delete"] })` + `requireWorkspaceRoleAuthority({ ac: ["delete"] })`.
- Controller logic, same lock:
  1. Look up the row by `(workspaceId, id)`; 404 `WorkspaceRoleNotFoundError` if absent.
  2. `role === "owner"` defensively (unreachable) → `RoleNameReservedError`.
  3. **Assignment guard**: is `role.role` currently referenced by any `workspace_member` row in this workspace? Recommended implementation, preserving better-auth's own semantics exactly (see §0's better-auth read): for every `workspace_member` row in the workspace, comma-split `.role` on `,`, trim each piece, and check membership of the target role name — i.e. the same shape as `roleGrantsOwner` but parameterized on an arbitrary role name rather than hardcoded to `"owner"`. **This is a DELIBERATE exception to the #82 "never comma-split for evaluation" rule** — see Ambiguity Q2, this needs Thomas's sign-off since it is genuinely a place where the codebase's own stated invariant and byte-identical-behavior-preservation pull in different directions.
  4. If referenced → `RoleAssignedToMembersError`.
  5. Delete the row.
- Response 200: `deletedWorkspaceRoleSchema = {id, role}`.
- Errors: 400 (role currently assigned to members / reserved name), 401, 403 (no access / missing `ac:delete`), 404 (role not found).
- Policy: same shape as create/update, `elevated: true` required.
- Events: same open question (Ambiguity Q3).

Note on `elevated: true` vs the `workspace:transfer_ownership` precedent (S5): transfer-ownership stays `elevated: false` with a written reason because `workspace:transfer_ownership` is **not** a member of `AUTHORITY_GRANTING` at all — declaring it either way was Thomas's open judgment call, not a rule. `workspace:manage_roles` **is already** in `AUTHORITY_GRANTING` (`packages/permissions/src/elevated.ts:37-45`, with its own inclusion reason spelled out: "a role editor can mint authority up to the editor's own rank") — that decision is already made and is not S7's to revisit. The absence of a real step-up mechanism (`POST /api/me/step-up` does not exist yet) is the same declarative-ahead-of-enforcement situation every capability/scope/reach field in this file is already in (per #8's "not wired into the live request path yet" caveat) — it is not a reason to under-declare here specifically.

## 3. Per-hook repointing (client)

| Hook | Old call | New call | Shape change |
| --- | --- | --- | --- |
| `use-workspace-roles.ts` | `authClient.organization.listRoles({query:{organizationId}})` | `GET /api/workspace/{workspaceId}/roles` via new fetcher | None — response is already `{id, organizationId→workspaceId, role, permission, createdAt, updatedAt}[]`; `parsePermission`'s string-JSON fallback branch can be dropped (native route parses server-side) but is harmless to keep |
| `use-create-workspace-role.ts` | `authClient.organization.createRole({organizationId, role, permission})` | `POST /api/workspace/{workspaceId}/roles` body `{role, permission}` | None to the hook's own signature; response shape changes from better-auth's `{success, roleData, statements}` wrapper to the plain `workspaceRoleSchema` row — the hook currently just returns `data` unused beyond cache invalidation, so this is safe, but grep any other caller of `useCreateWorkspaceRole().mutateAsync` for a `.roleData` access before assuming it is safe (none found in `roles.tsx`'s create form as read) |
| `use-update-workspace-role.ts` | `authClient.organization.updateRole({organizationId, roleName, data:{permission}})` | `PATCH /api/workspace/{workspaceId}/roles/{roleId}` body `{permission}` | **Signature change**: `roleName: string` → `roleId: string`. One call site to update: `apps/web/src/routes/_layout/_authenticated/dashboard/settings/workspace/roles.tsx` line ~703, which already holds the full `role` row (`role.id` is in scope) — change `roleName: role.role` to `roleId: role.id` |
| `use-delete-workspace-role.ts` | `authClient.organization.deleteRole({organizationId, roleName})` | `DELETE /api/workspace/{workspaceId}/roles/{roleId}` | Same signature change, same one call site, line ~812: `deleteRole({workspaceId, roleName: role.role})` → `deleteRole({workspaceId, roleId: role.id})` |

Both cache-invalidation behaviors (`["workspace-roles", workspaceId]` on all three mutations, plus `["workspace-capabilities", workspaceId]` on update) are preserved unchanged — no query-key renames needed.

## 4. Build order

1. **Contract-only, additive, ships dark** — same posture as S4/S5: add `apps/api/src/workspace/controllers/workspace-role-lock.ts`, `workspace-role-errors.ts`, the four controllers, the schema/response additions, the four routes in `index.ts`, the four `policy.ts` entries. Nothing yet calls these from the client. Regenerate `tests/api-contract/openapi.json` and `tests/permissions/matrix.fixture.json` in this same PR (both are generated artifacts, not hand-edited, per every prior stage's commit message). Run `pnpm test:permissions`, `pnpm check:openapi`, `pnpm test:integration` — all green — before touching any web file.
2. **Repoint the four web hooks and their one call site** in the same PR (small enough that splitting it into a second PR only adds a window where the plugin and native surface disagree for no reason — S8a repointed nine call sites in the same PR as its route, and S6a repointed twelve; this is four hooks and two call sites, smaller than either precedent).
3. **Delete now-dead code**: confirm (grep) whether any `use-*` file or fetcher becomes a zero-importer after the repoint (mirroring S6a's deletion of three dead invitation files) — likely none here, since all four hooks are kept (repointed in place, not replaced), but check for a now-unused `authClient.organization.listRoles`-adjacent type import in `auth-client.ts` or similar.
4. **Do not touch `apps/api/src/auth.ts`'s `organization()` config** — `roles: {owner}`, `dynamicAccessControl`, and the `organizationRole` schema mapping all stay exactly as they are; the plugin's own role routes stay mounted and reachable (by API key or direct call) until S10, same as every other S4–S8a family.
5. Update `docs/07-planning/status.md`/the retrofit ledger only as a durable transition once merged — matches CLAUDE.md's "status.md is a durable snapshot" rule; this is the orchestrator's call, not this blueprint's.

## 5. Integration tests required

New file `tests/api-integration/workspace-role-writes.test.ts` (real PostgreSQL, matching every existing suite; helper file `tests/api-integration/helpers/workspace-role-write-http.ts`, mirroring `workspace-invitation-write-http.ts`'s shape).

| Test | Behavior pinned | Non-vacuity note (the production line it depends on) |
| --- | --- | --- |
| List returns every seeded default role plus a custom one, `owner` never appears | `listWorkspaceRoles` reads all `workspace_role` rows | Depends on `list-workspace-roles.ts`'s `WHERE workspaceId = ?` actually running — proven non-vacuous by asserting a SECOND workspace's roles are NOT returned (cross-tenant leak would otherwise pass a same-workspace-only assertion trivially) |
| `viewer` and `member` can list roles (200); `admin`/`owner` can too | Preserves better-auth's `ac:read` grant to all four legacy roles | Depends on `requireWorkspacePermission({ac:["read"]})` actually resolving `customRoleStatements` from the DB row, not a compiled fallback — proven non-vacuous by first editing `viewer`'s own `permission` row to REMOVE `ac:read` via the new update route (or a raw SQL fixture write) and asserting list now 403s for a viewer-only caller; without this half the test only proves "default seed grants read", not "the route actually reads the row" |
| `viewer` and `member` get 403 on create/update/delete; `admin`/`owner` get through the gate | Preserves the `ac:create/update/delete` split | Same non-vacuity technique: assert 403 on a real HTTP call, not on a unit-level permission-check function in isolation |
| Create rejects `role: "owner"` (case-insensitive, e.g. `"Owner"`) | `checkIfRoleNameIsTakenByPreDefinedRole` parity | Assert the row count in `workspace_role` did NOT change (not just the HTTP status) — a handler that returns 400 after already inserting would pass a status-only assertion |
| Create rejects a duplicate name (case sensitivity matches better-auth's lower-casing) | `checkIfRoleNameIsTakenByRoleInDB` parity | Assert exactly one row exists for that name afterward |
| Create rejects an unknown resource key in `permission` (e.g. `{fooo:["bar"]}`) | `checkForInvalidResources` parity | Assert 400 AND zero row inserted |
| **Create rejects granting a permission the caller does not hold** — concrete case: log in as `admin`, POST `{role:"super", permission:{organization:["delete"]}}` | The `checkIfMemberHasPermission` equivalent (Finding F2) | THE decisive non-vacuity test for this whole feature: without the check, this call returns 200 and inserts the row; assert 403 AND zero row inserted. Then, as a second half, assign that admin the SAME custom role via `PATCH /members/{userId}/role` (already-shipped S5 route) and re-attempt `DELETE /api/workspace/{workspaceId}` (S4's own delete route, which the admin could not call before) — if this check is missing, this second half is the actual escalation proof, at 200 where 403 is required |
| Concurrent creates of the same name race-detect | The advisory-lock fix (Finding F1) | Fire two concurrent `createRole` calls with the identical name from two connections; assert exactly ONE row exists afterward and the loser gets 409/400, not a silent duplicate — without `WORKSPACE_ROLE_LOCK_NAMESPACE`, both can read "not taken" before either commits |
| Update replaces (not merges) `permission` | `updateData.permission = newPermission` parity | Create a role with `{organization:["update"], member:["create"]}`, update it with just `{organization:["update"]}`, then assert a member holding it can no longer do `member:create` (proves the OLD grant was actually dropped, not merely that the new field was accepted) |
| Update rejects an unknown resource key, same as create | `checkForInvalidResources` on the update path | Same evidence shape as create's version |
| Update rejects granting a permission the caller doesn't hold | Same as create's decisive test, on the update path | Same shape |
| Update on a nonexistent `roleId` → 404 | `WorkspaceRoleNotFoundError` reuse | — |
| Delete refuses a role currently held by a member (comma-aware) | The better-auth-parity assignment guard (Ambiguity Q2) | Set a member's `workspace_member.role` to the malformed value `"custom,admin"` directly via SQL (mirroring `multi-role-membership-characterization.test.ts`'s own fixture style), attempt to delete role `"custom"`, assert refusal — this is the case that distinguishes an exact-match guard (would wrongly ALLOW the delete) from the comma-aware guard this blueprint recommends |
| Delete succeeds once the last member holding it is removed/reassigned | Assignment guard is not permanently stuck | — |
| Delete rejects `"owner"` | Defensive parity check | — |
| Instance-admin who is a plain `viewer` member cannot create/update/delete a role via the bypass | `requireWorkspaceRoleAuthority({ac:[...]})` closes the same instance-admin bypass S4/S5/S6a already close | Mirrors S4/S5's own bypass test exactly; proven non-vacuous by first showing the SAME instance-admin succeeds when their workspace role actually is `admin` |
| API key / impersonation session get `session_required` 403 on all four routes | `requireSessionOnly()` | Matches every other workspace mutation's own session-only test |
| Non-member gets 403/404 per the existing reach convention | `workspaceAccess.fromParam` + `requireWorkspaceMembership` | — |
| OpenAPI baseline: `pnpm check:openapi` reports the correct new operation count | Contract consistency | Assert the exact delta (4 new operations), not just "no errors", matching S6a's own "423 operations" style evidence |
| Permission matrix: `pnpm test:permissions` green, diff is additive-only | Matrix fixture consistency | Diff the fixture's parsed JSON before/after and assert every PRE-EXISTING route's row is byte-identical (matches S5's own stated verification method) |

## 5b. Implementation note on the "cannot grant what you don't hold" check

`hasWorkspacePermission(c: Context, permissions)` (`require-workspace-permission.ts:91`) takes a Hono `Context`, but every S4/S5/S6a controller is a plain function over primitives (`workspaceId`, `userId`, ...) with no `Context` dependency — calling `hasWorkspacePermission` once per `(resource, action)` pair being granted would mean either threading `c` into the controller (breaking the established controller/handler separation) or N redundant DB round trips from the route handler. Recommend: extract the caller's-own-statements resolution already inside `hasWorkspacePermission` (the `isInstanceAdmin` → `workspaceMemberRoles` → `isUnambiguousMembership` → `role === "owner" ? builtInRoleStatements("owner") : customRoleStatements(...)` chain) into a new exported function, e.g. `resolveCallerWorkspaceStatements(c): Promise<Record<string, readonly string[]> | null>`, called ONCE per request in the route handler; pass the resolved `statements` object into `createWorkspaceRoleCtrl`/`updateWorkspaceRoleCtrl` as a plain argument, and have the controller run the missing-permission check as a pure in-memory loop (the same shape as the existing unexported `satisfies()` helper, exported or duplicated). This is a small, in-scope refactor of `require-workspace-permission.ts` — that file is not on CLAUDE.md's shared-contract-ownership list, and S4/S5/S6a/S8a already modified its siblings directly without a separate contract PR.

## 6. Identifier homes (do-not 11)

**No new identifier is required.** `workspace:manage_roles` and `workspace:read` both already exist in `packages/permissions/src/capabilities.ts` and `docs/01-architecture/rbac.md`'s Capabilities table; `workspace:manage_roles` is already in `AUTHORITY_GRANTING` (`elevated.ts`). The `workspace_role` table/columns already exist (migration `0030_smart_umar.sql`) and need no schema change. The one open item is whether S7's mutations emit an event — see Ambiguity Q3 below; if the answer is yes, the event key(s) are new identifiers and `docs/01-architecture/events.md` must gain them in the same PR, per do-not 11. If the answer is no (matching every S4–S8a precedent except `workspace.created`), nothing new is needed there either.

Two documentation-only additions worth making in the same PR (not new identifiers, just closing a description gap found while reading for this blueprint):
- `docs/01-architecture/data-model.md` §2 has no row for `workspace_role` at all (it documents only the FUTURE `role` table). Since S7 is the stage that gives this table its first dedicated route surface, add one line noting it as the legacy, pre-#7 shape, mirroring how `packages/permissions/src/legacy-better-auth-access-control.ts`'s own doc comment already frames it ("inherited, transitional, on its way out").
- `docs/01-architecture/rbac.md`'s "Roles are editable rows" section (currently describes only the future `role` table with `rank`/`is_system`/`capabilities jsonb`) should gain a sentence that P0's actual CRUD surface (this stage) operates on the legacy `workspace_role` shape (`role` name + `permission` JSON), exactly as `workspace/policy.ts`'s own comments already do for `organization:update` vs `workspace:update`.

## 7. Ambiguities — could not resolve from the code, need a decision

**Q1 — path identifier for update/delete: `roleId` (opaque id) or `roleName` (the human name)?**
Better-auth's own routes accept either, in the BODY (RPC-style), never in a URL path, so it never had to choose. A REST path segment does. A role name may legitimately contain a `/` (better-auth's own `normalizeRoleName` only lower-cases; no character restriction), which would break a `{role}` path segment (Hono would treat it as extra path structure) — a real, concrete bug: a role named `"ops/infra"`, created via the still-mounted plugin today, would be unaddressable by `PATCH/DELETE /api/workspace/{workspaceId}/roles/ops/infra`. **This blueprint recommends `roleId`** (the row's opaque `id`, already returned by `list`/`create`), matching how `updateWorkspaceMemberRoleRoute` already addresses members by opaque `userId` rather than by display name, and requiring a one-line change at each of the two web call sites (both already hold the full row, so `role.id` is in scope where `role.role` is used today). **This is a design decision this blueprint is making, not inherited from better-auth or from the spec — flag it to Thomas as a decision made, reversible by keying on `role` (URL-encoded) instead if he prefers exact parity with the plugin's addressing scheme.**

**Q2 — the delete "is this role assigned to anyone" guard: comma-aware match, or use `resolveMembershipRoleFrom` and treat malformed rows as holding nothing?**
better-auth's own `deleteOrgRole` comma-splits every member's stored `role` value and blocks deletion if ANY piece matches (inclusive, matching its own `permission.mjs` evaluator's OR-across-pieces semantics). PR #110's `resolveMembershipRoleFrom` (the #82 single-role invariant's canonical resolution) explicitly refuses to interpret a malformed/multi-valued row for AUTHORIZATION purposes and is the wrong tool to reach for here casually — but a delete-safety guard is arguably a different QUESTION ("is this DB row still referenced by anything") than an authorization decision ("what is this member allowed to do"). This blueprint recommends the comma-aware match (byte-identical to today's live plugin behavior, and blocking on ambiguity is the safe direction for a delete-guard specifically — it can never silently orphan a grant). **This still needs Thomas's sign-off**: it is the one place in this feature where "preserve inherited behavior exactly" and "never comma-split, per #82" pull in different directions, and #82's own instruction ("Do not implement comma-splitting to match the plugin") is stated without an explicit carve-out for delete-guards. Do not resolve this silently either way without recording it in the decision log, per the spec interaction rule.

**Q3 — do the three mutation routes emit an event or write an audit-log row?**
No S4, S5, S6a, or S8a controller emits an event except `create-workspace.ts`'s `workspace.created` (confirmed by grepping every controller under `workspace/` and `invitation/` for `publishEvent` — exactly one hit). `docs/01-architecture/events.md` was not read in full for this blueprint (targeted grep only) — an implementer should check it for an existing `workspace_role.*` or `role.*` event key before assuming none is wanted; if the precedent (silence) holds, no change is needed. Separately, rbac.md's "Elevated and audited actions" table is explicit that `elevated: true` actions are tracked in that generated table (satisfied automatically once the four policies land) but does not by itself imply a durable `audit_log` row is written by these specific routes — no existing S4-S8a mutation writes to an `audit_log` table either (not grepped exhaustively for this blueprint; flagged rather than asserted).

**Q4 — should `GET .../roles` paginate?**
better-auth's `listOrgRoles` has none, and the ceiling is 25 rows per workspace (below), so pagination is very likely unnecessary. Flagging only because every other `GET` list route in this codebase was not checked for a pagination convention this blueprint should match; recommend confirming there isn't a house convention (e.g. `?cursor=`) that a 25-row-max list should nonetheless follow for consistency, rather than silently deciding "no pagination" is fine.

## 8. Findings — risks and blockers (severity by blast radius)

### F1 — HIGH — `workspace_role` has no unique constraint on `(workspace_id, role)`, and its two consuming reads use un-ordered `.limit(1)`
**Evidence**: `apps/api/drizzle/0030_smart_umar.sql` creates `workspace_role` with two plain `CREATE INDEX` statements and no `UNIQUE`; `apps/api/src/database/schema.ts:239-262` confirms the same (`index(...)`, never `uniqueIndex(...)`). `require-workspace-permission.ts`'s `customRoleStatements` and `require-workspace-role-authority.ts`'s `ownRoleStatements` both `SELECT ... .limit(1)` with no `ORDER BY`.
**Failure scenario**: two concurrent `POST /api/workspace/{id}/roles` calls (native, once S7 ships, or one native + one through the still-mounted plugin's own `/organization/create-role` — both read `workspace_role` and both currently have the identical non-atomic check-then-insert shape) with the SAME role name both pass their own "name not taken" check before either commits, producing two `workspace_role` rows for `(workspaceId, "manager")` with potentially DIFFERENT `permission` payloads. Every subsequent `requireWorkspacePermission`/`requireWorkspaceRoleAuthority` evaluation for any member holding `role = "manager"` in that workspace now reads WHICHEVER row Postgres's heap scan returns first — nondeterministically, and reversibly by an unrelated `UPDATE` elsewhere in the heap (the exact mechanism `WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE`'s own doc comment describes for `workspace_member`, replicated here one table over). This is a broader blast radius than the `workspace_member` duplicate-row defect the codebase already fixed: it affects EVERY request from EVERY member holding that role, not just requests about one specific member pair.
**This is the same defect class the codebase has already found and fixed twice** (`workspace_member` in #77/#88, `workspace_member.role` malformation in #82/#110) — for a THIRD table (`workspace_role`) that nobody has audited yet, because until S7 there was no native write path to it at all.
**Required for S7, not optional**: the new `WORKSPACE_ROLE_LOCK_NAMESPACE` advisory lock (§1) closes it for native callers. It does NOT close it against the still-mounted plugin's own `/organization/create-role`/`update-role` (which takes no lock, exactly like the plugin's membership routes don't, per `workspace-membership-lock.ts`'s own "among native callers" qualifier) — that residual gap closes only at S10, and should be recorded in the PR exactly the way S5 recorded the equivalent gap for membership writes. Recommend also changing `customRoleStatements`/`ownRoleStatements` to read ALL matching rows and fail closed on more than one (mirroring `workspaceMemberRoles`/`isUnambiguousMembership`) rather than trusting `.limit(1)` even after the lock — a value written by the plugin path before S7 ships, or during the S10 window, can still be a pre-existing duplicate the lock does not retroactively clean up.

### F2 — HIGH — omitting "you cannot grant a capability you do not hold" is a concrete, exploitable self-escalation for the `admin` role today
**Evidence**: `legacy-better-auth-access-control.ts`: `admin`'s compiled `organization` statement is `["update"]` only (from `adminAc.statements`, never overridden to include `"delete"`). `require-workspace-role-authority.ts`/`require-workspace-permission.ts` resolve a CUSTOM role's authority purely from `workspace_role.permission`'s JSON, with no comparison to what the CALLER (the role's creator/editor) themselves hold. better-auth's own `crud-access-control.mjs` (`checkIfMemberHasPermission`, called from both `createOrgRole` and `updateOrgRole`) is the control that closes exactly this gap today, on the still-mounted plugin.
**Failure scenario**: a caller holding only the `admin` role (never `organization:delete`, deliberately — that's what distinguishes admin from owner in this product, and what the S4 policy.ts / rbac.md's own "admin: everything except deleting the workspace" line states) calls `POST /api/workspace/{id}/roles` with `{role:"super", permission:{organization:["delete"]}}`. If step 3 of §2's create-controller logic (`checkIfMemberHasPermission` equivalent) is skipped, this succeeds and inserts the row. The same admin then calls the ALREADY-SHIPPED `PATCH /api/workspace/{id}/members/{selfUserId}/role` (S5) to assign themselves `"super"` — permitted, since `member:update` is one of admin's own held capabilities and neither S5's `requireWorkspacePermission`/`requireWorkspaceRoleAuthority` nor its controller checks whether the NEW role's authority exceeds the ACTOR's own (S5's controller only refuses the literal string `"owner"`). The admin's `workspace_member.role` is now `"super"`. `DELETE /api/workspace/{id}` (S4) re-resolves the caller's role via `hasWorkspacePermission`, reads the `"super"` row, finds `organization:["delete"]`, and grants — an admin has deleted a workspace they were explicitly designed never to be able to delete, with zero instance-admin involvement and no bypass of any EXISTING check; this is a straight-line, two-call path through routes that already exist plus the new one.
**Required for S7**: the `checkIfMemberHasPermission`-equivalent step in §2's create AND update controllers is not optional hardening — it is the control that makes the rest of the codebase's carefully-scoped role capabilities (owner-only `organization:delete`, owner-only `workspace:transfer_ownership`-adjacent reasoning) actually hold once roles become admin-editable. Note `workspace:transfer_ownership` itself is NOT reachable this way (§0: it is evaluated by `requireWorkspaceCapability` against the separate canonical `@taskdesk/permissions` data, never against `workspace_role.permission`) — the exposure is scoped to whatever `hasWorkspacePermission` actually reads (`organization`, `member`, `invitation`, `team`, `ac`, plus the extended `project`/`task`/`label` resources), and `organization:["delete"]` is the one gap between what `admin` compiles to and what `owner` compiles to.

### F3 — MEDIUM — the 25-role ceiling exists only as a config literal in `auth.ts`, with no shared source S7 can reference
**Evidence**: `apps/api/src/auth.ts:279` — `maximumRolesPerOrganization: 25` inline in the `organization()` plugin config object literal; not exported, not named.
**Consequence if not addressed**: S7's native `createWorkspaceRole` controller either duplicates the literal `25` (drift risk — a future change to one and not the other silently makes the plugin and the native route disagree on the ceiling, and unlike every other divergence in this feature, THIS one is invisible until someone hits exactly the 25th/26th role) or the implementer omits the ceiling entirely (a behavioral WIDENING relative to what better-auth enforces today — the plugin still enforces 25 until S10, so an admin could hit "409 too many roles" on the plugin path and then discover the native path has no such limit, an inconsistency a careful admin would notice and a support ticket would be filed over).
**Recommended fix**: export a named constant (e.g., from a new small `apps/api/src/utils/workspace-role-limits.ts`, or from `@taskdesk/permissions` if that package is judged the more authoritative home) and have `auth.ts`'s config reference it too, so there is exactly one `25` in the codebase, matching this project's own stated principle that "every identifier has exactly one authoritative home."

### F4 — LOW — the LIST route's declared capability will not match its runtime enforcement, by design, matching an already-accepted pattern — but only if this is written down
**Evidence**: §2's recommendation is `workspace:read` declared, `ac:["read"]` enforced. This is the same shape as S4's `organization:update` (enforced) vs `workspace:update` (declared) gap, which the codebase already accepts and documents extensively in `workspace/policy.ts`'s comments.
**Not a defect if documented; becomes one if not**: an implementer who does not write the equivalent comment (as §2 specifies) leaves a future reader to conclude the mismatch is a mistake rather than a known, temporary, #7-scoped gap — exactly the confusion `workspace/policy.ts`'s existing comments exist to prevent for the S4/S5/S6a cases. No code change is at risk here, only a documentation omission.

### F5 — LOW — "PATCH replaces, not merges" is a real REST-semantics trap for a future API consumer, even though the current UI already sends a full replacement set
**Evidence**: `roles.tsx`'s `handleSave` (line ~672-710) computes `currentPermissions` from its own local checkbox-matrix state (the FULL set, not a delta) before calling `updateRole` — so today's only caller already behaves correctly. better-auth's own `updateOrgRole` also replaces wholesale (§0).
**Failure scenario if not documented**: a future API consumer (an MCP tool, a future admin CLI, a third-party integration once workspace service API keys exist) reasonably assumes `PATCH` semantics are a merge (the far more common REST convention) and sends only the ONE permission entry it means to add, silently WIPING every other entry the role previously had. This is not exploitable today (no such second caller exists yet) but is worth an explicit `description` string on the OpenAPI operation and a code comment on `updateWorkspaceRoleBody`, matching how `updateWorkspaceMemberRoleRoute`'s own description field already spells out an unusual constraint ("Can never grant or touch the owner role").

## Summary of verdict for this blueprint

The route/schema/policy shape is a direct, low-risk application of the S4/S5/S6a/S8a template — no new middleware, no new capability identifiers, no schema migration required for the routes themselves. The genuine risk is concentrated in two places that are easy to skip because better-auth performs them silently today and nothing in this codebase currently tests for their absence: the missing unique constraint on `workspace_role` (F1) and the missing "cannot grant what you do not hold" check (F2). Both are required, not optional, for S7 to be a faithful "native replacement" rather than a narrower-looking route that is actually less safe than the plugin it replaces — which is exactly the failure mode #77's own review found and fixed once already, one table over.
