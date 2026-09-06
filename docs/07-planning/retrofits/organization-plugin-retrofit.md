# TaskDesk v2 — `organization()` Plugin Retrofit Matrix

**Scope:** read-only dependency inventory + current-state → target matrix for removing better-auth's `organization()` plugin.
**Source of truth read:** `/home/ubuntu/.taskdesk-lanes/lane-a-6` (branch `feat/p0-remove-inherited-surfaces`).
**Status of the decision:** settled — `organization()` IS removed in P0. This document maps the retrofit; it does not re-argue it.
**Constraint:** #7 (`packages/permissions`, separate lane) replaces **policy + evaluation only** — never persistence, workspace/membership lifecycle, invitations, teams, plugin hooks, or route surface.

_(Document written incrementally as each item was confirmed. All `file:line` references are relative to the lane-a-6 workspace root unless stated.)_

---

## 1. Dependency inventory

### 1.1 The plugin mount itself

| Item | Evidence |
|---|---|
| `organization` imported from `better-auth/plugins` | `apps/api/src/auth.ts:27` |
| `organization({ ... })` mounted in the `plugins` array | `apps/api/src/auth.ts:269` (block runs to `apps/api/src/auth.ts:445`) |
| `AccessControl` type import used only to widen the plugin's `ac` | `apps/api/src/auth.ts:28` |
| `ac`, `DEFAULT_ROLE_NAMES`, `defaultRolePayloads`, `owner` imported from `@taskdesk/permissions` | `apps/api/src/auth.ts:7-12` |

### 1.2 Adapter schema / table mapping (the `schema:` block)

`apps/api/src/auth.ts:292-329` re-points every better-auth organization model onto a TaskDesk table:

| better-auth model | `modelName` | field remaps | Evidence |
|---|---|---|---|
| `organization` | `workspace` | `additionalFields.description` (string, `input: true`, optional) | `auth.ts:293-303` |
| `member` | `workspace_member` | `organizationId -> workspaceId`, `createdAt -> joinedAt` | `auth.ts:304-310` |
| `invitation` | `invitation` | `organizationId -> workspaceId` | `auth.ts:311-316` |
| `organizationRole` | `workspace_role` | `organizationId -> workspaceId` | `auth.ts:317-322` |
| `team` | `team` | `organizationId -> workspaceId` | `auth.ts:323-328` |
| `teamMember` | *(not remapped — plugin default `teamMember` model)* | — | absent from the `schema` block; served by `apps/api/src/database/schema.ts:194-211` (`team_member`) via the alias below |

Drizzle tables the plugin actually writes (all live in `apps/api/src/database/schema.ts`):

- `workspaceTable` / `"workspace"` — `schema.ts:141-151` (has `slug` UNIQUE, `logo`, `metadata`, `description`, `createdAt`; **no `updatedAt`, no `organisationId`**)
- `workspaceUserTable` / `"workspace_member"` — `schema.ts:153-176` (`role` text default `"member"`, `joinedAt`)
- `teamTable` / `"team"` — `schema.ts:178-192`
- `teamMemberTable` / `"team_member"` — `schema.ts:194-211`
- `invitationTable` / `"invitation"` — `schema.ts:212-236` (`role`, `teamId`, `status` default `pending`, `expiresAt`, `inviterId`)
- `workspaceRoleTable` / `"workspace_role"` — `schema.ts:238-262` (`role`, `permission` as JSON **text**)
- `sessionTable.activeOrganizationId` / `active_organization_id` and `activeTeamId` / `active_team_id` — `schema.ts:61-62`

**Alias layer the drizzle adapter resolves through** — `apps/api/src/database/schema.ts:891-901`:
`workspace`, `team`, `teamMember`, `workspace_member`, `invitation`, `organizationRole` are exported as aliases of the TaskDesk tables purely so better-auth's model lookup succeeds. `organizationRole = workspaceRoleTable` (`schema.ts:900`) is a plugin-shaped name with no other consumer. Drizzle relations for these aliases: `schema.ts:926-980+`.

### 1.3 Access-control coupling

| Item | Evidence |
|---|---|
| `ac: ac as unknown as AccessControl` — TaskDesk statement widened to satisfy the plugin generic | `apps/api/src/auth.ts:275` |
| `roles: { owner }` — only `owner` is static/compiled-in; the rest are DB rows | `apps/api/src/auth.ts:282` |
| `dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 25 }` | `apps/api/src/auth.ts:283-286` |

### 1.4 Teams

| Item | Evidence |
|---|---|
| `teams: { enabled: true, maximumTeams: 10, allowRemovingAllTeams: false }` | `apps/api/src/auth.ts:287-291` |

### 1.5 Lifecycle hooks still present

| Hook | Behaviour | Evidence |
|---|---|---|
| `allowUserToCreateOrganization` | when `DISABLE_WORKSPACE_CREATION=true`, re-reads `user.role` from the DB (cookie-cache staleness guard) and allows only instance admins; otherwise `true` | `apps/api/src/auth.ts:346-354` (env read at `apps/api/src/auth.ts:57-58`) |
| `requireEmailVerificationOnInvitation: false` | invitation id is the secret, not email verification | `apps/api/src/auth.ts:361` |
| `organizationHooks.beforeCreateOrganization` | validates workspace name via `checkWorkspaceName`, throws `APIError("BAD_REQUEST")` | `apps/api/src/auth.ts:363-368`; validator at `apps/api/src/utils/check-workspace-name.ts` |
| `organizationHooks.afterCreateOrganization` | seeds `workspace_role` rows from `DEFAULT_ROLE_NAMES` + `defaultRolePayloads` (skips already-taken names, best-effort, swallows errors) **and** `publishEvent("workspace.created", ...)` | `apps/api/src/auth.ts:369-411` (seed `:376-403`, event `:405-410`) |
| `sendInvitationEmail` | builds `${TASKDESK_AGENT_URL}/invitation/accept/${data.id}`, resolves locale, sends via `@taskdesk/email` `sendWorkspaceInvitationEmail`, tolerates `SMTP_NOT_CONFIGURED` | `apps/api/src/auth.ts:413-444` |

Only `beforeCreateOrganization` and `afterCreateOrganization` remain from the organization hook family — no `beforeAddMember`/`afterAddMember`/`beforeCreateInvitation` etc. are configured (verified by the `grep -n "organization"` sweep of `auth.ts`, which lists every occurrence).

### 1.6 Non-hook `auth.ts` code that reads plugin state

| Item | Evidence |
|---|---|
| Rate-limit custom rule keyed on the plugin's route path `"/organization/invite-member"` | `apps/api/src/auth.ts:520` |
| `hooks.before` middleware gates `/organization/invite-member` on cloud: blocks anonymous senders and disposable-email invitees | `apps/api/src/auth.ts:630-651` |
| `hooks.after` middleware writes `session.activeOrganizationId` after sign-in/sign-up from the first `workspace_member` row | `apps/api/src/auth.ts:713-733` (write at `:726-729`) |

Note the shape mismatch at `auth.ts:717-721`: the middleware queries `schema.workspaceUserTable` directly (TaskDesk-owned access) but writes into the plugin-owned session column `activeOrganizationId`. Half of this pair is already TaskDesk-native.

### 1.7 Drizzle adapter model map (separate from the plugin's `schema:` block)

`apps/api/src/auth.ts:157-173` passes an explicit model→table map to `drizzleAdapter`, and six of those entries exist only to serve the organization plugin:
`workspace` (`:165`), `workspace_member` (`:166`), `invitation` (`:167`), `workspace_role` (`:168`), `team` (`:169`), `teamMember` (`:170`).
`...schema` at `auth.ts:159` additionally spreads the alias exports from `database/schema.ts:891-901`, so the plugin-shaped names resolve twice.

