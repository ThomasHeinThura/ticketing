# TaskDesk v2 — `organization()` Plugin Retrofit Matrix

**Scope:** read-only dependency inventory + current-state → target matrix for removing better-auth's `organization()` plugin.
**Source of truth read:** `/home/ubuntu/.taskdesk-lanes/lane-a-6` (branch `feat/p0-remove-inherited-surfaces`).
**Status of the decision:** settled — `organization()` IS removed in P0. This document maps the retrofit; it does not re-argue it.
**Constraint:** #7 (`packages/permissions`, separate lane) replaces **policy + evaluation only** — never persistence, workspace/membership lifecycle, invitations, teams, plugin hooks, or route surface.

**⚠ Read this before acting on any "#7's" attribution below.** This document attributes a
dozen shared-contract items to **#7** — the capability vocabulary, `rank`/`is_system`/
`is_editable`/`version` on `workspace_role`, the route-policy registry, `resolveIdentity`,
the `/api/capabilities` response vocabulary, the `better-auth` access-control import (S11),
and the "which routes are `sessionOnly`" decision. **#7 is CLOSED.** So every one of those
attributions now points at a closed issue. **Every sentence below that still reads "is #7's"
or "belongs to #7" in the present tense is pointing back to this note — read it as "was
#7's, and is currently unowned" wherever it appears**, rather than as a live assignment.

This is stated once, here, rather than annotated at each of the twelve sites in full, because
correcting them one at a time is exactly how this document has already contradicted itself
three times: a row gets fixed and the sentence beside it is left stale. Each site below now
carries a short pointer back to this paragraph instead — that is the fix, not a rewrite of
each sentence. **Do not fold any of them into #6 to make the ledger tidy, and do not author
them in this lane.** Eleven of the twelve need an owner assigned — either #7 reopened with a
stated reason, or a new tracking issue — and that assignment is a decision for Thomas, not a
renaming an agent may do.

