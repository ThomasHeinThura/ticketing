# PR #733 security review record: workspace owners and admins hold an explicit sees_all grant

PR #733 implements Thomas's 2026-10-14 decision, which is recorded in the decision log. Workspace owner and admin memberships carry an explicit `sees_all` grant on that workspace (rbac.md reach step 2).

**How the grant is held.** It is a direct `membership_grant` with `direct_origin = 'system_backfill'` on a per-workspace carrier role that has no capabilities. One sync function keeps it in step with the legacy workspace role at workspace creation, add, invite accept, role change, ownership transfer, remove, leave and account deletion.

**Audit.** A grant writes `membership.sees_all_granted` and a revoke writes `membership.changed`. Both are written in the same transaction, with a system actor.

**Backfill.** The data-only, idempotent migration `0123` backfills existing owners and admins. A failure-isolated boot reconcile covers people created later.

**Locking.** Ownership transfer locks the person rows in id order.

**Scope.** Managers, members and customers are unchanged.

A Claude Sonnet 5.5 lane implemented the change over five rounds. The reviewers below are fresh, independent contexts. Follow-ups are tracked in #737.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `541f988d`, with 6 mutants surviving. Delta APPROVE at `a7a4af27`, where all of them are killed, the audit and lock changes are verified, and the merge with #732 is checked. Delta APPROVE at `b151fbda`, covering boot isolation and wiring.
- Ordinary review B by Claude Sonnet 5.5 (design, migration at 90k rows, merge with #732, combined with #730): APPROVE at `d3121745`. Delta APPROVE at `a7a4af27`. The full serialized integration suite passed 2586 tests.
- Security review by Claude Opus 5.5: CLEAR at `b151fbda`. It found no over-grant or under-revoke, the carrier role stays inert, migration `0123` is idempotent and stays within each workspace, the audit is atomic, and the lock order is consistent. All 9 mutations were caught.

**Reviewed head:** `b151fbda6dce61d3fd0e8a7ef65942c79ba86bf9`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `733-ordinary-a-sonnet.md` | Ordinary review A (8ea3ce27..541f988d) | Claude Sonnet 5.5 | `541f988d` | APPROVE | `6c6bb738575a78f79d57baf5ae6e343a75734e51f5aba963badce1771ec182c8` |
| 2 | `733-ordinary-b-sonnet.md` | Ordinary review B (82aecead..d3121745) | Claude Sonnet 5.5 | `d3121745` | APPROVE | `3c491fff46702716be31a129de1095bda4921d6a184bf49ff3ff0f7cca5045eb` |
| 3 | `733-a7a4-ordinary-delta-a-sonnet.md` | Ordinary delta review A (541f988d..a7a4af27) | Claude Sonnet 5.5 | `a7a4af27` | APPROVE | `c2ec7989d7e23fd430cd0e6eb905c588a2bc3c7341ff8c8d646d9648b89659e3` |
| 4 | `733-a7a4-ordinary-delta-b-sonnet.md` | Ordinary delta review B (d3121745..a7a4af27) | Claude Sonnet 5.5 | `a7a4af27` | APPROVE | `d9634d4830e90bd8cf8c00561e63e98575e43f0d95bf7a730d8b1764ce46e9e0` |
| 5 | `733-b151-ordinary-delta-a-sonnet.md` | Ordinary delta review A (a7a4af27..b151fbda) | Claude Sonnet 5.5 | `b151fbda` | APPROVE | `e5eb3036a31952be4b64d6c984368b073900bf0afa56f97dba3c499607ae3674` |
| 6 | `733-security-opus.md` | Security review (82aecead..b151fbda) | Claude Opus 5.5 | `b151fbda` | CLEAR | `4f7baed64b5d83443dd0bbd458d8415eb96dd5e128676bb21727f1c6e87d849d` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/733-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 6c6bb738575a78f79d57baf5ae6e343a75734e51f5aba963badce1771ec182c8) -->
# PR #733 ordinary review A (Claude Sonnet 5.5)

**Reviewed head:** 541f988dfd70a389ae58570c4c2e5a5a587a676d
**Base:** main 8ea3ce272ce25bf50d599e9e1615d1ce288ede07 (origin/main still at this SHA when reviewed)
**Model:** Claude Sonnet 5.5, fresh context. I did not author, direct or remediate the change.
**Worktree:** detached at the exact head under /Users/heinthura/.codex/wt-733-review. Removed after the review. The main checkout was untouched. Postgres came from Testcontainers (private containers, self-removed by ryuk).

## Verdict

**APPROVE, with non-blocking findings.** No blocking defect found. The decision is implemented faithfully, every writer I could find is wired, the migration is safe and idempotent, and the carrier role cannot confer authority. Non-blocking findings are mostly test gaps, one boot-time reconciliation gap, and a semantic conflict with #732 that the second PR to merge must resolve.

## Commands run (all serialized; exit codes preserved)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | exit 0 |
| New tests: `vitest run --config vitest.integration.config.ts` on `workspace-owner-admin-reach.test.ts` + `workspace-owner-admin-sees-all-migration.test.ts` | exit 0; 2 files, 14 tests passed (13 + 1) |
| `pnpm test:permissions --force` | exit 0; 15 files, 95 tests passed; 5/5 tasks (forced, not cached) |
| `pnpm check:route-policy` | exit 0 (turbo: 3 of 5 tasks cached; cached replay, not forced) |
| `pnpm lint:ci` | exit 0; 2273 files, 209 warnings, 1 info, no errors |
| `pnpm typecheck` | exit 0; 9/9 tasks (4 cached) |
| Workspace/member/identity integration set (43 files: `workspace-*` (excluding the two new files), `account-deletion`, `membership-*`, `multi-role-membership-remediation`, `registration-invitation`, `resolve-identity`, `resolve-request-identity`, `project*`, `project-reach-guard`, `work-item-project-reach*`, `identity-connection-admin`, `scim-admin`, `p1-identity-schema-seed`, `portal-identity-boundary`) | exit 0; 44 files, 535 tests passed |
| `tests/api-integration/identity/` directory | exit 0; 5 files, 49 tests passed |
| `drizzle-kit check` | exit 0, "Everything's fine" |
| Trial merge with #732 (head fetched), conflicts resolved by keeping both calls, then `tsc` + `workspace-owner-admin-reach` + `workspace-delete-role-dependents` + `account-deletion` | tsc clean; 28 passed, **3 failed** (all in #732's `workspace-delete-role-dependents.test.ts`, see F3). Merge aborted; nothing kept. |

I did not run the full integration suite. The implementer's notes report 193 files / 2562 tests with 4 timeouts that passed on re-run. I did not re-verify that.

## 1. Decision fidelity

- **Exactly owner and admin.** `REACH_ROLE_KEYS = ["owner","admin"]`. Admin additionally requires the genuine `is_system` `workspace_role` row. Managers, members, viewers and customers get nothing. Runtime probes confirmed this.
  - A lookalike admin (`workspace_role.admin` with `is_system=false`) gets no grant and a 404.
  - A customer-side person promoted to admin gets no grant.
  - Duplicate legacy rows fail closed.
  - The migration applies the same rules in SQL (single legacy row, genuine admin, staff person).
- **Writers.** I grepped every insert, update and delete on `workspaceUserTable` / `workspace_member` and on `workspaceRoleTable` across `apps`, `packages` and `scripts`. Every runtime writer of `workspace_member` calls the sync:
  - create-workspace, add-workspace-member, accept-invitation, update-workspace-member-role;
  - transfer-workspace-ownership (new owner and previous owner), remove-workspace-member, leave-workspace;
  - delete-account-data (the leave-loop sync, and `removeWorkspaceAdminReach` for workspaces deleted).
  - delete-workspace calls `removeWorkspaceAdminReach`.
