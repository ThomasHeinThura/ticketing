# PR #545 — deterministic seed profiles review evidence

**Reviewed head:** `1a549fbf5321a1a13fd822bd1f4fe6e3945b4a12`
**Reviewed head:** `81445b4ceeb745223dcc5af348e66782a981d96e`

This note records actual independent source and current-main composition reviews. The source review fixed the earlier missing-default blocker structurally; existing fixture manifests are verified without repair. The current-main import preserves all 13 seed paths byte-for-byte. No phase completion or gate waiver is claimed.

## Published evidence

- Source Luna: https://github.com/ThomasHeinThura/ticketing/pull/545#issuecomment-5926624672
- Source Sol: https://github.com/ThomasHeinThura/ticketing/pull/545#issuecomment-5926669611
- Current-main Luna: https://github.com/ThomasHeinThura/ticketing/pull/545#issuecomment-5926793912
- Current-main Sol: https://github.com/ThomasHeinThura/ticketing/pull/545#issuecomment-5926794524

The earlier replacement-source blocker remains historical evidence at https://github.com/ThomasHeinThura/ticketing/pull/545#issuecomment-5926464637. PR #541 was closed as superseded; its prior candidate/review history was preserved without rewriting history or suppressing the scanner.

## Full ordinary source review

# PR 545 ordinary review — default lifecycle

- Candidate: `1a549fbf5321a1a13fd822bd1f4fe6e3945b4a12`
- Base: `2242665c65faca25cc58eb070b686eb4c06d6487`
- Previous reviewed head: `f480420d`
- Reviewer: fresh independent GPT-6 Luna context; did not author or remediate this change.
- Scope: full PR seed implementation plus the `f480420d..1a549fbf` lifecycle fix, with emphasis on create-versus-reuse defaults, no mutation of incomplete fixtures, rollback, collision behavior, profile scope, placeholder identities, and unchanged CLI preflight.

## Verdict

**PASS — no blocking findings.** The structural fix addresses the previous defect: defaults are now seeded only for a newly inserted workspace/project; an existing workspace's default type/template sets and each existing project's columns/states are verified without repair. Profile people/items are inserted only after these validations. The whole operation runs in one transaction, so a later conflict rolls back any newly created workspace/project/default rows as well.

The stable fixture identifiers are checked when a row is found by its fixture slug. A canonical primary-key collision under a different slug is rejected by the database unique constraint during insert; the transaction rolls back. The suite explicitly covers same-slug/noncanonical-ID workspace and project conflicts, but does not separately construct a PK-only collision under another slug. I found no path that overwrites that row or leaves fixture writes behind.

## Checks performed