**Update, 2026-09-09 — S11 is the one exception.** Thomas has assigned it a dedicated work
item (see the S11 row and §3's S11 entry): *"S11 — remove legacy Better Auth access-control
shim and dependency from `packages/permissions`"*, dependency **S10 → S11**. S11 is no longer
part of the unowned eleven above — do not re-fold it into that set. **S11 stays outside
Throttle 1's conditions** unless Thomas changes that contract.

**STAGE LEDGER — the authoritative answer to "how far has the retrofit run?"** Throttle 1's
condition 2 is measured here, so this ledger is the thing to read, not the prose below it.
As of 2026-09-09, `main` at `a9abf9a`:

| Stage | State | Landed via | Evidence |
|---|---|---|---|
| **S0** — dead-code sweep | ✅ **COMPLETE** | PR #65, squash `b735bee4471488926fd37a771bb8682210895001` | `apps/api/src/utils/migrate-organizations.ts` absent from `main`; `SEAT_RECONCILIATION_LEASE` occurs 0 times in `apps/api/src/scheduler/leader-lock.ts` |
| **S1** — characterization tests | ✅ **COMPLETE** | PR #57, squash `b4aef999238d8848563860449432db588207c2d4` (reviewed head `95dc9280b9011f2d5615be1381d0993360a26368`) | 24 tests / 4 files, green against a real PostgreSQL 18. The equivalence oracle for S4–S7 |
| **S2** — native read routes | ✅ **COMPLETE** | PR #65, squash `b735bee4471488926fd37a771bb8682210895001` (reviewed head `24d8236316a9cc309ad8b3d4ccf3ee8ee9da00e5`) | `tests/api-contract/openapi.json` on `main` declares `GET /workspace`, `GET /workspace/{workspaceId}`, `GET /workspace/{workspaceId}/invitations`, `GET /capabilities`, `GET /workspace/{workspaceId}/members` |
| **S3** — client reads move off the plugin | 🔄 **IN FLIGHT** | — | Reads repointed at the S2 routes. Check GitHub for the current branch/PR and its state — this row does not track it. **Its S5 precondition is now SATISFIED** — S5 landed via PR #77. The constraint was: after S3 no client read returns the `workspace_member` row id that the two still-on-plugin mutations (`updateMemberRole`, the promote/demote transfer) require, so both were force-disabled on that branch. S5's userId-keyed routes are on `main`, so S3 must now repoint those two mutations at them and re-enable the controls, and delete S4b's `refresh-workspace-stores` shim and its test |
| **S4** — native workspace writes | ✅ **COMPLETE** | PR #67, squash `2388b0c7f4ae25d6084067bcff20a98528d8b400` (reviewed head `073e75f067846807b538150457f2db8280b12804`) | Baseline declares `POST /workspace`, `PATCH /workspace/{workspaceId}`, `DELETE /workspace/{workspaceId}`. Ships **dark** — the client is still on plugin writes (see **S4b**) |
| **S4b** — client workspace-write cutover | ✅ **COMPLETE** | PR #85, squash `a9abf9a1f0f9447673b4635ae8911fc5cb5937af` | Repointed `authClient.organization.create` / `.update` / `.delete` — six client call sites (`apps/web/src/fetchers/workspace/{create,update,delete}-workspace.ts`, `apps/web/src/hooks/queries/workspace/use-create-workspace.ts`, `apps/web/src/hooks/mutations/workspace/use-{update,delete}-workspace.ts`) — onto the native S4 routes. S4 no longer ships dark. Out of security-review scope (all fourteen files are `apps/web`), so cleared by **seven** independent Sonnet reviews rather than an Opus one. Carries an interim shim, `apps/web/src/lib/utils/refresh-workspace-stores.ts`: the displayed workspace name comes from the plugin's own nanostores, whose `atomListeners` match on **plugin route paths**, so a native write notified nothing and the name went stale until reload. **The shim and its test are deleted by S3**, which repoints the reads off those stores. |
| **S5** — native membership writes | ✅ **COMPLETE** | PR #77, squash `2b569a8dffa1c3d71ee24eae65cbaf75de7fd891` (reviewed heads `58ed36683cb6632f42e3435de932c00ce30a1b0f`, `4629511c26119c41a152270162aafc4869c03139`) | Five routes plus an atomic ownership transfer. In security-review scope; cleared by independent Opus review after two CHANGES REQUIRED rounds. The decisive finding was reached by controlled comparison rather than by reading: for a comma-joined `"owner,admin"` value the first draft's native routes were **less safe than the better-auth routes they replaced**. Resolved by a deliberate asymmetry in `apps/api/src/utils/workspace-member-roles.ts` — `anyRoleIsOwner` is comma-aware so the guard is entered, while `distinctOwnerUserCount` stays exact so a sole comma-joined owner counts 0 and the last-owner guard refuses |
| **S6a** — native invitation writes | ❌ **NOT STARTED — UNBLOCKED, startable now** | — | S5 landed via PR #77, which was its only blocker. Four native invitation routes; in security-review scope. In the same commit, move the rate-limit rule and the cloud disposable-email gate off the plugin, and keep the invitation link format and `status` vocabulary byte-identical. **Closes #88's duplicate-membership path at source** |
| **S6b** — hashed invitation tokens | ⏸️ **DEFERRED out of P0** | — | Needs a migration and a link-invalidation decision |
| **S7** — native role writes | ⛔ **BLOCKED BY #82 ONLY** | — | **#66 is closed**, fixed by PR #80 (squash `8a85008`) and verified on `main`: a missing `workspace_role` row is now a DENY for every role but `owner`, whose authority is compiled-in by design (retrofit plan R5). The privilege-restoration fail-open on the very table S7 writes is therefore gone. **The sole remaining blocker is #82** — one membership = exactly one role, where multi-role values diverge between the two evaluators (see the decision log). Check GitHub for its state rather than trusting this row. |
| **S8a** — active workspace | ❌ **NOT STARTED** | — | Blocked on S3 |
| **S8b** — rename the column back | ⏸️ **DEFERRED out of P0** | — | Needs a migration |
| **S9** — teams decision | ❌ **NOT STARTED — precondition corrected, see below** | — | The ledger previously said this needs only *"confirmation that nothing reaches teams"*. That is necessary and **not sufficient**, and the real precondition is now a named stage — see **§ S9's real precondition** and **S4b** |
| **S10** — unmount (the tripwire commit) | ❌ **NOT STARTED** | — | S4b and S5 are merged; still needs S3, S6a, S7, S8a and S9. `tests/api-contract/openapi.json` still declares six `/auth/organization/*` invitation operations, which is exactly what S10 removes |
| **S11** — remove legacy Better Auth access-control shim and dependency from `packages/permissions` | ❌ **NOT STARTED — OWNED, separate work item** | — | `packages/permissions/src/index.ts` still imports `createAccessControl`, `defaultStatements`, `memberAc`, `adminAc`, `ownerAc` from `better-auth/plugins/organization/access`. Was **#7's**; #7 is **CLOSED**. Thomas has assigned it a dedicated work item: remove the transitional shim, remove the final `better-auth` dependency from `packages/permissions`, regenerate the lockfile, prove no consumers remain. **Dependency: S10 → S11** — S10 must unmount the plugin first. **Not this retrofit's**, and **stays outside Throttle 1's conditions** unless Thomas changes that contract |

### Progress, stated the way it is actually useful

**"Six of fifteen" is a misleading denominator** and should not be quoted on its own: it
counts two stages that are deferred out of P0 and one (S11) that has its own separate work
item, so it understates how close S10 is. State it in four buckets instead:

| Bucket | Stages | Count |
| --- | --- | --- |
| **Landed** | S0, S1, S2, S4, S4b, S5 | **6** |
| **Required to reach S10, outstanding** | S3, S6a, S7, S8a, S9, S10 | **6** |
| **Deferred outside P0** | S6b, S8b | 2 — do **not** count these against Throttle 1 |
| **Separately owned — now has a dedicated work item** | S11 | 1 — **not** this retrofit's; #7, its former owner, is closed, and Thomas has assigned it a new work item (dependency S10 → S11). See the S11 row. Never fold it into #6 to make the ledger tidy. **Stays outside Throttle 1** |

So the live figure is **6 landed of 12 required**, with **6 outstanding**, and S10 last
because everything else feeds it. (**S4b was new to this count** when it was added on
2026-09-09 — it was always required work, just not previously written down as its own row;
it has since landed. See the S4b row.)

**Issue #6 is therefore not complete and Throttle 1 cannot open** — condition 2 requires the
retrofit through S10. The other four conditions are met: #5 complete, #7 complete and
closed, route-policy coverage executing in CI, and an unclassified route demonstrated to
fail CI.

**What is startable right now, and what is not:**

- **S3** — in flight; check GitHub for the branch/PR and its state. **Its S5 precondition is
  satisfied** — S5 landed via PR #77 — so S3 must now repoint `updateMemberRole` and the
  promote/demote transfer at S5's userId-keyed routes, re-enable the two force-disabled
  controls, and delete S4b's `refresh-workspace-stores` shim and its test.
- **S4b** — ✅ **COMPLETE**, merged via PR #85.
- **S5** — ✅ **COMPLETE**, merged via PR #77.
- **S7** — ⛔ **BLOCKED BY #82 ONLY**. #66 is closed (PR #80), so the fail-open on
  `workspace_role` — the exact table S7 writes — is fixed and no longer blocks it. #82 remains:
  one membership = exactly one role, where multi-role values diverge between the two
  evaluators. Not a scheduling preference — authoring role writes first would build on a known
  privilege defect.
- **S6a** — **unblocked**, S5 has landed. **S8a** — needs S3. **S10** — needs all of the above.
- **S9** — see § S9's real precondition immediately below. Its analysis is **done**, and it
  changed the answer.

### S9's real precondition — corrected 2026-09-09, and demonstrated

The ledger asked for *"an explicit confirmation that nothing reaches teams."* That
confirmation holds: **0** callers in `apps/web/src` of any team route, `useListTeams`,
`useActiveTeam` or `authClient.organization.*Team*` (the `@/components/team/…` imports are a
UI directory name for workspace members, not the teams feature), and exactly **9**
team-shaped paths in `tests/api-contract/openapi.json`, matching this document's "nine team
routes".

**It is not sufficient, because `teams.enabled` is not only a route switch.** In
`better-auth/dist/plugins/organization/routes/crud-org.mjs:106`, organization-create reads:

```js
if (options?.teams?.enabled && options.teams.defaultTeam?.enabled !== false) {
```

and line 128 sets the created session's team from the team it makes. So dropping
`teams: { enabled: true }` (`apps/api/src/auth.ts:287-291`) removes **effects 5, 6 and 8** of
§2.5's nine-effect create contract — the default `team` row, the creator's `team_member`
row, and the session's `active_team_id`. **And S4 ships dark: the client still creates
workspaces through the plugin**, so that is a live-user regression, not a dark one.

**Demonstrated rather than argued.** Mutating `teams.enabled` to `false` and running the S1
characterization:

```
× create writes all NINE contract effects -- EIGHT first-order ... plus ONE one-hop durable
  FAIL tests/api-integration/organization-plugin-characterization.test.ts
       316|  expect(teamRows).toHaveLength(1);
  Tests  1 failed | 19 passed (20)
```

The S1 oracle catches it, so the regression is loud rather than silent — which is the job
that suite exists to do.

**The native path is unaffected**:
`apps/api/src/workspace/controllers/create-workspace.ts:152,165,181` inserts `teamTable`,
`teamMemberTable` and sets `activeTeamId` through Drizzle, independent of the plugin's
config; `delete-workspace.ts:28` clears both session columns.

**So S9's precondition is: the client must be off plugin workspace creation** — native
writes live — not merely that nothing calls a team route. **S9 gains a dependency edge from
S4b** (the client workspace-write cutover, see the S4b row) and is not startable in parallel
with it.

**S2 and S4 shipping does not narrow S10's work.** Both are additive: they added native
routes beside the plugin without unmounting anything. The plugin route surface `main`
exposes today is the same surface S10 must remove.

**The single most important correction this document has taken.** §3's S1 row originally listed **four** headline create side effects. Executed characterization measured **NINE**. §2.5 is now the authoritative statement of the inherited create contract, and **S4's equivalence obligation is NINE, not four.** Read §2.5 before planning S4.

_(Document written incrementally as each item was confirmed. All `file:line` references are relative to the lane-a-6 workspace root unless stated, except §2.5, which is stated against `main` at `b4aef99`.)_

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

`IMPL` already implemented in TaskDesk · `PART` partially implemented · `MISS` missing · `MIG` needs data migration · `ROUTE` needs route replacement · `TEST` needs behaviour test · `CONTRACT` needs shared-contract change (**was owned by #7 / Lane B, now CLOSED — do not invent here.** Row 19's item is the one exception: it is **S11**, which now has its own owner — see the S11 row. Every other `CONTRACT` row is currently UNOWNED)

Exactly one mark per responsibility, per the brief; where a second consideration matters it is stated in the note rather than as a second mark.

### 2.3 The matrix

| # | Inherited responsibility | Current implementation | Target | Mark | Note |
|---|---|---|---|---|---|
| 1 | Adapter schema mapping `organization → workspace` | `auth.ts:293-303` + `auth.ts:165` + alias `schema.ts:895` | no mapping — `workspace` is a plain TaskDesk table | `IMPL` | The table already exists and is TaskDesk-shaped. Removal is pure deletion of the mapping; no DDL. |
| 2 | Adapter mapping `member → workspace_member` (`organizationId→workspaceId`, `createdAt→joinedAt`) | `auth.ts:304-310` + `auth.ts:166` + alias `schema.ts:898` | `membership` (`person_id`, `scope`, `scope_id`, `role_id`, `sees_all`) | `MIG` | Target is a *different shape*, not a rename: scoped membership + `person_id` + `role_id` FK. `workspace_member.role` is a text name; target is an FK to `role`. Migration must be authored with the `person` table, which does not exist yet — so this is **not** a P0-step-1b migration. |
| 3 | Adapter mapping `invitation` (`organizationId→workspaceId`) | `auth.ts:311-316` + `auth.ts:167` + alias `schema.ts:899` | `invitation` (`email`, `organisation_id`, `role_id`, `token_hash`, `expires_at`, `state`, `invited_by`) | `MIG` | Current table is workspace-scoped, stores `role` as text, `status` not `state`, and **the row id *is* the link secret** (`auth.ts:414`, `check-registration-allowed.ts:146`). Target stores only a hash. Live pending invitations cannot survive that change unchanged — see §4. |
| 4 | Adapter mapping `organizationRole → workspace_role` | `auth.ts:317-322` + `auth.ts:168` + alias `schema.ts:900` | `role` with `capabilities jsonb`, `rank`, `key`, `is_system`, `is_editable`, `version` (`rbac.md:137-152`) | `CONTRACT` | The row *shape* was #7's (now unowned — see the note at the top of this document): capability vocabulary, `capabilities.ts`, rank/implication semantics. TaskDesk's own reader (`require-workspace-permission.ts`) already reads the table without the plugin, so nothing about removal is blocked on this. |
| 5 | Adapter mapping `team` (`organizationId→workspaceId`) | `auth.ts:323-328` + `auth.ts:169` + alias `schema.ts:896` | `team` (`workspace_id`, `name`, `capacity_days_per_week`, `is_cab`) — `data-model.md:113` | `MISS` | No TaskDesk route, controller, service or test writes `team` today. The plugin is the **only** writer. Removing it leaves teams with no create/update/delete path at all. |
| 6 | `teamMember` model (not remapped) | `auth.ts:170` + alias `schema.ts:897`, table `schema.ts:194-211` | `team_member` (`team_id`, `person_id`, `allocation_pct`, `is_lead`) — `data-model.md:114` | `MISS` | Same as #5, plus the target keys on `person_id` and carries allocation fields the current table lacks. |
| 7 | Workspace **creation** | `POST /auth/organization/create` (`auth-openapi.ts:158`), name check `auth.ts:363-368`, role seed + `workspace.created` event `auth.ts:369-411`, gate `auth.ts:346-354` | TaskDesk route `POST /api/workspace` | `ROUTE` | The only workspace-create path in the product. `apps/api/src/workspace/index.ts` currently exposes **one** route (`GET /{workspaceId}/members`) — there is no create/update/delete. This is the largest single piece of work. **Its full behavioural obligation is §2.5's NINE effects, not the four this document originally listed.** |
| 8 | Workspace **deletion** | `POST /auth/organization/delete` (`auth-openapi.ts:290`) | TaskDesk route `DELETE /api/workspace/{id}` with soft delete (`deleted_at`, `purge_after` — `data-model.md:109`) | `ROUTE` | Today deletion relies on the DB `ON DELETE CASCADE` chains off `workspace.id`. Target adds a 30-day recovery window the current schema has no columns for; the *route* is the P0 obligation, the soft-delete columns are a later phase. |
| 9 | Workspace **update** (name / logo / metadata / description) | `POST /auth/organization/update` (`auth-openapi.ts:979`) | TaskDesk route `PATCH /api/workspace/{id}` | `ROUTE` | `description` only exists because it is declared as an `additionalFields` entry at `auth.ts:295-302`; removing the plugin removes the only writer of that column. |
| 10 | Workspace **lookup / list** (`list`, `get-full-organization`, `check-slug`) | `auth-openapi.ts:576`, `:393`, `:132` | TaskDesk routes `GET /api/workspace`, `GET /api/workspace/{id}` | `ROUTE` | `get-full-organization` is a compound read (workspace + members + invitations + teams) that `apps/web/src/hooks/queries/workspace/use-get-full-workspace.ts:19` depends on. Slug uniqueness is enforced in the DB already (`schema.ts:146`), so `check-slug` is trivially reimplementable. |
| 11 | Membership **creation** (via invite accept / create-owner) | plugin internals, reached from `accept-invitation` (`auth-openapi.ts:16`) and `create` (`:158`) | TaskDesk service writing `membership` | `ROUTE` | No TaskDesk code path inserts into `workspace_member` outside test fixtures (`tests/api-integration/helpers/fixtures.ts:40`). Verified by the `workspaceUserTable` sweep — every other reference is a **read**. |
| 12 | Membership **removal** / leave | `remove-member` (`auth-openapi.ts:784`), `leave` (`:549`) | TaskDesk routes | `ROUTE` | `leave` carries the plugin's "cannot leave as the only owner" rule, which the client works around with a two-call promote/demote dance (`apps/web/src/hooks/mutations/workspace/use-transfer-workspace-ownership.ts:15,29,38`). That rule must be re-expressed server-side, not lost. |
| 13 | Membership **lookup** (`list-members`, `get-active-member`, `get-active-member-role`) | `auth-openapi.ts:603`, `:357`, `:381` | `GET /api/workspace/{id}/members` — **already exists** | `PART` | `apps/api/src/workspace/index.ts:13-31` + `apps/api/src/workspace/controllers/get-workspace-members.ts` already serve the member list natively. Missing: "the current caller's own membership/role". The client derives it by fetching the **whole** member list and filtering client-side (`apps/web/src/hooks/queries/workspace-users/use-active-workspace-user.ts:14-25`), and that value is the role the entire permission model keys on (`apps/web/src/hooks/use-workspace-permission.ts:48,50`). `getActiveMember` itself is referenced only as a *type* (`apps/web/src/types/workspace-user/index.ts:9`). |
| 14 | Role **resolution** for authorization (server) | `require-workspace-permission.ts:87-132` — reads `workspace_member.role` then `workspace_role.permission`, no plugin involvement | `resolveIdentity()` + capability evaluation in `packages/permissions` (`auth-and-identity.md:352-367`) | `IMPL` | **Already plugin-free.** This is the single most important finding: removing `organization()` does *not* break server-side authorization. Its eventual replacement by `resolveIdentity` was #7's (now unowned — see the note at the top of this document), and is not a precondition for removal. |
| 15 | Role **resolution** for the UI (client) | `authClient.organization.hasPermission` fan-out over 16 capabilities — `apps/web/src/hooks/use-workspace-permission.ts:15-32,71,114` | a TaskDesk capability endpoint | `ROUTE` | The plugin's `has-permission` (`auth-openapi.ts:455`) is the **only live authorization consumer of the plugin**. A single `GET /api/capabilities` (named in `docs/01-architecture/rbac.md:347`) replaces 16 round-trips. Its *response vocabulary* was #7's contract (now unowned — see the note at the top of this document); the route is not. |
| 16 | `workspace_role` CRUD (the Roles UI) | `create-role` / `update-role` / `delete-role` / `list-roles` / `get-role` — `auth-openapi.ts:208,1078,319,615,443`; client at `apps/web/src/hooks/queries/workspace/use-workspace-roles.ts:37` and the three mutation hooks | `role` CRUD with rank guardrails (`rbac.md:159-175`) | `ROUTE` | Persistence already lands in TaskDesk's own `workspace_role` table and is already read natively. Only the **write** path is the plugin's. The guardrails in `rbac.md:159-175` (cannot grant what you do not hold; rank comparisons; last-administrator check) exist in **no** current code — verified absent from `require-workspace-permission.ts` and `seed-default-workspace-roles.ts`. |
| 17 | Default-role seeding on workspace create | `auth.ts:369-411` (hook) + boot backfill `seed-default-workspace-roles.ts:19` | seeded by TaskDesk's own workspace-create service | `PART` | The seeding *logic* is already TaskDesk code operating on TaskDesk tables; only its **trigger** is the plugin hook. Re-pointing it at a TaskDesk create service is a small, safe move. The boot backfill needs no change at all. |
| 18 | `dynamicAccessControl` (DB-backed roles resolved at check time) | `auth.ts:283-286` | capability evaluation in `packages/permissions` | `CONTRACT` | Only `has-permission` consumes it (client side). `require-workspace-permission.ts:127-131` already reimplements the same "DB row wins, static fallback" precedence natively. |
| 19 | `ac` / `statement` access-control object | `packages/permissions/src/index.ts:9-49`, cast in at `auth.ts:275` and `apps/web/src/lib/auth-client.ts:39` | `capabilities.ts` capability vocabulary (`rbac.md:29,118`) | `CONTRACT` | **Hard coupling to better-auth remains even after the plugin is gone**: `packages/permissions/src/index.ts:1-7` imports `createAccessControl`, `defaultStatements`, `memberAc`, `adminAc`, `ownerAc` from `better-auth/plugins/organization/access`. Removing the plugin from `auth.ts` does **not** remove this import. Cutting it is **S11** now (dependency S10 → S11; see the S11 row) — no longer #7's, and no longer unowned, since #7 closed. |
| 20 | Invitation **create + email** | `invite-member` (`auth-openapi.ts:495`), email at `auth.ts:413-444`, rate limit `auth.ts:520`, cloud abuse gate `auth.ts:630-651` | TaskDesk invite route + hashed token (`auth-and-identity.md:357-370`) | `ROUTE` | Two guards are keyed on the **plugin's route string** (`auth.ts:520`, `auth.ts:630`) and silently become dead the moment the path changes. Both must move to the replacement route in the *same* commit. |
| 21 | Invitation **accept / reject / cancel** | `auth-openapi.ts:16,748,106`; client `use-accept-invitation.ts:11`, `use-reject-invitation.ts:11`, `use-cancel-invitation.ts:13`, `routes/invitation/accept.$inviteId.tsx:53` | TaskDesk routes; acceptance creates the membership and consumes the invitation (`auth-and-identity.md:368-369`) | `ROUTE` | `requireEmailVerificationOnInvitation: false` (`auth.ts:361`) is a deliberate deviation whose rationale (`auth.ts:355-360`) must be carried into the replacement — and reconciled against `auth-and-identity.md:360-363`, which *requires* the accepting account to verify the invited address. **The docs and the code disagree here.** |
| 22 | Invitation **lookup** | `get-invitation` (`auth-openapi.ts:408`), `list-invitations` (`:591`), `list-user-invitations` (`:696`) | TaskDesk routes — **partly already exist** | `PART` | `GET /api/invitation/{id}` and `GET /api/invitation/pending` already exist natively (routes `apps/api/src/invitation/index.ts:10-38`, handlers `:40-50`, mounted at `apps/api/src/index.ts:555`; controllers `get-invitation-details.ts`, `get-user-pending-invitations.ts`; plus the unauthenticated `GET /invitation/public/:id` at `apps/api/src/index.ts:215-219`), backed by `check-registration-allowed.ts:85-98,133-146`. Missing: the per-workspace `list-invitations` the admin UI uses. |
| 23 | Teams routes (`create-team`, `update-team`, `remove-team`, `list-teams`, `list-user-teams`, `set-active-team`, `add-team-member`, `remove-team-member`, `list-team-members`) | `auth-openapi.ts:239,1122,828,661,733,949,52,870,627` | TaskDesk team routes (`data-model.md:113-114`) | `MISS` | **No TaskDesk equivalent exists, and no frontend caller was found** in the `apps/web/src` sweep — the entire team surface appears to be reachable only through the plugin's HTTP API. If that holds, teams can be dropped with the plugin and rebuilt when the feature is actually specified, rather than reimplemented now. I did not exhaustively verify that no UI reaches teams by raw fetch. |
| 24 | `session.activeOrganizationId` / `set-active` | write `auth.ts:713-733`; route `auth-openapi.ts:915`; client `workspace-switcher.tsx:59`, `onboarding-flow.tsx:81`, `create-workspace-modal.tsx:62`, `accept.$inviteId.tsx:62`; read `useActiveOrganization()` `use-active-workspace.ts:6-7`; column `schema.ts:61` | active workspace is a **client concern** or a TaskDesk-owned session field; authority never comes off the session (`auth-and-identity.md:352-367`) | `MIG` | Uniquely awkward: the *write* is already TaskDesk code (`auth.ts:717-721` reads `workspaceUserTable` directly) but the *read* is the plugin's client hook. The column was TaskDesk's `active_workspace_id` before the plugin renamed it (`apps/api/src/utils/migrate-session-column.ts:1-10`). Live sessions carry values in it — see §4. |
| 25 | `allowUserToCreateOrganization` (`DISABLE_WORKSPACE_CREATION`) | `auth.ts:346-354` | authorization check on the TaskDesk create route | `ROUTE` | Behaviour to preserve exactly, including the documented cookie-cache-staleness workaround at `auth.ts:337-345` (which is now moot — the rationale at `auth.ts:337-345` cites `session.cookieCache`, and that cache was disabled in this very branch at `auth.ts:496-503`, so the fresh DB read is belt-and-braces rather than load-bearing). |
| 26 | `workspace.created` domain event | `auth.ts:405-410` | emitted by the TaskDesk create service | `ROUTE` | Consumers live in `apps/api/src/plugins/registry.ts` (event subscriptions initialised at `:29`). If the plugin is removed without re-emitting, subscribers go quiet with no error. **Now enumerated (this cell previously said it was not):** exactly one subscriber persists anything — `notification/index.ts:167` → the `workspace_created` notification row, which is **effect 9** of §2.5. The payload contract is `workspaceId` / `workspaceName` / `ownerId`. |
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
| D8 | Every route declares a policy; CI enforces coverage | No route-policy registry exists (`routePolicy` / `RoutePolicy` sweep of `apps/api/src` and `packages` finds only a comment at `apps/api/src/index.ts:517` deferring it to #7, now closed and unowned — see the note at the top of this document). | `docs/01-architecture/adr/0010-route-policy-registry.md:31-53` vs `apps/api/src` |
| D9 | Workspace and organisation are distinct: `project.organisation_id` names the **customer** organisation; workspace is "an organisational container, not a security boundary" | Only `workspace` exists; it *is* the tenancy boundary today (every reach check is `workspace_member`). | `docs/01-architecture/multi-tenancy.md:17-21` vs `apps/api/src/utils/validate-workspace-access.ts:45-49` |

**Consequence for sequencing:** the documented target (`organisation` + `person` + scoped `membership`) is a *later* phase than this removal. Removing `organization()` in P0 lands on the **existing** `workspace` / `workspace_member` / `workspace_role` / `invitation` tables with TaskDesk-owned writers. Trying to land the target data model in the same change would force the `person` table, the organisation/workspace split and the capability vocabulary — all three of which are outside #6.

---

## 2.5 The inherited create contract, closed at NINE — S1 outcome, authoritative

**This section supersedes the four-effect create description that §3's S1 row originally carried.** It is the equivalence contract S4–S7 must reproduce, and it is stated here rather than only in the test file so that a planner reading the plan cannot miss it.

One **default** `POST /auth/organization/create` call has **NINE observable contract effects**: **EIGHT first-order create effects plus ONE one-hop durable event consequence.**

The count was revised four times before it closed, and the shape of the error is worth keeping: **this plan said four; S1 first measured six; the review at `9a1eb4e` found a seventh; the review at `f3ce193` found an eighth; the whole-database enumeration that review prompted found the ninth.** Every round read one step further down the same call stack. It is now derived by **two independent methods** — reading the whole create path, and diffing every row count across all 29 public tables around one successful create — and the second method is what found effect 9, because effect 9 is not in the create stack at all.

### First-order effects (1–8)

| # | Effect | Note |
|---|---|---|
| 1 | one `workspace` row | |
| 2 | one owner `workspace_member` row | `role = owner` |
| 3 | three seeded `workspace_role` rows | `viewer`, `member`, `admin` — **no seeded `owner` row.** Owner authority is compiled in; see R5 |
| 4 | one `workspace.created` event | payload contract below |
| 5 | one default `team` row | named after the workspace |
| 6 | one creator `team_member` row | |
| 7 | the **creating session's** `active_organization_id`: `null → workspace.id` | same session row, column mutation — not a new row |
| 8 | the **creating session's** `active_team_id`: `null → team.id` | same session row, column mutation — not a new row |

Effects 5 and 6 exist because `teams.enabled: true` with `teams.defaultTeam` left unset (`auth.ts:287-291`) satisfies better-auth's `teams.enabled && defaultTeam?.enabled !== false` — `undefined !== false` is true.

**Effect 4 — the exact payload contract.** `publishEvent("workspace.created", …)` at `auth.ts:405`. The contract at the event-bus boundary is:

```
workspaceId
workspaceName
ownerId
```

These three fields are the contract **because effect 9 is produced from exactly them**. The inherited call also passes an `ownerEmail` field, which the S1 oracle does **not** assert and which no consumer reads; it is not part of the contract, and S4 should not treat it as one.

**Effects 7 and 8 were each unasserted until a review found them** (F11, then F12). An S4 handler omitting either would leave a user who has just created their first workspace with no active workspace, or no active team, **and no error** — while the whole suite stayed green.

### One-hop durable consequence (9)

`workspace.created` **eventually** causes exactly **one** persisted `notification` row:

```
type          = workspace_created
userId        = creator
resourceId    = workspace.id
resourceType  = workspace
eventData.workspaceName = workspace name
```

Chain: `auth.ts:405` `publishEvent` → `events/index.ts:35` `EventEmitter` dispatch → `notification/index.ts:167` subscriber → `notification/controllers/create-notification.ts:48` `db.insert(notificationTable)`.

It is **unconditional** on this baseline: `auth.ts:405` always passes `ownerId`, satisfying the subscriber's `if (data.ownerId)` guard, and `createNotification` maps only `task_*` / `due_date_*` types to a preference key — `workspace_created` maps to `null`, so there is no preference lookup and no early return.

### Timing is NOT contractual

**Effect 9 is EVENTUALLY CONSISTENT.**

The current inherited implementation often persists the notification **before** the HTTP response returns, but only because further awaited database work — `setActiveOrganization` and `setActiveTeam`, i.e. effects 7 and 8 — happens *after* `workspace.created` is published. **That ordering is INCIDENTAL.** `publishEvent` uses `EventEmitter` dispatch and does not await the async subscriber's promise, so a native S4 handler may legitimately do less work after publishing.

**Synchronous pre-response notification persistence is NOT contractual.** The S1 oracle therefore asserts effect 9 through a **bounded poll** on this create's exact notification identity, and must not be read as requiring immediate visibility. An S4 implementation that persists the row a moment later is conformant; one that never persists it is not.

### Where the contract stops — exclusions and the stopping rule

Recording "nine" alone is not enough, because the enumeration was reopened four separate times before it closed. These are **excluded**, each for a stated reason, so S4 does not restart the debate:

| Excluded | Reason |
|---|---|
| `session.updated_at` | generic Drizzle `$onUpdate` consequence of updating the session row at all (`schema.ts:53-55`) — not a separate organization-create decision |
| `notification.created` | downstream notification-subsystem consequence **of** effect 9 (`create-notification.ts:63`) |
| `deliverNotification(...)` | downstream delivery behaviour (`create-notification.ts:66`) |
| email / webhook / push delivery | downstream notification subsystem |
| `secondaryStorage` session mirror | unreachable — no `secondaryStorage` is configured |
| unconfigured member / team organization hooks | unreachable — only `beforeCreateOrganization` and `afterCreateOrganization` are configured |
| session `databaseHooks` | no applicable configured hook — `auth.ts:523` declares only `user` hooks |
| reads on the create path | not persistence effects |
| rate-limit database rows | absent — no `storage` is configured, so the limiter is in-memory |

**The stopping rule is: 8 first-order effects + 1 asserted one-hop durable consequence.** No downstream notification internals are part of the organization-create equivalence contract.

**Unclassified create-path writes or events: 0**, at both row and column granularity.

### Scope of the ruling

`N=9` is **the frozen inherited S1 baseline.** It is **not** a standing rule that every future event listener automatically becomes part of the organization-create contract. **Every future listener or consequence requires its own explicit contract decision.**

### Session selection is preserved through S4–S7

- `active_organization_id` create-time selection is **preserved through S4–S7**.
- `active_team_id` create-time selection is **preserved through S4–S7**.

If **S9** later removes or redesigns team semantics, that is an **explicit S9 divergence**. It must **not** disappear silently during S4.

The characterized request is the **default** create request. `keepCurrentActiveOrganization=true` gates effects 7 and 8 (and only those two — 1–6 and 9 are ungated) and remains **outside** this S1 default-path oracle.

### The executable source ledger — where implementers look next

This section is the prose contract. **The executable ledger is:**

> **`tests/api-integration/organization-plugin-characterization.test.ts`**

Its oracle header and the comment block immediately above the create test carry, in one place:

- the **8 + 1 taxonomy** and why the count is derived rather than asserted
- the **installed-source path ledger** — the exact `better-auth` `crud-org.mjs` / `adapter.mjs` / `internal-adapter.mjs` call chain behind each of effects 1–8, and the full chain behind effect 9
- the **timing caveat** (effect 9 is eventual; the pre-response ordering is incidental)
- the **exclusions** and the stopping rule
- the **same-session** assertions for effects 7 and 8 — captured as a row *before* the call and re-read by that captured id afterwards, so "some session", "a fresh login", "a second session" and "the response says so" are all excluded by construction
- the **whole-database enumeration method** (29-table before/after row-count diff) that found effect 9

**Deliberately not duplicated here:** the per-line `crud-org.mjs:NNN` / `adapter.mjs:NNN` addresses. Those are pinned to an installed dependency version and go stale on upgrade; the file-level pointer stays true. Read the ledger in the test file, not a copy of it.

### Evidence

The independent instrument that closed the S1 gate is **PR #57 review [`pullrequestreview-5141105391`](https://github.com/ThomasHeinThura/ticketing/pull/57#pullrequestreview-5141105391)** against reviewed head `95dc928`, verdict **CLEAR FOR THOMAS MERGE DECISION**. See the decision log entry *"2026-09-08 · Organization create baseline closes at N=9"* for the ruling itself, including the `N=9 → N=8 → N=9` history and the fact that the temporary `N=8` ruling was **never implemented**.

---

## 3. The smallest merge-safe implementation plan

**Shape of the plan:** every step before S10 is **additive**. The plugin stays mounted and serving throughout; new TaskDesk routes are added alongside it, the client is moved over one concern at a time, and only the final step unmounts anything. That keeps every intermediate commit independently revertible and keeps `main` shippable.

**Migrations:** the next free number is **0050**, migrations are centrally coordinated, and **this analysis creates none**. Only S8b and S6b would need one, and both are explicitly deferred out of P0 below — so the recommended path through this plan consumes **zero migration numbers**.

| Step | What changes | Preconditions | Verification | Migration? |
|---|---|---|---|---|
| **S0 — dead-code sweep** — ✅ **COMPLETE, merged via PR #65** | Delete `apps/api/src/utils/migrate-organizations.ts` (41 lines, no importers). Delete the unused `SEAT_RECONCILIATION_LEASE` export (`apps/api/src/scheduler/leader-lock.ts:7`). | none | Typecheck + full suite green; grep for both symbols returns nothing. | No |
| **S1 — characterization tests** — ✅ **COMPLETE, merged via PR #57** | HTTP-level integration tests that drive the **current** plugin routes and assert on **database state**, not on plugin response shapes. **create → all NINE contract effects of §2.5** (8 first-order + 1 one-hop durable, the last asserted as *eventual* via a bounded poll); invite → `invitation` row with `status=pending`; accept → `workspace_member` row; role create/update/delete → `workspace_role` rows, with the pre-defined-guard and assigned-role guards distinguished by error code; `has-permission` for owner/admin/member/viewer/custom, plus negative cases for an unknown role and for `viewer` with its row deleted. Also pins the two path-keyed guards of R1 and the R2 session behaviour. | Integration harness boots `createApp` (it already does — `tests/api-integration/*`). | **Done:** 24 passed / 4 files / 0 failed / 0 skipped against a real PostgreSQL 18, migrated from scratch. They are the equivalence oracle for S4–S7: the same assertions must pass afterwards. ⚠️ **This row originally listed FOUR create effects. It was wrong — the contract is NINE. See §2.5.** | No |
| **S2 — native read routes (additive)** — ✅ **COMPLETE, merged via PR #65** | Add `GET /api/workspace` (caller's workspaces), `GET /api/workspace/{id}` (workspace + members + pending invitations), `GET /api/workspace/{id}/invitations`, `GET /api/capabilities` (one call replacing the 16-way `hasPermission` fan-out; implemented over `hasWorkspacePermission`, `apps/api/src/utils/require-workspace-permission.ts:87`). `GET /api/workspace/{id}/members` already exists (`apps/api/src/workspace/index.ts:13-31`). | S1. | New route tests; `tests/api-integration/openapi.test.ts` still green (it only asserts presence, not absence). Compare `/api/capabilities` output against `has-permission` for the same fixtures. | No |
| **S3 — client reads move off the plugin** | Repoint `get-workspaces`, `use-get-full-workspace`, `use-get-workspace-users`, `use-active-workspace-user`, `use-get-workspace-invites`, `use-workspace-permission` at the S2 routes. Replace `useListOrganizations` / `useActiveOrganization` with TanStack queries. **Redefine `apps/web/src/types/workspace-user/index.ts:4,9,14,19` and `apps/web/src/types/workspace/index.ts:5` against the TaskDesk response shapes** instead of `Awaited<ReturnType<typeof authClient.organization.*>>`. | S2 merged. | `apps/web/src/hooks/use-workspace-permission.test.tsx` rewritten and green; manual pass over workspace switcher, members table, roles UI. | No |
| **S4 — native workspace writes** — ✅ **COMPLETE, merged via PR #67** | `POST /api/workspace`, `PATCH /api/workspace/{id}`, `DELETE /api/workspace/{id}`. Move over, unchanged: `checkWorkspaceName` (`auth.ts:363-368`), the `DEFAULT_ROLE_NAMES` seed (`auth.ts:376-403`) — **without** the `catch` that swallows failures, `publishEvent("workspace.created")` (`auth.ts:405-410`), and the `DISABLE_WORKSPACE_CREATION` instance-admin gate (`auth.ts:346-354`). Generate + dedupe `slug` (NOT NULL UNIQUE, `schema.ts:146`) and write `description` (`schema.ts:149`). **Must also reproduce effects 5–9 of §2.5**, which the plugin performs and which no code in this step inherits for free: the default `team` row, the creator `team_member` row, the creating session's `active_organization_id` and `active_team_id`, and the `workspace.created` payload shape that effect 9's notification is built from. | S1 — **satisfied, merged.** Client still on plugin writes — this step ships dark (see **S4b**). | **Equivalence obligation is NINE, not four** (§2.5). S1 assertions re-pointed at the new routes and passing identically — **all nine effects**, with effect 9 asserted as *eventual*, never as synchronous pre-response persistence. Duplicate-slug returns 409, not a 500. | No |
| **S4b — client workspace-write cutover** — ✅ **COMPLETE, merged via PR #85** | Repoint `authClient.organization.create` / `.update` / `.delete` onto the native S4 routes at the six client call sites: `apps/web/src/fetchers/workspace/create-workspace.ts:32`, `apps/web/src/hooks/queries/workspace/use-create-workspace.ts:39`, `apps/web/src/fetchers/workspace/update-workspace.ts:20`, `apps/web/src/hooks/mutations/workspace/use-update-workspace.ts:55`, `apps/web/src/fetchers/workspace/delete-workspace.ts:8`, `apps/web/src/hooks/mutations/workspace/use-delete-workspace.ts:11`. Not S5/S6a/S7/S8a's job — none of their scopes cover workspace CRUD. | S4 — satisfied, merged. | Manual pass over create/update/delete workspace flows; a grep gate that `authClient.organization.{create,update,delete}` has zero remaining callers in `apps/web/src`. | No |
| **S5 — native membership writes** — ✅ **COMPLETE, merged via PR #77** | `POST /api/workspace/{id}/members`, `DELETE /api/workspace/{id}/members/{userId}`, `PATCH .../role`, `POST /api/workspace/{id}/leave`. Re-express the plugin's "last owner cannot leave" rule server-side — today the client fakes it with a promote/demote pair (`apps/web/src/hooks/mutations/workspace/use-transfer-workspace-ownership.ts:29,38`), which should collapse into one atomic transfer endpoint. | S4. | S1 assertions re-pointed; new negative tests: last owner cannot leave, cannot self-demote, cannot remove a member of another workspace. | No |
| **S6a — native invitation writes** | `POST /api/workspace/{id}/invitations` (create + send), `POST /api/invitation/{id}/accept`, `.../reject`, `DELETE /api/invitation/{id}`. **In the same commit**, move the two path-keyed guards off better-auth: the rate-limit rule (`auth.ts:520`) and the cloud anonymous/disposable-email gate (`auth.ts:626-651`) onto the new route's middleware. Keep the existing link format (`auth.ts:414`) and `status` vocabulary (`pending`/`accepted`/`canceled`, `check-registration-allowed.ts:67,158-159`) byte-identical. | S5. | S1 assertions re-pointed. A test that the invite rate limit still fires, and one that a disposable-email invite is still rejected on cloud — neither exists today. Existing `tests/api-integration/registration-invitation.test.ts` must stay green untouched. | No |
| **S6b — hashed invitation tokens** *(defer out of P0)* | Move to CSPRNG token + SHA-256 hash per `docs/01-architecture/auth-and-identity.md:358-363`. | S6a; an explicit decision to invalidate outstanding links. | — | **Yes** — adds `invitation.token_hash`. Do not bundle with S6a. |
| **S7 — native role writes** | `POST/PATCH/DELETE /api/workspace/{id}/roles` over `workspace_role`. Persistence and the existing permission gate only. The `rbac.md:159-175` guardrails (cannot grant what you do not hold, rank comparison, last-administrator check) depend on `rank` / `is_system` / capability vocabulary that do not exist — **do not implement them here; they are currently unowned (#7 is closed — see the note at the top of this document)** and record the gap. Also blocked by #66 and #82 — see the main stage table. | S4 (seeding path settled). | S1 role assertions re-pointed; a test that editing `admin` in workspace A does not affect workspace B. | No |
| **S8a — active workspace** | Replace the four `organization.setActive` calls (`workspace-switcher.tsx:59`, `onboarding-flow.tsx:81`, `create-workspace-modal.tsx:62`, `accept.$inviteId.tsx:62`). Recommended: keep writing the existing `session.active_organization_id` column via a small `POST /api/workspace/{id}/activate`, and keep the sign-in backfill at `auth.ts:713-733` exactly as it is. | S3. | Switching workspace survives a reload; a pre-existing session keeps its workspace. | No |
| **S8b — rename the column back** *(defer out of P0)* | `active_organization_id → active_workspace_id`, reversing `apps/api/src/utils/migrate-session-column.ts`. | S8a and the plugin fully unmounted. | — | **Yes**. Also lets `migrate-session-column.ts` be deleted. Not worth a migration number during P0. |
| **S9 — teams decision** | Confirm nothing in `apps/web/src` reaches teams (the sweep found no caller), then drop `teams: { enabled: true, ... }` (`auth.ts:287-291`) and the nine team routes. **Keep the `team` / `team_member` tables** — dropping them is a migration and the target model still wants them (`data-model.md:113-114`). | **S4b merged** (the client must be off plugin workspace creation — see § S9's real precondition) and an explicit confirmation that no client or integration reaches teams. | Suite green; a grep-based assertion that no `/organization/*team*` route is referenced. | No |
| **S10 — unmount (the tripwire commit)** | Remove `organization()` (`auth.ts:269-445`) and its imports (`auth.ts:27,28`). Remove the six plugin-only adapter entries (`auth.ts:165-170`) and the aliases (`schema.ts:895-900`). Remove `organizationClient()` (`apps/web/src/lib/auth-client.ts:11,35-49`). Delete `apps/api/src/auth-openapi.ts` (1175 lines) and its registration (`index.ts:15,376`). Update `tests/api-integration/openapi.test.ts:71` to expect `POST /workspace` instead of `POST /auth/organization/create`. | S3, S4b and S5–S9 all merged; nothing references `authClient.organization` or `/organization/*`. | Full suite; a grep gate asserting zero occurrences of `authClient.organization` in `apps/web/src` and zero `/organization/` in `apps/api/src`. | No |
| **S11 — remove legacy Better Auth access-control shim and dependency from `packages/permissions`** *(separate work item, NOT this retrofit's)* | `packages/permissions/src/index.ts:1-7` still imports `createAccessControl`, `defaultStatements`, `memberAc`, `adminAc`, `ownerAc` from `better-auth/plugins/organization/access`. Remove the transitional shim, remove the final `better-auth` dependency from `packages/permissions`, regenerate the lockfile, prove no consumers remain. #7, its former owner, is **CLOSED**; Thomas has assigned this a dedicated tracking item rather than reopening #7. **Stays outside Throttle 1's conditions** unless Thomas changes that contract. | **S10** (the plugin must be unmounted before proving no consumers remain). Dependency: **S10 → S11**. | A grep/lockfile check that `better-auth` no longer appears as a `packages/permissions` dependency, and that nothing still imports from `better-auth/plugins/organization/access`. | Possibly — regenerating the lockfile, no schema migration. |

### 3.1 Shared-contract changes — NOT this retrofit's, and #7 (their former owner) is closed

Anything in this list must be **requested of whoever owns it, and right now nobody does** —
these were #7's, and **#7 is closed**. Do not author them in this lane, and do not fold them
into #6 to make the ledger tidy. They need an owner assigned before anyone acts on them:

1. **`packages/permissions` capability vocabulary** — the move from better-auth `statement` shape (`packages/permissions/src/index.ts:9-15`) to the `capabilities.ts` capability strings named in `docs/01-architecture/rbac.md:29,118` (which does not exist yet — finding D5).
2. ~~The better-auth AC import in `packages/permissions`~~ — **this is now S11, and S11 has an owner** (dependency S10 → S11; see the S11 row in the table above). Listed here only for history; do not treat it as one of the unowned items in this section. `packages/permissions/src/index.ts:1-7`. Both `apps/api/src/auth.ts:7-12` and `apps/web/src/lib/permissions.ts:1-10` consume this package; changing its exports is a two-app breaking change.
3. **Route-policy types** — the registry from `docs/01-architecture/adr/0010-route-policy-registry.md:31-53`, explicitly deferred to #7 (now closed and unowned — see the note at the top of this document) at `apps/api/src/index.ts:517`. Every route S2/S4–S7 adds will eventually need a policy declaration; **declare nothing now**, or the shape will have to be rewritten.
4. **Identity / context types** — `resolveIdentity()` returning `{ userId, side, organisationId, memberships, reach, authority }` (`docs/01-architecture/auth-and-identity.md:352-357`). New routes should keep using the existing Hono context vars (`c.get("userId")`, `c.get("workspaceId")`, `c.get("apiKey")` — `apps/api/src/utils/require-workspace-permission.ts:91-107`), not anticipate this shape.
5. **`organisation` / `workspace` / `project` base schema** — the `organisation` + `person` split (`docs/01-architecture/data-model.md:106-115`) and the reshaping of `workspace_member` into scoped `membership`. **This retrofit must land on the existing tables.**

### 3.2 What this plan deliberately does not do

- No `organisation` or `person` table, no scoped `membership` — that is the later phase (finding D7).
- No `rank` / `is_system` / `is_editable` / `version` on `workspace_role` (finding D4) — was #7's, now unowned (see the note at the top of this document).
- No hashed invitation tokens (finding D6) — S6b, deferred, needs a migration and a link-invalidation decision.
- No soft-delete columns on `workspace` (`deleted_at` / `purge_after`, `data-model.md:109`) — needs a migration; S8 of some later phase.
- No dropping of `team` / `team_member` tables.

---

## 4. Risks — where this breaks silently

Ordered by how quietly it fails.

### R1 — The two path-keyed guards die without an error (highest silent-failure risk)
`apps/api/src/auth.ts:520` (`"/organization/invite-member": { window: 60, max: 5 }`) and `apps/api/src/auth.ts:630` (`if (ctx.path === "/organization/invite-member" && isCloud())`) match a **literal string**. Unmount the plugin, or move invitations to a new path, and both silently become no-ops: no exception, no type error, no failing test. The comment at `auth.ts:626-629` records why they exist — "the 2026-05-28 incident saw ~14k phishing invites sent from throwaway disposable-email signups". There is currently **no test** covering either guard, so the suite will not notice. Mitigation: S6a moves both in the same commit and adds the missing tests first (S1).

### R2 — Sessions already carrying `activeOrganizationId`
**Corrected by executed characterization — this entry originally said "only on sign-in/sign-up", and that was wrong.** There are **three** distinct behaviours, and conflating them is what hid effects 7 and 8 for two review rounds:

1. **Create selects for the creating session.** `POST /organization/create` sets `active_organization_id` **and** `active_team_id` on the session that made the call (§2.5, effects 7 and 8).
2. **A later membership insert does not retroactively backfill an existing session** — this is the risk R2 actually names, and it is unchanged.
3. **A fresh sign-in can select an available workspace** (`apps/api/src/auth.ts:713-733`).

The risk below concerns behaviour 2 only. `session.active_organization_id` (`apps/api/src/database/schema.ts:61`) is not re-acquired by an existing session when a membership is added later. If the client's `useActiveOrganization()` (`apps/web/src/hooks/queries/workspace/use-active-workspace.ts:6-7`) is removed without an equivalent server read, every already-signed-in user lands with no active workspace and no error — the UI simply renders empty. `use-active-workspace.ts:19-23` falls back to the route param, so users deep-linked into a workspace URL will look fine while users landing on the dashboard root will not — an easy bug to miss in manual testing. Mitigation: S8a keeps the column and the backfill; do not rename it (S8b) until after S10.

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
`publishEvent("workspace.created", ...)` (`apps/api/src/auth.ts:405-410`) is emitted only from the plugin hook. Subscriptions are wired in `apps/api/src/plugins/registry.ts:29`. A native create route that forgets the publish breaks every subscriber with no error anywhere.

**RESOLVED by S1 — the enumeration this entry asked for has been done.** The original text said "I did not enumerate which subscribers listen for `workspace.created` — that should be checked before S4." It has been, by whole-database row-count diff rather than by reading subscriptions, which is what made it trustworthy: **exactly one subscriber persists anything** — `notification/index.ts:167`, which writes the `workspace_created` notification row that is **effect 9** of §2.5. That row is now a contract obligation on S4 in its own right, not merely a subscriber that might go quiet, and it is asserted as *eventual* rather than synchronous. The risk this entry describes is therefore no longer a silent one: an S4 route that forgets the publish fails the S1 oracle.

### R8 — Columns that only the plugin writes
- `workspace.description` exists solely because of the `additionalFields` declaration at `auth.ts:295-302`. A replacement update route that omits it makes the field silently read-only.
- `workspace.slug` is NOT NULL UNIQUE (`schema.ts:146`) and is generated by the plugin. A native create that does not generate/dedupe it produces either a NOT NULL violation or an unhandled unique-violation 500 instead of a 409.
- `workspace` has **no `updatedAt`** (`schema.ts:141-151`) — an update route cannot record when it changed without a migration.

### R9 — Vocabulary drift on `invitation.status`
`check-registration-allowed.ts:67,158-159` compares against the American spellings `"pending"` / `"accepted"` / `"canceled"`. A replacement writing `"cancelled"` (or a `state` column per `data-model.md:115`) silently re-opens invite-only registration for cancelled invitations. This is a one-character bug with an authorization consequence.

### R10 — New routes are reachable by API key; plugin routes were not
`enableSessionForAPIKeys: false` (`apps/api/src/auth.ts:476`, rationale `:471-475`) means an API key never became a session, so `/organization/*` was effectively session-only. Every route added in S2/S4–S7 mounts **below** the global guard at `apps/api/src/index.ts:513`, which authenticates API keys too. Workspace creation, member removal and role editing would become API-key-reachable for the first time. `hasWorkspacePermission` does intersect API-key permissions (`require-workspace-permission.ts:94-99`), so this is contained rather than open — but the *policy* decision ("which routes are `sessionOnly`") belongs to the route-policy registry that was #7's (now closed and unowned — see the note at the top of this document) (`apps/api/src/index.ts:517`). Flag it; do not decide it here.

### R11 — `team_member` has no workspace scope
`team_member` carries only `team_id` + `user_id` (`apps/api/src/database/schema.ts:194-211`); the workspace is reachable only through `team.workspace_id`. If teams are ever reimplemented natively, every authorization check must join through `team` — a direct `team_member` lookup is a cross-workspace leak. Not a risk of the removal itself, but a trap laid for whoever rebuilds teams.

### R12 — The test suite will stay green through a breaking removal
Restated because it underwrites every other risk: `tests/` contains exactly **one** reference to the plugin (`tests/api-integration/openapi.test.ts:71`), and every fixture seeds tables directly (`tests/api-integration/helpers/fixtures.ts:30-45`). Removing `organization()` therefore produces **one** failing assertion while breaking workspace creation, invitations, member management and the roles UI. S1 exists specifically to close this gap, and no step after S1 should merge without it.
