# Project creator/grant query ownership — authentic review records

**Reviewed head:** `67279e456b3aa477d4ee6a6d510512631c9017de`

Two fresh independent ordinary contexts and a further fresh independent full GPT-6.1 Sol context cleared this bounded source. These are source reviews, not current hosted CI/runtime or whole-project/#580/phase acceptance. Root publishes the authentic reports and is not a reviewer. The author handoff is provenance, not independent approval. Original private author report and exact canonical copy remain retained with custody receipt; no credentials are published.

## Retained report project580-creator-extraction-author-luna.md

SHA-256 `af13cea358dd375b950affbe4c3694fac56c9f64516551381caff372d32d48bb`

# #580 project creator/grant query extraction — author handoff

Status: implementation complete for the bounded project creator/grant extraction; local branch awaits conductor review. This is not #580 completion, merge readiness, or a whole-project conversion claim.

## Source and commits

- Accepted base: `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5` (`origin/main` at task start).
- Branch: `codex/query-ownership-580-project-creator` in `/Users/heinthura/.codex/worktrees/580-project-creator-query-extraction/Ticketing.v2`.
- Current full head: `67279e456b3aa477d4ee6a6d510512631c9017de`.
- Commits, in order:
  - `7e21e9636a22f5b6e330135c98a9ff8e4da695ae` — extract creator/grant SQL into named project repository.
  - `33e2fb8cc6cb58baa5bf6b6ad9f0dcf5d2fe2ef5` — formatter corrections.
  - `15ffcfa9b5f37d70a45ef1bc17ff33e3f6c6775d` — add transaction rollback regression.
  - `66bcef52380524c0a3ec26e8cb8ddef5f78b9f9e` — preserve non-null `person.organisation_id` result type.
  - `67279e456b3aa477d4ee6a6d510512631c9017de` — validate project id against supplied workspace in repository predicate and add mismatched-scope assertion.

Changed paths only:
- `apps/api/src/project/project-creator-grant.ts`
- `apps/api/src/project/project-creator-grant.repository.ts` (new named repository)
- `tests/api-integration/project-creator-lead.test.ts`

## Implementation boundary

Direct statements for project creator role lookup/creation, creator-person reads and lock, workspace `sees_all` check, active direct grant check/insertion, candidate listing, ordered person/grant locks, and grant revocation now live in `project-creator-grant.repository.ts`. Every repository operation receives the actual `Executor` first, awaits statements, and returns materialized rows/scalars/void. The scoped project revocation predicate checks both project id and workspace id. The existing public grant/revoke orchestration functions, `create-project.ts`, transaction ownership, membership projection, audit order, route authorization, role trust/provenance and lifecycle behavior remain intact.

Added two assertions in the existing integration suite: a creator grant revoke called with a mismatched workspace does not revoke the grant; and a deliberate transaction rollback leaves the creator grant, projected membership and audit state unchanged. No new feature, table, capability, role semantics, route or dependency was added. No pending #785 helper was imported; no attachment code was touched.

## Checks and PostgreSQL evidence

- `pnpm install --frozen-lockfile` — succeeded; lockfile unchanged.
- `pnpm exec biome check --write apps/api/src/project/project-creator-grant.ts apps/api/src/project/project-creator-grant.repository.ts tests/api-integration/project-creator-lead.test.ts` — completed with two existing warnings in the test file (`noExplicitAny` at its `call` helper and unused `world` argument in `expectCreatorGrantWritten`); no warning points to added lines.
- `pnpm exec biome check apps/api/src/project/project-creator-grant.ts apps/api/src/project/project-creator-grant.repository.ts tests/api-integration/project-creator-lead.test.ts` — exit 0, same two warnings.
- `pnpm exec turbo run typecheck --filter=@taskdesk/api` — passed (4 tasks).
- `git diff --check` — passed; final worktree clean.
- Focused PostgreSQL command: `env -u CI pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/project-creator-lead.test.ts` with `TASKDESK_DATABASE_URL` loaded from a private mode-0600 env file (the credential value is intentionally omitted here). Final run: **1 file passed; 23 tests passed; exit 0; 15.66 s**. The first run before the workspace-scope assertion also passed 1 file / 23 tests / exit 0.

Disposable DB proof before final run: container `codex-580-project-creator-pg-20261016-a1`, full ID `5b9751b2a2ff2b4cb5e435b69d4267ab1302fe806f47f66b8c60c93cb171fb71`, label `codex.owner=project580-creator-extraction`, database `taskdesk_project_creator_test`, published only on `127.0.0.1` dynamic port `32776`, `pg_isready` succeeded. The container ID and label were rechecked before exact-ID stop/removal. Container and private credential env file were removed after the run. Initial/final Docker ID inventories are retained as `project580-creator-docker-before.txt` and `project580-creator-docker-after.txt`; no other resource was stopped or removed.

## Residuals and handoff

- `createProjectRow` in `apps/api/src/project/controllers/create-project.ts` still owns its direct advisory lock, slug-claim, max-position, project, slug insert and default-column statements. They were deliberately excluded as a separate project query-ownership slice.
- Structural `check:queries` remains outside this bounded implementation; no gate wiring or overall residual inventory was attempted.
- Initial direct `pnpm --filter @taskdesk/api typecheck` failed because workspace package declarations were not built in the new worktree. The required root Turbo command builds the dependencies and passed; its first run caught the person organization annotation issue, corrected in commit `66bcef5`.
- Current head is local only. No push, PR, hosted CI, review claim, merge, Docker image, browser or release work was performed. Next action: conductor reviews exact head `67279e456b3aa477d4ee6a6d510512631c9017de` before deciding whether to push/open the candidate.

