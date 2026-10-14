# PR #744 security review record: a project's creator holds a project-lead membership

PR #744 implements Thomas's 2026-10-14 decision, which is recorded in the decision log.

**What it does:**
- Creating a project grants the creator a project-scope `project-lead` membership through a direct grant with origin `project_creator`. The grant is audited and written in the same transaction as the create. It is skipped for `sees_all` holders.
- Migration 0124 adds a nullable `project.created_by` (FK to person, `ON DELETE SET NULL`). It widens the grant-origin constraints and seeds a per-workspace project-scope `project-lead` role whose capabilities are exactly rbac.md's lead list. There is no backfill, because no record shows who created existing projects.
- Creator grants are revoked when the creator is removed from the workspace, leaves, is erased, deletes the project, or is promoted to owner or admin. Workspace delete clears them through #732's helper.
- `createdBy` is declared in the project schema.

A Claude Sonnet 5.5 lane implemented the change over two rounds. The reviewers below are fresh, independent contexts. Follow-ups are tracked in #746.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `161a8d76`. Decision 3 (a project-scope role overriding the workspace role in the declarative evaluator) is not a defect: managers lose nothing enforced and members gain nothing. Delta APPROVE at `2220a1fc`.
- Ordinary review B by Claude Sonnet 5.5 (migration run twice, role seed, docs, merge conflicts): APPROVE at `161a8d76`. The full serialized suite passed 2805 tests.
- Security review by Claude Opus 5.5: CLEAR at `2220a1fc`. No over-grant was found: a `createdBy` sent in the body is ignored, IdP mappings refuse the role, and its capabilities are pinned. Enforced authority is unchanged, revocation is complete, migration 0124 is safe, and all 8 mutations were caught.

**Reviewed head:** `2220a1fcbdfacd934fb86f7e2b8ecd46195a3912`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `creator-lead-ordinary-a-sonnet.md` | Ordinary review A (2e03855e..161a8d76) | Claude Sonnet 5.5 | `161a8d76` | APPROVE | `40a97fb8c1f7c7e42a657f169c679308be124a87b0842a60632599d4ccaf0e58` |
| 2 | `744-ordinary-b-sonnet.md` | Ordinary review B (2e03855e..161a8d76) | Claude Sonnet 5.5 | `161a8d76` | APPROVE | `aa2c9c6f8d7daf3182260781d7d7f6e8f2ce44f71adbe602bfedc6f2d74e18d2` |
| 3 | `744-2220-ordinary-delta-a-sonnet.md` | Ordinary delta review A (161a8d76..2220a1fc) | Claude Sonnet 5.5 | `2220a1fc` | APPROVE | `b57f2e7dfa787ce97a53ca71a25ca2e2fed865bacfd4c3de1a2a27a87ba0938d` |
| 4 | `744-security-opus.md` | Security review (16234794..2220a1fc) | Claude Opus 5.5 | `2220a1fc` | CLEAR | `0464d5931b8731d65da21b7f9020162677865f8512200451403a03e931168c87` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/creator-lead-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 40a97fb8c1f7c7e42a657f169c679308be124a87b0842a60632599d4ccaf0e58) -->
# Ordinary review A: PR #744 "a project's creator holds a project-lead membership"

**Reviewer:** Claude Sonnet 5.5, fresh context. Did not author, direct or remediate the change.
**Reviewed head:** 161a8d76b2891b87af4e9e6bd5b20b428a5ef9a7
**Base:** main at branch creation, 2e03855edbee5dcab9045e93fd2e06177bd66ea9 (`git merge-base` confirmed; origin/main still at that SHA)
**Method:** scratch worktree at the exact head, private postgres container (random 127.0.0.1 port, db `reva_test`). Worktree removed and container stopped by exact ID afterwards. Main checkout untouched.

## Commands and counts (all at the exact head)
- New file `project-creator-lead.test.ts`: 1 file / 20 tests pass.
- `workspace-` + `project-` integration files (includes workspace-owner-admin-reach, project-list, project-reach-guard, project-delete): 55 files / 879 tests pass.
- `pnpm test:permissions`: 16 files / 104 tests pass.
- `pnpm check:route-policy`: pass.
- `pnpm lint:ci`: 0 errors (212 warnings, same class as before).
- `pnpm typecheck`: 9/9 tasks.
- `drizzle-kit check`: "Everything's fine". `drizzle-kit generate` afterwards: "No schema changes".
- Not run: the full serialized integration suite (the implementer reports 198 files / 2805 tests).