- **Writers not wired (all judged non-blocking):**
  - `utils/migrate-workspace-user-email.ts` does a legacy deletion of orphan `workspace_member` rows with NULL `user_id`. It is called from `index.ts`, but those rows have no person anyway.
  - `utils/seed-default-workspace-roles.ts` heals `workspace_role.is_system` and seeds missing default roles on every boot, with no re-sync (F2).
  - `ensureStaffPersonForUser` / `seedInternalOrganisationAndStaffPersons` create staff persons without a sync (F2).
  - `workspace_role` update/create/delete controllers do not change who is owner/admin. Delete is blocked while members reference the role. No change to reach is needed.
  - `apps/web/e2e/*.spec.ts` inserts a `member` row directly, which is a test-only path.
- **Revocation scope.** It only ever touches `direct_origin='system_backfill'` grants. An admin-made direct grant is untouched in both directions. External SCIM/OIDC/JIT grants are never deleted. `projectMembershipKeys` re-projects them with `sees_all=false`, and the implementer's JIT test confirms this.
  - Probe P2 confirmed an admin-made grant is not rewritten, and a promoted admin holding an admin-made `sees_all=false` grant gets no reach. That is a documented gap; no production path creates admin-origin direct grants today.

## 2. Migration safety

- `0123_workspace_owner_admin_sees_all.sql` is append-only. The diff is one new SQL file, a journal entry (idx 123, `when` 1791945587607 greater than 0122's 1791744014813) and a snapshot that differs from 0122 only in `id`/`prevId` (chain intact). Accepted migrations are unchanged. `drizzle-kit check` is clean.
- It is data-only and idempotent. Every insert is guarded by NOT EXISTS or ON CONFLICT, and the upsert and relinks re-apply the same values. The shipped test runs 0122 → 0123 → 0123 and asserts the second run is a no-op. I ran it (passes) and mutated the guards (M16, M17 below; both caught).
- **Existing-data safety.**
  - Owners with no `person` row are skipped by the inner join, with no failure.
  - Duplicate `workspace_member` rows are skipped.
  - A pre-existing non-system `role` row keyed `owner`/`admin` in a workspace is skipped, and the grant join requires `is_system`. Fail closed.
  - A pre-existing active direct grant (admin-made) is never replaced.
  - External grants are kept and unlinked from the effective row exactly as the projection would.
- `system_backfill` is exactly what `data-model.md` reserves for the system. The doc wording was updated from "migration-only" to "system-written (migration 0123 and the writer)".
- Residual: the backfill is a point-in-time snapshot (F2).

## 3. Carrier role

- **Empty capabilities.** `capabilities = []` and `isSystem=true`, `isEditable=false`, rank 100/80. The probe read back exactly `owner`/`admin`, both empty. `resolve-identity` adds an authority entry with empty capabilities for the carrier, which adds nothing. Authority still comes from the legacy `workspace_member.role` plus the compiled-in `BUILT_IN_ROLES`.
- **Role management and mapping.** No API in this repo creates, edits, lists or deletes rows in the generic `role` table. The only listing is the SCIM mapping options.
  - `validateIdpMappingRole`, the OIDC JIT default role path and the SCIM mapping path all reject `role.key` of `admin` or `owner`. Probe P6 confirmed the validator returns false for both carrier rows. SCIM/OIDC/JIT cannot target carriers, so no external grant can pin a carrier role.
- **Uniqueness.** The `role_scope_workspace_key_unique` index covers `role`. Custom-role uniqueness in `workspace_role` is a separate table with no interaction. A same-keyed non-system `role` row is never trusted as the carrier (`ensureReachRole` returns null, so no reach).
- **Side effects of carriers being workspace-scoped `role` rows.** `list-workspace-audit` (workspace sees_all) now lets owner/admin see the workspace's project-scoped audit rows. This is consistent with the decision. `workflow-transition-context.resolveActorRoleIds` now includes the carrier role id for owners and admins. A workflow transition whose `role_id` named a carrier would match them, but nothing can currently point at one.
- **Workspace delete.** `removeWorkspaceAdminReach` deletes `system_backfill` grants and workspace-scoped memberships before the workspace row. `membership.role_id` and `membership_grant.role_id` are RESTRICT. Tests cover workspace delete and account delete.
- **Merge with PR #732 (#180).** Its `deleteWorkspaceRoleDependents` helper is a strict superset of `removeWorkspaceAdminReach` for delete (role-referencing grants of any origin, mappings, `scim_group_member`, memberships by role or scope, project-scoped). The two PRs touch the same two call sites (`delete-workspace.ts`, `delete-account-data.ts`). Trial merge: textual CONFLICT in both files (`data-model.md` auto-merges). Mechanical resolution is possible: keep #732's helper and drop the `removeWorkspaceAdminReach` calls (keeping both also works). See F3.

## 4. Effect

The shipped integration suite (which I ran, 13/13) drives real routes: sign-up, create workspace, create/read/list/update project, create/read/edit/list work items for a fresh owner (200s). It covers:
- an admin promoted gains reach and an admin demoted gets a 404;
- direct add, invitation accept, remove, leave and ownership transfer;
- another workspace's projects staying 404 for owner and admin.

My own probe (P5) added a cross-workspace check. An owner of W1 gets a 404 on W2's project, and cannot PATCH it (403 or 404). A removed admin (P7) goes 404 with no membership rows left.

## 5. Mutation testing (17 own plus 4 follow-ups; each applied to the worktree, the two new test files run, then restored)

| # | Mutation | Result |
| --- | --- | --- |
| M1 | drop admin-made-grant guard | **SURVIVED** (no runtime test) |
| M2 | drop genuine-admin `is_system` check | **SURVIVED** (only the SQL side is tested) |
| M3 | `manager` added to REACH_ROLE_KEYS | **SURVIVED**. The manager "gains none" assertion inserts the row directly, so the sync never runs for a manager (vacuous) |
| M4 | carrier capabilities non-empty | **SURVIVED** at runtime (only the migration test asserts empty) |
| M5 | drop staff-side check | **SURVIVED** (customer-person case untested at runtime) |
| M6 | (my edit was behavior-neutral; discarded, redone as M18) | n/a |
| M7 | skip `projectMembershipKeys` | killed (8 tests) |
| M8 | insert `sees_all=false` | killed (8 tests) |
| M9 | no sync for previous owner on transfer | killed (1) |
| M10 | no sync in leave | killed (1) |
| M11 | no sync in account-deletion leave loop | killed (1) |
| M12 | no cleanup in delete-workspace | killed (1) |
| M13 | no sync in role update | killed (2) |
| M14 | no sync in invitation accept | killed (1) |
| M15 | cleanup drops any direct origin | **SURVIVED** (harmless at delete, but the origin filter is untested) |
| M16 | migration: drop single-row guard | killed |
| M17 | migration: also backfill managers | killed |
| M18 | ambiguous rows treated as first row | killed |
| M19 | no sync in add member | killed (3) |
| M20 | no sync in remove member | killed (1) |
| M21 | no sync in create-workspace | killed (1) |

15 of 21 killed. The survivors are the guards listed under F1. All behaviors behind the survivors are correct today (probes P1-P4 pass against the real code), so this is test debt, not a defect.

## Findings

**Blocking: none.**

**Non-blocking:**

- **F1 (test gaps; recommend adding before or shortly after merge).**
  - The manager negative case never exercises the sync (M3).
  - There is no runtime test for the admin-made grant (M1), the lookalike custom admin (M2), the customer-side person (M5) or empty carrier capabilities (M4).
  - These are one-line additions using `syncWorkspaceAdminReach` or the real routes. My probes P1-P4 are the exact cases.
- **F2 (reconciliation gap).**
  - The sync runs only on the writers, and the backfill is a one-shot snapshot.
  - Cases left without a grant:
    - an owner/admin whose staff `person` row is created after 0123 (the boot seed `seedInternalOrganisationAndStaffPersons` / `ensureStaffPersonForUser` does not sync);
    - an admin whose `workspace_role.admin` row is missing or `is_system=false` at migration time but healed or seeded by the every-boot self-heal in `seed-default-workspace-roles.ts` (issue #318). Legacy admin authority returns after the heal, but reach does not.
  - Recommend a follow-up that runs the idempotent `syncWorkspaceAdminReach` for all owner/admin rows at boot after the seeds, or on the next role change. Likely rare in practice.
- **F3 (sequencing with #732).**
  - Textual conflicts in `delete-workspace.ts` and `delete-account-data.ts`.
  - Semantic conflict: after merging, 3 of #732's tests fail with `23505 membership_person_scope_scope_id_unique`. Its `seedProvisioningRows` inserts a workspace-scope `membership` for the workspace owner, who now already has the auto-created owner membership. Whichever merges second must rework those tests, for example by using a non-owner person or upserting. Then it drops the `removeWorkspaceAdminReach` calls in favor of `deleteWorkspaceRoleDependents`. The `syncWorkspaceAdminReach` leave-loop in account deletion stays.
- **F4 (documented gap).** An owner/admin who holds an admin-made direct grant with `sees_all=false` gets no reach. The code is intentional, and no production path mints such grants today (only the 0090-0093 reconciliation script). Worth one line in `rbac.md`.
- **F5 (minor).** Two concurrent transfers across different workspaces that touch the same pair of persons in opposite order can deadlock on the `person ... FOR UPDATE` locks (Postgres aborts one with 40P01). Theoretical and rare.
- **F6 (docs).** The per-workspace carrier `role` rows are not described in `data-model.md`'s `role` entry. Only `membership_grant` and `rbac.md` were updated.
- **F7 (info).** When a person holds both an external grant and the backfill direct grant, the direct grant now wins the effective membership. The external role's capabilities no longer project through `membership`. For an owner/admin that is acceptable, since legacy authority covers it and external roles cannot be `admin`/`owner`.

## What I did not check

- The full 193-file integration suite, the web app and e2e.
- Real concurrency (parallel promote/demote, parallel transfer; only reasoned about).
- A production-scale or large-data migration run, and a migration run against a database with real legacy drift.
- A Docker image build, deployment or UAT.
- The other open PRs (#730, #728, #719, #589, #512) for conflicts beyond #732. `gh pr diff --name-only` on #730, #728 and #719 showed no overlap with the files touched here (drizzle, delete-workspace, delete-account-data, create-workspace).
- `check:policy`, `check:vocabulary`, `check:inventory`, `check:openapi` and the other check scripts the implementer ran. I ran only `check:route-policy`.
- GPT-6 Sol security review (separate gate). This PR changes the authorization surface and a migration, so it is security scope.

My probes (P1-P7) were a temporary test file that I removed with the worktree. They are described above and are small to recreate.

**VERDICT: APPROVE (ordinary review A), 0 blocking, 7 non-blocking findings (F1-F7). Security-scope Sol review still required.**
<!-- END REPORT (sha256 6c6bb738575a78f79d57baf5ae6e343a75734e51f5aba963badce1771ec182c8) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/733-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 3c491fff46702716be31a129de1095bda4921d6a184bf49ff3ff0f7cca5045eb) -->
# PR #733 ordinary reviewer B (design / migration / docs / whole system)

**Reviewed head:** d31217455943bf3350185046cf4f9ee6e3dddcfc
**Base:** main 82aecead4c32861c3b2321af4abf7fcd1dc14731 (#732)
**Model / context:** Claude Sonnet 5.5, fresh independent context. Did not author, direct or remediate. Did not read reviewer A before forming this view.
**Worktrees:** scratch worktrees at the exact head and at a trial merge with #730. Both removed afterwards. Own Postgres container removed by exact ID. Testcontainers Postgres cleaned up by the harness. Main checkout untouched.

## Verdict

**APPROVE, ordinary review CLEAR. No blocking findings.** Four non-blocking findings (N1-N4) and three notes.

## Commands and results

| Command | Result |
|---|---|
| `drizzle-kit check` | "Everything's fine". 0123 snapshot `prevId` equals the 0122 `id`. The 0123 snapshot body is identical to 0122 apart from `id`/`prevId`. Journal idx 123, `when` greater than 0122's. |
| Reach + migration + delete-role-dependents (3 files, private PG, no CI) | 3 files / 32 tests passed |
| Full serialized integration, `CI=true` (Testcontainers pg18) | 194 files / 2580 tests passed, exit 0, 853s |
| `pnpm test:permissions` | 15 files / 95 tests passed, 5 turbo tasks successful |
| `pnpm lint:ci` | exit 0 (209 pre-existing warnings, 0 errors) |
| `pnpm typecheck --force` | exit 0, 9/9 tasks |
| Trial merge of #730 head 5402ea36 into d3121745 | Merged with no conflicts |
| Trial merge: reach, migration, project-scoped-reach, task-target-reach, delete-role-dependents (5 files) | 5 files / 218 tests passed |
| Trial merge: `test:permissions` | 16 files / 104 tests passed |
| Trial merge: API typecheck | exit 0 |
| Migration at scale (see 2) | idempotent, 90,000 grants; timings below |

## 1. Design

- **Shape is minimal-compliant.** rbac.md says `sees_all` comes only from a direct grant. The per-workspace carrier role (`role` row, key `owner` or `admin`, empty `capabilities`, `is_system`, not editable) plus one `system_backfill` direct grant projected through the existing `projectMembershipKeys` is the smallest shape that fits.
  - The `membership_grant_source_shape_check` already allowed `system_backfill` with a null granter, so no schema change is needed.
  - Authority still comes from `workspace_member.role` and the compiled-in `BUILT_IN_ROLES`. The empty list means a later narrowing of the built-ins cannot be shadowed by a stale snapshot.
- **No listing leak, checked at source.**
  - The only writer of the `role` table is the new module. No API lists `role` rows for workspace scope, apart from the SCIM mapping chooser below.
  - SCIM and OIDC role choosers: `validateScimMappingRole` and the OIDC validator refuse keys `owner` and `admin`. The chooser at `identity/repository.ts` ~3547 does select carrier rows (rank <= max) before filtering them out. They are not returned, but they occupy page slots (N3).
  - The "roles API" and God Mode read `workspace_role`, not `role`.
  - The carrier row has empty capabilities. In `resolve-identity` it adds an inert workspace-scope authority entry with rank equal to the built-in owner or admin rank, so capability evaluation is unchanged.
- **The projection already preferred direct over external grants.** This PR changes no projection code, only adds callers.
  - Effect on a person holding both an external grant and our grant: the effective `membership.role_id` becomes the carrier, `sees_all` becomes true, and the external grant is unlinked but kept.
  - I traced every reader of `membership.role_id` for the workspace scope. Capabilities come from `workspace_member` plus built-ins. `workflow-transition-context.resolveActorRoleIds` adds the carrier id to an owner's role-id set, but no transition can name a carrier id because nothing enumerates them.
  - So it changes reach, and not capabilities. The migration and writer tests assert the external grant is kept and reprojected.

## 2. Migration 0123

- **Data-only and append-only.** The chain is correct (see the `drizzle-kit check` row above).
- **Idempotent.** A real pre-0123 migrate is run twice in its test. At 90k rows I ran the SQL twice: the second run inserted 0, 0, then re-applied 90,001 identical upserts, with all updates 0. Role rows 60,000, grants 90,001 (one pre-existing), memberships 90,001, no grant left unlinked.
- **Duplicates and missing persons are handled.**
  - A duplicate `(workspace, user)` pair is excluded by the count guard.
  - A user with no `person` row, or a customer-side person, is excluded by the inner join on `side = 'staff'`.
  - A custom `admin` lookalike is excluded by the `is_system` requirement.
  - An existing active direct grant is never replaced.
  - These are all covered in `workspace-owner-admin-sees-all-migration.test.ts`. The boot reconcile heals the no-person case.
- **Scale.** I seeded 30k workspaces, 30k owners, 60k admins and 95k persons, and ran the file in one transaction (`psql -1`) after resetting to an empty reach state with stale-ish stats.
  - Statement 1 (carrier roles): 1.1s.
  - Statement 2 (grants): **33s**.
  - Statement 3 (membership upsert): 2s.
  - Statement 6 (final relink): 3s.
  - Total about 40s for 90k owner/admin rows.
  - With fully stale statistics (autocommit, no analyze after the bulk load) the final relink statement ran more than 5 minutes. With fresh stats it ran in 69ms (hash join). See N1. Realistic instances are orders of magnitude smaller.
- **Fresh install versus upgrade.**
  - Fresh install: the migration is a no-op on an empty DB. Creation writes the grant in `createWorkspace`.
  - Upgrade: the migration backfills first, then the boot reconcile runs after both seeds. Reconcile only visits owner/admin members with no active direct grant, so after the migration it is a cheap no-op. It cannot duplicate the migration's work, because the writer finds the existing grant and the direct-active unique index backs it.

## 3. Boot reconcile

- The query reads owner/admin `workspace_member` rows, joins `person` (`person_userId_idx`), and runs a NOT EXISTS probe on `membership_grant_person_scope_idx`. The filter on `role` is a scan of `workspace_member`, which is bounded by member count and is not a hot path.
- Steady state visits only owner/admin members who still lack a direct grant: ambiguous, custom-admin lookalike or no-person cases. Each is a short no-op transaction with `person FOR UPDATE`.
- Concurrency:
  - Two instances booting at once: the second blocks on the `person FOR UPDATE` lock, re-reads (READ COMMITTED), finds the grant and does nothing.
  - Carrier role insert: `onConflictDoNothing` on `role_scope_workspace_key_unique`, then re-select. A lost race resolves cleanly.
  - Live requests: writers hold the workspace membership lock before calling the sync, so the order is workspace lock, then person lock.
  - No duplicate or unique-violation path found.

## 4. Merge rework with #732

- All delete paths (`delete-workspace.ts`, `delete-account-data.ts`) use #732's `deleteWorkspaceRoleDependents`. `removeWorkspaceAdminReach` does not exist anywhere in `apps` or `tests`.
- `releaseOwnerReach` is opt-in, in 5 test cases (6 call sites, counting the Keeper workspace). It only clears the creator's workspace-scope reach rows so the fixture can seed its own membership and direct grant without hitting the unique keys.
  - The seeded rows are the same as before the PR, so #732's assertions are intact.
  - #732 deletion is still exercised with owner reach rows present in these tests. In `workspace-delete-role-dependents.test.ts`: project-scope role (`Project role`), `GlobalP`, `A` (invalid-by-model), and account erasure. In `workspace-owner-admin-reach.test.ts`: "deleting a workspace with owner/admin grants succeeds and leaves no reach rows" and "account deletion of a sole-member owner deletes the workspace without tripping the reach rows' role restriction".
  - The RESTRICT-stays test is unchanged.

## 5. Docs

- `rbac.md` step 2, the carved exception at line 245, `data-model.md` (carrier rows in the `role` row, `system_backfill` in the grant row) and the decision log are accurate against the code: direct origin, writer scope, built-in-only authority, fail-closed rules.
- The decision log diff is purely additive at the top. No older entry was edited.
- Not covered by the PR's docs, but worth noting: `rbac.md` line 837 and `security-model.md` line 140 still say `sees_all` is "audited as a reach change" and "never self-grantable". The automatic grant writes no `audit_log` row (N2).

## 6. Effect on #730

- #730 head 5402ea36 trial-merged into the #733 head with no conflicts.
- The owner probe on the combined tree shows the journey succeeding:
  - Workspace create, project create, project get, project list, task list and work-item create all return 200.
  - Work-item get and patch are 200.
  - Legacy task create and the comment POST returned 400 because of validation in the unmodified probe. Probe fix: it sends `dueDate: null` and `content` where the schema needs a string and `body`. These are not reach denials.
  - The probe's work-item create needed a `typeId` to return 200; I added a `typeId` lookup to my scratch copy.
  - The evidence file itself was not modified.
- #730's `project-scoped-reach` and `task-target-reach` tests plus the reach-guard permission tests (104 total) pass on the combined tree.
- **Fresh-owner journey succeeds once both are combined.** #730 therefore depends on #733, as the decision log says.

## Findings

Blocking: none.

Non-blocking:
- **N1 (migration scale).** The grant insert and the final relink join are quadratic if the planner has stale statistics: more than 5 min at 90k rows in my worst case, about 40s at the realistic worst case. Mitigation if ever needed: `ANALYZE` between statements is not possible inside the migration transaction, so consider restructuring the NOT EXISTS probes. Low priority.
- **N2 (audit and docs gap).** The automatic grant writes no audit row, while rbac.md 837 and security-model.md 140 describe `sees_all` as audited. The decision log covers the intent but no doc says the system grant is exempt.
- **N3 (chooser).** Carrier rows are selected by the SCIM mapping chooser then discarded. They consume page slots, so a page can contain fewer than `limit` items while a cursor still continues. Not a leak. A `key not in ('owner','admin')` filter in the SQL would be cleaner.
- **N4 (lock order).** `transferWorkspaceOwnership` syncs the new owner then the caller. Two concurrent transfers in different workspaces in opposite directions between the same two people can deadlock on the two `person` rows (40P01). The workspace lock does not serialize them. Sort the ids before locking if this matters. Very rare.

Notes (no action):
- A future role CRUD that creates workspace-scope custom roles with key `admin` or `owner` would collide with the carrier unique index. The writer fails closed on a same-keyed custom row.
- Deactivated staff persons still receive the grant. Reach for them is cut elsewhere.
- Local-factor `required_role` policy could in theory name a carrier id. Ids are not discoverable.

## Not checked

- No Windows or Linux runs. No production-sized real data.
- Did not read reviewer A's report.
- Did not read the implementer notes beyond skimming. All claims here come from source and runs.
- Did not run e2e, web or visual suites.
- Did not run the full integration suite on the #730 trial merge, only the 5 relevant files plus permissions.
<!-- END REPORT (sha256 3c491fff46702716be31a129de1095bda4921d6a184bf49ff3ff0f7cca5045eb) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/733-a7a4-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 c2ec7989d7e23fd430cd0e6eb905c588a2bc3c7341ff8c8d646d9648b89659e3) -->
# PR #733 exact-head delta review A (Claude Sonnet 5.5)

**Reviewed head:** a7a4af2715dedb3367bab09810fc5ef765a2051f
**Previously approved:** 541f988dfd70a389ae58570c4c2e5a5a587a676d. Merge base with main for this review: 82aecead4c32861c3b2321af4abf7fcd1dc14731 (main after #732).
**Model:** Claude Sonnet 5.5, fresh context; scratch worktree and Testcontainers Postgres, both removed afterwards.

## Verdict
**APPROVE the delta. 0 blocking, 4 non-blocking.** Security-scope GPT-6 Sol review remains a separate gate.

## Runs (serialized, exit codes preserved)
| Command | Result |
| --- | --- |
| reach + migration + #732 `workspace-delete-role-dependents` tests | exit 0; 3 files, 38 tests |
| workspace/member/project/identity/audit integration set (47 files + `identity/` dir) | exit 0; 52 files, 643 tests |
| `pnpm test:permissions --force` | exit 0; 15 files, 95 tests |
| `pnpm lint:ci` | exit 0; 0 errors, 209 warnings |
| `pnpm typecheck --force` | exit 0; 9/9, 0 cached |
| `pnpm check:route-policy` | exit 0 |

## Round 2: survivors re-run
My six survivors (M1 admin-made-grant guard, M2 genuine-admin check, M3 manager, M4 carrier caps, M5 staff check, M15 origin-ignoring revoke) are all **killed** now (M1/M15: 2 tests each; M2: 3; M3, M4, M5: 1 each). The tests use the real routes and the real `reconcile`/seed paths, not direct inserts.
- **Boot reconcile, correctness.** It selects owner/admin legacy rows with a staff person and no active direct workspace grant, then runs the same per-member `syncWorkspaceAdminReach` in its own transaction. Mutating the role filter (B2) is killed by 3 tests.
- **Concurrent boots.** `sync` takes the person row `FOR UPDATE` before re-reading the grant, so the loser sees the winner's committed grant, changes nothing and writes no audit row. `ensureReachRole` uses ON CONFLICT DO NOTHING, and the active-direct unique index is the backstop. Safe. Admin-made grant holders are skipped. Lookalike admins are re-visited each boot, which is a cheap no-op.
- **Docs.** The data-model and rbac carrier and audit notes are present and accurate.

## Round 3: merge with #732
- `delete-workspace.ts` and `delete-workspace-role-dependents.ts` are byte-identical to main. `removeWorkspaceAdminReach` is gone, with no references left. `delete-account-data.ts` only adds the leave-loop sync.
- `releaseOwnerReach` is opt-in, used in 6 fixtures that seed their own workspace-scope membership or grant. It deletes only that workspace's workspace-scope rows at fixture start. The remaining #732 tests and the reach tests keep owner reach rows present at delete time.
- #732's guarantees still bite. Mutating its helper to skip the membership delete (D1) or the grant delete (D2) fails 8+ tests, including the released fixtures, which still assert dependents are removed and other workspaces are untouched. No weakening.

## Round 4: audit
- The rows are written via `appendAuditLog(tx, ...)` inside the sync transaction (savepoint on the same session), so they commit or roll back with the grant. `actorType: "system"`, `actorId: null`, person's organisation, workspace id, `after` carries source, scope, seesAll and role.
- Grant uses `membership.sees_all_granted`. Revoke uses `membership.changed`. Both are in `audit-trail.md` (line 231, "Authority and reach changes") and `audit/actions.ts`, so the key choice matches the catalogue. Granting also covers a role change of the carrier (documented).
- No-op writes nothing: `change` stays null when there is no existing grant to revoke, or an existing grant is unchanged. Mutations killed: A1 (audit on no-op, 1), A2 (no audit on revoke, 2), A3 (wrong key, 4), A4 (no audit, 4), A5 (actor not system, 2).
- SQL backfill writes none, and this is documented in rbac.md.

## Lock order (reasoned; no failing test exists)
`lockPersonsInOrder` runs `SELECT id FROM person WHERE user_id IN (...) ORDER BY id FOR UPDATE`. In Postgres, LockRows sits above Sort, so rows are locked in id order, and every transfer takes the lower person id first regardless of argument order. The deadlock it prevents is real: workspace W1 A-to-B locks B then A, while W2 B-to-A locks A then B, in the unordered code. After the call, the two `sync` re-locks are free. `sync` takes person lock then audit-chain advisory lock, the same order as `oidc-login` (person then audit), so no new cross-order is introduced. Users lacking a person return fewer rows; the call is harmless then. My mutants L1 (desc order) and L2 (call removed) both pass the suite, which confirms the implementer's note: the "opposite transfers do not deadlock" test does not discriminate. I accept the reasoning, but it is unguarded.

## Findings (non-blocking)
- **N1 (unguarded).** The lock order has no discriminating test (L1, L2 survive). Option: a test that holds person A with a plain `FOR UPDATE` while a transfer runs and asserts the lock order via `pg_locks`/timing, or a structural test that asserts `lockPersonsInOrder` precedes both syncs.
- **N2.** Boot wiring is untested: removing the `reconcileWorkspaceAdminReach()` call from `runApiBootTasks` (B1) survives, since tests call the function directly. The staff filter in the reconcile query (B3) also survives; that filter is redundant with `sync`'s own check.
- **N3.** `reconcileWorkspaceAdminReach` has no try/catch. A throw for one member (for example the projection's "active direct-grant uniqueness invariant broken") would abort API boot. This is arguably fail-closed, but the seeds above it log and continue.
- **N4 (info).** `appendAuditLog` takes the global audit-chain advisory lock, held to the end of the caller's transaction. Owner/admin membership writers, workspace creation and account deletion now hold it until commit. This is a throughput serialization point, not a deadlock risk (person lock then audit lock is the consistent order). Audit `entityId` is the person id (entity type `membership`); that is workable but worth confirming against audit-trail entity conventions.

## Not checked
Full integration suite, web/e2e, deployment, real concurrency (reasoned only), and a migration against drifted production data.

**VERDICT: APPROVE (delta), 0 blocking, 4 non-blocking (N1-N4).**
<!-- END REPORT (sha256 c2ec7989d7e23fd430cd0e6eb905c588a2bc3c7341ff8c8d646d9648b89659e3) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/733-a7a4-ordinary-delta-b-sonnet.md; Claude Sonnet 5.5; sha256 d9634d4830e90bd8cf8c00561e63e98575e43f0d95bf7a730d8b1764ce46e9e0) -->
# PR #733 exact-head delta review (ordinary reviewer B)

**Reviewed head:** a7a4af2715dedb3367bab09810fc5ef765a2051f
**Delta base:** d31217455943bf3350185046cf4f9ee6e3dddcfc (my earlier APPROVE)
**Model:** Claude Sonnet 5.5, fresh context. Scratch worktree and private Postgres, both removed.

Delta: `workspace-admin-reach.ts`, `transfer-workspace-ownership.ts`, `rbac.md`, and the reach test (4 files).

## Verdict

**APPROVE, delta CLEAR. No blocking findings.** Two non-blocking notes.

## Runs

| Command | Result |
|---|---|
| Reach + migration + all audit/workspace integration files (private PG) | 37 files / 386 tests passed |
| Full serialized integration, `CI=true` | 194 files / 2586 tests passed, exit 0 (was 2580; +6 new reach tests) |
| `pnpm lint:ci` | exit 0 |
| `pnpm typecheck --force` | exit 0 |

## Audit design

- `appendAuditLog` takes a `Tx`, so the row commits or rolls back with the grant. It accepts `actorType: "system"` with a null `actorId`, and `organisationId` is taken from the person row.
- A grant or a role change writes `membership.sees_all_granted`. A revoke writes `membership.changed`. A no-op re-sync leaves `change === null` and writes nothing. Both keys are in the `audit-trail.md` authority-and-reach catalogue, so no catalogue edit is needed.
- `membership.changed` is acceptable for a revoke. The catalogue has no revoke key, and `after.seesAll: false` plus the omitted `role` distinguishes it. A dedicated `membership.sees_all_revoked` would be clearer, but it needs a catalogue addition first (AGENTS.md do-not 11). That is optional follow-up.
- `entityId` is the person id under `entityType: "membership"`, not the membership id. Consumers that join on membership id will not match. Non-blocking.
- No audit for the SQL backfill is acceptable. Hash-chained rows cannot be written from SQL, and it is a one-shot recorded by the decision log. The boot reconcile calls the same function and does audit.
- Docs are consistent: `rbac.md` step 2 now describes the audit keys, the system actor, the no-op rule, the reconcile and the backfill exemption, and it softens "never self-grantable" correctly. This satisfies the `rbac.md` 837 and `security-model.md` 140 statements, which I flagged as N2.

## Lock order (N4)

- `lockPersonsInOrder` selects the person rows `ORDER BY id FOR UPDATE` before either sync. The two syncs re-lock rows already held, which is free. The reasoning is sound: both transactions then acquire the same two locks in the same global order. A user with no `person` row is simply skipped.
- New tests cover argument-order independence and opposite-direction transfers. Both are in the full-suite pass.
- Non-blocking note: the sync now appends an audit row, which takes the global `pg_advisory_xact_lock` audit-chain lock after the person lock. That order is the same as the other person-then-audit paths, and in transfer both persons are locked before any audit. One pattern I did not exhaustively verify is a transaction that audits first and then calls the sync. Account erasure may do this via `invalidateAccountDeletionCredentials`, which can append an audit row before the sync locks the person, so it could in theory invert against a concurrent role change on the same user. PostgreSQL detects this as 40P01 and aborts one transaction. It is exotic, and the account-deletion tests pass.

## Not checked

- Not exhaustively traced: every path that holds the audit lock before a person lock (see above).
- No e2e or web suites run.
<!-- END REPORT (sha256 d9634d4830e90bd8cf8c00561e63e98575e43f0d95bf7a730d8b1764ce46e9e0) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/733-b151-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 e5eb3036a31952be4b64d6c984368b073900bf0afa56f97dba3c499607ae3674) -->
# PR #733 exact-head delta review A (Claude Sonnet 5.5)

**Reviewed head:** b151fbda6dce61d3fd0e8a7ef65942c79ba86bf9
**Previously approved:** a7a4af2715dedb3367bab09810fc5ef765a2051f. Delta: 4 files (`workspace-admin-reach.ts`, `rbac.md`, `boot-orchestration-success.test.ts`, `workspace-owner-admin-reach.test.ts`).
**Model:** Claude Sonnet 5.5, fresh context; scratch worktree + Testcontainers Postgres, removed afterwards.

## Verdict
**APPROVE the delta. 0 blocking, 1 non-blocking (residual of the lock-order claim).**

## Runs (exit codes preserved)
| Command | Result |
| --- | --- |
| reach, migration, `boot-orchestration-success`, `boot-orchestration`, `instance-setup-bootstrap`, `audit-log`, `audit-read`, `audit-failure-notifier`, #732 `workspace-delete-role-dependents` | exit 0; 9 files, 130 tests |
| `pnpm lint:ci` | exit 0; 0 errors, 209 warnings |
| `pnpm typecheck --force` | exit 0; 9/9, 0 cached |
| `pnpm test:permissions --force` | exit 0; 95 tests |

## N2 / N3 mutants
| Mutant | Result |
| --- | --- |
| remove `reconcileWorkspaceAdminReach()` from `runApiBootTasks` | **killed** (`boot-orchestration-success`, summary-line assertion) |
| rethrow in the catch (no isolation) | **killed** (trigger test, and one other test, fail) |
| failures not counted (`failed += 0`) | **killed** (trigger test) |
| summary log text changed | **killed** (boot test) |
| `visited` miscounted | **killed** (trigger test) |
One earlier attempt of mine (a syntactically broken log mutant, and one timeout-ridden run under load) was invalid and re-run cleanly; results above are from the clean re-runs.

## Failure isolation / partial state
Each member runs `database.transaction(tx => syncWorkspaceAdminReach(...))`, and the `try/catch` is outside the transaction, so any throw rolls back the whole member (carrier role insert, grant, projection, audit row) before the error is logged and the loop continues. The implementer's trigger test fails the grant insert for one person and asserts the other member still gets a grant and the failed one is retried next boot. That test fails before the audit write, so I added my own probe (temporary, not kept): a trigger that fails the `audit_log` insert for one person, i.e. AFTER the grant, projection and carrier role were written. After the reconcile, that person had no `membership`, no `membership_grant` and no carrier `role` row, with result `{visited:1, failed:1}`. No partial state. The failed member keeps no grant and is picked up at the next boot (fail closed).

## Lock-order claim
The new comment states person lock, then grants, then audit-chain lock last, matching the repo-wide order. I grepped `appendAuditLog` callers (35 non-test files) and intersected with files that `FOR UPDATE`-lock `person`: `pending-action/service.ts`, `deletion-targets.ts`, `credential-invalidation.ts`, `intake/repository.ts` (no person locks), identity writers. In the spot-checked flows the person lock precedes the audit write (`deletion-targets` locks at lines 108/511 before audits at 180/596; `approveUserDeactivation` locks at 687/742 before audit at 935; `invalidateAccountDeletionCredentials` locks person before it audits and the later sync re-locks the same already-held row; `withWorkspaceDeletionAccessLifecycle` audits after the mutate callback where the sync runs). I found no audit-then-person-lock transaction.
- **Residual (non-blocking, N1):** this is a spot check, not an exhaustive proof of every audit caller (35 files, some via `auditTx` savepoints on the same session). The doc comment tells future callers to lock the person first, which is the right guard.

## Not checked
Full integration suite, web/e2e, deployment, true multi-process concurrent boots (reasoned in the previous round).

**VERDICT: APPROVE (delta), 0 blocking, 1 non-blocking.**
<!-- END REPORT (sha256 e5eb3036a31952be4b64d6c984368b073900bf0afa56f97dba3c499607ae3674) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/733-security-opus.md; Claude Opus 5.5; sha256 4f7baed64b5d83443dd0bbd458d8415eb96dd5e128676bb21727f1c6e87d849d) -->
# PR #733 security review: workspace owners and admins hold an explicit `sees_all` grant

**Reviewed head:** b151fbda6dce61d3fd0e8a7ef65942c79ba86bf9
**Base:** main 82aecead4c32861c3b2321af4abf7fcd1dc14731 (merge base; `gh pr view 733` reported MERGEABLE)
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is a fresh, independent context. I did not author, direct or remediate this PR.
**Date:** 2026-10-14
**Head re-checked at the end of the review:** `gh pr view 733 --json headRefOid` returned `b151fbda6dce61d3fd0e8a7ef65942c79ba86bf9`.

## Scope and method

- I used a scratch detached worktree at the exact head (`$TMPDIR/rev733`). I removed it afterwards with `git worktree remove --force` and `git worktree prune`.
- I did not modify the main checkout. Its `git status` matched the session-start snapshot before and after the review.
- I used a private Postgres 18 container on 127.0.0.1:55733 with database `taskdesk_test`. Container id `b62f46d7edb581eb2642a7f93e1ac6976ed0721464b6f4ae61d5450fd073fa49`. I removed it by that exact id at the end.
- All test runs were serialized: vitest ran with 1 worker, one command at a time. I preserved exit codes.

### Surfaces examined

- `apps/api/src/workspace/workspace-admin-reach.ts`. The whole file: `desiredReachRoleKey`, `ensureReachRole`, `syncWorkspaceAdminReach`, `lockPersonsInOrder` and `reconcileWorkspaceAdminReach`.
- `apps/api/drizzle/0123_workspace_owner_admin_sees_all.sql`. All six statements.
- Every caller:
  - `create-workspace.ts`
  - `add-workspace-member.ts`
  - `accept-invitation.ts`
  - `update-workspace-member-role.ts`
  - `transfer-workspace-ownership.ts`
  - `remove-workspace-member.ts`
  - `leave-workspace.ts`
  - `delete-account-data.ts`
  - the boot wiring in `index.ts`
- Completeness of writers. I grepped for every insert, update and delete on `workspaceUserTable` / `workspace_member`. The writers covered by this PR are the only runtime writers. The only other writer is `migrate-workspace-user-email.ts`, which handles legacy null-`user_id` rows only, and those rows have no person.
- `user.id` deletion goes through `deleteUser`, which runs `deleteAccountData`. Better Auth `/admin/*` (`remove-user`) is refused in `auth.ts` hooks.
- Provenance:
  - `system_backfill` has no other writer. `migrate-membership-provenance.ts` writes only `direct_origin = 'admin'`.
  - The `membership_grant` CHECKs from 0090 force external sources to `sees_all = false` and `system_backfill` to a null granter.
- Projection: `identity/repository.ts` `projectMembershipKeys`. A direct grant always wins, and more than one active direct grant throws.
- IdP role validation: `validateIdpMappingRole` and `hasSafeOidcRoleCapabilities`. Both reject role keys `admin`/`owner` and the `sees_all` capability.
- Role writers: no runtime API writes the `role` table. The only runtime writer is `ensureReachRole`.
- Workspace role controls:
  - `delete-workspace-role.ts` refuses while the role is assigned.
  - `update-workspace-role.ts` edits `workspace_role.permission` only.
  - `seed-default-workspace-roles.ts` heals `is_system` every boot.
- Authority and reach consumers:
  - `permissions/resolve-identity.ts`: inactive or banned person resolves to `null`; customer branch; staff `scopedRoleMemberships` well-anchoring.
  - `packages/permissions/src/evaluator.ts` `reaches()`: the `visibleToPersonIds` check runs before the sees_all short-circuit, and reach is limited to `workspaceIds.includes(project.workspaceId)`.
  - `strict-policy-enforcement.ts` and `pending-action/required-access.ts`.
  - `notification/task-reach.ts`, which filters `person.active = true`.
  - `list-workspace-audit.ts`.
- Lock order:
  - `lockWorkspaceRoleAssignment` / workspace membership advisory lock, then person `FOR UPDATE`, then grant and membership rows, then the audit-chain advisory lock (`appendAuditLog`).
  - The account-deletion path: pending-action lifecycle lock, then workspace locks, then the user row, then person (`invalidateAccountDeletionCredentials`), then audit, then sync. The person row is already held there.
- Workspace deletion: `delete-workspace-role-dependents.ts` (#732) clears grants and memberships scoped to the workspace and its projects, and those that reference workspace-owned roles. The carrier roles are workspace-owned.
- Docs:
  - decision-log 2026-10-14 entry
  - rbac.md § Reach step 2
  - data-model.md
  - ADR 0015 (see N1)

## Commands and results

| # | Command (cwd = scratch worktree unless noted) | Result |
| --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| 2 | `vitest run --config vitest.integration.config.ts` on 4 files: `workspace-owner-admin-reach`, `workspace-owner-admin-sees-all-migration`, `boot-orchestration-success`, `workspace-delete-role-dependents` | **exit 0. 4 files, 40 tests passed** |
| 3 | Own probe file `zz-opus-733-probe.test.ts`. It was scratch only and deleted with the worktree; I do not have it any more. P1–P5 below describe it. | **exit 0. 6 tests passed** |
| 4 | 9 mutations M1–M9. Each was run against the reach and migration test files, then restored with `git checkout`. | **9 of 9 killed** (each exit 1, see below) |
| 5 | Migration 0123 run twice through `psql` in one transaction per run, on a hand-seeded DB, with a snapshot diff (see below) | RUN1 exit 0, RUN2 exit 0. **Snapshots identical** |
| 6 | `pnpm test:permissions --force` | **exit 0. 15 files, 95 tests. Turbo 5/5** |
| 7 | Broader integration slice. 22 files: `account-deletion`, `audit-log`, `audit-read`, `boot-orchestration`(+`-success`), `identity-connection-admin`, `notification-task-reach`, `notification-workspace-reach`, `project-reach-guard`, `scim-admin`, `work-item-project-reach`(+`-credentials`, `-reads`), `workspace-invitation-writes`, `workspace-membership-duplicate-rows`, `workspace-role-duplicate-rows`, `workspace-write-reachability`, `workspace-delete-role-dependents`, `workspace-owner-admin-reach`, `workspace-owner-admin-sees-all-migration`, `intake-reach-negative`, `legacy-task-project-reach` | **exit 0. 22 files, 456 tests passed** |
| 8 | `gitleaks git --log-opts="82aecead..b151fbda" --redact -v .` | **exit 0. 5 commits scanned, no leaks found** |

### Probes (P1–P5, real routes and real controllers)

- **P1, self-promotion.**
  - Setup: a `member`, a `manager` (genuine `is_system` workspace_role row) and a `viewer`.
  - Each tried `PATCH /api/workspace/{ws}/members/{self}/role {role:"admin"}`. All three got **403**. None got an active grant, and the project read stayed **404**.
  - Each also tried `POST /transfer-ownership` naming themselves. The request was not 200 and produced no grant.
- **P2, race: sync holds the person lock and a demotion runs at the same time.**
  - Setup: an admin whose grant had been revoked, which makes them a reconcile candidate.
  - Transaction A ran `syncWorkspaceAdminReach`. It read `admin`, inserted a grant and kept the person lock.
  - `updateWorkspaceMemberRole(..., "member")` ran concurrently and blocked in its sync. A then committed.
  - End state: **0 active grants**. The demotion's sync saw A's committed grant under READ COMMITTED and revoked it.
- **P2b, the reverse interleaving.** The demotion transaction updated `workspace_member` and synced while holding the person lock. A concurrent sync then waited. End state: **0 active grants**.
- **P3, observation.** I simulated an `end_memberships` deactivation: `person.active = false`, grants revoked with `person_deactivated`, membership deleted. `reconcileWorkspaceAdminReach()` then **re-created 1 active `system_backfill` grant** for the inactive person. The project read is still refused, because `resolveIdentityFromFacts` returns `null` for an inactive person. See N2.
- **P4, observation.** I demoted with a raw `workspace_member` update, bypassing the controllers. The boot reconcile **left the stale grant active (1)**: it only grants and never revokes. See N3.
- **P5, cross-workspace.**
  - Setup: a user who is admin of WS1 and member of WS2.
  - They have no WS2 grant and exactly 1 WS1 grant.
  - WS2 got only an `owner` carrier, for its creator.
  - Every workspace-scope `owner`/`admin` `role` row in the DB has `capabilities = []`.

### Mutations (all killed)

| ID | Mutation | Killing tests |
| --- | --- | --- |
| M1 | `desiredReachRoleKey`: skip the `isGenuineBuiltInRoleGrant("admin", isSystem)` check | 4 failed: custom role named admin; is_system heal reconcile; reconcile audit; per-member failure isolation |
| M2 | `REACH_ROLE_KEYS` += `"manager"` | 1 failed: manager through real routes gains no grant |
| M3 | Remove `if (existing && existing.directOrigin !== "system_backfill") return;` | 2 failed: admin-made direct grant never rewritten or revoked; remove/leave touch only system_backfill |
| M4 | Revoke branch becomes `return` (never revoke) | 8 failed: demote, remove, leave, JIT reprojection, account-deletion leave, and others |
| M5 | Staff-side check becomes `if (!person) return` | 1 failed: customer-side person promoted to admin gets no grant |
| M6 | 0123: drop the duplicate-row guard `count(*) = 1` from the grant insert | 1 failed: migration test |
| M7 | 0123: grant-to-role join drops `workspace_id` and `is_system`, which allows a cross-workspace join | 1 failed: migration test |
| M8 | `leave-workspace.ts`: remove the sync call | 2 failed: admin who leaves loses rows; leave audits revoke |
| M9 | 0123: drop `p.side = 'staff'` from the role-carrier insert and the grant insert | 1 failed: migration test |

### Migration 0123 run twice on a seeded DB

I seeded the DB with raw SQL on top of the schema at head:

- workspaces `wsX` and `wsY`;
- `wsX` has a genuine `admin` workspace_role (`is_system = true`) and a `manager` row. `wsY` has an `admin` lookalike (`is_system = false`);
- a customer organisation;
- these users:
  - u1: owner of wsX and member of wsY;
  - u2: genuine admin of wsX;
  - u3: lookalike admin of wsY;
  - u4: customer-side person who is admin of wsX;
  - u5: owner of wsX with two duplicate rows;
  - u6: manager of wsX;
  - u7: admin of wsX with no person row.

Results:

- Run 1 created exactly two carrier roles (wsX `owner` and `admin`, `is_system`, not editable, `[]`, ranks 100 and 80) and exactly two grants: p1 owner on wsX and p2 admin on wsX. Both are direct `system_backfill`, `sees_all`, active and linked, and both are projected to `sees_all` memberships.
- Nothing was granted to u1 in wsY, u3, u4, u5, u6 or u7.
- Run 2 inserted 0 roles and 0 grants and linked 0 rows. The snapshot diff was **IDENTICAL**.
- Run 2 still reports `INSERT 0 5` for the membership upsert, because `ON CONFLICT DO UPDATE` re-touches `updated_at`. The values do not change.
- The SQL is fully static, with no interpolation or dynamic SQL, so there is no injection surface.
- Every join is keyed on the workspace: role to grant uses `r.workspace_id = e.workspace_id`, and the membership upsert uses `g.scope_id`.

## Answers to the security questions

1. **Over-grant: none found.**
   - **What is granted.** The grant derives only from the caller's own committed `workspace_member` row. It is read under the person row lock, after the writer's own `workspace_member` write.
   - **Fail-closed cases.** It requires all of: a single unambiguous row; role `owner`, or `admin` backed by an `is_system` `workspace_role`; a `staff` person; and a carrier `role` with `is_system`. Anything else fails closed.
   - **Managers, custom roles and customers.** Managers get nothing (M2 kills). A custom "admin" gets nothing: `is_system = false` fails closed (M1 kills). The every-boot `is_system` heal of any row named `admin` is pre-existing #318 behaviour. `UNIQUE (workspace_id, role)` makes that the one genuine row. Customers get nothing (M5 kills), and the resolver ignores `workspace_member` for customers anyway.
   - **SCIM, OIDC and JIT.** These cannot produce `system_backfill` or set `sees_all`, because of the CHECK constraints, and IdP mapping validation rejects the `admin`/`owner` keys. Their grants are never touched except to be unlinked by the projection.
   - **API keys.** A key inherits its owner's reach, consistent with #724. Its capabilities are still clamped by key scope. The role, member and transfer routes are `requireSessionOnly`, so keys and impersonation cannot promote.
   - **Impersonation and instance admins.** No instance or God Mode path writes `workspace_member`. Instance admins already have `reach: all`.
   - **Boot reconcile.** It selects only `owner`/`admin` rows with a `staff` person and then reruns the same fail-closed sync.
   - **Migration selection.** It mirrors the runtime predicate exactly, and the double-run test confirmed it.
   - **Self-promotion.** P1 returned 403 for member, manager and viewer, and transfer by a non-owner was refused. Who may set the admin role is unchanged by this PR: `member:update` plus `requireWorkspaceRoleAuthority`.
2. **Under-revoke: none on any application path.**
   - Remove, leave, demotion, transfer (the previous owner becomes admin, so the role is rewritten) and account-erasure leave all sync in the same transaction.
   - Account-erasure workspace deletion and workspace delete clear the rows through #732's helper.
   - Races are closed by the person lock under READ COMMITTED (P2 and P2b).
   - Stale grants can arise only from out-of-band SQL edits, because the reconcile never revokes (N3).
3. **Carrier role.**
   - Capabilities are empty, `is_system = true` and `is_editable = false`.
   - No runtime writer of the `role` table exists, and no seed or migration adds capabilities to it.
   - IdP mappings reject the `admin`/`owner` keys.
   - The `workspace_role` roles API is a different table.
   - A pre-existing same-key non-system `role` row makes `ensureReachRole` fail closed. The migration's grant join also requires `is_system`.
   - Authority from the carrier appears as an extra `RoleGrant` with empty capabilities. No consumer reads `rank` or `roleKey` (I grepped).
4. **Migration 0123.**
   - The SQL is static and idempotent in value, and scoped per workspace (verified above).
   - On upgrade it unlinks external grants from the effective row and re-points membership role and `sees_all` to the direct grant. This is exactly what `projectMembershipKeys` would do.
   - It writes no audit rows. That is documented in rbac.md, the decision log and the migration header. I accept it: hash-chained rows cannot be written from SQL, and the population is deterministic from `workspace_member`, so it can be reconstructed. The boot reconcile audits anything it grants afterwards.
5. **Audit.**
   - `appendAuditLog` throws on failure and the sync does not catch, so the grant and the audit row commit or roll back together.
   - Audit is skipped only when the row did not change.
   - No sync can be made to skip audit for a real grant or revoke change.
6. **Locks, deadlock and DoS.**
   - The order is consistent everywhere: workspace advisory lock, then person, then grant and membership rows, then the audit advisory lock.
   - Account erasure locks the person before auditing and before the sync, and takes workspace locks first.
   - Opposite transfers use `lockPersonsInOrder`, and the existing test covers them.
   - The reconcile takes no workspace lock: person, then rows, then audit. That is a subset of the same order.
   - The carrier insert (`ON CONFLICT DO NOTHING` on a unique index) can wait on another transaction's uncommitted carrier, but that transaction never needs anything the waiter holds.
   - Boot cost is one candidate query plus one transaction per owner/admin without an active direct grant. After the migration, the steady-state candidates are only rows that fail closed, such as duplicate rows. An outside user cannot inflate that number.
   - Failure isolation: each member has its own transaction, so a failure rolls back that member entirely and leaves no partial grant. The existing trigger test plus M1 cover this.
7. **Effect on reach.**
   - `reaches()` short-circuits only for `workspaceIds.includes(project.workspaceId)`. The `visibleToPersonIds` (CP-16) restriction is applied first and still applies to owners and admins.
   - Customer-organisation data is reached only through the `organisation` reach kind, which staff never get.
   - The grant is keyed to the one workspace (P5, M7). Nothing goes beyond the decision.
   - I did not run #730's branch. Its combination is reasoned from #712 on main plus this PR's grant shape.
8. **Mutations and runs.** As above: 9 of 9 mutations killed. All suites green.

## Findings

**Blocking:** none.

**Non-blocking:**

- **N1 (docs/governance).** ADR 0015 (accepted) still says `system_backfill` is "migration-only" and "available only to the forward migration" (lines ~50–57 and ~130). This PR also writes it from a runtime system writer, `workspace-admin-reach.ts`.
  - data-model.md and rbac.md are updated.
  - The 2026-10-14 decision-log entry authorizes the grant but does not mention the provenance value or amend the ADR.
  - The property that matters for security still holds: it is never API input.
  - Recommend a one-line ADR 0015 amendment, or a decision-log note naming `system_backfill` as the owner/admin reach provenance, so the next reviewer does not read the runtime writer as an ADR violation.
- **N2 (deactivation).** `syncWorkspaceAdminReach` and the boot reconcile do not check `person.active`. After an `end_memberships` deactivation, which revokes direct grants, the next boot re-creates an audited `system_backfill` grant for the inactive owner or admin (P3 confirmed).
  - It is not exploitable. The resolver returns `null` for inactive persons, and notification reach filters `active`.
  - But it contradicts `end_memberships` intent and adds a misleading audit row.
  - Suggest adding `eq(personTable.active, true)` to the reconcile candidate query, and to the sync grant branch.
- **N3 (reconcile is grant-only).** The boot reconcile never revokes a `system_backfill` grant whose owner/admin basis has disappeared out-of-band, for example by raw SQL or a restore (P4 confirmed).
  - Every application writer revokes in its own transaction, so this does not arise in normal use.
  - Optional hardening: also select active `system_backfill` grants whose person's `workspace_member` role is no longer `owner`/`admin`, and run the same sync.
- **N4 (migration rerun).** The membership upsert re-touches `updated_at` on every `system_backfill` membership when rerun. The values are idempotent. Cosmetic.

## Residual risk / not checked

- I did not run the full integration suite (193 files). I ran the 22 most relevant files (456 tests), `test:permissions` and the PR's own files.
- I did not build or boot the Docker image. The boot wiring is covered by `boot-orchestration-success`, which passed.
- #730 (`codex/project-reach-remaining`) was not checked out. The reach conclusion in Q7 relies on the evaluator on this head plus the grant shape.
- I did not exercise SCIM deactivation or the `transitionPersonLifecycleInTransaction` path end to end. P3 simulated its row effects.
- Who may assign `admin` (`member:update` with role authority) is pre-existing authority. This PR does not change it, but it raises what an admin assignment is worth, because admins now see every project in the workspace.

**Verdict:** CLEAR
<!-- END REPORT (sha256 4f7baed64b5d83443dd0bbd458d8415eb96dd5e128676bb21727f1c6e87d849d) -->