The earlier planning artifact is unchanged. Its accepted-#790 historical-head sentence is corrected in the separate private file `project580-current-project-slice-plan-luna-erratum.md`.

## Retained report project580-creator-ordinary-a-luna.md

SHA-256 `5a3645dcc8670bf88c4bdd6253c82c7eefa93d01b6df3b75301828e90d558570`

# #580 project creator/grant extraction — ordinary review A

**Model:** GPT-6 Luna
**Role:** Independent ordinary reviewer (source/executor/conservation)
**Independence:** Fresh review context; did not author, direct, or remediate this candidate.
**Reviewed head:** `67279e456b3aa477d4ee6a6d510512631c9017de`
**Comparison base:** `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`
**Scope:** Complete diff and callers for `apps/api/src/project/project-creator-grant.ts`, new `apps/api/src/project/project-creator-grant.repository.ts`, and `tests/api-integration/project-creator-lead.test.ts`; RBAC and data-model contract; repository Executor contract. Focused on source/query conservation, executor use, lock and statement order, query scope, and trust boundary.

## Checks performed

- Read the exact three-path diff and both complete current source files.
- Compared the original implementation against the extracted operations, including create/ensure role, creator lock, sees-all check, active grant check and insert, grant revocation, membership projection, and audit sequencing.
- Traced callers in project creation/deletion, workspace create/leave/member removal, account erasure, and workspace admin reach.
- Read `docs/01-architecture/rbac.md`, `docs/01-architecture/data-model.md`, the 2026-10-14 creator decision, and `apps/api/src/database/executor.ts`.
- Checked `git diff --check` (passed). No tests or typecheck were run by this reviewer; author-reported checks were not treated as my execution evidence.

## Findings

No blocking findings.

The extraction preserves the transaction boundary: callers retain transaction ownership, repository functions receive the actual executor first and await statements, and no repository function opens a transaction or returns a builder. Grant creation still follows sees-all and trusted-system-role checks, then the existing-direct-grant check, insert, projection, and audit in the same order. The locked creator read still returns the same staff-person facts used by the service.

Revocation keeps its original person-row-first deterministic locking, then ordered grant-row locking, update, projection, and per-grant audit sequence. The moved predicate still selects only active direct `project_creator` grants. Project-specific revoke now additionally constrains the subquery by both project ID and supplied workspace ID; the added mismatched-workspace assertion covers that behavior. Workspace member revocation remains scoped to projects in that workspace and the person. Empty-input guards and materialized return shapes are preserved.

The repository classifies row/scalar operations from the actual identity/trust boundary, without exporting caller-readable cross-organization APIs or importing pending #785 helpers. The project-lead role remains system-row gated; creator staff-side validation and workspace `sees_all` suppression remain in the orchestration layer. No grant source, role semantics, audit behavior, or lifecycle caller changed.

## Non-blocking observations

- The new project predicate's workspace check is a useful scope hardening change beyond a literal query move and is covered by a negative integration assertion.
- Repository-level functions are exported from the module for internal composition, but current callers outside the orchestration module continue to use only the existing public helpers/constants; I found no new cross-org read surface.

## Verdict

**PASS — ordinary review A clears this exact head for the reviewed scope.** This verdict is not security review, feature acceptance, #580 completion, stage acceptance, or merge authorization.

## Retained report project580-creator-ordinary-b-luna.md

SHA-256 `9a5fc370b1599a5b56a512d72b26911521438b4f6f4ad5e635098be40007c158`

# #580 project creator/grant query extraction — ordinary review B

**Model:** GPT-6 Luna (assigned ordinaryB review context)
**Role:** Fresh independent ordinary reviewer
**Independence:** I did not author, direct, or remediate this candidate. I reviewed the exact source independently; the author's handoff was consulted only for scope/provenance and was not treated as a verdict.
**Reviewed head:** `67279e456b3aa477d4ee6a6d510512631c9017de`
**Comparison base:** `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`
**Scope:** `project-creator-grant.ts` extraction into the named repository, existing real PostgreSQL integration test additions, and directly relevant callers/contracts.

## Checks performed

- Confirmed checkout HEAD and clean worktree; inspected the complete three-file diff and complete extracted repository/service sources.
- Read repository workflow/policy instructions and the relevant project creator decision, RBAC reach and project-lead role contract, plus database executor typing.
- Traced actual callers in project creation, project deletion, workspace membership removal/leave, account erasure, workspace role reach, and workspace creation.
- Checked the actual SQL predicates and transaction orchestration for executor propagation, scope validation, lock sequence, direct-origin filtering, role trust, projection/audit atomicity and rollback coverage.
- No tests or commands beyond source inspection were run by this reviewer. Author-reported checks were not counted as mine.

## Findings

No blocking or non-blocking findings.

The extraction preserves the caller's transaction executor through every repository operation. The creator path still locks the staff person before grant writes and appends audit after grant/projection. Revocation still locks candidate people in deterministic id order before ordered grant locks, updates only active direct grants with `direct_origin = 'project_creator'`, reprojects, and appends audit in the same transaction. Role lookup remains workspace/project-scope/key constrained and grants only an `is_system` row; `sees_all` skip and the active-direct-grant idempotency check are preserved. Lifecycle subqueries bind project IDs to the supplied workspace, including the project-specific filter. The added mismatch assertion exercises this boundary, and the rollback test asserts grant, projection and audit rollback together.

The repository exposes named query functions but no new caller-readable cross-organization API; callers remain the existing service orchestration. I found no import from #785 or change to role provenance/`sees_all` semantics. The nullable organization type on locked revoke-person rows reflects the schema and is consumed safely by the existing audit fallback.

## Verdict

**PASS** for this bounded extraction at exact head `67279e456b3aa477d4ee6a6d510512631c9017de` against base `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`.