## Decision 3 (project-scope role overrides workspace role): NOT blocking
Where the declarative evaluator is used:
- `authorityFor` and `can` ARE enforced today through `projectReadDecision` (`has-project-reach.ts`) in `workspace-access-middleware`, `require-work-item-reach`, attachment reach and search. It returns 403 unless `can()` holds the route's capability. It is ANDed with the legacy workspace-role gate.
- `TASKDESK_POLICY_ENFORCE` strict enforcement is opt-in and off by default. Shadow mode only logs.
- `/api/capabilities` is not project-scoped. `hasCanonicalCapability` reads the workspace role, so `manageProjectSettings` and the other flags the web hook consumes never see the project-lead override. Probed: a manager creator gets all flags true, including `manageProjectSettings`.

I replayed `authorityFor` over every project/work_item-scope policy with a reach requirement, with and without the project-lead grant:
- Manager: the only capability lost on a route is `time_entry:update_any` (`PUT /api/time-entry/{id}`). That route has `deferCapability: true`, so it is not decided by the declarative check today. `project:archive` and `project:manage_settings` are not declared by any project-scope route (archive routes declare `project:update`, which lead holds).
- Member: gains `project:update`, `work_item:delete`, `work_item:assign` and `time_entry:read_any` in the declarative result.

Empirical probe, real routes:
- Manager creator: column create, archive, unarchive, PUT project and delete work item all return 200. `DELETE /api/project` returns 403, but a manager lacks `project:delete` anyway, so that is not a regression.
- Member creator: column create, archive, PUT project, milestone, health, workflow-rule, assign and DELETE work item all return 403. The legacy gate holds, so there is no effective escalation.

Conclusion: no capability downgrade for creators on any enforced decision, and no UI flag is hidden. The reach-only choice and the `sees_all` skip are consistent with this.

### Non-blocking N1 (latent, strict mode)
If `TASKDESK_POLICY_ENFORCE` is later enabled for project/work-item sources:
- A `member` creator would be ALLOWED `project:update`, delete, assign and similar by the declarative decision on their own project.
- A manager creator would be denied `time_entry:update_any`.

The same already holds for any admin-added project-lead membership. Recommend noting it in the strict-enforcement rollout checklist. If it should be avoided, the fix is to grant a role that does not lower or raise workspace authority, or to compute authority as the union (most-privileged) of workspace and project roles at the evaluator. It is not needed for this PR.

## Other checks
- Decision 1 (reach, not route authority): confirmed. Member creator reads, lists and works items, and every project-write route stays 403.
- Decision 2 (revoke on soft delete): correct and conservative. Revoke runs in the same transaction as the soft delete. No project restore or purge route exists, so no re-grant gap. Only `project_creator` origin is revoked (M4 proves admin and external grants survive).
- Migration 0124:
  - Append-only. The journal entry idx 124 has a `when` later than 0123's. The only edit to the existing journal is a removed stray blank line near idx 120/121, which is harmless.
  - `created_by` is a nullable text FK to `person.id` with ON DELETE SET NULL, so existing rows are unaffected.
  - The CHECK drop and re-add is a strict superset of the old constraints, so existing rows still validate.
  - The seed is `INSERT ... WHERE NOT EXISTS` on (scope, workspace, key), backed by the unique index `role_scope_workspace_key_unique`.
  - The role `workspace_id` equals the project's workspace, which satisfies the anchoring check in `resolve-identity`.
  - No native write path can create a same-keyed project-scope row (`create-workspace-role` writes the legacy `workspace_role` table), so the fail-closed skip is only a defensive branch.
- Exemptions: the `sees_all` skip is covered (M1 killed). The same-keyed untrusted-row skip is covered (M5 killed).
- Interaction with open PR #742 (head 8e4ddd48, trial merge in the scratch worktree):
  - Textual conflict only in `docs/07-planning/decision-log.md` (two new entries at the top). Both entries must be kept, so resolve by keeping both.
  - No code conflicts.
  - On the combined tree, 8 files / 152 tests pass: the new file plus project-list, project-reach-reads, project-reach-writes, project-reorder, owner-reach and workspace-owner-admin.
  - Probe: a manager creator and a member creator each see their own project in `GET /api/project`. Both find their work item through `/api/search`. A member does NOT see the manager's project. So #742's reach filter does not hide a creator's own project.