### 1.8 `/organization/*` route surface actually exposed

The plugin mounts its route family under `basePath: "/api/auth"` (`apps/api/src/auth.ts:156`), reached through the catch-all `auth.handler` wiring in `apps/api/src/index.ts`. The full surface is enumerated (and published into the OpenAPI document) by `apps/api/src/auth-openapi.ts` — `organizationRoutes()` at `apps/api/src/auth-openapi.ts:13`, registered at `apps/api/src/index.ts:376` (imported at `apps/api/src/index.ts:15`).

**35 documented routes**, all `/auth/organization/...`, with `apps/api/src/auth-openapi.ts` line numbers:

| Route | Line |
|---|---|
| `accept-invitation` | 16 |
| `add-team-member` | 52 |
| `cancel-invitation` | 106 |
| `check-slug` | 132 |
| `create` | 158 |
| `create-role` | 208 |
| `create-team` | 239 |
| `delete` | 290 |
| `delete-role` | 319 |
| `get-active-member` | 357 |
| `get-active-member-role` | 381 |
| `get-full-organization` | 393 |
| `get-invitation` | 408 |
| `get-role` | 443 |
| `has-permission` | 455 |
| `invite-member` | 495 |
| `leave` | 549 |
| `list` | 576 |
| `list-invitations` | 591 |
| `list-members` | 603 |
| `list-roles` | 615 |
| `list-team-members` | 627 |
| `list-teams` | 661 |
| `list-user-invitations` | 696 |
| `list-user-teams` | 733 |
| `reject-invitation` | 748 |
| `remove-member` | 784 |
| `remove-team` | 828 |
| `remove-team-member` | 870 |
| `set-active` | 915 |
| `set-active-team` | 949 |
| `update` | 979 |
| `update-member-role` | 1029 |
| `update-role` | 1078 |
| `update-team` | 1122 |

Caveat I did not verify: `auth-openapi.ts` is a hand-written OpenAPI *description*; the plugin may mount routes it does not document (e.g. `set-active-team`/`list-user-teams` variants) and may document ones it does not mount. Treat this table as the **client-visible contract**, and re-derive the mounted set from better-auth itself before deleting anything.

### 1.9 Frontend callers (`apps/web/src`)

The client plugin is mounted at `apps/web/src/lib/auth-client.ts:35-48` (`organizationClient` imported at `:11`), carrying its own `ac` cast (`:39`), a **static four-role map** `{ viewer, member, admin, owner }` (`:40-45`) — note this diverges from the server, which registers only `owner` — and `dynamicAccessControl.enabled: true` (`:46-47`). `ac` and the roles come from `apps/web/src/lib/permissions.ts:1` (a re-export of `@taskdesk/permissions`).

| Concern | Caller | Evidence |
|---|---|---|
| Workspace list | `authClient.organization.list()` | `apps/web/src/fetchers/workspace/get-workspaces.ts:4`; `apps/web/src/fetchers/workspace/create-workspace.ts:23`; `apps/web/src/hooks/queries/workspace/use-create-workspace.ts:30` |
| Workspace list (reactive) | `authClient.useListOrganizations()` | `apps/web/src/hooks/queries/workspace/use-get-workspaces.ts:8`; `apps/web/src/hooks/queries/workspace/use-active-workspace.ts:9` |
| Active workspace | `authClient.useActiveOrganization()` | `apps/web/src/hooks/queries/workspace/use-active-workspace.ts:6-7` |
| Workspace create | `authClient.organization.create` | `apps/web/src/fetchers/workspace/create-workspace.ts:32`; `apps/web/src/hooks/queries/workspace/use-create-workspace.ts:39` |
| Workspace update | `authClient.organization.update` | `apps/web/src/fetchers/workspace/update-workspace.ts:20`; `apps/web/src/hooks/mutations/workspace/use-update-workspace.ts:55` |
| Workspace delete | `authClient.organization.delete` | `apps/web/src/fetchers/workspace/delete-workspace.ts:8`; `apps/web/src/hooks/mutations/workspace/use-delete-workspace.ts:11` |
| Full workspace (org + members + teams) | `authClient.organization.getFullOrganization` | `apps/web/src/hooks/queries/workspace/use-get-full-workspace.ts:19-22`; type at `apps/web/src/types/workspace/index.ts:5` |
| Set active workspace | `authClient.organization.setActive` | `apps/web/src/components/workspace-switcher.tsx:59`; `apps/web/src/components/onboarding/onboarding-flow.tsx:81`; `apps/web/src/components/shared/modals/create-workspace-modal.tsx:62`; `apps/web/src/routes/invitation/accept.$inviteId.tsx:62` |
| Member list | `authClient.organization.listMembers` | `apps/web/src/fetchers/workspace-user/get-workspace-users.ts:18`; `apps/web/src/fetchers/workspace-user/get-active-workspace-users.ts:10`; `apps/web/src/hooks/queries/workspace-users/use-get-workspace-users.ts:39`; `apps/web/src/hooks/queries/workspace-users/use-active-workspace-user.ts:14` |
| Active member (role source for the whole UI) | `authClient.organization.getActiveMember` (type) | `apps/web/src/types/workspace-user/index.ts:9` |
| Member remove | `authClient.organization.removeMember` | `apps/web/src/fetchers/workspace-user/delete-workspace-user.ts:12`; `apps/web/src/hooks/mutations/workspace-user/use-delete-workspace-user.ts:13` |
| Member role change | `authClient.organization.updateMemberRole` | `apps/web/src/hooks/mutations/workspace-user/use-update-workspace-user-role.ts:18` |
| Ownership transfer (promote + demote pair) | `authClient.organization.updateMemberRole` ×2 | `apps/web/src/hooks/mutations/workspace/use-transfer-workspace-ownership.ts:29,38` |
| Invite | `authClient.organization.inviteMember` | `apps/web/src/fetchers/workspace-user/invite-workspace-member.ts:14`; `apps/web/src/hooks/mutations/workspace-user/use-invite-workspace-user.ts:20` |
| Invitation accept | `authClient.organization.acceptInvitation` | `apps/web/src/hooks/mutations/workspace-user/use-accept-invitation.ts:11`; `apps/web/src/routes/invitation/accept.$inviteId.tsx:53` |
| Invitation reject | `authClient.organization.rejectInvitation` | `apps/web/src/hooks/mutations/workspace-user/use-reject-invitation.ts:11` |
| Invitation cancel | `authClient.organization.cancelInvitation` | `apps/web/src/hooks/mutations/workspace-user/use-cancel-invitation.ts:13` |
| Invitation get | `authClient.organization.getInvitation` | `apps/web/src/hooks/queries/workspace-users/use-get-invitation.ts:13` |
| Invitation list (per workspace) | `authClient.organization.listInvitations` | `apps/web/src/hooks/queries/workspace-users/use-get-workspace-invites.ts:12` |
| Invitation list (per user) | `authClient.organization.listUserInvitations` | `apps/web/src/hooks/queries/workspace-users/use-get-user-invitations.ts:9`; type at `apps/web/src/types/workspace-user/index.ts:19` |
| Role list | `authClient.organization.listRoles` | `apps/web/src/hooks/queries/workspace/use-workspace-roles.ts:37` (maps `r.organizationId → workspaceId` at `:45`) |
| Role create / update / delete | `createRole` / `updateRole` / `deleteRole` | `apps/web/src/hooks/mutations/workspace/use-create-workspace-role.ts:18`; `apps/web/src/hooks/mutations/workspace/use-update-workspace-role.ts:18`; `apps/web/src/hooks/mutations/workspace/use-delete-workspace-role.ts:16` |
| Permission checks (whole UI gating) | `authClient.organization.hasPermission` | `apps/web/src/hooks/use-workspace-permission.ts:71` (16-capability fan-out) and `:114` (ad-hoc escape hatch) |
| Ownership-transfer UI copy naming the plugin | comment/label | `apps/web/src/components/team/members-table.tsx:274` |

