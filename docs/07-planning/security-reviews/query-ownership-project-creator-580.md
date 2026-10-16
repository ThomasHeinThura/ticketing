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