## Mutation testing (10 mutants against project-creator-lead.test.ts)
| Mutant | Result |
| --- | --- |
| M1 drop the `sees_all` skip | killed |
| M2 no revoke on project delete | killed |
| M3 no grant audit row | killed |
| M4 revoke ignores `direct_origin` | killed |
| M5 trust a non-system same-keyed role | killed |
| M6 drop the still-a-member guard on revoke | killed |
| M7 `created_by` not written | killed (4 tests) |
| M8 drop the staff-side check in `lockCreatorPerson` | SURVIVED |
| M9 grant not projected onto `membership` | killed (8 tests) |
| M10 project-kind revoke widened to the whole workspace | killed |

## Findings
- Blocking: none.
- N1 (non-blocking): latent strict-mode divergence, described under Decision 3.
- N2 (non-blocking): the `lockCreatorPerson` staff-side check is unpinned (M8 survived). A customer-side person cannot reach `POST /api/project`, so it is defensive only. A one-line direct-call unit test would close it.
- N3 (non-blocking): the journal diff includes a whitespace-only removal in existing history. Harmless but touches an old region.
- N4 (non-blocking, observation): shadow-mode comparison of legacy against declarative will now show divergence for creators (a member creator allowed declaratively and denied by legacy). Not inspected: shadow tally and logger consumers.

## Residual, not checked
- Full integration suite.
- The remaining revoke wiring (leave, erasure) beyond the PR's own tests, which M6 and the file's remove/leave tests cover.
- Shadow-event consumers.
- Container build and UAT.

**Verdict:** APPROVE (ordinary review A, no blocking findings) at 161a8d76b2891b87af4e9e6bd5b20b428a5ef9a7. Security-scope GPT-6 Sol review is still required separately (migration and permissions paths).
<!-- END REPORT (sha256 40a97fb8c1f7c7e42a657f169c679308be124a87b0842a60632599d4ccaf0e58) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/744-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 aa2c9c6f8d7daf3182260781d7d7f6e8f2ce44f71adbe602bfedc6f2d74e18d2) -->
# PR #744 ordinary review B (design, migration, docs, whole system)