- Read repository instructions and required workflow/feature material: `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, current `status.md`, newest decision-log entries, `docs/04-engineering/testing-strategy.md` seed contract, and relevant implementation/test files.
- Confirmed Git `HEAD` and GitHub PR #545 head exactly match the candidate SHA; PR base matches the supplied base.
- Reviewed the full seed implementation and the `f480420d..1a549fbf` diff. The CLI still initializes dotenv before resolving config/importing DB code, rejects local fallback before DB import/connection, and sanitizes malformed credential-bearing URLs.
- Ran `pnpm test:seed` on Docker Desktop context `desktop-linux`; disposable Testcontainers PostgreSQL 18 only: **2 files passed, 18 tests passed**. This includes missing work-item type, state-template, column, and state rollback/preservation cases, workspace/project slug collisions, repeated profile runs and preservation of an unrelated row.
- Ran `node --test scripts/ci/lib/typecheck-coverage.test.mjs`: **7/7 passed**.
- `git diff --check 2242665c65faca25cc58eb070b686eb4c06d6487..HEAD`: clean.
- Verified realistic people are `userId: null`, `isPlaceholder: true`, staff-side rows; this path creates no user credentials, workspace memberships, or role grants. Minimal/hostile counts are one project, zero people, ten items; realistic is 50 projects, 200 people, 10,000 items.
- No source files edited.

## Gate observation

At review time PR #545 was open and draft. GitHub reported fast/full checks still in progress and `pull request template + security review` failed on the candidate. This review does not clear those independent gates.


## Full independent security review

# PR #545 — independent GPT-6 Sol security review

**Reviewed candidate:** `1a549fbf5321a1a13fd822bd1f4fe6e3945b4a12`
**Comparison base:** `2242665c65faca25cc58eb070b686eb4c06d6487`
**Reviewer and independence:** Fresh GPT-6 Sol context; I did not author, direct, or remediate this candidate. I made no source edits, commits, pushes, or merges. This is the per-PR security pass, not a P0 phase finalizer or a review of a later main-integrated head.
**Verdict:** **PASS — no blocking security findings at the reviewed candidate SHA.**

## Scope and security assessment

I reviewed the complete 13-path PR diff and the seed implementation against `docs/04-engineering/testing-strategy.md`'s fixture contract, the repository workflow and current status/decision context, and the existing workspace/project default, internal-organisation, database resolution, and CI typecheck-coverage helpers. The changed `package.json` and `scripts/ci/**` place this candidate in the mandatory security-review scope.

The earlier `f480420d` blocker is repaired structurally. `seedWorkspaceDefaults` is called only after the fixture workspace is newly inserted. A reused workspace is checked for its complete canonical type and template sets before any project, person, or item writes. Likewise, columns and states are created only for a newly inserted project; existing project defaults are verified before later fixture rows. Missing or altered default rows fail the enclosing transaction, and the four new PostgreSQL regressions confirm that a missing type, template, column, or state stays missing and other rows are preserved. Canonical fixture IDs, slugs, project slug claims, workspace and project links, and existing item references are checked; unique constraints fail a primary-key collision on insert without committing partial fixture writes.

The seed writes placeholder staff `person` rows with `userId: null` for the realistic profile and does not create users, sessions, workspace memberships, roles, or credentials. The profile sizes remain minimal 1 project/0 people/10 items, realistic 50/200/10,000, and hostile 1/0/10. The hostile parent chain is bounded and cycle-free in the test. A single transaction covers the profile; reruns preserve an unrelated user row and do not duplicate fixtures.

The CLI loads dotenv before resolving configuration or importing its DB-backed profile, rejects the implicit local fallback before a connection, and replaces credential-bearing `ERR_INVALID_URL` errors with a fixed message. The changed CI coverage guard checks every file in each nonempty derived TypeScript test tree against real compiler programs reached through the invoked typecheck script; its singleton, missing, partial, empty-tree, and orphan-config probes still fail closed. This does not weaken the existing gate semantics.

## Verification actually performed

- `DOCKER_CONTEXT=desktop-linux pnpm test:seed`: **2 files, 18 tests passed, 0 failed** against a fresh disposable Testcontainers PostgreSQL 18 database. This includes the four incomplete-default rollback/preservation regressions, slug collisions, profile reruns/counts, hostile data, and relational scope.
- `node --test scripts/ci/lib/typecheck-coverage.test.mjs scripts/ci/probes/orphan-tsconfig-coverage.test.mjs`: **15 passed, 0 failed, 0 skipped**.
- `pnpm --filter @taskdesk/api typecheck`: passed, including `tsconfig.tests.json` with the new seed files.
- `git diff --check 2242665c65faca25cc58eb070b686eb4c06d6487..1a549fbf5321a1a13fd822bd1f4fe6e3945b4a12`: passed. Review worktree remained clean. GitHub PR #545 and local HEAD both reported the reviewed candidate SHA when checked.

I did not run the full workspace suite, invoke the real CLI against a persistent database, build or boot the image, or open a screen; no UI path changed. Hosted integration and deployability checks are separate gates. At review time, PR #545 was draft, its `pull request template + security review` check was failing, and hosted integration was still in progress. This PASS does not declare the PR merge-ready, clear those gates, or apply to any later candidate SHA.

## Residual observations

Concurrent first runs can make one transaction fail on a unique fixture key; they cannot leave partial committed fixture rows. Existing item verification does not compare description or position, so it confirms the key identity and security-relevant scope/reference fields rather than byte-for-byte fixture equivalence. Neither residual grants authority or changes existing rows. No gate is waived.


## Current-main ordinary composition review

# PR #545 current-main composition review

- **Reviewer:** fresh independent GPT-6 Luna context; I did not author, direct, or remediate PR #545 or the main import.
- **Reviewed candidate:** `81445b4ceeb745223dcc5af348e66782a981d96e`
- **Comparison base:** `bd615cb4c42b975053180616dc7be6dbebff3f7c`
- **Source implementation head:** `1a549fbf5321a1a13fd822bd1f4fe6e3945b4a12`
- **Verdict:** **PASS — no blocking findings in the main composition delta.**

## Scope

Verified local and GitHub PR #545 head/base metadata. Compared the main-import merge commit to both parents, inspected the 11 paths imported from main (pending-action API, policy, response/service, architecture note, review note, OpenAPI, integration auth helper/tests, and permission matrix), and verified every one of the 13 PR #545 paths in the base-to-candidate diff is byte-identical to the implementation source head. Reviewed seed CLI/config bootstrap, create-versus-reuse defaults, the actual `pnpm typecheck` CI invocation and TypeScript test-tree coverage guard. Read the existing independent full Luna and Sol review reports for source head `1a549f…` as prior evidence, not as a substitute for checking this merge delta.

## Findings

None. The main import adds pending-action deny/cancel composition and associated policy/schema/OpenAPI/test evidence. It does not change the seed implementation, default helpers, test database bootstrap, seed script registration, typecheck configuration, or coverage guard. The newly imported API routes act on pending-action rows using the current resolved session/API-key owner identity. Realistic seed people have no user identity (`userId: null`), credentials, memberships, or roles; the seed does not create pending-action rows. I found no path by which fixture data gains authentication or authority through this composition.

The import does not weaken CI/typecheck authority. `pnpm typecheck` remains the invoked fast-CI command, and the coverage guard resolves files against the compiler programs actually invoked by that command. Seed tests and fixture paths remain covered by the API test config and existing coverage assertions.

## Verification performed

- Local `HEAD` is exactly `81445b4ceeb745223dcc5af348e66782a981d96e`; merge parents are source `1a549fbf5321a1a13fd822bd1f4fe6e3945b4a12` and base `bd615cb4c42b975053180616dc7be6dbebff3f7c`. `gh pr view 545` independently reports that exact candidate/base, open and draft.
- Confirmed all 13 paths changed from base are byte-identical to source head `1a549f…`. The only merge delta from source is the 11 pending-action paths listed above.
- `DOCKER_CONTEXT=desktop-linux pnpm test:seed`: **2 files / 18 tests passed** against the test suite's disposable Testcontainers PostgreSQL 18 instance. No persistent development database was used.
- `node --test scripts/ci/lib/typecheck-coverage.test.mjs`: **7/7 passed**, including checks that every nonempty derived test tree appears in the actually invoked TypeScript programs and that missing/partial/empty coverage fails closed.
- `git diff --check bd615cb4c42b975053180616dc7be6dbebff3f7c...81445b4ceeb745223dcc5af348e66782a981d96e`: passed; worktree remained clean.
- Inspected `/private/tmp/taskdesk-pr545-smoke-1a54/cli-results.json` and `counts.txt`: all six minimal/realistic/hostile profile runs exited 0; live/ready probes returned `{"status":"ok"}`; counts were 52 fixture projects, 10,020 fixture items, 200 placeholder people, zero login users and zero workspace/canonical memberships. This is root-provided run evidence, not a run performed by this reviewer.
- Prior independent full Luna and Sol reports at `1a549f…` each record the disposable PostgreSQL seed suite at 2 files / 18 tests. Those reports bind the source head; this review binds the current-main merge candidate.

## Limits

I did not rerun the full workspace suite, hosted CI, or image build/boot; those are separate candidate gates, and the root-provided smoke evidence is listed above. This is an ordinary current-main composition review, not a replacement for the existing security review or an assertion that PR #545's required checks are green.


## Current-main independent security composition review

# PR #545 — independent GPT-6 Sol security composition review

**Reviewed candidate:** `81445b4ceeb745223dcc5af348e66782a981d96e`
**Comparison base:** `bd615cb4c42b975053180616dc7be6dbebff3f7c`
**Previously reviewed source head:** `1a549fbf5321a1a13fd822bd1f4fe6e3945b4a12`
**Reviewer and independence:** Fresh GPT-6 Sol context. I did not author, direct, or remediate the seed candidate or merged main changes. I made no source edit, commit, push, or merge. This is the exact-head per-PR security composition pass, not the P0 phase finalizer.
**Verdict:** **PASS — no blocking security findings in the current-main composition.**

## Scope and findings

The candidate is a merge of the previously reviewed seed source head and current `main`. Its base-to-head PR diff contains 13 seed paths. I compared every one byte-for-byte with `1a549f…`; all are identical. The merge's first-parent delta contains 11 imported pending-action paths, with no conflict-resolution edits to seed, database resolution, bootstrap, test configuration, or CI coverage code. Prior independent full Luna and Sol source reviews at `1a549f…` recorded the seed's 18 passing disposable-PostgreSQL tests and 15 passing CI probes; the fresh Luna composition review at `81445b4…` independently reran 18 seed tests and seven CI coverage tests. I used those as prior evidence and checked this composition myself.

I inspected the imported deny/cancel routes, policy declarations, session-only middleware, requester identity resolver, decision transaction, schema, and integration auth helper. A decision requires the authenticated caller's resolved `personId` to match `pending_action.requested_by_person_id`; denial also requires a browser session. The decision transaction locks that owned action, accepts only `pending`, and verifies an attached login user before writing its terminal state, event, and audit. The seed's realistic people have `userId: null`, are placeholders, and have no login user, membership, role, credential, or pending-action row. `resolveIdentity` begins at `user` and joins by `person.user_id`, so these fixture people cannot resolve as requesters through either session or API-key credentials. The imported route and helper changes do not change that boundary or grant authority to fixture data.

The merge does not alter the seed's explicit database configuration guard, lazy import order, single-transaction fixture writes, or create-versus-reuse checks for canonical workspace and project defaults. The imported pending-action tables/routes are not invoked by seeding. The changed CI coverage test is identical to its reviewed source head, and its probes still bind every nonempty test tree to the TypeScript compiler programs invoked by the actual typecheck script. I found no seed namespace, database bootstrap, authentication singleton, or CI gate weakening from combining the two heads.

## Verification actually performed

- Local `HEAD` and GitHub PR #545 head both reported `81445b4ceeb745223dcc5af348e66782a981d96e`; GitHub base reported `bd615cb4c42b975053180616dc7be6dbebff3f7c`. The PR was draft and mergeable at inspection time.
- Compared all 13 base-to-head paths byte-for-byte with the source head: **identical**. Inspected the 11 first-parent imported main paths and the changed API/identity/schema/test seams noted above.
- `node --test scripts/ci/lib/typecheck-coverage.test.mjs scripts/ci/probes/orphan-tsconfig-coverage.test.mjs`: **15 passed, 0 failed, 0 skipped**. This includes singleton, partial, empty-tree, orphan-config, and actual-invocation probes.
- `git diff --check bd615cb4c42b975053180616dc7be6dbebff3f7c..81445b4ceeb745223dcc5af348e66782a981d96e`: passed. Worktree remained clean.
- Read prior source-head full Sol review and current-head Luna composition report. Their disposable-PostgreSQL seed runs are **their executions**, not mine. Root separately reported an image build, healthy isolated-container boot, and real CLI profile reruns; I did not execute those.

## Limits and gate state

I did not rerun the seed PostgreSQL suite, full workspace suite, image build/boot, or hosted integration in this review. The exact seed source files were unchanged by the merge, the independent current-head Luna review reran the 18 seed tests, and the source-head full Sol pass covered their security behavior. At my GitHub check, hosted integration was still in progress and `pull request template + security review` was failing; this verdict does not clear those required gates or assert merge readiness. No gate is waived.


## Root deployability and actual CLI evidence

Root built current source `81445b4ceeb745223dcc5af348e66782a981d96e` as `taskdesk:pr545-81445b4c`, image ID `sha256:eb81c27c009854d6c2d8200a864e484624dcafaf19f36e008e0c7bddd71f5b1b`; its revision label equals the source SHA. Build log: `/private/tmp/pr545-8144-docker-build.log`.

The private disposable Compose fixture `/private/tmp/taskdesk-pr545-smoke-1a54` uses its own PostgreSQL 18/Valkey/network/volumes and loopback ports, never the local Traefik development database. The image booted healthy after the migration service completed; live and ready both returned 200. The earlier source image at `1a549fbf` also built and booted. Root invoked the actual documented `pnpm seed minimal`, `realistic`, and `hostile` commands twice each against an explicit, fixture-only application-role URL. All six invocations exited 0. After importing current main and booting the current image, root reran all three commands on source `81445b4c`; all exited 0 and both health probes still returned 200.

The fixture contains 52 projects, 10,020 work items and 200 placeholder people, with zero login users, workspace memberships or canonical memberships. Private run evidence: `cli-results.json`, `counts.txt`, `boot-8144.log`, and `results-8144.json` in that fixture directory. These root executions are separate from each independent reviewer's 18-test seed runs. No persistent user database was seeded, reset or modified.

The seed suite is an explicit separate `pnpm test:seed` run, not attributed to the hosted general integration suite. Full exact-final-candidate required checks remain a protected-merge condition. There is no UI change; the new-model fixture does not establish the 10k legacy-UI journey. Representative authorization soak, other P0 exit criteria and the separate Sol phase finalizer remain unfinished.