This verdict covers only the reviewed bounded slice. It does not assert #580 completion, whole-project query ownership, test execution by this reviewer, or merge readiness.

## Retained report project580-creator-full-security-61-sol.md

SHA-256 `a0d2e89c21f8eb1976ae9b681f4da5520ea93ca3684d63608b29802602ae5746`

# #580 project creator/grant extraction — full independent security review

**Model:** GPT-6.1 Sol
**Role:** Fresh independent full Sol security reviewer
**Context:** /root/project580_creator_full_security_sol
**Independence:** This context did not author, direct or remediate the candidate. No source changes were made. The two fresh ordinary reports were read in full before the security analysis; their verdicts were inputs, not substitutes for independent inspection.
**Reviewed head:** 67279e456b3aa477d4ee6a6d510512631c9017de
**Comparison base:** 3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5
**Review depth:** FULL, bounded to the complete three-file net change and relevant authorization/lifecycle contracts and callers.

## Scope and checks actually performed

Confirmed HEAD twice, inspected clean worktree status, enumerated the exact three changed paths and read the complete source diff, complete current orchestration, complete new repository and complete added test cases. Compared moved statements against their base implementation. Ran `git diff --check 3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5 HEAD`: passed.

Read AGENTS.md, agent-workflow.md, CLAUDE.md, active-mission.md, the #580 D1–D4 decision entry, query-ownership/executor standards, multi-tenancy and monorepo scoped-query contracts, creator decision, relevant RBAC reach/project-lead passages and data-model entries. Inspected the actual Executor/Transaction types and person schema. Read both canonical ordinary A/B reports and author handoff in full.

Traced actual project-create route context through controller and creator helpers, project-delete transaction, member removal/leave, account-erasure lifecycle, workspace creation and workspace-admin-reach promotion. Searched the new repository's imports/callers; only the existing orchestration module imports it. Inspected integration helpers and the existing suite's security/lifecycle coverage, including the newly added mismatch and rollback assertions.

No PostgreSQL, Docker, browser, image build, hosted CI, push, source edits, or test/typecheck execution was performed by this reviewer. Author evidence reports a focused real PostgreSQL run of 1 file / 23 tests passed and API Turbo typecheck of 4 tasks passed at this candidate, plus formatting with two existing test-file warnings. Those are attributed author results, not my execution evidence. Private raw logs and credential material were neither printed nor published.

## Security analysis

Every extracted statement uses the actual first-parameter executor. No helper substitutes the default connection, creates or commits a transaction, leaks a builder or returns a deferred statement. Public service functions still require Transaction. Project insertion, grant/projection and audit remain owned by the same outer transaction. The internal predicate composes subqueries on that executor and is never exposed to callers.

The creator-person read is an authorization fact keyed by the authenticated route-context user ID, not a person ID supplied in the request body. Staff-side validation stays in the service; the returned organisationId is non-null, consistent with the schema. Role lookup and workspace sees-all checks are internal authorization facts, not caller-readable cross-organisation listing endpoints. The current create caller supplies its context-resolved workspace and the project just inserted there. Revocation facts and IDs feed internal lifecycle mutation and audit only. No new route or serialization surface bypasses resolved-identity reach, and no pending #785 wrapper is imported. The repository's exported functions are trusted internal composition functions, not standalone authorization entry points.

Role creation preserves BUILT_IN_ROLES.lead capabilities/rank, project scope, workspace key, system provenance and the existing conflict/re-read behavior. A same-key custom non-system row remains fail-closed. Existing system-role acceptance is unchanged; this extraction adds no role-mutator or IdP path. Grant insertion retains direct/project_creator provenance, seesAll=false, and no granting person. Workspace sees-all suppression prevents creator project scope from replacing owner/admin authority. The active-direct-grant check and person lock preserve existing idempotency and uniqueness behavior; an admin-made direct grant is not replaced.

Lifecycle selection remains restricted to active project-scope direct grants whose origin is project_creator. Member filters bind both person and workspace project set. The intentional project-filter change additionally binds project ID to workspace ID in SQL for both candidate listing and locked grant re-read. A mismatched pair now yields zero rather than touching a foreign-workspace creator grant. This is scope hardening, not merely a literal move. Soft-deleted rows remain visible to the predicate, so the existing soft-delete-then-revoke order still works. The added integration assertion targets that mismatch and the rest of the test still verifies legitimate deletion and isolation of the retained project.

Person rows are locked in deterministic ID order before ordered grant locks; the candidate read is non-locking and precedes those locks as before. Grant update uses only the locked selected IDs; projection follows and per-grant audit is last, all on the supplied transaction. Other grant origins remain intact. Existing lifecycle callers and their transaction/serialization responsibilities did not change. Account removal, leave, promotion to sees-all, project deletion and workspace cleanup retain their prior ownership. This review does not claim a new proof of every inherited concurrency interaction.

The rollback regression revokes a real creator grant through the caller transaction, confirms a separate connection still sees the committed unrevoked row while the transaction is open, deliberately throws, then verifies grant remains unrevoked, effective membership remains and no revoke audit persists. It meaningfully detects accidental default-connection grant writes and verifies the final atomic outcome. Source inspection independently confirms projection and audit use that same transaction. No test was skipped, weakened or focused in source.

## Findings and verdict

**Blocking findings:** None.

**Non-blocking findings:** None requiring candidate changes.

**Verdict: PASS — full independent security review clears this exact candidate for this bounded scope.** The source changes preserve the existing trust, provenance, transaction and lock boundaries; the intentional workspace predicate closes a scope mismatch without widening authority.

## Residuals and limits