**Reviewed head:** 161a8d76b2891b87af4e9e6bd5b20b428a5ef9a7
**Base:** 2e03855e (merge-base with origin/main at review start; origin/main is now f4f5bf78, #735)
**Model / context:** Claude Sonnet 5.5, fresh independent context. Did not author, direct or remediate. Did not read reviewer A's report.
**Method:** scratch detached worktree at the exact head (removed after), private Postgres 18 container `rvb744-pg` (id a6b816f3b52c..., removed by exact id), main checkout untouched.

## Verdict
**APPROVE, no blocking findings.** Four non-blocking observations below (N1 is the one worth a follow-up).

## Commands and counts
| Check | Result |
| --- | --- |
| Manual apply of migrations 0000-0123 via psql, seed 3 workspaces (one with an untrusted same-key non-system role), apply 0124, then re-run the 0124 seed block twice | applied clean; 2 roles seeded (is_system, 37 caps), untrusted row untouched; re-runs insert 0 rows (idempotent) |
| 0124 role capabilities vs rbac.md `lead` row (37 vs 37, set diff) | identical |
| `drizzle-kit check` | "Everything's fine" |
| Snapshot 0124 vs 0123 diff | only: new id/prevId chain, the two CHECK values, `project.created_by` column and FK (`ON DELETE set null`). Nothing else |
| `project.created_by` | nullable text; FK `project_created_by_person_id_fk`, confdeltype `n` (set null) |
| `tests/api-integration/project-creator-lead.test.ts` + `workspace-owner-admin-reach.test.ts` (private DB) | 2 files, 48 tests pass |
| Full serialized integration, `CI=true` (`vitest run --config vitest.integration.config.ts`, Testcontainers PG) | **198 files, 2805 tests passed** (782 s) |
| `pnpm turbo run test:permissions --force` | 16 files, 104 tests pass |
| `pnpm lint:ci` | 0 errors, 212 warnings, 1 info (warning class pre-existing) |
| `pnpm turbo run typecheck --force` | 9/9 tasks successful, 0 cached |
| Trial merges (no commit, scratch tree) | #744 + origin/main f4f5bf78: clean. #744 + #742 (8e4ddd48): one conflict, docs/07-planning/decision-log.md. #742 + main: clean |

## Findings against the assigned angles

1. **Migration 0124.** Append-only and idempotent (seed guarded by NOT EXISTS on the (scope, workspace, key) unique index; the DDL half is run once by drizzle as usual). Journal: the only change to existing content is deletion of one stray blank line between idx 120 and 121 (whitespace only, no entry, tag or `when` changed; no earlier snapshot or SQL touched; new `when` 1791988639038 is greater than 0123's). No CI gate or rule I could find in AGENTS.md or docs/04-engineering/migrations.md forbids that; acceptable but see N2. No other open PR claims number 0124 (#589 is the stale integration train).
2. **New workspaces.** `create-workspace.ts` calls `ensureProjectLeadRole(tx, workspace.id)` inside the creation transaction after `seedWorkspaceDefaults`; a test covers it and the full suite is green. Also created on demand at first grant, with `onConflictDoNothing`, so the race is safe.
3. **Role capabilities and edit surface.** Exactly equals rbac.md lead (37). No role edit or delete route exists anywhere in apps/api/src (no consumer of `is_editable` outside the #733 carrier seed; roleTable writers are only workspace-admin-reach, project-creator-grant and workspace-delete). IdP mappings cannot target a project-scope role (validator refuses; test pins it). Same-key non-system row fails closed (tested, and I confirmed the migration leaves it alone).
4. **Docs.** Decision-log entry is at the top, newest first, wording matches Thomas's decision (grant, audit, `created_by`, no backfill, reversal). rbac.md step 3, the project-lead role paragraph and the exception sentence are consistent with the code. data-model.md `project`, `role`, `membership_grant` rows and ADR 0015 origin line updated. No stale enumeration of `direct_origin` values found outside historical security-review notes.
5. **Interaction with #742 / main.** See conflict table above. Only textual conflict with #742 is the decision-log top-of-file insertion (both add a newest entry); trivial. rbac.md, project/index.ts auto-merge. Semantically #744 is the complement of #742: #742 reach-filters the project list and search, which is exactly why a creator needs the grant. Merge order #744 then #742 (or reverse) is fine apart from the decision-log hunk. Both rbac.md edits are in different regions.
6. **Runs.** All green (table above).

## Non-blocking observations
- **N1 (design, follow-up).** A creator who is later promoted to owner or admin keeps their `project_creator` project-scope grant. `syncWorkspaceAdminReach` does not mention it. Under the declarative `authorityFor`, a project-scope grant replaces workspace authority on that project, which is the exact reason the grant is skipped at creation for sees_all holders. Enforced routes still gate on the workspace role, so no live authority change, but the declarative evaluator would see lead-only capabilities for a new admin on their old project. Suggest: revoke `project_creator` grants when a person gains sees_all (and a test). Conversely, an owner demoted to manager has no grant on projects they created (created_by is set, so a later reconcile is possible). No promotion or demotion test exists.
- **N2 (process).** The journal blank-line removal is unrelated whitespace churn in a migration control file; harmless, but it makes the diff of an immutable file non-empty. Prefer leaving it.
- **N3 (contract).** `project.created_by` is now returned in raw project rows (create, get, list) but `projectSchema` in apps/api/src/project/response.ts does not declare it, so tests/api-contract/openapi.json is not updated. It exposes a staff person id only. Either declare it or strip it; I did not run `test:contract`.
- **N4 (observability).** When a workspace holds an untrusted same-key `project-lead` row, `grantProjectCreatorLead` returns `skipped_no_role` silently (no log or audit), so the creator quietly gets no reach. Fail closed is right; a warning log would help.

## Not checked
`test:contract` and web/e2e suites; image build and boot; behaviour on a populated production-size `membership_grant` table when adding the CHECKs (the table scan is small, not measured); #742 semantics beyond a trial merge.
<!-- END REPORT (sha256 aa2c9c6f8d7daf3182260781d7d7f6e8f2ce44f71adbe602bfedc6f2d74e18d2) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/744-2220-ordinary-delta-a-sonnet.md; Claude Sonnet 5.5; sha256 b57f2e7dfa787ce97a53ca71a25ca2e2fed865bacfd4c3de1a2a27a87ba0938d) -->
# PR #744 exact-head delta review (ordinary A, Claude Sonnet 5.5)

**Reviewed head:** 2220a1fcbdfacd934fb86f7e2b8ecd46195a3912
**Previously approved:** 161a8d76b2891b87af4e9e6bd5b20b428a5ef9a7. Fresh scratch worktree and private postgres (both removed afterwards).

## Merge
- Main 16234794 is an ancestor of the head. Merge commit 8d7369bf.
- `git show --cc` on it prints no combined diff, so there are no conflict-resolution hunks: the merge is clean.
- The PR's own delta (8d7369bf..2220a1fc) is 6 files: `project-creator-grant.ts`, `response.ts`, `workspace-admin-reach.ts`, `rbac.md`, `openapi.json`, and the test file.

## Runs
- `project-creator-lead` integration file: 1 file / 22 tests pass.
- `test:permissions`: 16 files / 104 tests pass.
- `check:openapi`: matches the API (284 operations), exit 0.

## Mutations
- M8 (drop the staff check in `lockCreatorPerson`): now KILLED by the new "lockCreatorPerson returns only a staff person" test.
- P1 (promotion revoke disabled): killed.
- P2 (`console.warn` removed): killed.

## Promotion revoke (B-N1)
- Placement is correct. The revoke is in `syncWorkspaceAdminReach`, in the promoting transaction, when `roleId !== null` (the person is now owner or admin).
- It reuses `revokeCreatorGrants` with `direct_origin = 'project_creator'` only, so admin-made and external grants are untouched. It writes one audit row per grant with reason `workspace_sees_all_granted`.
- Idempotent re-syncs and the boot reconcile revoke zero rows.
- The revoke is correct because a project-scope role would replace the workspace authority of a `sees_all` holder under the declarative evaluator. That is the reason creation skips them.

**Demotion, reported as asked.**
- A demoted admin does NOT get the creator grant back.
- Demoting drops `sees_all`, so the former admin who created projects loses reach on them. Their reach is whatever other grants they hold.
- This follows the decision as written: the grant is made at create time only, and there is no re-derive from `created_by`. I judge it consistent with that decision.
- It is a real product edge. `created_by` is retained, so a later "re-grant on demotion" is possible. If Thomas wants creators to keep reach after demotion, that needs a decision-log line. There is no test pinning demotion behaviour either way.
- Non-blocking.

## OpenAPI (B-N3)
- `createdBy` is declared in `projectSchema` as nullable string.
- `openapi.json` has the property and it is added to `required`, so it matches the schema. `check:openapi` passes.
- `projectSchema` is used by the create, get, reorder, update, delete, archive and restore responses, and the column is returned by those handlers.
- It exposes an opaque staff person id to anyone who can read the project, which is the same convention as other actor columns.

## Warn (B-N4)
`console.warn` fires on the fail-closed skip and a test asserts it. This is fine. Using the structured logger instead of `console.warn` would be a nicety.

## Findings
- Blocking: none.
- Non-blocking N5: the promotion revoke is placed after the early return for an admin-made explicit `sees_all` direct grant. A creator holding such a grant would keep a creator grant. This is not reachable via native write paths, and it is harmless.
- Non-blocking N6: no demotion test (see above).

**Verdict:** APPROVE at 2220a1fcbdfacd934fb86f7e2b8ecd46195a3912. Security-scope Sol review is still required separately.
<!-- END REPORT (sha256 b57f2e7dfa787ce97a53ca71a25ca2e2fed865bacfd4c3de1a2a27a87ba0938d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/744-security-opus.md; Claude Opus 5.5; sha256 0464d5931b8731d65da21b7f9020162677865f8512200451403a03e931168c87) -->
# PR #744 security review: Claude Opus 5.5

**PR:** #744 "feat(api): a project's creator holds a project-lead membership" (branch `codex/creator-project-lead`)
**Reviewed head:** 2220a1fcbdfacd934fb86f7e2b8ecd46195a3912
**Base:** main 16234794f54df11891b17f0132f0107e8848fff0 (merge-base of the head; confirmed with `gh pr view 744 --json headRefOid,baseRefOid`)
**Model:** Claude Opus 5.5 (claude-opus-5-5)
**Role:** independent security reviewer. I did not author, direct or remediate this change.
**Method:**
- A detached scratch worktree at the exact head, removed afterwards.
- A private Postgres 18 container (id `3ae15a2d81fb…`), with databases `sec744_test` and `sec744mig_test`. I removed it by exact id.
- The main checkout was not modified. Its `git status` was identical before and after.

**Note on routing.** CLAUDE.md names GPT-6 Sol as the mandatory security gate. This review is the Opus pass the orchestrator requested. Whether it satisfies or adds to the Sol gate is the orchestrator's call. This note does not decide that.

## Surfaces examined
- `apps/api/src/project/project-creator-grant.ts`: the whole file (grant, role ensure, the three revoke entry points, lock order).
- `apps/api/src/project/controllers/create-project.ts`, `delete-project.ts`, `project/index.ts` (the create handler's body destructuring), `update-project.ts` (the explicit `.set` field list), `response.ts`.
- `workspace-admin-reach.ts` (`syncWorkspaceAdminReach` and the promotion revoke placement), and every caller of it:
  - add member;
  - update role;
  - transfer ownership;
  - leave;
  - remove;
  - create workspace;
  - erasure;
  - accept invitation;
  - boot reconcile.
- The three `workspace_user` delete sites: remove, leave and erasure. All three now revoke.
- `packages/permissions/src/evaluator.ts` (`authorityFor` project override), `apps/api/src/utils/has-project-reach.ts` (`projectReadDecision`), `workspace-access-middleware.ts` (the `requireProjectReach` 403/404 path), `require-workspace-capability.ts` (handler checks read the workspace role), and the work-item assign/delete handler checks.
- `identity/repository.ts` (`validateIdpMappingRole` / `hasSafeOidcRoleCapabilities`: only organisation/workspace scope is accepted).
- I searched for every `membership_grant` insert and every `role` insert/update. There is no native role-editor or project-member route that writes `role` or `membership_grant`. The only `project` inserts are the create controller and `scripts/seed-profile.ts`, and the seed path writes no grant.
- Migration 0124, the journal, `schema.ts` CHECK definitions, and `openapi.json` (which operations carry the `Project` schema).
- Prior evidence (read, not trusted):
  - `creator-lead-impl-sonnet.md`
  - `creator-lead-ordinary-a-sonnet.md`
  - `744-ordinary-b-sonnet.md`
  - `744-2220-ordinary-delta-a-sonnet.md`

## Commands and results
| Command | Result |
| --- | --- |
| `gh pr view 744 --json headRefOid,baseRefOid` | head 2220a1fc…, base 16234794… |
| `vitest --config vitest.integration.config.ts tests/api-integration/project-creator-lead.test.ts` | 1 file, 22/22 pass |
| Related integration files (`project-*` except creator, `workspace-owner-admin-*`, `workspace-membership-*`, `workspace-delete-role-dependents`, `account-deletion`) | 24 files, 413/413 pass |
| `pnpm test:permissions` (turbo) | 16 files, 104/104 pass, exit 0 |
| `gitleaks git --log-opts=16234794..2220a1fc` (v8.30.1) | 2 commits scanned, no leaks found |
| Policy-registry enumeration (tsx script over `policyRegistry.entries`) | 30 project/work_item-scope routes declare a capability in lead∖member or lead∖manager. The sets are listed under Q2. |
| My own probe file (a temporary `zz-sec744-opus-probe.test.ts`, deleted afterwards) | 5/5 pass. Results are under Q1, Q2 and Q3. |
| Migration 0124 run twice on a populated pre-0124 DB (0000–0123 applied by psql, then seeded with 2 workspaces, a `system_backfill` sees_all grant and a project) | Results under Q4 |

### Mutations (8, all run against `project-creator-lead.test.ts`)
None of these repeats a prior reviewer's mutant.

| # | Mutation | Result |
| --- | --- | --- |
| S1 | Drop the revoke call in `remove-workspace-member.ts` | killed (1 test) |
| S2 | Drop the revoke call in `leave-workspace.ts` | killed (1) |
| S3 | Drop the revoke call in `delete-account-data.ts` | killed (1) |
| S4 | Invert the promotion condition (`roleId === null`) in `syncWorkspaceAdminReach` | killed (1) |
| S5 | Migration literal gains `"project:delete"` | killed (1) |
| S6 | `ensureProjectLeadRole` capabilities gain `"project:delete"` | killed (1) |
| S7 | `ensureProjectLeadRole` rank 50 → 100 | killed (1) |
| S8 | The creator grant written with `seesAll: true` | killed (3) |

## Answers to the security questions

### Q1 Over-grant
**No over-grant found.**

- **Spoofing.** The create handler destructures a fixed field list and passes `c.get("userId")`. `update-project.ts` sets an explicit column list.
  - Probe: `POST /api/project` with `createdBy`/`created_by` set to another person returned 200. `created_by` was the caller, the victim had 0 grants and the victim got 404.
  - `PUT` with `createdBy` left the column unchanged.
- **Other insert paths.** Only `scripts/seed-profile.ts` inserts projects outside the controller, and it writes no grant. There is no duplication, template or import route that creates projects. `import-tasks` only reads `project`.
- **Who can create.**
  - Probe: a viewer got 403 and a non-member got 403. Neither wrote any `project_creator` grant.
  - `lockCreatorPerson` requires `side = 'staff'`, so a customer person never gets a grant.
  - With an API key, the key owner gets the grant. The key's capability clamp still applies to every later call.
  - With impersonation, the impersonated user gets the grant, which is the normal impersonation semantics.
- **Capability set.**
  - Migration seed literal = `BUILT_IN_ROLES.lead` exactly: 37 capabilities, rank 50, `is_system`. This is pinned by a test (S5 and S6 killed).
  - `authorityFor` clamps project-scope grants to the project tier, so `workspace:read` has no project-scope effect.
- **Editability and IdP mappings.**
  - The row is `is_editable = true`, but no native route edits `role` rows. So in practice it cannot be edited today.
  - IdP mappings are refused: `hasSafeOidcRoleCapabilities` accepts only organisation/workspace scope, and the PR test pins this.
  - A non-system same-keyed row fails closed with a warning.
- **No transitive granting.** No route lets a `project:manage_members` holder write `membership_grant`.

### Q2 Authority changes
**Confirmed: no enforced escalation and no enforced loss.**

- **lead∖member:** `project:update, project:manage_members, work_item:delete, work_item:assign, work_item:export, label:manage, saved_view:share, intake:triage, time_entry:read_any, time_entry:log_backdated, report:export, member:invite, automation:manage`.
- **member∖lead:** `saved_view:create`.

The probe matrix used real routes on each creator's own project, with a work item the owner created:

| Route | member creator | viewer-demoted creator | manager creator |
| --- | --- | --- | --- |
| GET project (reach) | 200 | 200 | 200 |
| create work item | 200 | 403 | 200 |
| PUT project | 403 | 403 | 200 |
| PATCH health | 403 | 403 | 200 |
| POST milestone | 403 | 403 | 200 |
| POST prerequisite | 403 | 403 | 200 |
| POST column | 403 | 403 | 200 |
| assign to other | 403 | 403 | 400 (past auth) |
| DELETE work item | 403 | 403 | 200 |
| archive | 403 | 403 | 200 |
| DELETE project | 403 | 403 | 403 (manager lacks `project:delete`; not a regression) |

What this shows:
- The handler-level checks (`assertCallerHasCapability*`, `requireWorkspaceCapability`, `requireWorkspacePermission`) read the workspace role. They are ANDed with `projectReadDecision`, so the project-scope override never raises a member or viewer.
- The only manager capability the override removes on a declared route is `time_entry:update_any`. That route is `deferCapability: true`, so the declarative result does not decide it. A manager creator keeps manager authority.
- I could not exercise `GET /api/time-entry/task/{taskId}`: it returned 404 for every actor, including the owner, because of a wrong probe path on my side. Statically, it is `deferCapability: true` and gated by `requireWorkspaceCapability("time_entry:read_any")`, which is the legacy gate.

### Q3 Revocation
**Revocation is complete for every native writer.**

- **Wired:** remove, leave and erasure (each after the `workspace_user` delete, guarded by "still a member"), project soft delete (same transaction), and promotion to owner/admin (inside `syncWorkspaceAdminReach`, which covers role update, transfer, add, accept-invitation and the boot reconcile). Workspace delete is covered by the #732 helper.
- Each path is pinned by a killed mutant (S1–S4 here, M2/M6 in the prior reviews).
- Probe: removal followed by re-add does not bring the grant back (404).
- **Promotion race.** Both transactions lock the person row `FOR UPDATE` first. The sees_all read and the revoke candidate read happen after the lock, under READ COMMITTED. Both orderings end correctly.
- **Removal race: a window exists.** See finding N1.

### Q4 Migration 0124
**The migration is safe.**

- **Populated pre-0124 DB, first run:** every statement succeeds. 2 `project-lead` rows are seeded (one per workspace, 37 capabilities, rank 50, system). The existing `system_backfill` grant still validates. 0 `project_creator` grants are created (no backfill). The existing project has `created_by` NULL.
- **Second run of the whole file:** the seed INSERT is a no-op (`INSERT 0 0`) and the CHECK drop/re-add is fine. `ADD COLUMN` and `ADD CONSTRAINT …_fk` fail with "already exists". This is normal for drizzle DDL, because the journal guards it and the migrator runs pending files in one transaction. Only the data seed claims idempotency, and it holds.
- **Negative checks after the migration:**
  - A `project_creator` grant with a `granted_by_person_id` is rejected by `membership_grant_source_shape_check`.
  - A `direct_origin = 'bogus'` value is rejected by `membership_grant_direct_origin_check`.
- **The new CHECKs are a strict superset of the old ones.** The FK is nullable, `ON DELETE SET NULL`.

### Q5 Exposure
**Acceptable.**

- In `openapi.json`, `createdBy` is carried only by the `Project` schema. That schema is used by `POST /project`, `GET/PUT/DELETE /project/{id}`, `PUT /project/reorder` and archive/unarchive.
- All of those are staff routes gated by `project:create/read/update/delete` with reach. The customer role holds none of these capabilities.
- No portal schema includes the project row. The `intake/repository.ts` `select()` of `project` is internal and is not serialized.
- The value is an opaque staff `person.id`, the same convention as other actor columns.

### Q6 Mutations and runs
- 8 of my own mutations, all killed.
- New integration file: 22/22. `test:permissions`: 104/104. gitleaks: clean.

## Findings

**Blocking:** none.

**Non-blocking:**

- **N1: create/remove race leaves a dormant creator grant (low).**
  - `createProjectRow` does not re-check workspace membership after `lockCreatorPerson`.
  - Suppose the creator's removal commits between the route middleware's membership check and the create transaction. Then the project is created and an active `project_creator` grant is written for a non-member. Removal's revoke already ran and saw nothing.
  - I reproduced this by calling the controller directly after removal:
    - grant count 1, active;
    - project 404 while not a member;
    - **200 after being re-added, even as `viewer`**.
  - Impact is limited:
    - the window is milliseconds;
    - the actor is the person being removed;
    - the reach is to the project they themselves created;
    - admin-made grants survive removal by design anyway.
  - Fix (small): after `lockCreatorPerson`, call `workspaceMemberRoles(tx, workspaceId, creatorUserId)` and abort the transaction when it is empty. The person lock already serializes with removal's `syncWorkspaceAdminReach` lock.
- **N2: latent strict-mode divergence (concurs with A-N1, extended).**
  - Under `authorityFor`, a creator demoted to `viewer` keeps the grant (pinned by the PR test). That creator, and a `member` creator, hold lead write capabilities in the declarative result on their project.
  - Today the legacy gates deny this, as my matrix shows.
  - It must be on the `TASKDESK_POLICY_ENFORCE` rollout checklist. Alternatively, the evaluator should take the union instead of the override for this origin before strict mode is enabled.
- **N3: the grant audit row records no `apiKeyId`.** A project created with an API key yields a `membership.changed` row attributed to the person only. `impersonatorId` is not populated by any writer in the repo, so that part is a pre-existing, repo-wide gap.
- **N4: `is_editable = true` on the `project-lead` row.** This is harmless today because there is no editor for `role` rows. A future role editor must treat edits to this row as changing every creator's authority, or set it non-editable.
- **N5 (concurs with delta-A N5/N6).**
  - An admin-made workspace direct grant short-circuits `syncWorkspaceAdminReach` before the promotion revoke. No native path writes such a grant.
  - No test pins the demotion behaviour.

## Residual risk / not checked
- Full serialized integration suite (only the 25 related files were run), container image build, and UAT.
- Shadow-tally and logger consumers of the new legacy/declarative divergence.
- A true concurrent (two-connection) race test. N1 was shown by ordering the steps in sequence, not by actual concurrency.
- The time-entry `read_any` routes were checked statically only.

**Verdict:** CLEAR
<!-- END REPORT (sha256 0464d5931b8731d65da21b7f9020162677865f8512200451403a03e931168c87) -->
