# PR #732 security review record: workspace delete clears role-referencing rows first (#180)

PR #732 fixes #180. A workspace delete, or an account erasure that deletes a sole-member workspace, failed with a 500 once any membership, grant or IdP group mapping referenced a role owned by that workspace. The cause is that `role.workspace_id` is `ON DELETE CASCADE`, while the references into `role` are `ON DELETE RESTRICT`.

The RESTRICT foreign keys are kept, so a single role delete still cannot silently strip authority. Instead, a shared helper runs inside the delete transaction, after authorization and the existing locks. It deletes these rows, in a safe order:

1. `scim_group_member`
2. `membership_grant`
3. the OIDC and SCIM group mappings
4. `membership`

A row is deleted if its role belongs to the workspace, its scope is the workspace or one of its projects, or it hangs off a deleted mapping. There is no migration.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts. Remaining RESTRICT dependents are tracked in #731, and the erasure follow-up in #734.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `18ec954f`, where 3 of 6 mutants survived. Delta APPROVE at `baff7053`, where all 3 are killed by new tests.
- Ordinary review B by Claude Sonnet 5.5 (design, erasure, audit, conflict with #733): APPROVE at `baff7053`. The full serialized integration suite passed 2558 tests.
- Security review by Claude Opus 5.5: CLEAR at `baff7053`. It found no cross-tenant over-deletion, the authorization is unchanged, and nothing that grants access is orphaned. N1 (erasure counts only legacy members) is tracked as #734.
- Mechanical security rebind at `2c7cf84d`: CLEAR. It is a pure merge of `main` `0cc0ae12` (#728).

**Reviewed head:** `baff7053524c133a9919c1fcc5fbfb44edb5fbd3`
**Reviewed head:** `2c7cf84dc0d324aff3f2509d89932fec2d4f78de`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `732-ordinary-a-sonnet.md` | Ordinary review A (8ea3ce27..18ec954f) | Claude Sonnet 5.5 | `18ec954f` | APPROVE | `7f2ca2764917074898319069cca94903360b430729055af8736f2a1dce9d1c4a` |
| 2 | `732-baff-ordinary-delta-a-sonnet.md` | Ordinary delta review A (18ec954f..baff7053) | Claude Sonnet 5.5 | `baff7053` | APPROVE | `1612715d9fe5a062583b20f38baa936bc14bdc523e7c3958134a834ebe0041f5` |
| 3 | `732-ordinary-b-sonnet.md` | Ordinary review B (8ea3ce27..baff7053) | Claude Sonnet 5.5 | `baff7053` | APPROVE | `d7aa4995f1e0d42a47eefc0be9f35a79a6e06dd849e62441c80f7476f533a909` |
| 4 | `732-security-opus.md` | Security review (8ea3ce27..baff7053) | Claude Opus 5.5 | `baff7053` | CLEAR | `03fd2baac41db47c96097f85730b2bd98f4da4cc4070bb1a1240c2869215ac05` |
| 5 | `732-2c7c-security-rebind-opus.md` | Mechanical security rebind (baff7053..2c7cf84d) | Claude Opus 5.5 | `2c7cf84d` | CLEAR | `17606ffbe03615b9c144f9f37896f4e2b2aade34d66b1bee711e73f472b21cf0` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/732-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 7f2ca2764917074898319069cca94903360b430729055af8736f2a1dce9d1c4a) -->
# PR #732 ordinary review A (Claude Sonnet 5.5)

**Reviewed head:** 18ec954f0b66768f0bd9c9b1c5af31203307657e
**Base:** 8ea3ce272ce25bf50d599e9e1615d1ce288ede07 (main)
**Model:** Claude Sonnet 5.5 (fresh context; did not author/direct/remediate). Scratch worktree at exact head, removed afterwards; main checkout untouched.

## Commands (all exit 0)
- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts` on workspace-delete-role-dependents + workspace-write-update-delete + account-deletion + workspace-role-writes: 4 files, 71 tests passed (new file alone with the first three: 3 files, 25 tests). Harness Testcontainers postgres; no containers of mine to remove.
- `pnpm test:permissions`: api 15 files / 95 tests passed (5 turbo tasks).
- `pnpm lint:ci`: exit 0, 0 errors, 208 warnings, 1 info (pre-existing class).
- `pnpm typecheck`: 9/9 successful, but "FULL TURBO" (all 9 cache hits, 31 ms), so it is a cache replay of the same inputs, not a fresh tsc run.

## Findings
1. Correctness/isolation: PASS. I read the helper against the migration FK catalog. Every FK into `role`, `membership`, `membership_grant`, `oidc_group_mapping`, `scim_group_mapping` is covered, and the order (scim_group_member, grants, mappings, memberships) is safe. `membership_grant.membership_id` and `scim_group_member.membership_id` are SET NULL, so membership-last is fine. Id sets are materialised before the first delete. A null `scope_id` never matches `inArray`. Instance/organisation scope rows are untouched. Identity connections and external identities are untouched (tested).
   Own probe (temporary test, deleted): in a doomed workspace A with a soft-deleted project, global-role (workspace_id null) memberships scoped to A and to its soft-deleted project were deleted; a global-role membership on B's project survived; route returned 200.
2. NON-BLOCKING: cross-workspace role use. Nothing in the DB (no trigger/CHECK) stops a membership in B holding a role owned by A. The same probe showed that row is silently deleted when A is deleted (otherwise the delete would 500). The app writers and the permission resolver (`roleWorkspaceId` checks) treat such rows as invalid, so this strips only an inert/invalid row. Not documented and not tested; consider a sentence in data-model.md or a test.
3. NON-BLOCKING: scope-only predicates are untested. Mutation M1 (drop project-scope predicate) and M2 (drop workspace-scope predicate) both survive: every test membership also holds a workspace-owned role, so only the role predicate is exercised. These predicates matter for polymorphic orphan cleanup (scope_id has no FK), and the implementer noted this gap. Recommend adding one test with a global role scoped to the workspace and to a project (my probe shows the code is correct today).
4. NON-BLOCKING: M5 (skip scim_group_member delete by mapping id) survives; the grant-id path covers the test data. A scim_group_member row whose grant is not doomed but whose mapping is would only be hit via the mapping-id branch. Add a fixture row with null grant if desired (`membership_grant_id` nullable? not verified).
5. Transactionality/locking: PASS with accepted gap. Helper runs inside the delete tx after `lockWorkspaceRoleAssignment` in both paths (account path locks all the user's workspaces sorted first). SCIM/OIDC writers do not take that lock (only native writers do; verified by grep of lock users). Under READ COMMITTED a provisioning insert committing between the helper's snapshot and the workspace delete makes the RESTRICT cascade fail: 500 and full rollback, retryable, fail-closed, no corruption. A scope-only polymorphic row inserted in that window could be orphaned (no FK). Low risk, non-blocking; #731 or a follow-up could take the lock in provisioning writers.
6. Account erasure: PASS. Helper called with `plan.workspaceIdsToDelete` after the workflow delete and before the workspace delete; the "leave" workspaces are untouched; test 5 asserts erasure of a sole-member workspace plus survival of the other person's workspace/membership.
7. RESTRICT still in force: PASS. Test 6 asserts direct `DELETE role` fails with 23001 and the row remains. Mutation check: the test is independent of the helper.
8. Docs: PASS. The data-model.md `role` row is accurate (FK list, order, scope rule, no migration, reversal). Minor: wording "Rows of other workspaces are untouched" is slightly broader than finding 2.

## Mutations (new file, 6 tests, tree restored after each)
- M3 widen workspace-scope predicate (any scope_id): 1 failed (other-workspace test). Killed.
- M4 widen project-scope predicate (any project): 2 failed. Killed.
- M6 skip the grant delete: 3 failed. Killed.
- M1 drop project-scope predicate: 6 passed. SURVIVED (finding 3).
- M2 drop workspace-scope predicate: 6 passed. SURVIVED (finding 3).
- M5 skip scim_group_member-by-mapping delete: 6 passed. SURVIVED (finding 4).
The implementer's own mutations (helper calls removed, membership/scim_member deletes skipped) were not re-run; I did not remove either call site myself.

## Not checked
Full integration suite; unit/UI/e2e; image build/UAT deploy; the out-of-scope RESTRICT dependents (#731); concurrent execution of SCIM/OIDC provisioning against delete (reasoned only, not reproduced); fresh (uncached) typecheck; security-scope Sol review (separate gate).

## Verdict
APPROVE, no blocking findings. Three non-blocking test-strength/doc follow-ups recommended (findings 2, 3, 4).
<!-- END REPORT (sha256 7f2ca2764917074898319069cca94903360b430729055af8736f2a1dce9d1c4a) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/732-baff-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 1612715d9fe5a062583b20f38baa936bc14bdc523e7c3958134a834ebe0041f5) -->
# PR #732 exact-head delta review A (Claude Sonnet 5.5)

**Reviewed head:** baff7053524c133a9919c1fcc5fbfb44edb5fbd3
**Compared against:** 18ec954f0b66768f0bd9c9b1c5af31203307657e (previously approved by me)
**Model:** Claude Sonnet 5.5. Scratch worktree, removed afterwards.

## Delta
`git diff --stat 18ec954f..baff7053`: 2 files (docs/01-architecture/data-model.md, tests/api-integration/workspace-delete-role-dependents.test.ts). Nothing under apps/ or packages/: no source change.

## Mutants re-run (new file now 10 tests, baseline 10 passed)
- M1 drop project-scope predicate: 1 failed ("GLOBAL role scoped to a project ... not one in another workspace"). KILLED.
- M2 drop workspace-scope predicate: 1 failed ("GLOBAL role scoped to the doomed workspace, and keeps the role"). KILLED.
- M5 skip scim_group_member delete by mapping id: 1 failed ("reached only through its group-mapping id"). KILLED.
Tree restored after each (git status clean).

## Runs (exit 0)
- New file + workspace-write-update-delete + account-deletion + workspace-role-writes: 4 files, 75 tests passed.
- `pnpm test:permissions`: 15 files, 95 tests passed (5 tasks).

## Doc
The new wording matches behaviour I probed on 18ec954f: global-role membership scoped to the doomed workspace/project is removed and the global role stays; other workspaces' and same-person memberships elsewhere survive; a B membership holding an A-owned role is deleted. "Invalid by the model" is consistent with the resolver's roleWorkspaceId checks. Accurate.

## Not checked
Lint/typecheck on this head (delta is tests+docs only; not re-run), full integration suite, concurrency, security-scope Sol gate.

## Verdict
APPROVE at baff7053. No blocking or new non-blocking findings; the three earlier non-blocking gaps are closed.
<!-- END REPORT (sha256 1612715d9fe5a062583b20f38baa936bc14bdc523e7c3958134a834ebe0041f5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/732-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 d7aa4995f1e0d42a47eefc0be9f35a79a6e06dd849e62441c80f7476f533a909) -->
# PR #732 ordinary review B (design / schema-docs alignment / whole system)

**Reviewed head:** baff7053524c133a9919c1fcc5fbfb44edb5fbd3
**Base:** main 8ea3ce272ce25bf50d599e9e1615d1ce288ede07
**Model / context:** Claude Sonnet 5.5, fresh independent context. Did not author, direct or remediate. Reviewer A's report not read.

## Runs (scratch worktree at the exact head, removed afterwards)
Integration used `CI=true`, so global-setup starts a private Testcontainers postgres:18-alpine (auto-stopped; nothing of mine left in `docker ps`, no container removed by hand). Host containers (taskdesk-*, owner-sees-all-pg2) were not touched.
- New file + `workspace-write-update-delete` + `account-deletion`: 3 files, 29 tests passed.
- Full serialized integration suite (`CI=true`, fileParallelism false, 1 worker): 192 files, 2558 tests passed, exit 0. That is 2554 from the implementer's first run plus the 4 round-2 tests.
- `pnpm lint:ci`: exit 0 (0 errors, 208 warnings, 1 info; pre-existing).
- `pnpm typecheck --force`: 9/9 tasks successful, 0 cached.

## 1. Design: keep RESTRICT + explicit helper
Sound, and consistent with the workflow pre-delete already in `delete-workspace.ts`: same pattern (explicit child delete, in-transaction, before the workspace row), same stated reason, same two call sites. The helper generalises it without changing the shape.
- Keeping RESTRICT preserves the property that a single `DELETE role` can never silently strip authority (the new test 6 asserts SQLSTATE 23001 still fires). Switching to CASCADE would make ordinary role deletes strip memberships, which is the authorization-relevant risk #180 itself raised. Workspace delete is the only legitimate mass-removal path.
- Coverage is complete for the role dependents. I cross-checked the five FKs to `role` in schema.ts: `membership`, `oidc_group_mapping`, `scim_group_mapping`, `membership_grant` are covered. `workflow_transition.role_id` is already handled by the existing workflow delete. The RESTRICT dependents of those tables (`scim_group_member`, grants to mappings) are covered. `membership_id` FKs are SET NULL, so no ordering hazard.
- Selecting by "role owned by workspace OR scope is workspace OR scope is one of its projects" is right, because `scope/scope_id` has no FK. Without the scope predicates, project-scoped and workspace-scoped memberships holding global roles would be orphaned, so this fixes a latent leak beyond the 500.
- Id sets are materialised before the first delete, so the later statements do not depend on delete order.
- Docs: `data-model.md` `role` row now states the semantics and the reversal path. It is accurate against the code. No contradiction with rbac.md.

## 2. Account erasure
No privacy or erasure spec governs workspace hard-delete: `data-protection.md` covers God Mode anonymise only; `auth-and-identity.md` L336 says departed members are anonymised, never hard-deleted, which concerns person history, not workspace purge. Account erasure already hard-deletes sole-member workspaces (`planAccountDeletion`), so removing their role dependents is consistent. The helper touches only rows of `workspaceIdsToDelete`. Workspaces the user merely leaves (`workspaceIdsToLeave`) are untouched, as is the user's `person` row.
Pre-existing, out of scope (non-blocking, see N3): leaving a workspace does not remove the person's `membership`/`membership_grant` rows for that workspace.

## 3. Upcoming conflict with PR #733 (head 541f988dfd70a389ae58570c4c2e5a5a587a676d, same merge base)
Trial merge of #732 into #733: textual CONFLICT in exactly two files, `delete-workspace.ts` and `delete-account-data.ts` (adjacent import line plus adjacent call line). `data-model.md` auto-merges (different table rows). No conflict in tests or the helper file.
Semantics: #733's `removeWorkspaceAdminReach` deletes (a) workspace-scoped DIRECT `system_backfill` grants and (b) workspace-scoped memberships for the workspace(s). #732's helper deletes every grant whose role is owned by the workspace or whose scope is the workspace/its projects, and every membership likewise. Both of #733's deletions are strict subsets, and the carrier `role` rows #733 creates are workspace-owned, so they are caught by the role-ownership predicate.
**Recommendation:** rebase #733 onto #732 after #732 merges. Delete `removeWorkspaceAdminReach` and both call sites, and take #732's helper call at both conflict hunks. Keep `syncWorkspaceAdminReach` (including the new leave-loop sync in `delete-account-data.ts`, which acts on `workspaceIdsToLeave`, disjoint from the deleted set) and keep #733's rbac.md and decision-log changes. Keep #733's reach test, and add one assertion that a reach grant plus carrier role disappear via the shared helper. Resolve `data-model.md` by hand if needed, keeping both sentences. This also avoids two lanes owning the same delete ordering. One thing to confirm: #733 inserts reach rows during member writes under `lockWorkspaceRoleAssignment`, and the delete paths already hold that lock, so no new race arises.

## 4. Audit and events
Nothing is silently dropped. `delete-workspace.ts` and `delete-account-data.ts` emit no audit or outbox event today, and events.md/rbac.md define no per-membership removal event for workspace deletion (`saved_view.deleted`-style events are per entity; the elevated-action audit of the workspace delete is a route/pending-action concern, unchanged by this PR). The membership/grant ledger rows (including historical revoked grants and `revocation_reason`) are now hard-deleted with the workspace. That is consistent with the documented hard-delete of the workspace and its children, but it is a retention consequence worth one line in a later retention doc. Non-blocking.

## Findings
- **Blocking:** none.
- N1 (non-blocking): a SCIM/OIDC provisioning write racing the delete can insert a membership after the helper runs and fail the cascade with a 500 (rolled back, no corruption). Tracked in #731; the implementer disclosed it.
- N2 (non-blocking): a membership in workspace B holding a role owned by workspace A is deleted when A is deleted. This is documented as invalid-by-model and tested; acceptable, but ensure the role-assignment writers actually reject cross-workspace roles (the existing lock path suggests they do).
- N3 (non-blocking, pre-existing, out of scope): erasure of a leaving user does not clear their identity-table rows for workspaces they leave. Belongs to a separate issue; #733's leave-loop sync partially touches it.
- N4 (non-blocking): the helper applies no soft-delete filter; `project` has no deleted column, so none is needed today. Revisit when #198's soft-delete lands.
- Remaining RESTRICT dependents (custom_field, request_type_version, submission, identity_connection.default_workspace_id) are correctly deferred to #731.

## Not checked
Mutation re-runs (implementer's evidence not independently repeated); UI/e2e; image build/boot (no image-affecting change: code-only, no migration).

## Verdict
**APPROVE / CLEAR (ordinary review B) at baff7053524c133a9919c1fcc5fbfb44edb5fbd3.** No blocking findings. Security-scope Sol review is still required separately (this touches `delete-account-data.ts`).
<!-- END REPORT (sha256 d7aa4995f1e0d42a47eefc0be9f35a79a6e06dd849e62441c80f7476f533a909) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/732-security-opus.md; Claude Opus 5.5; sha256 03fd2baac41db47c96097f85730b2bd98f4da4cc4070bb1a1240c2869215ac05) -->
# PR #732 security review: Claude Opus 5.5

**PR:** #732, "fix(api): workspace delete clears role-referencing rows first (#180)"
**Reviewed head:** baff7053524c133a9919c1fcc5fbfb44edb5fbd3
**Base:** main 8ea3ce272ce25bf50d599e9e1615d1ce288ede07
**Model:** Claude Opus 5.5 (claude-opus-5-5). This is an independent context. It did not author, direct or remediate the change.
**Date:** 2026-10-14

Head verified with `gh pr view 732 --json headRefOid`, which returned `baff7053524c133a9919c1fcc5fbfb44edb5fbd3`. The range has two commits, 18ec954f and baff7053. The review ran in a scratch detached worktree at the exact head, which was removed afterwards. It used a private Postgres 18 container, `opus732-pg`, with database `opus732_test`. That container was created for this review and removed afterwards by its exact ID.

## Surfaces examined

- `apps/api/src/workspace/controllers/delete-workspace-role-dependents.ts` (new).
- `apps/api/src/workspace/controllers/delete-workspace.ts`: the call site, the lock and the transaction.
- `apps/api/src/user/controllers/delete-account-data.ts`: the call site, plus the `planAccountDeletion` sole-member rule in `user/account-deletion.ts`.
- The route middleware for `DELETE /api/workspace/{workspaceId}` in `apps/api/src/workspace/index.ts`, and the account-deletion hook in `auth.ts`. Both are unchanged in this diff.
- Every writer of `membership`, `membership_grant`, `oidc_group_mapping` and `scim_group_mapping`:
  - `identity/oidc-group-mapping-admin.ts` (POST/PATCH);
  - `identity/scim-admin.ts`;
  - `identity/oidc-login.ts` (JIT grant and OIDC group grants);
  - `identity/repository.ts`: SCIM group sync grants (~L3270), membership materialisation (~L2090–2200) and `validateIdpMappingRole`;
  - `database/migrate-membership-provenance.ts` (backfill).
- The live FK catalog of the migrated `_test` database, including the delete actions of every FK into `role`, `membership`, `membership_grant`, the `*_group_mapping` tables, `scim_group_member`, `project` and `workspace`.
- Every column named `scope_id`, `*role_id` or `*workspace_id`.
- Triggers and check constraints on the identity tables.
- `workspace-role-assignment-lock.ts` and `pending-action/workspace-access-invalidation.ts`.
- The new test file `tests/api-integration/workspace-delete-role-dependents.test.ts`, which has 10 tests.
- The `data-model.md` delta.

## Commands and results

| Command | Result |
| --- | --- |
| `vitest --config vitest.integration.config.ts workspace-delete-role-dependents.test.ts` | 1 file, 10/10 passed, exit 0 |
| `vitest --config vitest.integration.config.ts` on `workspace-delete-role-dependents`, `account-deletion` and `workspace-write-update-delete` | 3 files, 29/29 passed, exit 0 |
| `vitest --config vitest.permissions.config.ts` (`test:permissions`), after `turbo build --filter=@taskdesk/api^...` | 15 files, 95/95 passed, exit 0 (see note) |
| `gitleaks git --log-opts=8ea3ce27..baff7053 --redact` (v8.30.1) | 2 commits scanned, no leaks, exit 0 |
| Mutation M1: project-id subquery unfiltered (all projects in the instance) | **Killed.** 3 tests failed, including "leaves another workspace's rows alone…" and "…but not one in another workspace" |
| Mutation M2: `roleId IN workspaceRoleIds` removed from the membership delete | **Killed.** "deletes a membership in workspace B that holds a role owned by workspace A…" failed |
| Mutation M3: helper call removed from `delete-account-data.ts` | **Killed.** "account erasure deletes a sole-member workspace…" failed |
| Extra mutation M4: `scope = 'workspace'` discriminator removed (`inArray(scopeId, ids)` only) | **Survived**, 10/10 passed. See N3. |

Note on `test:permissions`: the first run, before the dependency packages were built, failed 4 files with `Failed to resolve entry for package "@taskdesk/email"`. That is an environment precondition: the turbo task declares `dependsOn: ["^build"]`. After building, the suite was 95/95 green. All runs were serialized, and exit codes were taken from `pipestatus`.

## Analysis by question

### 1. Over-deletion and cross-tenant impact

**The predicates.** A row is deleted only when one of these holds:

- its `role_id` is a role whose `workspace_id` is in the doomed set; or
- its `(scope, scope_id)` is `('workspace', doomed id)`; or
- its `(scope, scope_id)` is `('project', project of a doomed workspace)`; or
- for grants only, it hangs off a doomed mapping.

`scim_group_member` rows are deleted only through a doomed grant or a doomed mapping. The id sets are materialised before the first delete.

**Global and built-in roles.** These have `workspace_id IS NULL`, so they are never in `workspaceRoleIds`. A membership with a global role is removed only when its scope is the doomed workspace or one of its projects, and the role row itself is untouched. Instance-scope and organisation-scope rows (for example, the customer role on an organisation) never match. The test at L531/L563 covers this, and M1 confirms the project branch is tenant-bounded.

**The same person's memberships elsewhere.** These are untouched, because the predicates key on role ownership or scope, never on person. The test at L361 covers this.

**Cross-workspace-role rows (membership in B holding a role owned by A).** Every application writer prevents them:

- Mapping create and update (OIDC and SCIM) is instance-admin only. It passes through `validateIdpMappingRole`. For agent connections, that function requires `role.scope === input.scope` and `role.workspace_id === input.scopeId`, and rejects `admin`/`owner`. For customer connections, it requires the global `customer` role on the connection's organisation.
- JIT and OIDC/SCIM grants copy `role_id`/`scope`/`scope_id` verbatim from a validated mapping or JIT role.
- `membership` is written only by the materialiser, which projects the winning grant's role for that exact `(person, scope, scope_id)` key.
- The provenance backfill only copies existing membership rows into direct grants.

No HTTP surface lets a tenant user write a `role_id` that points into another workspace. An attacker therefore cannot plant such a row, either to make an innocent workspace's delete strip memberships elsewhere or to strip someone else's access. If such a row existed from legacy data or a direct DB write, deleting it when A is deleted is fail-closed. The role it names is being destroyed, and the alternative is a 500 that blocks A's deletion. The test at L678 covers this, and M2 kills the predicate removal.

**Scope-id collisions.** Workspace, project and organisation ids are server-generated with `createId()` (cuid2) in separate tables, and no route accepts a client-chosen id. The project branch is also scoped by `project.workspace_id`. A collision would need two server-generated cuid2 values to coincide, which is not attacker-reachable. See N3 for the surviving discriminator mutant.

### 2. Authorization of the delete paths

These are unchanged in the diff.

**`DELETE /api/workspace/{id}`** keeps this middleware chain:

- `requireSessionOnly`
- `workspaceAccess.fromParam`
- `requireWorkspaceMembership`
- `requireWorkspacePermission({organization:["delete"]})`
- `requireWorkspaceRoleAuthority({organization:["delete"]})`

**Account erasure** stays reachable only through the better-auth delete-user hook for the caller's own `user.id`.

On both paths the helper runs only after authorization and inside the single delete transaction:

- In `delete-workspace.ts`, it runs inside `withWorkspaceDeletionAccessLifecycle` (pending-action lifecycle lock), after `lockWorkspaceRoleAssignment` (advisory 4002/4003) and after the `workflow` pre-delete.
- In `delete-account-data.ts`, it runs after the per-workspace role-assignment locks, the user `FOR UPDATE` lock, the membership-set recheck, the blocked-owner check and credential invalidation.

On both paths it runs immediately before the `workspace` row delete. Any error rolls the whole transaction back.

### 3. Under-deletion and orphaned authority

After the helper, the remaining FKs into `role` are:

- `membership`, `membership_grant` and the `*_group_mapping` tables, which the helper clears;
- `workflow_transition`, which is cleared by the pre-existing `workflow` delete.

`membership_grant.membership_id` and `scim_group_member.membership_id` are `SET NULL`.

No authority-bearing row is left pointing at a deleted role. A leftover row would make the `role` cascade fail and roll everything back, so a partial delete is not possible. Polymorphic `scope_id` rows for the workspace or its projects in the four identity tables are deleted. The other polymorphic `scope_id` tables (`legal_hold`, `saved_view`, `notification_preference`, `user_preference`) carry no authority and are out of scope for #180.

**Recycled ids.** Mappings are deleted rather than orphaned. Ids are cuid2 and never reused, and every later sync re-validates mapping targets (`validateIdpMappingRole` checks that the workspace and role still exist). So no mapping can re-grant into a different workspace.

### 4. Concurrency

Identity provisioning (SCIM sync, OIDC login) does not take the workspace role-assignment advisory lock. Suppose a grant or membership insert for workspace A races the delete. Then one of two things happens:

- The insert commits before the cascade deletes A's roles. The `role` RESTRICT FK then aborts the delete transaction.
- The delete commits first. The insert's FK to the now-deleted role then fails.

Either way, one transaction rolls back completely and no partial state persists. A rare rollback-only 500 that the caller can retry is acceptable, and it is the same class of behaviour the PR fixes deterministically.

## Findings

### Blocking

None.

### Non-blocking

**N1. Account erasure can now delete workspaces that have IdP-provisioned members.**

- **Current rule.** `planAccountDeletion` treats a workspace as "sole member" from `workspace_member` (legacy) rows only.
- **What it misses.** IdP-provisioned `membership`/`membership_grant` rows and instance-admin OIDC/SCIM mappings into that workspace do not create `workspace_member` rows.
- **Before this PR.** The RESTRICT FKs accidentally made erasure fail with a 500 for such a workspace.
- **After this PR.** Erasure succeeds and deletes the workspace together with other people's IdP-derived memberships and the admin's mappings.
- **Why this is not blocking.** The erasing user is the only legacy member of the workspace. A non-sole-owner member cannot reach this branch, and route-level workspace access is still keyed on `workspace_member`. So this is not a privilege escalation. The same sole user could already delete the workspace whenever no role-referencing rows existed.
- **Recommendation.** File a follow-up so the erasure plan counts target-model `membership` holders, or refuses when IdP mappings target the workspace. The deleted mappings also have no dedicated identity audit event; consider emitting provisioning or audit evidence.

**N2. Narrow access-invalidation gap for the invalid-by-model cross-workspace row.** When a membership in B holding an A-owned role is deleted with A, the access-loss invalidation only snapshots pending actions in A. That row cannot be produced by any application writer (see Q1), so the gap is theoretical. Noted for completeness.

**N3. The workspace-scope discriminator is untested.** Mutation M4 removes `scope = 'workspace'` from the workspace branch of `inWorkspaceScope`, and it survives. This is not exploitable, because ids are server-generated cuid2 and an attacker cannot force a collision with a non-workspace `scope_id`. Still, the predicate is defence-in-depth with no regression guard. Suggested test: insert an `organisation`-scope row whose `scope_id` equals the doomed workspace id, and assert it survives.

**N4. The provisioning race produces a 500.** As described in Q4: it rolls back atomically, is retryable, and is acceptable. Optionally, map the FK violation to 409.

## Residual risk / not checked

- I did not run the full integration suite. I ran only the three deletion files listed above, plus `test:permissions`.
- I did not exercise the race in Q4 with a live concurrent test. That analysis rests on Postgres FK and locking semantics.
- I did not audit legacy or production data for pre-existing cross-workspace-role rows. If any exist, deleting the owning workspace will remove them (fail-closed).
- `identity_connection.default_workspace_id → workspace` is still `RESTRICT`. Deleting a workspace that a connection defaults to will still fail with a 500. That is a fail-closed availability gap outside #180's scope.
- I did not build the image or run a deploy check. The change has no migration and touches no dependencies.

**Verdict:** CLEAR
<!-- END REPORT (sha256 03fd2baac41db47c96097f85730b2bd98f4da4cc4070bb1a1240c2869215ac05) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/732-2c7c-security-rebind-opus.md; Claude Opus 5.5; sha256 17606ffbe03615b9c144f9f37896f4e2b2aade34d66b1bee711e73f472b21cf0) -->
# PR #732: mechanical exact-head security rebind (Claude Opus 5.5)

**Reviewed head:** 2c7cf84dc0d324aff3f2509d89932fec2d4f78de
**Prior CLEAR head:** baff7053524c133a9919c1fcc5fbfb44edb5fbd3 (see `732-security-opus.md`)
**Base:** main 0cc0ae12a8ad2fc46df539fcc29fe5199a5acb7b (#728, web board/rank/bulk). Original base was 8ea3ce272ce25bf50d599e9e1615d1ce288ede07.
**Model:** Claude Opus 5.5 (claude-opus-5-5). I am the same independent security-review context as the CLEAR review, and not an author.
**Scope:** This was a mechanical rebind only. As instructed, I ran no tests.

## Checks

| Check | Result |
| --- | --- |
| `gh pr view 732 --json headRefOid` | `2c7cf84dc0d324aff3f2509d89932fec2d4f78de` |
| `git ls-remote origin refs/heads/main` | `0cc0ae12a8ad2fc46df539fcc29fe5199a5acb7b`. Main is unchanged. |
| Parents of the head | Exactly 2 parents: ^1 = baff7053…, ^2 = 0cc0ae12… |
| Head tree vs `git merge-tree --write-tree baff7053 0cc0ae12` | Both are `bc63cdd3985fa5fb8927810b7d6e510d6a9d8a05`. They are identical. |
| `git diff --name-only baff7053 2c7cf84d` vs `git diff --name-only 8ea3ce27 0cc0ae12` | Identical: 51 files. These are `apps/web` work-item board, rank and bulk UI files, fetchers, hooks and routes; `i18n/*.json`; `packages/ui/src/styles/pairs.json`; one visual snapshot; and `docs/07-planning/security-reviews/728-…md`. |
| Overlap with #732's 5 files | None. |
| Interaction with workspace delete or account erasure | None. The incoming delta contains no `apps/api` changes. The only match for a deletion-related term is a web test fixture capability flag, `deleteWorkspace: false`. Nothing touches `delete-workspace*`, `delete-account-data`, the identity tables, role FKs or migrations. |

## Findings

There are no new findings. The non-blocking items N1–N4 from `732-security-opus.md` carry forward unchanged.

**Verdict:** CLEAR
<!-- END REPORT (sha256 17606ffbe03615b9c144f9f37896f4e2b2aade34d66b1bee711e73f472b21cf0) -->