This is neither merge authorization nor whole-project/#580/stage acceptance. Structural query gating and remaining create-project statements are outside this slice. Hosted required checks, image build/boot/health and applicable runtime acceptance remain the conductor's outstanding gates; this report does not claim them green. The author handoff states the candidate is local and unpublished. No credentials or raw private runtime logs are included. Any later product/source delta requires review under the exact-head policy; authentic publication of this report is governed by the separate review-record-only rule.


## Combined project creation and creator-grant composition on accepted #785

The two unchanged reviewed slices are now composed on actual accepted main `9f736c39d4310cde458d76e561b245619d08c3bd`. The seven source/note paths match their owning publications; every other accepted-main path is conserved. Two fresh independent ordinary contexts and a fresh full current-composition GPT-6.1 Sol context pass the exact source below. Their actual dispatches selected `gpt-6-luna`, `gpt-6-luna`, and `gpt-6.1-sol` respectively; authentic self-descriptions and fingerprint limits remain unchanged. The conductor is not a reviewer.

Component panels retain their original source coverage; `72a8cd98` had not separately received integration review despite loose preparation wording. Current fresh reviews assess the combined tree directly. The preparation author initially misread the diff direction and falsely alleged missing creator tests; root exact-blob proof and the separate correction show no lost tests or remediation. Source stayed unchanged. First PostgreSQL container startup failed before tests because of a PG18 mount mismatch, was cleaned, and the corrected focused run passed five files / 63 tests. Current hosted CI, image proof, protected merge, whole #580, feature/stage and SIT acceptance remain pending. Existing note EOF whitespace is preserved with the authentic prefixes.

### Retained report: project580-combined-project-query-preparation-luna.md

# #580 combined project query candidate — composition preparation

Status: prepared local two-parent composition for root review. The worktree is clean and should remain frozen pending actual acceptance of #785. No push, PR, tests, PostgreSQL, Docker, browser or runtime work was performed.

## Exact base, source publications and candidate

- Accepted base: `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`.
- Reviewed creator/grant publication: `5e715d82e1443f88ad9ca4cc2cb262598d6bb784`; parent is author implementation `67279e456b3aa477d4ee6a6d510512631c9017de`.
- Reviewed project-create-row publication: `ff62bb60d63c17918f22dac16d10a3f6471dda2d`; parent/source implementation is `7990746b16c10962ef086d6f832bac126d45a1ca`.
- Both source implementations have merge base exactly the accepted base above.
- New branch/worktree: `codex/query-ownership-580-project-combined` at `/Users/heinthura/.codex/worktrees/580-project-combined-composition/Ticketing.v2`.
- Candidate merge head: `72a8cd98f029311fa2eb08b1bb42ee209050e951`, parents in order `5e715d82e1443f88ad9ca4cc2cb262598d6bb784` and `ff62bb60d63c17918f22dac16d10a3f6471dda2d`.
- Merge completed with `ort`, no conflicts or resolutions.

## Paths and conservation proof

The candidate delta from accepted base is exactly these five source paths and two preserved review notes:

1. `apps/api/src/project/project-creator-grant.repository.ts`
2. `apps/api/src/project/project-creator-grant.ts`
3. `tests/api-integration/project-creator-lead.test.ts`
4. `apps/api/src/project/controllers/create-project.ts`
5. `apps/api/src/project/repository.ts`
6. `docs/07-planning/security-reviews/query-ownership-project-creator-580.md`
7. `docs/07-planning/security-reviews/query-ownership-project-create-row-580.md`

For all four creator publication paths and all three project-create-row publication paths, candidate `git ls-tree` records (mode and blob) equal the owning reviewed publication exactly. `git diff --quiet <accepted-base> <candidate> -- .` with the seven paths excluded succeeded: every other accepted-main path remains byte-identical. The original creator branch/worktree at `5e715d82...` and project-create-row branch/worktree at `ff62bb60...` were only read and remain untouched.

## Checks actually run

- `pnpm install --frozen-lockfile` — succeeded; lockfile unchanged.
- `pnpm exec turbo run typecheck --filter=@taskdesk/api` — passed (4 tasks: API plus its dependency builds).
- `pnpm exec biome check` on the five source paths — exit 0; two pre-existing warnings remain in `project-creator-lead.test.ts` (`noExplicitAny` in its `call` helper and unused `world` argument in `expectCreatorGrantWritten`); no warning points to newly added lines.
- `git diff --check` over the five source paths — passed.
- Full `git diff --check` against accepted base reports only two inherited trailing blank lines: line 208 of `query-ownership-project-create-row-580.md` and line 182 of `query-ownership-project-creator-580.md`. Those notes are byte-identical to the reviewed source publications, so I preserved them unchanged.
- Final `git status --short --branch` — clean on the new composition branch.

## Hold and next action

The existing #785 composition is still PostgreSQL-pending and not accepted. This candidate intentionally imports neither its source nor any helper from it. Keep this branch/worktree clean until root verifies actual #785 acceptance; then follow root's instruction for normal accepted-main import and fresh final composition review. This preparation does not substitute for those steps, and does not claim #580 completion or PR readiness.

### Retained report: project580-combined-accepted785-preparation-luna.md

# Project #580 combined query preparation — Luna

Status: local combined candidate prepared; held for fresh reviews. No push, PR, or merge to main.

## Candidate and ancestry