Four `apps/web/src/types/**` aliases derive their public types from plugin return types — `apps/web/src/types/workspace-user/index.ts:4,9,14,19` and `apps/web/src/types/workspace/index.ts:5`. These are the shared-shape choke point on the client: they must be redefined against a TaskDesk contract, not inferred from better-auth.

### 1.10 Authorization calls that read organization/member state

**Server-side authorization is already TaskDesk-native and does *not* go through the plugin.** `apps/api/src/utils/require-workspace-permission.ts` resolves a caller's role from `workspace_member` (`:109-115`), then that role's statements from `workspace_role.permission` (`:51-68`, parsed at `:22-49`), falling back to the compiled-in `builtInRoles` (`:10-20`, imported from `@taskdesk/permissions` at `:1`) only when no row exists (`:127-131`). API-key permissions are intersected at `:94-99` and instance admin short-circuits at `:101-103`; the middleware wrapper is `requireWorkspacePermission` at `:134-158`.

Verified: **no server file calls `auth.api.hasPermission` or `auth.api.getActiveMember`.** The only `auth.api.*` calls outside `auth-openapi.ts` are `getSession` (`apps/api/src/index.ts:493`, `apps/api/src/utils/authenticate-api-request.ts:17`) and the two dead calls in `migrate-organizations.ts` (below).

Other TaskDesk-native readers of membership state (all plugin-free, all continue to work unchanged after removal):
`apps/api/src/workspace/controllers/get-workspace-members.ts:12-16`, `apps/api/src/utils/validate-workspace-access.ts:45-49`, `apps/api/src/utils/assert-assignable-user.ts:16-21`, `apps/api/src/search/controllers/global-search.ts:132-134,366-367`, `apps/api/src/notification-preferences/service.ts:121-126`.

So the *only* live authorization consumer of the plugin is the **web client**, via `/organization/has-permission`.

### 1.11 Dead / migration-era code

| Item | Evidence | Status |
|---|---|---|
| `apps/api/src/utils/migrate-organizations.ts` — calls `auth.api.createOrganization` (`:18`) and `auth.api.addTeamMember` (`:30`) | whole file (41 lines) | **Dead**: no import of `migrateOrganizations` / `migrate-organizations` anywhere in `apps/api/src` or `tests`. It also has a latent bug — it passes a *workspace* id as `teamId`. Delete with the plugin. |
| `apps/api/src/utils/migrate-session-column.ts` — renames `active_workspace_id → active_organization_id` at boot | `:10`, called from `apps/api/src/index.ts:722` (imported `:48`) | **Live**, and it is the historical record that this column was TaskDesk's before the plugin renamed it. |
| `seedDefaultWorkspaceRoles()` boot backfill | `apps/api/src/utils/seed-default-workspace-roles.ts:19`, called at `apps/api/src/index.ts:738` | **Live and plugin-independent** — pure Drizzle writes into `workspace_role`. Survives removal as-is. |

### 1.12 Tests touching any of the above (`tests/`)

Scoped grep of `tests/` for `organization` returns **exactly one hit**:

- `tests/api-integration/openapi.test.ts:71` — asserts `"POST /auth/organization/create"` is present in the published OpenAPI document. **This test fails the moment the route family is unmounted** and is the one required test edit.

Everything else seeds the tables directly and is therefore plugin-agnostic:
- `tests/api-integration/helpers/fixtures.ts:30-45` — `createWorkspaceMember` inserts into `workspaceTable` + `workspaceUserTable` by hand.
- `tests/api-integration/registration-invitation.test.ts:8-27` — seeds `invitationTable` rows directly.
- `tests/api-integration/workspace-rbac.test.ts`, `tests/api-integration/authorization-boundaries.test.ts`, `tests/api/utils/workspace-access-middleware.test.ts` — exercise `require-workspace-permission` / `validate-workspace-access`, i.e. the TaskDesk-native path.
- `apps/web/src/hooks/use-workspace-permission.test.tsx` — the one **client** test over the `hasPermission` fan-out (it lives under `apps/web/src`, not `tests/`; I did not read its mocking strategy).

**Gap:** there is no behaviour test anywhere for workspace create/delete, member add/remove, role assignment or invitation accept *as HTTP flows* — those paths are only exercised through the plugin, which the suite never calls. That is the single biggest safety problem in this retrofit.

### 1.13 Billing / seat remnants — confirmed clear

Billing was removed in `apps/api/drizzle/0047_drop_billing.sql` (drops `billing_event`, `billing_reminder_sent`, `trial_grant`, `workspace_billing`), and `apps/api/src/index.ts:515` records the three billing surfaces as removed in #6.

Sweep of `apps/api/src`, `apps/web/src`, `packages` for `billing|seat|stripe|subscription`: **nothing organization-related remains.** The only survivor is a dead exported constant:

- `apps/api/src/scheduler/leader-lock.ts:7` — `export const SEAT_RECONCILIATION_LEASE = "seat-reconciliation";` with **zero references** in `apps/api/src`. A seat-billing remnant, unrelated to `organization()`, safe to delete independently.

There is **no seat sync hook** on the plugin (contra `docs/01-architecture/auth-and-identity.md:80-81`, which says the plugin has "hooks for create, delete and seat sync" — see the doc/code divergences in §2).

---

## 2. Current-state → target matrix

### 2.1 The documented target

Grounded in `docs/01-architecture/data-model.md:98-118` and `docs/01-architecture/auth-and-identity.md:32-90`:

- `docs/01-architecture/auth-and-identity.md:37` — "**Not used.** better-auth's organisation plugin is removed at the fork — our own `organisation` / `membership` / `team` / `invitation` tables are the directory, because identity is always resolved from *our* database."
- `docs/01-architecture/auth-and-identity.md:72` — verdict row: `organization` → "**removed at fork — P0 step 1b**".
- `docs/01-architecture/auth-and-identity.md:78-88` — the whole `/organization/*` family "**disappears from the router**", including `/organization/invite-member`.
- `docs/01-architecture/data-model.md:99-100` — "better-auth is used for **authentication only** — its organisation plugin is **not** used; the directory below is ours."
- Target tables: `organisation` (`data-model.md:106`), `person` (`:108`), `workspace` (`:109`), `membership` (`:111`), `role` (`:112`), `team` (`:113`), `team_member` (`:114`), `invitation` (`:115`).
- Target `role` DDL: `docs/01-architecture/rbac.md:137-152` — `scope`, `workspace_id`, `key`, `name`, `rank`, `capabilities jsonb`, `is_system`, `is_editable`, `version`.
- Identity resolution rule: `docs/01-architecture/auth-and-identity.md:352-367` — `resolveIdentity(session.userId)` returning `{ userId, side, organisationId, memberships, reach, authority }`; **never** read authority off the session.
- Target invitation flow: `docs/01-architecture/auth-and-identity.md:357-370` — CSPRNG token, **only the SHA-256 hash stored**, 7-day expiry, redemption bound to the invited email address.

### 2.2 Legend