- Worktree: `/Users/heinthura/.codex/worktrees/580-project-combined-composition/Ticketing.v2`
- Branch: `codex/query-ownership-580-project-combined`
- HEAD: `ebed6b6aafcc3b0a1b1430545d51418b07bc1988`
- Tree: `e4d7ce5810e0ab42fac069a98fc5def3e9734349`
- Parents, in order: `72a8cd98f029311fa2eb08b1bb42ee209050e951` (the previously reviewed project-creator/project-row composition) and accepted #785 merge `9f736c39d4310cde458d76e561b245619d08c3bd`.
- Accepted #785 parent/tree evidence: parents `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5`, `98a04f25a915893adb9c5e2cc211f96185270321`; tree `c10e53abbc7b56c2db8e2d2d749bdb45f4e40dd7`.
- Creator extraction source `67279e45`… was published/reviewed at `5e715d82e1443f88ad9ca4cc2cb262598d6bb784`. Project create-row source `7990746b16c10962ef086d6f832bac126d45a1ca` was published at `ff62bb60d63c17918f22dac16d10a3f6471dda2d`. Accepted #785 is imported by a normal merge commit; no cherry-pick, rebase, or history rewrite.

## Exact seven-path source conservation

All seven intended composition paths have identical mode and blob in `HEAD` and first parent `72a8cd98…` (also the previously reviewed composition); no source was resolved or edited during the accepted #785 merge:

| Path | Mode | Blob |
| --- | --- | --- |
| `apps/api/src/project/controllers/create-project.ts` | `100644` | `b2929a455797d29a18a86270c3ab7cdc2646453d` |
| `apps/api/src/project/project-creator-grant.repository.ts` | `100644` | `aa283b5ae68005ad86dfd98bf719b39984766ffe` |
| `apps/api/src/project/project-creator-grant.ts` | `100644` | `6e6cf56b8d4a31d07d6a4d8226c7119297abfeaf` |
| `apps/api/src/project/repository.ts` | `100644` | `127c4b6a143cb5a903f74a0b65c60e9239d60cf4` |
| `tests/api-integration/project-creator-lead.test.ts` | `100644` | `44f0177b0252edcb162b841305cfe53422e0e7e4` |
| `docs/07-planning/security-reviews/query-ownership-project-create-row-580.md` | `100644` | `abe6cab1e8b3e9b4f195438198f43e48c33c593b` |
| `docs/07-planning/security-reviews/query-ownership-project-creator-580.md` | `100644` | `ac1d28fa001e532175e72cbabaac420125dfea78` |

The explicit two-tree check `git diff --exit-code 72a8cd98f029311fa2eb08b1bb42ee209050e951 HEAD -- apps/api/src/project docs/07-planning/security-reviews/query-ownership-project-create-row-580.md docs/07-planning/security-reviews/query-ownership-project-creator-580.md` exited 0. The explicit two-tree accepted-main conservation check `git diff --exit-code 9f736c39d4310cde458d76e561b245619d08c3bd HEAD -- .` with precisely those seven paths excluded also exited 0. Accepted #785 changes outside the seven paths therefore match its source tree. In particular, the accepted notification review note is retained.

## Correction to an earlier status message

I initially reversed `git diff` direction and reported that the creator-lead rollback assertions had been lost from accepted #785. That was false. Blob proof confirms the assertions are present from the creator source in both `72a8cd98…` and `HEAD` (`44f0177…`); accepted main `9f736c39…` has the older test blob (`1441489928a76bf7288fbda0d9305f906e23f5a7`). No source/test edit was made. Root’s independent adjudication confirmed this. This correction is recorded explicitly to prevent the false regression claim being reused.

## Checks

- `pnpm --filter @taskdesk/api typecheck` — exit 0 (API, permissions, tests, RLS prototype, and approvals TS configs as invoked by the package script).
- `pnpm exec biome check apps/api/src/project/controllers/create-project.ts apps/api/src/project/project-creator-grant.ts apps/api/src/project/project-creator-grant.repository.ts apps/api/src/project/repository.ts tests/api-integration/project-creator-lead.test.ts` — exit 0; 5 files checked, 2 warnings (the pre-existing test-file `noExplicitAny` and unused `world` parameter); no fixes applied.
- `git diff --check` for the five source/test paths against accepted #785 — exit 0. A broader check also found only the two pre-existing review-note EOF blank-line warnings (`query-ownership-project-create-row-580.md:208`, `query-ownership-project-creator-580.md:182`); those files were preserved byte-for-byte.
- Worktree status is clean at `ebed6b6…`.

## Focused PostgreSQL run and ownership proof

The authorized command was run once against five requested files, with `CI` unset, using the existing API integration Vitest harness (no Testcontainers/Ryu fallback):

`env -u CI pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/project-slug-claim-permanence.test.ts ../../tests/api-integration/project-slug-unique.test.ts ../../tests/api-integration/project-organisation-binding.test.ts ../../tests/api-integration/project-creator-lead.test.ts ../../tests/api-integration/project-reorder.test.ts`

Actual result: **5 files passed; 63 tests passed; 0 failed; exit 0; 31.63 seconds**. This covers the five-file requested scope, including the same transaction/rollback, audit/projection, bad workspace id, ordering and deactivation-lock assertions present in those suites. The test command output did not include any credential-bearing URL or password.

Disposable DB used `postgres:18-alpine`, unique owner label/name `p580-combined-fixed-20261016T134736Z-34099`, loopback-only dynamic port `32781`, and tmpfs at `/var/lib/postgresql`. The connection was supplied via a private mode-0600 temporary env file; no URI/password is recorded here. Label and base SHA were checked before readiness/test and cleanup. Only that owned container was removed, and the private PG env files were deleted. Sorted Docker container ID inventories before and after the successful attempt are byte-identical (SHA-256 `8b21c7392a892185982fe3417632771947f0a7cd97e5b26019674e686e57c9bf`).

One earlier container startup attempt failed before the test process started because I used the wrong PG18 tmpfs target (`/var/lib/postgresql/data`). Root authorized resuming the same focused window with the corrected PG18 path. The first failure is retained in the adjacent private `project580-pg-first-failure.txt`; it is not counted as a test run. The first attempt’s exact container was cleaned and its Docker inventory restored before the corrected run.

## Next action

Keep this clean candidate local. Obtain two fresh independent ordinary composition reviews and the required full GPT-6 Sol review before publication. No unaccepted #632/#799 content is imported; no attachment, schema, capability, feature, or behavior scope was added.

### Retained report: project580-combined-accepted785-ordinary-a-luna.md

# Project #580 accepted-main composition — ordinary review A

**Model:** GPT-6 Luna
**Role:** Independent ordinary reviewer A (composition and integration seams)
**Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate.
**Reviewed head:** `ebed6b6aafcc3b0a1b1430545d51418b07bc1988`
**Comparison base:** accepted #785 merge `9f736c39d4310cde458d76e561b245619d08c3bd`
**Candidate tree:** `e4d7ce5810e0ab42fac069a98fc5def3e9734349`
**Parents:** `72a8cd98f029311fa2eb08b1bb42ee209050e951` (project creator/create-row composition), `9f736c39d4310cde458d76e561b245619d08c3bd` (accepted #785).
**Scope:** Exact candidate composition of the project creator grant and create-row query extractions with accepted #785; all seven changed paths; creator create transaction, repository executor seams, membership projection and audit, lifecycle revocation, relevant contracts, tests and notes. This review assesses the combined tree, rather than reusing component verdicts as approval of the merge composition.

## Checks performed

- Confirmed `HEAD` is the requested exact SHA and the worktree is clean.
- `git diff --exit-code 72a8cd98f029311fa2eb08b1bb42ee209050e951 HEAD -- <seven paths>` — passed; all seven paths are conserved byte-for-byte from the first parent. This independently confirms the creator-lead rollback assertions remain present in the actual combined tree.
- `git diff --exit-code 9f736c39d4310cde458d76e561b245619d08c3bd HEAD -- .` with exactly those seven paths excluded — passed; every other path matches accepted #785.
- `git diff --check` across the five source/test paths against accepted #785 — passed. The handoff notes two pre-existing EOF blank-line warnings in the two preserved review notes; no source whitespace issue was found.
- Read the current `AGENTS.md`, active mission, `agent-workflow.md`, `CLAUDE.md`, feature spec `projects-and-engagements.md`, `monorepo-layout.md`, `data-model.md`, `rbac.md`, the 2026-10-14 creator decision and both preserved component review notes.
- Inspected all four project source modules and the creator integration test. Verified that the controller alone opens the transaction; repository operations receive the transaction executor and await their statements. The project-create sequence remains organisation validation/lock, workspace ordering lock, permanent slug claim check, creator-person lock, position lookup and project insert, slug claim, default columns, state seeding, then creator grant.
- Traced grant assignment and revocation behavior in source: only staff creators are recorded; workspace `sees_all` holders are skipped; role use is gated on the system row; an active direct project grant prevents duplicate insert; grant, effective-membership projection and audit share the project transaction. Revocation predicates constrain to active `project_creator` direct grants and the supplied workspace/project, then lock people before grants and perform revocation, projection and audit through the caller transaction.
- Inspected test coverage for bad-workspace revocation no-op, create grant and persisted projection/audit, member removal/leave/account erasure, `sees_all` promotion, project deletion and rollback. No tests or typecheck were run by this reviewer. The private preparation handoff reports the focused PostgreSQL run as 5 files / 63 tests passing in 31.63 seconds, plus API typecheck; I treat those as author evidence, not my execution.

## Findings

No blocking or non-blocking findings.

The merge composition is clean: it imports the reviewed project source as the first-parent tree without altering any of its seven paths, while the accepted #785 tree remains identical everywhere else. I found no lost assertion, conflict resolution, or cross-slice import that changes authority or query behavior. The repository split preserves the project-create transaction boundary and sequencing, and the creator grant and revoke paths retain the intended scope, projection, audit and rollback behavior. The tests exercise the actual route for reach and lifecycle behavior and include the workspace mismatch and transactional rollback cases relevant to this composition.

## Verdict

**PASS — ordinary review A clears exact head `ebed6b6aafcc3b0a1b1430545d51418b07bc1988` for the scope above.** This is not a security review, candidate acceptance, #580 completion, or merge authorization.

### Retained report: project580-combined-accepted785-ordinary-b-luna.md

# #580 combined accepted-#785 composition — ordinary review B

**Model:** GPT-6 Luna tier (assigned reviewer; platform model fingerprint was not exposed in this context)
**Role:** Fresh independent ordinary reviewer B
**Independence:** I did not author, direct, advise, or remediate the candidate. The preparation packet and retained slice reports were used to identify provenance and expected scope only; I verified the current source and tree relations independently.
**Reviewed head:** `ebed6b6aafcc3b0a1b1430545d51418b07bc1988`
**Comparison base:** accepted #785 `9f736c39d4310cde458d76e561b245619d08c3bd`
**Composition parent:** `72a8cd98f029311fa2eb08b1bb42ee209050e951`
**Scope:** Complete seven-path diff, all five source/test paths, the two imported review records, composition conservation, direct route and lifecycle callers, query ownership D1–D4, customer-organisation binding, RBAC/creator-grant contract, transaction executor, lock and audit order. This is a bounded source review, not #580 or stage acceptance.

## Checks actually performed

- Confirmed the checkout is at the exact reviewed SHA and clean before inspection.
- Read local `AGENTS.md`, active mission, `agent-workflow.md` review/model rules, `CLAUDE.md`, `coding-standards.md` query-ownership contract, `multi-tenancy.md`, `projects-and-engagements.md`, the RBAC reach/role sections, and decision-log entries for D1–D4, creator grants, and workspace `sees_all`.
- Inspected the complete current create controller, project repository, creator-grant orchestration and repository, and the relevant creator integration tests. Traced production callers in the create route, project deletion, workspace create/leave/member removal, account erasure, and workspace-admin reach; checked `Executor` and the route's permission/error mapping.
- Verified the exact seven changed paths and their modes/blobs. All seven are byte-identical to the first-parent composition `72a8cd98…`. An explicit two-tree diff confirmed all other paths at the candidate equal accepted #785. This independently resolves the preparation note's earlier reversed-diff claim; the rollback assertions are present in current test blob `44f0177b…`.
- Ran `git diff --check` on the seven paths. Source/test paths are clean; it reports one extra blank line at EOF in each imported review note (`query-ownership-project-create-row-580.md:208`, `query-ownership-project-creator-580.md:182`).
- No tests, typecheck, database, Docker, browser, build, push, PR, or merge were run/performed by this reviewer. The preparation packet's API typecheck and focused PostgreSQL result are author-owned evidence, not my execution evidence.

## Review

The import adds no source delta on top of the previously assembled composition. I nevertheless inspected the full current implementation and cross-slice path. Project creation still owns one transaction; every moved project statement and creator/grant statement receives that transaction executor, awaits its statement, and returns materialized rows/scalars/void. Repository SQL stays in named repositories, including the raw advisory lock and the grant predicate fragment, consistent with D1–D4.

Customer binding retains the active, non-internal, non-deleted organisation predicate and `FOR SHARE`; the workspace-owner check still requires an internal organisation. The create route checks strict `project:create` before looking up a selected customer organisation, preserves managed-service/calendar checks, and maps invalid binding to the same generic 422. This validates request-selected create configuration and does not become a customer-content read or a new identity/reach surface.

Ordering lock namespace/key remains `(1524, hashtext(workspaceId))`, matching the reorder path. The permanent global slug-claim check and insert remain paired with the unique constraints and existing 409 conversion. Max-position behavior is unchanged. Project insert, permanent claim, default columns, state seeding, creator grant/projection and audit remain in the same transaction and order, so a thrown write still rolls the full creation back.

The creator path continues to lock the staff person before authority writes; `sees_all` suppresses the project-scope creator role; only an `is_system` project-lead role is trusted; only an active direct grant is treated as existing; projection and grant audit follow insertion inside the caller transaction. Revocation locks candidate people in sorted order before ordered grant rows, filters to active direct `project_creator` grants, updates, reprojects, then writes system audit rows. Project-specific revocation constrains both project and supplied workspace. I traced the actual project deletion and membership-removal/leave/account-erasure/promotion callers and found their transaction propagation intact. The added wrong-workspace and deliberate rollback assertions are present; their execution is author-owned evidence.

The candidate does not add routes, schema, capabilities, grant sources, or new privilege. It retains the creator identity boundary and the documented lifecycle; I found no incompatible change to canonical identity behavior. The accepted #785 import does not alter these seven paths or introduce a cross-slice interaction in the remaining tree.

## Findings

No blocking findings.

Non-blocking documentation formatting: each imported review note ends with an extra blank line, as reported by `git diff --check`. It does not affect source behavior or review provenance.

## Verdict

**PASS — ordinary review B clears exact head `ebed6b6aafcc3b0a1b1430545d51418b07bc1988` against accepted #785 for this combined composition scope.** This static review does not substitute for the required current-head Sol security review, hosted checks, release/runtime acceptance, or a #580/stage completion claim.

### Retained report: project580-combined-accepted785-full-security-61-sol.md

# Full independent security review — #580 combined project composition on accepted #785

**Model:** GPT-6.1 Sol (assigned security-review model; this context has no separate runtime fingerprint API).
**Role/context:** Fresh independent full security reviewer, `/root/project580_combined_accepted785_full_security_sol`.
**Reviewed head:** ebed6b6aafcc3b0a1b1430545d51418b07bc1988
**Comparison base:** 9f736c39d4310cde458d76e561b245619d08c3bd (accepted #785).
**Independence:** I did not author, direct, advise, remediate, or perform an ordinary review of this candidate. I independently inspected the actual current composition. Component and ordinary verdicts are evidence, not substitutes for this review.
**Depth:** FULL current-composition security review, not lightweight conservation confirmation.
**Verdict:** PASS — no blocking or non-blocking security findings in this bounded candidate.

## Actual scope and checks

Confirmed the exact HEAD and clean checkout. Read the complete seven-path diff: four production source files, creator integration-test additions, and both preserved component review notes. Inspected the complete create controller, both new repositories and creator orchestration. Compared moved statements with accepted-base implementations. Read AGENTS.md, active mission, workflow and CLAUDE.md, query-ownership D1–D4 standards, relevant project, RBAC, customer-binding and creator decisions, data-model and lifecycle ADR passages. Read both current ordinary reports and the current preparation report.

Traced actual callers and transaction seams through the project route, project deletion, member removal, leave, account erasure, workspace-admin promotion, membership projection, state seeding, advisory ordering/reorder and audit append. Searched references to repository exports and creator functions. The new project repository is used by create-project.ts; the new creator repository is imported only by creator orchestration. Public creator helpers remain the existing lifecycle integration surface. Examined accepted #785 canonical identity construction and its customer-membership admission helper, including persisted project-role anchoring and the staff/customer branches.

Independent two-tree checks found all seven candidate paths identical to composition parent 72a8cd98f029311fa2eb08b1bb42ee209050e951 and every other path identical to accepted #785. This is conservation evidence only: the two component reviews did not separately integration-review 72a8cd98. This report reviews the current composition in its own right. The rollback test is actually present in current blob 44f0177b0252edcb162b841305cfe53422e0e7e4; the earlier missing-test claim was false and is corrected in the preparation report.

Ran git status, rev-parse, diff/stat/name checks, the explicit conservation checks and git diff --check. The latter reports only the preserved extra EOF blank line in each historical review note (lines 208 and 182). No source whitespace defect was reported. Those append-only notes were not edited. No source/ref changes, test/typecheck execution, PostgreSQL, Docker, browser, image build, hosted CI, push, PR or merge was performed by this reviewer.

## Security analysis

The combined controller still owns one db.transaction. Every moved statement receives that actual tx as its first executor argument. Neither repository substitutes a global/default connection, opens a transaction, commits, or returns a deferred builder. Every statement is awaited and returns materialized facts/rows/scalars or void. The broader internal inferInsert types do not introduce mass assignment: the sole production caller constructs explicit field lists. Public grant/revoke orchestration continues to require Transaction.

Customer binding checks the selected organisation id with active=true, isInternal=false and deletedAt IS NULL, holding FOR SHARE through the surrounding transaction. Concurrent deactivation/delete cannot commit between that successful check and creation. The workspace-owner join requires an internal organisation. A false result becomes the same generic InvalidProjectOrganisationError and indistinguishable 422. The route retains workspace access, project-create permission, strict project:create before customer lookup, managed-service/calendar validation, and the authenticated context user id. This helper returns a minimal create-validation fact, not customer content. The creator, role, sees-all and lifecycle reads feed internal authority mutation/audit only. This analysis does not establish any general exception for unscoped content reads or broad writers: these internal exports depend on their inspected, authorized callers.

Statement order remains customer check/lock, workspace ordering lock, permanent claim precheck, creator-person lock, maximum position, project insert, permanent claim, default columns, state seed, creator grant/projection and audit. Ordering still uses transaction advisory lock (1524, hashtext(workspaceId)), matching reorder. Maximum is workspace-clamped with null mapped to initial zero. The global slug precheck is intentionally instance-wide; permanent claim PK and project_slug_unique are still the race arbiters, and only their exact constraint names map to ProjectSlugTakenError and generic 409. Claims are not released by the new helpers. Columns and concrete states retain the created project/workspace and same transaction.

The creator person is selected by authenticated user id and locked FOR UPDATE; only staff is accepted, with created_by null otherwise. No caller-supplied person id or IdP attribute selects the creator. Workspace-scope sees_all is checked for this person and workspace before role/grant work, preventing a project role from replacing owner/admin authority. Project-lead lookup remains scope=project, workspace and key constrained; an existing non-system same-key row fails closed. Creation uses the built-in lead capability list/rank, system provenance, direct/project_creator origin and seesAll=false. An existing active direct grant is preserved. Projection and audit receive the same tx after insertion; audit's nested savepoint stays on the caller session, so an outer failure rolls everything back.

Revocation predicates select only active project-scope direct project_creator grants. Member selection clamps person and workspace project set. Project-specific selection intentionally hardens the old predicate by requiring both project id and supplied workspace id in the subquery; both candidate listing and locked reread use the same predicate. A mismatched pair cannot revoke a foreign workspace grant. Soft-deleted project rows remain selectable, preserving soft-delete-then-revoke. Person locks remain deterministic by person id before grant locks ordered by grant id; only those locked selected IDs are updated. Projection follows, then project/workspace-scoped system audits. Admin-created direct and external origins remain untouched. Actual leave/removal/erasure/promotion/deletion callers preserve their existing transaction and lifecycle responsibilities; no new lock-order inversion is introduced by the extraction.

Accepted #785's canonical customer admission requires the own-organisation genuine customer membership and constructs customer authority separately; staff creator grants do not satisfy or bypass that branch. The staff resolver continues to load the projected membership joined to its persisted project role, check role scope and actual project's workspace against role.workspaceId, and grant project-scoped authority. The extracted role/grant/projection shapes still satisfy those checks. No new customer-to-staff, global sees_all, instance-admin, workspace role, IdP mapping or content serialization path is introduced. Accepted notification/identity sources are unchanged outside the seven paths. I found no incompatible authority interaction in this composition.

## Tests and evidence attribution

I inspected the new wrong-workspace assertion and deliberate transaction rollback test. The rollback test uses a separate read while revocation is in-flight, then throws and verifies grant, effective membership and revoke audit are absent/restored as appropriate. It detects accidental independent grant commits; source inspection confirms projection and audit share the handle. Existing suite cases cover creator-only reach, workspace isolation, sees_all skip/promotion, member removal/leave/erasure, deletion, trusted roles and IdP rejection.

The preparation context reports current-head API typecheck passing and focused PostgreSQL passing 5 files / 63 tests in 31.63 seconds, with exact owned cleanup. Those are preparation-owned execution results, not tests run by me. Earlier 23-test and 62-test component results remain labelled to their original sources and do not alone approve this composition. Ordinary A and B both record PASS at this exact candidate/base; B discloses its unavailable fingerprint. The conductor supplies explicit Luna dispatch provenance; I do not relabel their original reports or independently attest model telemetry.

## Findings and limits

Blocking security findings: none. Non-blocking security findings: none. The two preserved note EOF blank lines are documentation formatting only, already identified by ordinary B.

PASS clears only this current bounded partial #580 composition for security review. It does not close #580, claim complete repository query conversion, feature/stage completion, protected-merge readiness, image/browser verification, release or SIT acceptance. It does not prove every inherited concurrency interaction beyond the inspected delta and callers. Current required CI and other applicable acceptance gates remain the conductor's responsibility. Any later non-record delta needs exact-head review under policy.


**Reviewed head:** `ebed6b6aafcc3b0a1b1430545d51418b07bc1988`