`IMPL` already implemented in TaskDesk · `PART` partially implemented · `MISS` missing · `MIG` needs data migration · `ROUTE` needs route replacement · `TEST` needs behaviour test · `CONTRACT` needs shared-contract change (**owned by #7 / Lane B — do not invent here**)

Exactly one mark per responsibility, per the brief; where a second consideration matters it is stated in the note rather than as a second mark.

### 2.3 The matrix

| # | Inherited responsibility | Current implementation | Target | Mark | Note |
|---|---|---|---|---|---|
| 1 | Adapter schema mapping `organization → workspace` | `auth.ts:293-303` + `auth.ts:165` + alias `schema.ts:895` | no mapping — `workspace` is a plain TaskDesk table | `IMPL` | The table already exists and is TaskDesk-shaped. Removal is pure deletion of the mapping; no DDL. |
| 2 | Adapter mapping `member → workspace_member` (`organizationId→workspaceId`, `createdAt→joinedAt`) | `auth.ts:304-310` + `auth.ts:166` + alias `schema.ts:898` | `membership` (`person_id`, `scope`, `scope_id`, `role_id`, `sees_all`) | `MIG` | Target is a *different shape*, not a rename: scoped membership + `person_id` + `role_id` FK. `workspace_member.role` is a text name; target is an FK to `role`. Migration must be authored with the `person` table, which does not exist yet — so this is **not** a P0-step-1b migration. |
| 3 | Adapter mapping `invitation` (`organizationId→workspaceId`) | `auth.ts:311-316` + `auth.ts:167` + alias `schema.ts:899` | `invitation` (`email`, `organisation_id`, `role_id`, `token_hash`, `expires_at`, `state`, `invited_by`) | `MIG` | Current table is workspace-scoped, stores `role` as text, `status` not `state`, and **the row id *is* the link secret** (`auth.ts:414`, `check-registration-allowed.ts:146`). Target stores only a hash. Live pending invitations cannot survive that change unchanged — see §4. |
| 4 | Adapter mapping `organizationRole → workspace_role` | `auth.ts:317-322` + `auth.ts:168` + alias `schema.ts:900` | `role` with `capabilities jsonb`, `rank`, `key`, `is_system`, `is_editable`, `version` (`rbac.md:137-152`) | `CONTRACT` | The row *shape* is #7's: capability vocabulary, `capabilities.ts`, rank/implication semantics. TaskDesk's own reader (`require-workspace-permission.ts`) already reads the table without the plugin, so nothing about removal is blocked on this. |
| 5 | Adapter mapping `team` (`organizationId→workspaceId`) | `auth.ts:323-328` + `auth.ts:169` + alias `schema.ts:896` | `team` (`workspace_id`, `name`, `capacity_days_per_week`, `is_cab`) — `data-model.md:113` | `MISS` | No TaskDesk route, controller, service or test writes `team` today. The plugin is the **only** writer. Removing it leaves teams with no create/update/delete path at all. |
| 6 | `teamMember` model (not remapped) | `auth.ts:170` + alias `schema.ts:897`, table `schema.ts:194-211` | `team_member` (`team_id`, `person_id`, `allocation_pct`, `is_lead`) — `data-model.md:114` | `MISS` | Same as #5, plus the target keys on `person_id` and carries allocation fields the current table lacks. |
| 7 | Workspace **creation** | `POST /auth/organization/create` (`auth-openapi.ts:158`), name check `auth.ts:363-368`, role seed + `workspace.created` event `auth.ts:369-411`, gate `auth.ts:346-354` | TaskDesk route `POST /api/workspace` | `ROUTE` | The only workspace-create path in the product. `apps/api/src/workspace/index.ts` currently exposes **one** route (`GET /{workspaceId}/members`) — there is no create/update/delete. This is the largest single piece of work. |
| 8 | Workspace **deletion** | `POST /auth/organization/delete` (`auth-openapi.ts:290`) | TaskDesk route `DELETE /api/workspace/{id}` with soft delete (`deleted_at`, `purge_after` — `data-model.md:109`) | `ROUTE` | Today deletion relies on the DB `ON DELETE CASCADE` chains off `workspace.id`. Target adds a 30-day recovery window the current schema has no columns for; the *route* is the P0 obligation, the soft-delete columns are a later phase. |
| 9 | Workspace **update** (name / logo / metadata / description) | `POST /auth/organization/update` (`auth-openapi.ts:979`) | TaskDesk route `PATCH /api/workspace/{id}` | `ROUTE` | `description` only exists because it is declared as an `additionalFields` entry at `auth.ts:295-302`; removing the plugin removes the only writer of that column. |
| 10 | Workspace **lookup / list** (`list`, `get-full-organization`, `check-slug`) | `auth-openapi.ts:576`, `:393`, `:132` | TaskDesk routes `GET /api/workspace`, `GET /api/workspace/{id}` | `ROUTE` | `get-full-organization` is a compound read (workspace + members + invitations + teams) that `apps/web/src/hooks/queries/workspace/use-get-full-workspace.ts:19` depends on. Slug uniqueness is enforced in the DB already (`schema.ts:146`), so `check-slug` is trivially reimplementable. |
| 11 | Membership **creation** (via invite accept / create-owner) | plugin internals, reached from `accept-invitation` (`auth-openapi.ts:16`) and `create` (`:158`) | TaskDesk service writing `membership` | `ROUTE` | No TaskDesk code path inserts into `workspace_member` outside test fixtures (`tests/api-integration/helpers/fixtures.ts:40`). Verified by the `workspaceUserTable` sweep — every other reference is a **read**. |
| 12 | Membership **removal** / leave | `remove-member` (`auth-openapi.ts:784`), `leave` (`:549`) | TaskDesk routes | `ROUTE` | `leave` carries the plugin's "cannot leave as the only owner" rule, which the client works around with a two-call promote/demote dance (`apps/web/src/hooks/mutations/workspace/use-transfer-workspace-ownership.ts:15,29,38`). That rule must be re-expressed server-side, not lost. |
| 13 | Membership **lookup** (`list-members`, `get-active-member`, `get-active-member-role`) | `auth-openapi.ts:603`, `:357`, `:381` | `GET /api/workspace/{id}/members` — **already exists** | `PART` | `apps/api/src/workspace/index.ts:13-31` + `apps/api/src/workspace/controllers/get-workspace-members.ts` already serve the member list natively. Missing: "the current caller's own membership/role". The client derives it by fetching the **whole** member list and filtering client-side (`apps/web/src/hooks/queries/workspace-users/use-active-workspace-user.ts:14-25`), and that value is the role the entire permission model keys on (`apps/web/src/hooks/use-workspace-permission.ts:48,50`). `getActiveMember` itself is referenced only as a *type* (`apps/web/src/types/workspace-user/index.ts:9`). |
| 14 | Role **resolution** for authorization (server) | `require-workspace-permission.ts:87-132` — reads `workspace_member.role` then `workspace_role.permission`, no plugin involvement | `resolveIdentity()` + capability evaluation in `packages/permissions` (`auth-and-identity.md:352-367`) | `IMPL` | **Already plugin-free.** This is the single most important finding: removing `organization()` does *not* break server-side authorization. Its eventual replacement by `resolveIdentity` is #7's, and is not a precondition for removal. |
| 15 | Role **resolution** for the UI (client) | `authClient.organization.hasPermission` fan-out over 16 capabilities — `apps/web/src/hooks/use-workspace-permission.ts:15-32,71,114` | a TaskDesk capability endpoint | `ROUTE` | The plugin's `has-permission` (`auth-openapi.ts:455`) is the **only live authorization consumer of the plugin**. A single `GET /api/capabilities` (named in `docs/01-architecture/rbac.md:347`) replaces 16 round-trips. Its *response vocabulary* is #7's contract; the route is not. |
| 16 | `workspace_role` CRUD (the Roles UI) | `create-role` / `update-role` / `delete-role` / `list-roles` / `get-role` — `auth-openapi.ts:208,1078,319,615,443`; client at `apps/web/src/hooks/queries/workspace/use-workspace-roles.ts:37` and the three mutation hooks | `role` CRUD with rank guardrails (`rbac.md:159-175`) | `ROUTE` | Persistence already lands in TaskDesk's own `workspace_role` table and is already read natively. Only the **write** path is the plugin's. The guardrails in `rbac.md:159-175` (cannot grant what you do not hold; rank comparisons; last-administrator check) exist in **no** current code — verified absent from `require-workspace-permission.ts` and `seed-default-workspace-roles.ts`. |
| 17 | Default-role seeding on workspace create | `auth.ts:369-411` (hook) + boot backfill `seed-default-workspace-roles.ts:19` | seeded by TaskDesk's own workspace-create service | `PART` | The seeding *logic* is already TaskDesk code operating on TaskDesk tables; only its **trigger** is the plugin hook. Re-pointing it at a TaskDesk create service is a small, safe move. The boot backfill needs no change at all. |
| 18 | `dynamicAccessControl` (DB-backed roles resolved at check time) | `auth.ts:283-286` | capability evaluation in `packages/permissions` | `CONTRACT` | Only `has-permission` consumes it (client side). `require-workspace-permission.ts:127-131` already reimplements the same "DB row wins, static fallback" precedence natively. |
| 19 | `ac` / `statement` access-control object | `packages/permissions/src/index.ts:9-49`, cast in at `auth.ts:275` and `apps/web/src/lib/auth-client.ts:39` | `capabilities.ts` capability vocabulary (`rbac.md:29,118`) | `CONTRACT` | **Hard coupling to better-auth remains even after the plugin is gone**: `packages/permissions/src/index.ts:1-7` imports `createAccessControl`, `defaultStatements`, `memberAc`, `adminAc`, `ownerAc` from `better-auth/plugins/organization/access`. Removing the plugin from `auth.ts` does **not** remove this import. Cutting it is #7's. |
| 20 | Invitation **create + email** | `invite-member` (`auth-openapi.ts:495`), email at `auth.ts:413-444`, rate limit `auth.ts:520`, cloud abuse gate `auth.ts:630-651` | TaskDesk invite route + hashed token (`auth-and-identity.md:357-370`) | `ROUTE` | Two guards are keyed on the **plugin's route string** (`auth.ts:520`, `auth.ts:630`) and silently become dead the moment the path changes. Both must move to the replacement route in the *same* commit. |
| 21 | Invitation **accept / reject / cancel** | `auth-openapi.ts:16,748,106`; client `use-accept-invitation.ts:11`, `use-reject-invitation.ts:11`, `use-cancel-invitation.ts:13`, `routes/invitation/accept.$inviteId.tsx:53` | TaskDesk routes; acceptance creates the membership and consumes the invitation (`auth-and-identity.md:368-369`) | `ROUTE` | `requireEmailVerificationOnInvitation: false` (`auth.ts:361`) is a deliberate deviation whose rationale (`auth.ts:355-360`) must be carried into the replacement — and reconciled against `auth-and-identity.md:360-363`, which *requires* the accepting account to verify the invited address. **The docs and the code disagree here.** |
| 22 | Invitation **lookup** | `get-invitation` (`auth-openapi.ts:408`), `list-invitations` (`:591`), `list-user-invitations` (`:696`) | TaskDesk routes — **partly already exist** | `PART` | `GET /api/invitation/{id}` and `GET /api/invitation/pending` already exist natively (routes `apps/api/src/invitation/index.ts:10-38`, handlers `:40-50`, mounted at `apps/api/src/index.ts:555`; controllers `get-invitation-details.ts`, `get-user-pending-invitations.ts`; plus the unauthenticated `GET /invitation/public/:id` at `apps/api/src/index.ts:215-219`), backed by `check-registration-allowed.ts:85-98,133-146`. Missing: the per-workspace `list-invitations` the admin UI uses. |
| 23 | Teams routes (`create-team`, `update-team`, `remove-team`, `list-teams`, `list-user-teams`, `set-active-team`, `add-team-member`, `remove-team-member`, `list-team-members`) | `auth-openapi.ts:239,1122,828,661,733,949,52,870,627` | TaskDesk team routes (`data-model.md:113-114`) | `MISS` | **No TaskDesk equivalent exists, and no frontend caller was found** in the `apps/web/src` sweep — the entire team surface appears to be reachable only through the plugin's HTTP API. If that holds, teams can be dropped with the plugin and rebuilt when the feature is actually specified, rather than reimplemented now. I did not exhaustively verify that no UI reaches teams by raw fetch. |
| 24 | `session.activeOrganizationId` / `set-active` | write `auth.ts:713-733`; route `auth-openapi.ts:915`; client `workspace-switcher.tsx:59`, `onboarding-flow.tsx:81`, `create-workspace-modal.tsx:62`, `accept.$inviteId.tsx:62`; read `useActiveOrganization()` `use-active-workspace.ts:6-7`; column `schema.ts:61` | active workspace is a **client concern** or a TaskDesk-owned session field; authority never comes off the session (`auth-and-identity.md:352-367`) | `MIG` | Uniquely awkward: the *write* is already TaskDesk code (`auth.ts:717-721` reads `workspaceUserTable` directly) but the *read* is the plugin's client hook. The column was TaskDesk's `active_workspace_id` before the plugin renamed it (`apps/api/src/utils/migrate-session-column.ts:1-10`). Live sessions carry values in it — see §4. |
| 25 | `allowUserToCreateOrganization` (`DISABLE_WORKSPACE_CREATION`) | `auth.ts:346-354` | authorization check on the TaskDesk create route | `ROUTE` | Behaviour to preserve exactly, including the documented cookie-cache-staleness workaround at `auth.ts:337-345` (which is now moot — the rationale at `auth.ts:337-345` cites `session.cookieCache`, and that cache was disabled in this very branch at `auth.ts:496-503`, so the fresh DB read is belt-and-braces rather than load-bearing). |
| 26 | `workspace.created` domain event | `auth.ts:405-410` | emitted by the TaskDesk create service | `ROUTE` | Consumers live in `apps/api/src/plugins/registry.ts` (event subscriptions initialised at `:29`). If the plugin is removed without re-emitting, subscribers go quiet with no error. I did not enumerate the subscribers of `workspace.created`. |
| 27 | Workspace-name validation | `auth.ts:363-368` → `apps/api/src/utils/check-workspace-name.ts` | same validator on the TaskDesk create route | `IMPL` | Validator is TaskDesk code with its own unit test (`tests/api/utils/check-workspace-name.test.ts`). Only the call site moves. |
| 28 | Client-side types derived from plugin return types | `apps/web/src/types/workspace-user/index.ts:4,9,14,19`; `apps/web/src/types/workspace/index.ts:5` | types generated from the TaskDesk OpenAPI document | `CONTRACT` | These `Awaited<ReturnType<typeof authClient.organization.*>>` aliases are the client's whole public shape for members and invitations. They stop compiling the moment `organizationClient()` is dropped, and their replacement shape is a shared contract. |
| 29 | OpenAPI publication of the route family | `auth-openapi.ts:13` (1175 lines), registered `index.ts:376` | replaced by the TaskDesk routes' own registrations | `ROUTE` | Deleting `auth-openapi.ts` breaks `tests/api-integration/openapi.test.ts:71`. That test edit is mandatory and is the removal's tripwire. |
| 30 | HTTP behaviour coverage for all of the above | none | negative + positive suites per `docs/01-architecture/adr/0010-route-policy-registry.md:47-65` | `TEST` | See §1.12. No test in `tests/` calls any `/organization/*` route. Everything is seeded directly, so the suite will stay green through a removal that breaks the product. |
| 31 | Billing / seat coupling | none — `0047_drop_billing.sql` | none | `IMPL` | Confirmed clear (§1.13). One unused constant remains at `apps/api/src/scheduler/leader-lock.ts:7`. |

### 2.4 Where the docs and the code disagree (findings, not fixed here)

| # | Doc says | Code says | Evidence |
|---|---|---|---|
| D1 | The plugin has "hooks for create, delete and **seat sync**" | There is no delete hook and no seat-sync hook. Only `beforeCreateOrganization` and `afterCreateOrganization` are configured, and all billing/seat code was removed in `0047_drop_billing.sql`. | `docs/01-architecture/auth-and-identity.md:80-81` vs `apps/api/src/auth.ts:362-411` |
| D2 | Plugin is at `auth.ts:315` | Plugin mount is at `auth.ts:269`; line 315 is inside the `invitation` schema mapping. | `docs/01-architecture/inherited-features.md:183` vs `apps/api/src/auth.ts:269` |
| D3 | "TaskDesk's `invitation`, `workspace_role` and team tables replace it" | Those tables are *the plugin's own storage today* — they are not a separate replacement. Removal is a rewrite of the writers, not a table swap. | `docs/01-architecture/inherited-features.md:183` vs `apps/api/src/auth.ts:292-328` |
| D4 | Roles carry `rank`, `key`, `is_system`, `is_editable`, `version`, `capabilities jsonb`; guardrails include rank comparison and a last-administrator check | `workspace_role` has `role` (text name), `permission` (JSON **text**), timestamps. No rank, no system flag, no version, no guardrails anywhere in code. | `docs/01-architecture/rbac.md:137-175` vs `apps/api/src/database/schema.ts:238-262` |
| D5 | Capability vocabulary lives in `packages/permissions/src/capabilities.ts`, with a CI test asserting doc/code agreement | That file does not exist. `packages/permissions/src/` contains only `index.ts` and `index.test.ts`, and the vocabulary is better-auth `statement` shape (`project`/`task`/`label`/`workspace`), not the `workspace:manage_settings`-style capability strings the doc lists. | `docs/01-architecture/rbac.md:29,118` vs `packages/permissions/src/index.ts:9-15` |
| D6 | Invitation redemption is bound to the invited email; the account completing sign-up **must verify that address**; only a SHA-256 token hash is stored | `requireEmailVerificationOnInvitation: false` with an explicit rationale, and the invitation **row id is the bearer secret** in the emailed link. | `docs/01-architecture/auth-and-identity.md:360-363` vs `apps/api/src/auth.ts:355-361` and `apps/api/src/auth.ts:414` |
| D7 | The directory is `organisation` / `person` / `membership` / `role`; identity resolves via `resolveIdentity(session.userId)` | None of `organisation`, `person`, `membership` exist in the schema, and there is no `resolveIdentity`. Sweep of `apps/api/src`, `apps/web/src`, `packages` for `organisation` returns **zero** hits. | `docs/01-architecture/data-model.md:106-115`, `auth-and-identity.md:352-357` vs `apps/api/src/database/schema.ts` |
| D8 | Every route declares a policy; CI enforces coverage | No route-policy registry exists (`routePolicy` / `RoutePolicy` sweep of `apps/api/src` and `packages` finds only a comment at `apps/api/src/index.ts:517` deferring it to #7). | `docs/01-architecture/adr/0010-route-policy-registry.md:31-53` vs `apps/api/src` |
| D9 | Workspace and organisation are distinct: `project.organisation_id` names the **customer** organisation; workspace is "an organisational container, not a security boundary" | Only `workspace` exists; it *is* the tenancy boundary today (every reach check is `workspace_member`). | `docs/01-architecture/multi-tenancy.md:17-21` vs `apps/api/src/utils/validate-workspace-access.ts:45-49` |

**Consequence for sequencing:** the documented target (`organisation` + `person` + scoped `membership`) is a *later* phase than this removal. Removing `organization()` in P0 lands on the **existing** `workspace` / `workspace_member` / `workspace_role` / `invitation` tables with TaskDesk-owned writers. Trying to land the target data model in the same change would force the `person` table, the organisation/workspace split and the capability vocabulary — all three of which are outside #6.

---

## 3. The smallest merge-safe implementation plan

**Shape of the plan:** every step before S10 is **additive**. The plugin stays mounted and serving throughout; new TaskDesk routes are added alongside it, the client is moved over one concern at a time, and only the final step unmounts anything. That keeps every intermediate commit independently revertible and keeps `main` shippable.

**Migrations:** the next free number is **0050**, migrations are centrally coordinated, and **this analysis creates none**. Only S8b and S6b would need one, and both are explicitly deferred out of P0 below — so the recommended path through this plan consumes **zero migration numbers**.

| Step | What changes | Preconditions | Verification | Migration? |
|---|---|---|---|---|
| **S0 — dead-code sweep** | Delete `apps/api/src/utils/migrate-organizations.ts` (41 lines, no importers). Delete the unused `SEAT_RECONCILIATION_LEASE` export (`apps/api/src/scheduler/leader-lock.ts:7`). | none | Typecheck + full suite green; grep for both symbols returns nothing. | No |
| **S1 — characterization tests** | Add HTTP-level integration tests that drive the **current** plugin routes and assert on **database state**, not on plugin response shapes: create → 1 `workspace` + 1 `workspace_member(role=owner)` + 3 `workspace_role` rows + `workspace.created` published; invite → `invitation` row with `status=pending`; accept → `workspace_member` row; role create/update/delete → `workspace_role` rows; `has-permission` for owner/admin/member/viewer/custom. | Integration harness boots `createApp` (it already does — `tests/api-integration/*`). | New tests green against the plugin **today**. They are the equivalence oracle for S4–S7: the same assertions must pass afterwards. | No |
| **S2 — native read routes (additive)** | Add `GET /api/workspace` (caller's workspaces), `GET /api/workspace/{id}` (workspace + members + pending invitations), `GET /api/workspace/{id}/invitations`, `GET /api/capabilities` (one call replacing the 16-way `hasPermission` fan-out; implemented over `hasWorkspacePermission`, `apps/api/src/utils/require-workspace-permission.ts:87`). `GET /api/workspace/{id}/members` already exists (`apps/api/src/workspace/index.ts:13-31`). | S1. | New route tests; `tests/api-integration/openapi.test.ts` still green (it only asserts presence, not absence). Compare `/api/capabilities` output against `has-permission` for the same fixtures. | No |
| **S3 — client reads move off the plugin** | Repoint `get-workspaces`, `use-get-full-workspace`, `use-get-workspace-users`, `use-active-workspace-user`, `use-get-workspace-invites`, `use-workspace-permission` at the S2 routes. Replace `useListOrganizations` / `useActiveOrganization` with TanStack queries. **Redefine `apps/web/src/types/workspace-user/index.ts:4,9,14,19` and `apps/web/src/types/workspace/index.ts:5` against the TaskDesk response shapes** instead of `Awaited<ReturnType<typeof authClient.organization.*>>`. | S2 merged. | `apps/web/src/hooks/use-workspace-permission.test.tsx` rewritten and green; manual pass over workspace switcher, members table, roles UI. | No |
| **S4 — native workspace writes** | `POST /api/workspace`, `PATCH /api/workspace/{id}`, `DELETE /api/workspace/{id}`. Move over, unchanged: `checkWorkspaceName` (`auth.ts:363-368`), the `DEFAULT_ROLE_NAMES` seed (`auth.ts:376-403`) — **without** the `catch` that swallows failures, `publishEvent("workspace.created")` (`auth.ts:405-410`), and the `DISABLE_WORKSPACE_CREATION` instance-admin gate (`auth.ts:346-354`). Generate + dedupe `slug` (NOT NULL UNIQUE, `schema.ts:146`) and write `description` (`schema.ts:149`). | S1. Client still on plugin writes — this step ships dark. | S1 assertions re-pointed at the new routes and passing identically. Duplicate-slug returns 409, not a 500. | No |
| **S5 — native membership writes** | `POST /api/workspace/{id}/members`, `DELETE /api/workspace/{id}/members/{userId}`, `PATCH .../role`, `POST /api/workspace/{id}/leave`. Re-express the plugin's "last owner cannot leave" rule server-side — today the client fakes it with a promote/demote pair (`apps/web/src/hooks/mutations/workspace/use-transfer-workspace-ownership.ts:29,38`), which should collapse into one atomic transfer endpoint. | S4. | S1 assertions re-pointed; new negative tests: last owner cannot leave, cannot self-demote, cannot remove a member of another workspace. | No |
| **S6a — native invitation writes** | `POST /api/workspace/{id}/invitations` (create + send), `POST /api/invitation/{id}/accept`, `.../reject`, `DELETE /api/invitation/{id}`. **In the same commit**, move the two path-keyed guards off better-auth: the rate-limit rule (`auth.ts:520`) and the cloud anonymous/disposable-email gate (`auth.ts:626-651`) onto the new route's middleware. Keep the existing link format (`auth.ts:414`) and `status` vocabulary (`pending`/`accepted`/`canceled`, `check-registration-allowed.ts:67,158-159`) byte-identical. | S5. | S1 assertions re-pointed. A test that the invite rate limit still fires, and one that a disposable-email invite is still rejected on cloud — neither exists today. Existing `tests/api-integration/registration-invitation.test.ts` must stay green untouched. | No |
| **S6b — hashed invitation tokens** *(defer out of P0)* | Move to CSPRNG token + SHA-256 hash per `docs/01-architecture/auth-and-identity.md:358-363`. | S6a; an explicit decision to invalidate outstanding links. | — | **Yes** — adds `invitation.token_hash`. Do not bundle with S6a. |
| **S7 — native role writes** | `POST/PATCH/DELETE /api/workspace/{id}/roles` over `workspace_role`. Persistence and the existing permission gate only. The `rbac.md:159-175` guardrails (cannot grant what you do not hold, rank comparison, last-administrator check) depend on `rank` / `is_system` / capability vocabulary that do not exist — **leave them to #7** and record the gap. | S4 (seeding path settled). | S1 role assertions re-pointed; a test that editing `admin` in workspace A does not affect workspace B. | No |
| **S8a — active workspace** | Replace the four `organization.setActive` calls (`workspace-switcher.tsx:59`, `onboarding-flow.tsx:81`, `create-workspace-modal.tsx:62`, `accept.$inviteId.tsx:62`). Recommended: keep writing the existing `session.active_organization_id` column via a small `POST /api/workspace/{id}/activate`, and keep the sign-in backfill at `auth.ts:713-733` exactly as it is. | S3. | Switching workspace survives a reload; a pre-existing session keeps its workspace. | No |
| **S8b — rename the column back** *(defer out of P0)* | `active_organization_id → active_workspace_id`, reversing `apps/api/src/utils/migrate-session-column.ts`. | S8a and the plugin fully unmounted. | — | **Yes**. Also lets `migrate-session-column.ts` be deleted. Not worth a migration number during P0. |
| **S9 — teams decision** | Confirm nothing in `apps/web/src` reaches teams (the sweep found no caller), then drop `teams: { enabled: true, ... }` (`auth.ts:287-291`) and the nine team routes. **Keep the `team` / `team_member` tables** — dropping them is a migration and the target model still wants them (`data-model.md:113-114`). | An explicit confirmation that no client or integration reaches teams. | Suite green; a grep-based assertion that no `/organization/*team*` route is referenced. | No |
| **S10 — unmount (the tripwire commit)** | Remove `organization()` (`auth.ts:269-445`) and its imports (`auth.ts:27,28`). Remove the six plugin-only adapter entries (`auth.ts:165-170`) and the aliases (`schema.ts:895-900`). Remove `organizationClient()` (`apps/web/src/lib/auth-client.ts:11,35-49`). Delete `apps/api/src/auth-openapi.ts` (1175 lines) and its registration (`index.ts:15,376`). Update `tests/api-integration/openapi.test.ts:71` to expect `POST /workspace` instead of `POST /auth/organization/create`. | S3–S9 all merged; nothing references `authClient.organization` or `/organization/*`. | Full suite; a grep gate asserting zero occurrences of `authClient.organization` in `apps/web/src` and zero `/organization/` in `apps/api/src`. | No |
| **S11 — cut the last better-auth AC dependency** | `packages/permissions/src/index.ts:1-7` still imports `createAccessControl`, `defaultStatements`, `memberAc`, `adminAc`, `ownerAc` from `better-auth/plugins/organization/access`. | — | — | **#7 / Lane B — do NOT do this here.** Removing `organization()` from `auth.ts` does not remove this import; the package keeps compiling and working. |

### 3.1 Shared-contract changes — owned by #7 / Lane B, not to be invented here

Anything in this list must be *requested* of #7, not authored in this lane:

1. **`packages/permissions` capability vocabulary** — the move from better-auth `statement` shape (`packages/permissions/src/index.ts:9-15`) to the `capabilities.ts` capability strings named in `docs/01-architecture/rbac.md:29,118` (which does not exist yet — finding D5).
2. **The better-auth AC import in `packages/permissions`** — `packages/permissions/src/index.ts:1-7`. Both `apps/api/src/auth.ts:7-12` and `apps/web/src/lib/permissions.ts:1-10` consume this package; changing its exports is a two-app breaking change.
3. **Route-policy types** — the registry from `docs/01-architecture/adr/0010-route-policy-registry.md:31-53`, explicitly deferred to #7 at `apps/api/src/index.ts:517`. Every route S2/S4–S7 adds will eventually need a policy declaration; **declare nothing now**, or the shape will have to be rewritten.
4. **Identity / context types** — `resolveIdentity()` returning `{ userId, side, organisationId, memberships, reach, authority }` (`docs/01-architecture/auth-and-identity.md:352-357`). New routes should keep using the existing Hono context vars (`c.get("userId")`, `c.get("workspaceId")`, `c.get("apiKey")` — `apps/api/src/utils/require-workspace-permission.ts:91-107`), not anticipate this shape.
5. **`organisation` / `workspace` / `project` base schema** — the `organisation` + `person` split (`docs/01-architecture/data-model.md:106-115`) and the reshaping of `workspace_member` into scoped `membership`. **This retrofit must land on the existing tables.**

### 3.2 What this plan deliberately does not do

- No `organisation` or `person` table, no scoped `membership` — that is the later phase (finding D7).
- No `rank` / `is_system` / `is_editable` / `version` on `workspace_role` (finding D4) — #7.
- No hashed invitation tokens (finding D6) — S6b, deferred, needs a migration and a link-invalidation decision.
- No soft-delete columns on `workspace` (`deleted_at` / `purge_after`, `data-model.md:109`) — needs a migration; S8 of some later phase.
- No dropping of `team` / `team_member` tables.

---

## 4. Risks — where this breaks silently

Ordered by how quietly it fails.

### R1 — The two path-keyed guards die without an error (highest silent-failure risk)
`apps/api/src/auth.ts:520` (`"/organization/invite-member": { window: 60, max: 5 }`) and `apps/api/src/auth.ts:630` (`if (ctx.path === "/organization/invite-member" && isCloud())`) match a **literal string**. Unmount the plugin, or move invitations to a new path, and both silently become no-ops: no exception, no type error, no failing test. The comment at `auth.ts:626-629` records why they exist — "the 2026-05-28 incident saw ~14k phishing invites sent from throwaway disposable-email signups". There is currently **no test** covering either guard, so the suite will not notice. Mitigation: S6a moves both in the same commit and adds the missing tests first (S1).

### R2 — Sessions already carrying `activeOrganizationId`
`session.active_organization_id` (`apps/api/src/database/schema.ts:61`) is populated **only** on sign-in/sign-up (`apps/api/src/auth.ts:713-733`). An existing session never re-acquires it. If the client's `useActiveOrganization()` (`apps/web/src/hooks/queries/workspace/use-active-workspace.ts:6-7`) is removed without an equivalent server read, every already-signed-in user lands with no active workspace and no error — the UI simply renders empty. `use-active-workspace.ts:19-23` falls back to the route param, so users deep-linked into a workspace URL will look fine while users landing on the dashboard root will not — an easy bug to miss in manual testing. Mitigation: S8a keeps the column and the backfill; do not rename it (S8b) until after S10.

### R3 — Invitation links already in inboxes
The emailed link is `${TASKDESK_AGENT_URL}/invitation/accept/${data.id}` (`apps/api/src/auth.ts:414`) — **the invitation row id is the bearer secret**, and both the public lookup (`apps/api/src/index.ts:215-219` → `check-registration-allowed.ts:133-146`) and the accept page (`apps/web/src/routes/invitation/accept.$inviteId.tsx:53`) key on it. Two distinct failure modes:
- If the **accept endpoint** changes but the link format is preserved, outstanding links keep working (`accept.$inviteId.tsx` just calls a different mutation). This is the safe path and is what S6a does.
- If S6b's hashed tokens land, **every outstanding invitation dies** — the existing rows have no `token_hash` to compare against, and expiry is up to 7 days out. That must be an announced decision with a re-send path, not a side effect.
Also note `requireEmailVerificationOnInvitation: false` (`auth.ts:361`): today an unverified account can accept. The docs require the opposite (`auth-and-identity.md:360-363`, finding D6). Flipping that during the retrofit would lock out real invitees on an instance that does not verify email at all.

### R4 — Role resolution changes meaning during the cutover
There are **two different evaluators** running right now with different fallbacks:
- Server: `require-workspace-permission.ts:127-131` — DB row from `workspace_role` wins, falls back to `builtInRoles` (`viewer`/`member`/`admin`/`owner`), plus an **instance-admin bypass** at `:101-103`.
- Client: `authClient.organization.hasPermission` against a plugin registered with `roles: { owner }` only (`auth.ts:282`) and `dynamicAccessControl` (`auth.ts:283-286`), while the *client* plugin registers all four statically (`apps/web/src/lib/auth-client.ts:40-45`). No instance-admin bypass.
Consolidating the UI onto a server endpoint (S2's `/api/capabilities`) will therefore **change what the UI shows** — most visibly for instance admins, who will gain buttons they did not have. That is a correctness improvement, but it will read as a regression if not called out. Mitigation: S2 diffs the two evaluators over fixtures before S3 flips the client.

### R5 — Data already in `workspace_member`
`workspace_member.role` is free text with `default("member")` and **no FK** to `workspace_role` (`apps/api/src/database/schema.ts:169`). Consequences:
- A row whose `role` is neither in `workspace_role` for that workspace nor in `builtInRoles` resolves to `false` for everything (`require-workspace-permission.ts:127-131`) — a hard 403 with no diagnostic.
- `owner` is deliberately excluded from `DEFAULT_ROLE_NAMES` (`packages/permissions/src/index.ts:56-60`), so **no workspace ever has an `owner` row in `workspace_role`**; owner authority comes entirely from the compiled-in `builtInRoles.owner`. Any replacement that assumes "role name ⇒ `workspace_role` row" locks every owner out of their own workspace.
- Any later reshaping into scoped `membership` must reconcile both tables at once.

### R6 — A workspace created without its role seed
`afterCreateOrganization` seeds `workspace_role` inside a `try/catch` that **logs and continues** (`apps/api/src/auth.ts:397-403`). Today that hole is papered over by the boot-time backfill (`seed-default-workspace-roles.ts:19`, called at `index.ts:738`) — which only runs at process start. So a workspace can exist for hours where `viewer`/`member`/`admin` have no rows and every non-owner gets 403. S4 should make the seed part of the create **transaction** rather than copying the swallow-and-continue.

### R7 — `workspace.created` subscribers go quiet
`publishEvent("workspace.created", ...)` (`apps/api/src/auth.ts:405-410`) is emitted only from the plugin hook. Subscriptions are wired in `apps/api/src/plugins/registry.ts:29`. A native create route that forgets the publish breaks every subscriber with no error anywhere. **I did not enumerate which subscribers listen for `workspace.created`** — that should be checked before S4.

### R8 — Columns that only the plugin writes
- `workspace.description` exists solely because of the `additionalFields` declaration at `auth.ts:295-302`. A replacement update route that omits it makes the field silently read-only.
- `workspace.slug` is NOT NULL UNIQUE (`schema.ts:146`) and is generated by the plugin. A native create that does not generate/dedupe it produces either a NOT NULL violation or an unhandled unique-violation 500 instead of a 409.
- `workspace` has **no `updatedAt`** (`schema.ts:141-151`) — an update route cannot record when it changed without a migration.

### R9 — Vocabulary drift on `invitation.status`
`check-registration-allowed.ts:67,158-159` compares against the American spellings `"pending"` / `"accepted"` / `"canceled"`. A replacement writing `"cancelled"` (or a `state` column per `data-model.md:115`) silently re-opens invite-only registration for cancelled invitations. This is a one-character bug with an authorization consequence.

### R10 — New routes are reachable by API key; plugin routes were not
`enableSessionForAPIKeys: false` (`apps/api/src/auth.ts:476`, rationale `:471-475`) means an API key never became a session, so `/organization/*` was effectively session-only. Every route added in S2/S4–S7 mounts **below** the global guard at `apps/api/src/index.ts:513`, which authenticates API keys too. Workspace creation, member removal and role editing would become API-key-reachable for the first time. `hasWorkspacePermission` does intersect API-key permissions (`require-workspace-permission.ts:94-99`), so this is contained rather than open — but the *policy* decision ("which routes are `sessionOnly`") belongs to #7's route-policy registry (`apps/api/src/index.ts:517`). Flag it; do not decide it here.

### R11 — `team_member` has no workspace scope
`team_member` carries only `team_id` + `user_id` (`apps/api/src/database/schema.ts:194-211`); the workspace is reachable only through `team.workspace_id`. If teams are ever reimplemented natively, every authorization check must join through `team` — a direct `team_member` lookup is a cross-workspace leak. Not a risk of the removal itself, but a trap laid for whoever rebuilds teams.

### R12 — The test suite will stay green through a breaking removal
Restated because it underwrites every other risk: `tests/` contains exactly **one** reference to the plugin (`tests/api-integration/openapi.test.ts:71`), and every fixture seeds tables directly (`tests/api-integration/helpers/fixtures.ts:30-45`). Removing `organization()` therefore produces **one** failing assertion while breaking workspace creation, invitations, member management and the roles UI. S1 exists specifically to close this gap, and no step after S1 should merge without it.
