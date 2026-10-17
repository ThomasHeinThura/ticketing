

## Bounded repair and accepted #813 composition — 2026-10-17T03:07:43.118903+00:00

Prior reports retain their original source, scope and verdict. All dispatched review reports, adverse findings and authentic corrections are preserved below. New current security verdict is CLEAR at `dcf4071f79c7046cab343e51acadc2e9983b9e09`; this is source review, not hosted/runtime/image or merge acceptance. No gate waiver.

Actual source7f4 focused4files159tests/native0/67.76s, raw362634bytes SHA2564cf595ead210ed81d84984d0046fec479c3a0f175e6794b10d66543ac7e32cd2; exact owned cleanup23/109/7 unchanged/private environment removed. Current composition is tree-identical metadata only. Authentic corrections govern: attempt-limit throw occurs inside transaction; image build/boot/migrate/health is mandatory; role/policy concurrency is not operation-proof race coverage, audit-savepoint failure followed successful mutation is not outer proof-plus-mutation rollback coverage, canonicalization unit was not among the four executed files. Internal planning artifact remains private. No whole580/phase claim.


### Authentic report — remaining580-operation-proof-persistence-author-luna.md

# #580 operation-proof persistence author handoff

**Role:** GPT-6 Luna implementation author. This report is not independent review, security clearance, acceptance, or merge approval.

## Exact candidate and isolation

- **Frozen dependency source/base:** `433ea7769d1b8440046cfe7ba39acc23e029489c` (PR #813 publication source; hosted CI was pending per the supplied handoff, so this is not accepted `main`).
- **Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`.
- **Branch:** `codex/remaining580-operation-proof-persistence-author-luna`.
- **Candidate HEAD:** `7f4f0a2865e9ff1006f88edab264f4c9d3031324` (`refactor(auth): own operation proof persistence`).
- **Changed paths:** `apps/api/src/auth/repository.ts`, `apps/api/src/auth/step-up-service.ts` only. Worktree clean after commit.
- **External report mode:** created with exclusive create (`O_EXCL`) and mode `0600`.

## Source and contract reviewed

Read the full supplied `remaining580-stepup-operations-source-plan-luna.md`; repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `sdlc.md`, `coding-standards.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, `status.md`, and `decision-log.md`; PA-15 in `docs/01-architecture/pending-actions.md`; the step-up contract in `security-model.md`; query-ownership contract/review `docs/07-planning/security-reviews/764-query-ownership.md`; and `query-ownership-step-up-session-580.md`. I reviewed the actual current operation challenge, issuance and consumption tests in `tests/api-integration/local-factor-policy.test.ts`, relevant concurrency suite and canonicalization test paths. Historical pointer `0d694754d7410ae633de6ca240cee35947917547` was inspected only as lineage evidence; its old SQL/repository organization was not copied.

## Change and conservation

The service still opens the same transactions. Repository lifecycle methods receive and use that exact executor with no fallback to global `db`:

- `createOperationChallengeRecord` now owns the existing DB expiry clock read, session/operation advisory lock, `countRecentOperationChallenges`, prior challenge expiration, issued-row consumption, and insert. Source sequence is clock → advisory lock → count → expiration → issued consumption → insert, with the same five-per-person/session/operation rolling 15-minute limit. Hitting the count limit returns to the existing service transaction callback, which throws the existing `StepUpAttemptLimitError` so the transaction rolls back.
- `issueOperationTokenRecord` owns the advisory lock, `lockActiveStepUpSession`, exact challenge row lock, constant-time canonical body/nonce comparisons, challenge burn on nonce mismatch or failed verifier, DB issue/expiry clock read, conditional issuance update and `RETURNING` cardinality. The existing verifier callback remains at the same point in this order.
- `consumeOperationProofRecord` owns the exact issued-proof row lock, constant-time body hash comparison, conditional `issued`→`consumed` update with `now()` and `RETURNING`, and existing auth-method result handling. It receives the protected-action transaction supplied by the caller.

`countRecentOperationChallenges`, `lockOperationChallenge`, and `lockOperationProof` now await their query and return row arrays. Existing first-row destructuring remains: recent/challenge/proof use `[recent]`, `[challenge]`, `[proof]` respectively. Predicates, DB clock expressions and timestamp codecs, `FOR UPDATE`/`LIMIT 1`, hash-only token storage, canonical body/nonce logic, returned values, errors and fail-closed paths are preserved. No policy, schema, authority, event/audit, route, API wrapper, pending-action, SCIM/OIDC configuration, credential-factor implementation, or protected mutation changed.

## Checks and failures

- `pnpm install --frozen-lockfile` completed in the isolated worktree; no lockfile changes.
- Required declaration prerequisites built successfully: `@taskdesk/domain`, `@taskdesk/permissions`, `@taskdesk/email`.
- `pnpm exec biome check apps/api/src/auth/repository.ts apps/api/src/auth/step-up-service.ts` passed (2 files, no fixes).
- `pnpm --filter @taskdesk/api typecheck` passed (all configured API, permission, test, RLS prototype and approvals TypeScript projects).
- `git diff --check` passed before commit.
- Initial Biome and API typecheck attempts failed because this fresh worktree had no `node_modules`; the permitted frozen install resolved that. The first API typecheck after install then failed only because generated workspace declarations for domain/permissions/email had not yet been built; after the three permitted builds, the full API typecheck passed.

No unit or PostgreSQL/integration tests were run. No Docker/image, browser, full-suite, heavy runtime, hosted CI, PR, push or merge activity occurred. Existing cases inspected include wrong nonce and failed verifier, successful issuance and consumption, five-challenge saturation, audit-failure rollback, operation version/body binding and concurrent one-use behavior; their historical results are not claimed as current-head results.

## Residuals and dependency

This is an auth-path source candidate requiring fresh independent ordinary review and independent GPT-6 Sol security review at this exact SHA, plus exact-head CI and normal publication flow. PR #813 remains a source dependency whose hosted CI/acceptance is pending per the supplied handoff. This candidate does not claim #813 accepted on `main`, whole #580 completion, phase completion, hosted/runtime behavior or merge readiness. No test gap was resolved or weakened by this ownership relocation.


### Authentic report — operation7f4-full-ordinary-a-luna.md

# #580 operation-proof persistence — full ordinary review A

**Reviewer:** GPT-6 Luna  
**Role:** Independent ordinary reviewer  
**Independence:** Fresh context; did not author, direct, or remediate this candidate. The source plan was reviewed as a contract/input, not as approval.  
**Candidate:** `7f4f0a2865e9ff1006f88edab264f4c9d3031324`  
**Comparison base:** `433ea7769d1b8440046cfe7ba39acc23e029489c` (dependent candidate base; PR #813 source, not accepted `main`)  
**Scope checked:** Complete two-path diff: `apps/api/src/auth/repository.ts`, `apps/api/src/auth/step-up-service.ts`.  
**Verdict:** **CLEAR — no blocking or non-blocking findings.** This is ordinary review only; it is not the required independent GPT-6 Sol security review, exact-head CI, or acceptance.

## Review

I compared the moved operations directly with the base implementation and the supplied source plan, then checked the owning query-ownership and PA-15 contracts. The service retains transaction ownership: challenge creation and token issuance still open their original transactions, and proof consumption still receives the protected-action transaction. Each new lifecycle method takes that exact executor first and has no fallback to shared `db`.

The ownership boundary is consistent with `coding-standards.md` § Query ownership: transaction orchestration may remain in the service, while every statement runs through an executor-taking repository function; repository calls await statements and return values/rows rather than builders. The verifier callback is passed into issuance so it remains between the challenge checks and issuance clock/update, as it was in the original transaction flow. I found no contract requiring that callback to remain in the service.

I traced the lifecycle behavior:

- Challenge creation preserves DB expiry-time acquisition before advisory lock, then rolling-window count, challenge expiry, prior issued-proof consumption, and insertion. The count predicates remain person/session/operation plus `created_at > now() - interval '15 minutes'`; the five-attempt value is supplied by the service constant. At the limit, the new method returns null and the service throws the existing error after the read-only transaction completes. No write precedes the count, so this changes neither persisted state nor externally visible error behavior.
- Issuance preserves advisory lock → active-session row lock → exact challenge row lock → canonical body hash comparison → nonce hash comparison → one verifier call → DB issue/expiry clock → conditional challenge-to-issued update. Wrong nonce and failed verification still burn only the exact challenge ID in state `challenge`. The update retains state/expiry predicates and checks exactly one `RETURNING` row.
- Consumption preserves exact token/person/session/operation/route/version/state/expiry selection under `FOR UPDATE LIMIT 1`, constant-time body-hash comparison, conditional issued-to-consumed update using SQL `now()`, exactly-one-row `RETURNING` check, and the same accepted-auth-method result handling.
- Token, nonce, and canonical body hashing remain SHA-256; token storage remains hash-only. DB timestamp text is parsed as before for challenge/issue/expiry times, while `consumedAt` behavior is unchanged. First-row destructuring is retained after materializing the three affected builders as row arrays. Query errors still reject through the transaction, preserving rollback.

Repository search found no new authority or additional callers: the three lifecycle methods are called only by their existing service paths. No route, policy, schema, event/audit behavior, pending-action flow, credential-factor implementation, or protected mutation changed.

## Evidence and tests

Read-only inspection covered the full diff and these current test sources:

- `tests/api-integration/local-factor-policy.test.ts`: wrong nonce and failed verifier, bound operation challenge/issuance, five-attempt saturation and expired challenge rows, protected-action consumption, replay denial, and audit-failure rollback.
- `tests/api-integration/local-factor-policy-concurrency.test.ts`: searched for operation/challenge/proof cases; no matching operation lifecycle cases were found.
- `tests/api/identity/step-up-canonicalization.test.ts`: canonical body contract.

No tests or runtime checks were run by this reviewer. The author handoff reports no unit, PostgreSQL/integration, Docker, browser, hosted-CI, or full-suite run at this candidate SHA. The listed test cases are source coverage observations, not current-head pass results. The orchestrator's planned four-file PostgreSQL run remains separate evidence to be collected on the current candidate.

## Residuals

- This source depends on base `433ea7769d1b8440046cfe7ba39acc23e029489c`; #813 acceptance on `main` is not established here.
- Required exact-head CI and independent GPT-6 Sol security review remain outstanding.
- Current-head PostgreSQL/integration verification remains outstanding.



### Authentic report — operation7f4-ordinary-a-transaction-wording-correction-luna.md

# #580 ordinary review A — transaction wording correction

**Reviewer:** GPT-6 Luna  
**Role:** Correction to the report at `operation7f4-full-ordinary-a-luna.md`; not a new review round.  
**Candidate:** `7f4f0a2865e9ff1006f88edab264f4c9d3031324`  
**Comparison base:** `433ea7769d1b8440046cfe7ba39acc23e029489c`

The original report states: “At the limit, the new method returns null and the service throws the existing error after the read-only transaction completes.” That sentence is incorrect and is withdrawn.

I re-read `apps/api/src/auth/step-up-service.ts:createOperationChallenge` at the unchanged candidate SHA. The service awaits `createOperationChallengeRecord` inside the `db.transaction(async (tx) => { ... })` callback; when the result is null, it throws `StepUpAttemptLimitError` inside that callback, before returning `expiresAt`. The transaction therefore rolls back, as the original implementation did. There are no writes before the limit check, and the transaction-scoped advisory lock is released on rollback.

This factual correction does not change the review's **CLEAR** verdict or any other finding: the exact-SHA source scope and behavior comparison remain as recorded in the original report. No tests or additional runtime checks were run by this reviewer. Root's separately reported current-candidate PostgreSQL evidence is not attributed to this review.


### Authentic report — operation7f4-full-ordinary-b-luna.md

# #580 operation-proof persistence — full ordinary review B

**Model:** GPT-6 Luna (platform-reported model for this reviewer context)
**Role:** Fresh independent ordinary reviewer B
**Independence:** I did not author, direct, or remediate the candidate. I treated the author report, source plan, and ordinary A report as claims and checked them against the frozen source and evidence.
**Candidate HEAD:** `7f4f0a2865e9ff1006f88edab264f4c9d3031324`
**Comparison base:** `433ea7769d1b8440046cfe7ba39acc23e029489c` (dependent #813 source, not accepted `main`)
**Changed paths:** `apps/api/src/auth/repository.ts`, `apps/api/src/auth/step-up-service.ts`
**Verdict:** **CLEAR — no blocking or non-blocking findings.** Ordinary review only; this does not satisfy the independent GPT-6 Sol security review, hosted exact-head CI, or acceptance.

## Scope and contract

I verified the worktree HEAD and clean state, the complete two-path base-to-head diff, and relevant call sites. I read the required repository workflow and mission guidance plus PA-15 in `pending-actions.md` and `security-model.md`, the query-ownership section of `coding-standards.md`, the step-up session/query-ownership records, the author report, its source plan, and ordinary review A. I independently checked the three moved operation lifecycle functions and their original service implementations at the comparison base.

The actual repository boundary matches the query-ownership rule: all three new repository lifecycle methods accept the caller's transaction executor first, execute and await their statements, return rows/scalars/result DTOs, and do not fall back to global `db`. Challenge creation and issuance remain inside their existing `db.transaction` callbacks; proof consumption still receives the protected-action transaction. No route/API wrapper or transaction owner changed.

## Findings

I found no material source difference in the operation proof contract:

- Challenge creation keeps DB expiry-clock acquisition before the session/operation advisory lock; then counts the same person/session/operation rows in the rolling 15-minute window, enforces the existing five-attempt limit, expires prior challenges, consumes prior issued proofs, and inserts the same operation-bound challenge. A limit result is converted to the existing `StepUpAttemptLimitError` inside the unchanged transaction callback, preserving rollback and error behavior.
- Issuance keeps advisory lock → active agent-session `FOR UPDATE` → exact challenge `FOR UPDATE` and person/session/operation/route/version/state/expiry binding → canonical body hash comparison → nonce hash comparison → one verifier call → DB issue/expiry clock → conditional challenge-to-issued update and one-row `RETURNING` check. Nonce mismatch and failed verification burn only the exact challenge; missing/unrelated challenge ids remain untouched. Hash-only token persistence and constant-time comparisons remain.
- Consumption still locks the exact issued proof bound to token hash, person, session, operation, route, version, state and expiry; compares the canonical body hash; conditionally marks the row consumed with SQL `now()`; requires one `RETURNING` row; and applies the existing auth-method handling. The caller's transaction still contains the protected mutation, so rollback behavior is retained.
- The three materialized repository selects preserve first-row destructuring. Predicates, DB-clock expressions and timestamp codecs, `FOR UPDATE`/`LIMIT 1`, update predicates, return values, errors and query-exception propagation are preserved. In particular, the existing `new Date()` consumed timestamp in challenge replacement remains as-is; this candidate does not change its clock source.

No route policy, authority, schema, dependency, pending-action lifecycle, factor verification implementation, audit/event behavior, or protected mutation changed. The extraction does not introduce a new canonicalization or security boundary; it relocates the existing generic operation-proof persistence work.

## Checks and evidence

This reviewer performed static source/diff and contract inspection; I did not run builds or tests. Separately, I verified the provided `operation7f4-runtime` receipt is bound to the exact candidate SHA and a clean candidate check. Its Vitest invocation covers four named PostgreSQL integration files and reports **4 files / 159 tests passed** (65.63 seconds). The receipt records the same SHA on the owned PostgreSQL container, and the cleanup receipt records successful removal of that exact container. This is root's runtime evidence, not a test run by this reviewer.

The author report states scoped Biome, API typecheck, and prerequisite declaration builds passed at the candidate; I did not rerun them. No hosted CI/GitHub exact-head status was checked or inferred. No browser/image check applies to this source-only change.

## Residuals

The candidate depends on `433ea7769d1b8440046cfe7ba39acc23e029489c`; #813 is not established as accepted on `main`. The auth-path independent GPT-6 Sol security review and exact candidate hosted CI/publication gates remain outstanding. This verdict does not claim #580 completion, phase completion, or merge readiness.


### Authentic report — operation7f4-ordinary-b-image-gate-wording-correction-luna.md

# #580 operation-proof ordinary B — image-gate wording correction

**Model:** GPT-6 Luna (platform-reported model for this reviewer context)
**Record type:** Wording correction only; this is not a new review round, code remediation, gate result, or review of a new source candidate.
**Original report:** `operation7f4-full-ordinary-b-luna.md` — preserved unchanged.
**Candidate HEAD:** `7f4f0a2865e9ff1006f88edab264f4c9d3031324`.
**Comparison base:** `433ea7769d1b8440046cfe7ba39acc23e029489c`.

## Correction

The original report says: “No browser/image check applies to this source-only change.” That sentence was too broad and is withdrawn. This candidate changes `apps/api` code that ships in the image. Under `AGENTS.md`'s “Before you say done” requirement, the exact candidate still needs an actual image build, container boot, migration, and health-endpoint verification. No such image-gate result is claimed here, and no gate waiver is granted.

The lack of `apps/web` changes means no changed frontend screen is identified for this source diff. That observation does not waive any separately required hosted browser checks or later SIT/browser acceptance under the applicable workflow.

## Disposition

The correction changes no source, evidence, exact SHA, or review analysis. The ordinary B code verdict remains **CLEAR — no findings**. Image build/boot/migration/health, hosted checks, and later SIT acceptance remain separate pending gates as applicable. The PostgreSQL integration receipt remains its own evidence only; it does not satisfy or imply the image gate.


### Authentic report — operation7f4-full-security-61-sol.md

# #580 operation-proof persistence — full independent security review

**Model:** GPT-6.1 Sol. Dispatch provenance supplied for this fresh context: `gpt-6.1-sol`, `fork_turns=none`, reasoning `high`. The served-model fingerprint is not exposed to this reviewer; the route is not represented as an independently measured serving fingerprint.
**Role/context:** Fresh independent required full security reviewer, `/root/operation7f4_full_security_sol`.
**Independence:** I did not author, direct, plan, or remediate this candidate. I reviewed after the two ordinary CLEAR reports, including their authentic wording corrections. Their conclusions and the source plan were inputs to verify, not substitutes for inspection.
**Reviewed head:** 7f4f0a2865e9ff1006f88edab264f4c9d3031324
**Comparison base:** 433ea7769d1b8440046cfe7ba39acc23e029489c — dependent #813 publication source; this review does not establish it as accepted `main`.
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`.
**Full changed-path scope:** `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts`, complete base-to-head diff (236 insertions, 158 deletions).
**Verdict:** **CLEAR — no blocking or non-blocking security findings in this bounded candidate.** This is source security clearance against the stated dependent base, not merge readiness, accepted-main compatibility, whole #580 completion, image proof, or mission/stage acceptance.

## Contract and inspection

I verified clean worktree HEAD, the exact comparison base/merge base, all changed paths, the complete two-file diff, and `git diff --check`. I compared every moved statement and surrounding control flow with its original implementation at the base. I read the applicable repository workflow/model/mission guidance, current snapshot and newest decision context, PA-15 in `pending-actions.md`, the sessions/step-up contract in `security-model.md`, query ownership and UTC rules in `coding-standards.md`, the shared executor contract, and relevant retained query-ownership/session review records. I also read the author report, operation source plan, both ordinary reports, and both authentic wording corrections.

The three repository lifecycle functions take the existing transaction executor first and use it for every statement. They never resolve a default connection or open/commit/roll back the handed transaction. They await statements and return a Date/null or result DTO/null. The three formerly builder-returning operation selects now await row arrays; their consumers retain `[recent]`, `[challenge]`, and `[proof]`. There is no array-truthiness regression.

The repository boundary now includes the existing hash comparisons and verifier callback placement alongside persistence. The owning contract allows statement-owning repository functions to return DTOs; it does not require one statement per function or prohibit this callback. The callback remains caller-supplied and is invoked at the same security checkpoint. This relocation creates no authentication provider, grant, route, or new external entry point. A narrower existing transaction-handle alias does not allow a global-db fallback. I found no semantic contract violation merely from that organization.

## Full lifecycle security comparison

- **Challenge creation:** The original order is retained: obtain DB challenge expiry text → session/operation transaction advisory lock → count recent rows → expire prior live challenges → consume prior issued proofs → insert the new challenge. The count is still exact person/session/`bindingKind = operation`/operation with `created_at > now() - interval '15 minutes'`, regardless of row state. The existing service supplies limit 5. A limit result returns null to the service, which throws `StepUpAttemptLimitError` **inside** its `db.transaction` callback. No persistence write precedes that limit check; rejection rolls back the transaction and releases its transaction-scoped advisory lock. Existing route error/audit handling remains outside this extraction.
- **Issuance:** Advisory lock → active agent-session `FOR UPDATE LIMIT 1` → exact challenge `FOR UPDATE LIMIT 1` → constant-time body-hash comparison → constant-time nonce-hash comparison → one awaited authentication-verifier call → DB issue/expiry clock → conditional issuance update is preserved. The session check still binds id/user/agent portal and compares its UTC-wall-clock expiry using `dbNowUtc()`. Missing session or challenge returns null before the verifier. The challenge select still requires exact id/person/session/operation binding/route/version/state and unexpired challenge. Body mismatch returns null as before. Wrong nonce or a null verifier result expires only the selected exact challenge id still in `challenge` state; unrelated or missing ids are not burned. A successful verifier is followed by the same update requiring `challenge` and unexpired challenge, and success requires exactly one returned row. The callback cannot cause a second verifier invocation within this path.
- **Consumption:** The existing service validates canonical 43-character unpadded base64url and a round-tripped 32-byte token, hashes token and canonical body, and passes the caller's protected-action transaction. The repository locks the exact token digest/person/session/operation binding/operation/route/version/issued state/unexpired token with `FOR UPDATE LIMIT 1`. It checks the same body hash using `timingSafeEqual`, conditionally changes that exact id from issued to consumed with SQL `now()`, and requires exactly one `RETURNING` row. The existing supported-method handling remains after that update; unsupported methods return null. Replay and concurrent consumers still encounter the original lock/state predicates. No new standalone transaction or early commit separates consumption from the protected mutation.
- **Cryptography and binding:** Random nonce/token generation remains in the service, with 32-byte SHA-256 digests persisted and no raw token readback or storage added. All canonical body functions and fixed operation wrappers are unchanged. Moving pure nonce/token hash computation earlier into the repository-call arguments does not move verification or persistence earlier. Body and nonce comparisons remain constant-time. Existing database constraints enforce 32-byte operation body/nonce hashes and token hashes; token digests remain uniquely indexed. No hash, nonce, token or arbitrary body logging was added.
- **Time and codecs:** The original DB `now()`/interval expressions, transaction-start-clock semantics and acquisition order are unchanged. The raw clock queries still return timestamp text with the database offset, parsed into Dates at the same logical points; inserts/updates still use column-aware builders. Operation lifecycle timestamp columns are `withTimezone: true`; session expiry remains the separate UTC-wall-clock case. I inspected the installed Drizzle timestamp codec (`mapToDriverValue` uses `toISOString()`) and node-postgres transaction implementation (awaits the callback before commit; rejects through rollback). The pre-existing `new Date()` for replacing issued proofs' `consumedAt` remains unchanged; this candidate neither introduces it nor substitutes a process clock for the DB challenge/issue/expiry clocks.
- **Cardinality and errors:** Existing aggregate fallback, first-row destructuring, `LIMIT 1`, primary-key/update predicates and exactly-one-row issuance/consumption checks are preserved. No-row paths still return null or throw the same clock/limit error. Query and verifier exceptions are not swallowed by the new methods. Returned promises remain awaited/adopted by their transaction owners, preserving rollback on an outer transaction error. There is no new multirow success path.

I searched all declarations/callers of the three new methods and three materialized helpers. Each new lifecycle method is reached only through its original generic service path. I inspected the unchanged operation wrappers, the step-up API's current-agent/session-only/admin preflight and verifier closure, and the protected-action transaction seams for metrics rotation, MFA reset, admin grant/suspend, identity connection creation/configuration, OIDC mapping creation/update, and SCIM administration/token operations. The same `tx` continues through proof consumption and those existing mutation paths. Their authorization, canonicalization, configuration validation, factor policy, audits and protected mutations are unchanged. This is conservation of those seams, not a fresh whole-feature approval of excluded implementations.

## Actual evidence and coverage clarification

**No tests, installs, builds, typechecks, PostgreSQL/Docker/browser actions, source/ref changes, GitHub actions, or shared-document mutations were performed by this reviewer.** My checks were read-only source/diff/call-site/dependency-code and saved-evidence inspection. The only written artifact is this new exclusive-create report. The author's scoped Biome/API typecheck/declaration-build claims were read but not rerun or promoted into reviewer-run results.

I independently inspected root's existing `operation7f4-runtime` candidate, invocation, launcher, result, ownership, cleanup and inventory receipts and the raw log. It is bound to clean candidate `7f4f0a2865e9ff1006f88edab264f4c9d3031324`; the four selected PostgreSQL files are `local-factor-policy.test.ts`, `local-factor-policy-concurrency.test.ts`, `identity-clock-ahead-of-utc.test.ts` and `identity-clock-behind-utc.test.ts`. The actual log footer reports **4 files / 159 tests passed**. The launcher records native return code **0**, no timeout, **67.76 seconds**, ending `2026-10-17T02:28:18.125990+00:00`; Vitest's separate internal duration is **65.63 seconds**. The raw log is **362,634 bytes**, independently recomputed SHA-256 **4cf595ead210ed81d84984d0046fec479c3a0f175e6794b10d66543ac7e32cd2**. This is root's runtime evidence, not my execution.

Saved inspection and `/proc/mounts` evidence identify exact owned container `27024d1da599956d2e86113f252bf2b0808f183b685bb4c54d609ea80412aa86`, revision/run labels, PostgreSQL 18, tmpfs at `/var/lib/postgresql` and dynamic loopback-only published port. The exact-id cleanup receipt returned 0. I compared saved before/after inventories: 23 containers, 109 volumes, 7 networks, with no additions or removals. The private `test.env` is absent. These are inspected receipts, not a new live Docker inspection.

The following precision supersedes unsupported coverage descriptions in the author/planner/ordinary evidence; their authentic reports remain unchanged:

1. The actual `local-factor-policy.test.ts` cases include missing/non-agent DB-session rejection with an uncalled verifier; wrong nonce and wrong-password challenge expiry; five-challenge saturation returning 429 with five expired challenge rows and no metrics mutation; successful proof issuance/rotation; and replay denial. Its test named `audits rotation consumption transactionally and preserves AU-14 on SQL failure` injects an `auth.step_up_consumed` audit insertion failure and **expects the second rotation to succeed**, version to become 3, and an `audit_write_failed` notification. This verifies audit savepoint/failure handling with successful protected mutation, **not an outer proof-plus-mutation rollback regression**. The unchanged outer error/rollback behavior described above was verified from source and installed transaction code; it is not claimed as directly exercised by that audit test.
2. `local-factor-policy-concurrency.test.ts` contains two policy-write/role-deletion serialization cases. It is **not operation challenge/issuance/consumption race coverage**. A test name containing concurrency, or an author/source-plan assertion, does not establish an operation-proof race test. The two non-UTC wrappers assert real process/session zones and import their named identity/session/comment suites; they do not import the entire local-factor suite. `step-up-canonicalization.test.ts` was read as source only and is not one of the four executed files.
3. The recorded focused run does not prove every operation wrapper's end-to-end mutation, all denial snapshots, artificial no-row/multirow/query-error injection, exact expiry boundaries, or competing operation-proof transactions. I found no newly altered state, lock, executor, predicate, codec or transaction behavior making an additional regression a prerequisite to clearing this relocation. This is a risk-based bounded source verdict, not a claim that those coverage gaps are closed.

Ordinary A's authentic correction accurately withdraws its original statement that the limit throw happened after a completed transaction. Ordinary B's authentic correction accurately withdraws its image exemption. Neither changes source or its prior code verdict, and neither was treated as a new source review round here.

## Remaining gates and limits

The dependency #813 and the query-ownership contract/checker work are not accepted merely because their source is present in this checkout. Current accepted-main composition, any changed-source review, publication provenance, and all required exact-publication-SHA hosted checks remain the conductor's gates. I did not query or infer current GitHub acceptance/check state.

This `apps/api` change ships in the image: actual candidate image build, container boot, migrations and health-endpoint verification remain mandatory and are not satisfied by the focused PostgreSQL run. No changed frontend screen is identified by this two-file diff; separately required hosted browser/SIT acceptance remains applicable. No waiver is given. Pending-action lifecycle, credential implementations, operation-specific configuration/mutation redesign, schema, route/policy and dependency changes are outside this candidate and are not cleared by this report.


### Authentic report — accepted813-three-compositions-ordinary-luna.md

# Independent ordinary review — accepted #813 composition confirmations

Reviewer: GPT-6 Luna, fresh independent context. I did not author, direct, or remediate the candidates. This is a read-only composition review of three exact current heads. It is not a replacement for the earlier full source reviews, security reviews, CI, image verification, or acceptance gates.

## #811 time-entry candidate composed with accepted #813

- **Exact current head:** `c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4`
- **First parent / previously reviewed source:** `7671c1c700b31ae4d7c821d61d5791362d8d29cf`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Verdict: CLEAR for this bounded composition.**

I verified the worktree HEAD and both parents. The first-parent diff contains exactly three accepted-main paths: `apps/api/src/auth/repository.ts`, `tests/api-integration/local-factor-policy.test.ts`, and the step-up query-ownership review note. Each candidate-owned path from the supplied composition proof (42 paths) remains blob-identical to the reviewed source parent; each of the three incoming blobs is identical to accepted #813 main. The accepted and own path sets do not overlap. The proof records successful normal `--no-ff` merge and no conflict resolution; I independently confirmed the resulting tree relationships and exact three-path diff. The added source/test concerns existing step-up active-session read behavior, disjoint from the time-entry controller and regression. The accepted test covers deleted-session preflight denial and non-agent session denial during operation and pending-action issuance; the incoming repository changes materialize session query results while retaining callers' first-row semantics, as recorded in the accepted review note.

No composition finding. This verdict confirms source conservation and lack of a cross-path composition conflict; it does not redo the #811 concealment review or evaluate exact-head hosted/runtime gates. I ran no tests or other commands beyond read-only Git/source/evidence inspection.

## #812 approval candidate composed with accepted #813

- **Exact current head:** `24711f617d5e1134e36d83e3afadd85e206f0afa`
- **First parent / previously reviewed source:** `5fa659555d237ef29e24b6872676bc4ba7355a02`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Verdict: CLEAR for this bounded composition.**

I verified the worktree HEAD and both parents. The first-parent diff contains exactly the same three accepted-main paths listed above. All 18 candidate-owned paths from the proof remain blob-identical to the reviewed source parent; all three incoming blobs match accepted #813 main. The accepted and own path sets do not overlap. The merge proof records a normal merge with no conflict resolution, and the exact resulting diff confirms only those three incoming paths. The existing #812 approval request fixture repair and its reader/outsider assertions remain unchanged; the incoming session-query source and tests are disjoint from approval reach fixtures. No contract or source interaction was found in this bounded composition check.

No composition finding. This does not redo the #812 fixture/runtime review or replace any required security/exact-head gate. I ran no tests or runtime checks.

## #580 operation-proof persistence candidate composed with accepted #813

- **Exact current head:** `dcf4071f79c7046cab343e51acadc2e9983b9e09`
- **First parent / fully reviewed source:** `7f4f0a2865e9ff1006f88edab264f4c9d3031324`
- **Second parent / accepted #813 main:** `130508ef24f6442a59dbccaf305712891c8b3fbb`
- **Tree at both first parent and current head:** `d15260509b29f187945946c64a8ebf785db622e3`
- **Verdict: CLEAR for metadata-only composition; prior source review verdicts remain applicable.**

I verified the exact parents and tree ids. The merge commit's tree is identical to its first parent's tree, and `git diff`/`diff-tree` show no path or blob changes. Thus the accepted-main merge adds parent metadata only; there is no new source delta to re-review. The operation-proof source review remains the prior two ordinary CLEAR reviews and full GPT-6.1 Sol CLEAR at exact source `7f4f0a28…`, with their stated comparison base `433ea7769d1b8440046cfe7ba39acc23e029489c`.

I read the original reports and both authentic wording corrections, plus the full Sol report. The retained precision is: the attempt-limit error is thrown inside the transaction callback, so the original ordinary-A “transaction completed” statement is withdrawn; the audit-failure test exercises savepoint/failure handling followed by successful mutation and does not prove outer proof-plus-mutation rollback; and `local-factor-policy-concurrency.test.ts` covers policy-write/role-deletion serialization, not operation-proof races. Those coverage limits remain. The ordinary-B image wording correction also remains controlling: this `apps/api` source requires the separate image build, boot, migration, and health checks; the focused PostgreSQL run does not satisfy them. This metadata review claims none of those gates.

No new source finding or changed-source review round is indicated by this metadata-only merge. No tests, image, container, browser, or hosted checks were run here; no GitHub/ref mutation, commit, or push was performed.

## Independence and limits

I independently read the two composition proof receipts, inspected the actual worktrees/HEADs/parents/trees and first-parent diffs, verified source/incoming blob conservation for #811 and #812, checked their path-set intersections, and read the cited #580 ordinary/security reports and authentic corrections. No source or evidence reports were modified. These verdicts are limited to current-head composition and metadata confirmation. They do not claim exact-head CI, deployment/image acceptance, merge readiness beyond the already completed normal composition, #580 completion, or a phase finalizer.


### Authentic report — accepted813-four-candidates-security-61-sol.md

# Accepted #813 — four independent exact-head security verdicts

**Model / role:** GPT-6.1 Sol, fresh independent security reviewer context `/root/accepted813_four_candidates_security_sol`.
**Dispatch provenance:** The conductor supplied the actual tool-request arguments `model="gpt-6.1-sol"`, `reasoning_effort="high"`, `fork_turns="none"`. This is requested/accepted route provenance, not an independently measured serving attestation. The served provider/model/build fingerprint is unavailable to this context and is not invented.
**Independence:** I did not author, direct, plan, or remediate any of the four candidates. No child agent was spawned. I reviewed after reading the applicable current ordinary CLEAR reports and their authentic corrections. Their conclusions were claims to verify, not substitutes for source inspection.
**Method:** Four separate bounded source/composition security reviews. Earlier full-source review coverage remains attributed to its original reviewer, exact source and limits; this report neither restarts those full scopes nor silently claims to have re-audited them.
**Evidence root (E):** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover`.

## Separate verdicts

| Candidate | Exact reviewed head | Verdict and depth |
| --- | --- | --- |
| A — #811, activity/relations/time-entry recovery | `c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4` | **CLEAR** — full security inspection of the bounded post-admission 404 repair, plus bounded accepted-#813 composition confirmation |
| B — #812, approval recovery | `24711f617d5e1134e36d83e3afadd85e206f0afa` | **CLEAR** — bounded fixture-security and accepted-#813 composition confirmation |
| C — #580 operation-proof persistence | `dcf4071f79c7046cab343e51acadc2e9983b9e09` | **CLEAR** — lightweight metadata-only confirmation retaining the prior full two-path security review |
| D — #803 records | `6f990aae91590ef79db60c6433fa425b2390424e` | **CLEAR** — bounded new dated-fact, preservation and composition security confirmation retaining the prior full normative review |

**Blocking findings:** none in any of these four assigned deltas.
**New non-blocking security findings:** none in any of these four assigned deltas.
These are source security verdicts only. They are not current required-CI passes, image acceptance, permission to merge, whole-#580 acceptance, a phase finalizer, or release/SIT/mission completion.

## A — #811 at c3329e7d

**Reviewed head:** c3329e7d195c63a6e46caebdd2f306b4dc9ba1a4

- Worktree: `/Users/heinthura/.codex/worktrees/query773-current-luna`.
- Bounded repair base/publication: `e30eb752eedf09bc8fcfa9a54c856a7771ff3cf4`.
- Repair/source parent: `7671c1c700b31ae4d7c821d61d5791362d8d29cf`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Current tree: `713a5c84844c0beda52b18d25054ea3d0acbf826`.
- Retained full-source baseline: `d7f628fa89cedc25d610f93c5bd49ce6ae9c2df9`, full 40-path review `query773-d7f6-full-security-61-sol.md`, followed by accepted-#809 composition confirmation at `8a89525cb2a55f6a50b1b793e1e82ee5d367a5fe` in `accepted809-dual-composition-security-61-sol.md`.

I inspected the complete two-path repair: `apps/api/src/time-entry/controllers/get-time-entry.ts` and the new `tests/api/time-entry/get-time-entry.test.ts`. The controller still uses the authenticated resolved identity and exact id in the same reach-scoped repository read. It now awaits that read, throws `HTTPException(404, { message: "Time entry not found" })` for no row, and returns the unchanged row otherwise. There is no unscoped retry, stale middleware-row fallback, new disclosure, or widened authority.

The mounted GET route already declares concealed 404 and applies `workspaceAccess.fromTimeEntry` with project reach plus `time_entry:read_any` enforcement. The second repository lookup composes the entry id, its task/project relationship, deleted-project exclusion and current canonical project-reach predicate. A missing row or a current reach refusal observed at that read therefore takes the declared 404 path, instead of being serialized as an empty success. Query exceptions still propagate; the new guard does not turn an execution error into a row or retry through weaker scope. This is closure of the reported post-admission undefined-result defect, not a claim of serializable instantaneous revocation throughout a request.

The two controller tests directly cover undefined second-read rejection and returning the present row, with exact identity/id forwarding. They model the post-admission observation; they do not reproduce real database concurrency or constitute a complete HTTP denial journey. `query811-7671-static-unit-receipt.json` records root's exact-7671 one-file/two-test run and API typecheck, both exit 0. I inspected that receipt, did not run them, and do not transfer old e30 full-suite passes to c332.

Direct Git comparison independently confirms all 42 owned mode/blob entries remain identical to 7671, all three incoming entries match accepted 1305, the owned/incoming sets are disjoint, and the first-parent diff contains exactly those three incoming paths. Relative to the prior full 40-path baseline, only the reviewed time-entry controller, authentic own-note publication, and new regression differ among the current owned paths; the unchanged full-source coverage is retained. The incoming auth source/test seam is assessed below.

**Separate A verdict: CLEAR.** The reported undefined-result concealment defect is closed in source at this exact head. Prior storage cross-system atomicity and legacy/native-feature coverage limits remain as disclosed in the full review; this repair adds no new recovery guarantee.

## B — #812 at 24711f61

**Reviewed head:** 24711f617d5e1134e36d83e3afadd85e206f0afa

- Worktree: `/Users/heinthura/.codex/worktrees/query789-current-luna`.
- Accumulated fixture-repair base/publication: `d65c498cc9983cc89d11a670f90ee062ae99c310`.
- Repair/source parent: `5fa659555d237ef29e24b6872676bc4ba7355a02`, following `0d6003df5a6f805bb3a5ccea85bc950e2ea187e7`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Current tree: `7c04eb0f21b20464517df20e5fbf817eed5498fc`.
- Retained full-source baseline: `f7fb4cb6f8038deeb257709f776553023456c3d8`, full 15-path review `query789-f7fb-full-security-61-sol.md`, followed by the real disjoint accepted-#809 import confirmation at `88b7807378447cc74e584a37a48f277ddc1c34c8` in `accepted809-dual-composition-security-61-sol.md`.

I inspected the complete accumulated two-fixture-path delta in `tests/api-integration/helpers/reach-world.ts` and `tests/api-integration/work-item-project-reach.test.ts`. It changes no application source, schema, policy, capability, product status behavior or feature flag. The approval route's preparation adds exact private-item participant facts for the capable project member, reachable reader and project outsider. It does not change the item to a broader visibility class or grant either negative actor additional project authority.

Source inspection confirms the preserved conjunction: approval SQL applies current project reach AND private requester/exact-participant visibility, while route/handler checks separately require `approval:request`. The staff middleware does project reach before body validation; the handler then resolves the scoped target and enforces the capability. The new negative body contains nonempty `transitionId`, customer `kind`, and nonempty `approverId`, satisfying the actual strict request schema. Its dummy downstream identifiers do not mask the tested denials because the outsider fails project reach and the reachable reader fails capability before approval creation/transition eligibility. Participation therefore cannot replace project reach or authority: the tests retain outsider 404 and reachable-reader 403. The original empty-body positive/validation case still expects 400.

The earlier `query812-0d600-fixture-ordinary-luna.md` incorrectly treated the empty negative body as reaching the handler. Its authentic report remains intact and is not authoritative for the final repair. I read the final `query811812-runtime-repairs-ordinary-luna.md` and independently checked the schema/order above. The added approval count strengthens the existing snapshot against approval insertion. Snapshot equality remains a selected set of work-item rows and table counts, not a complete database-wide write audit or proof against every possible equal-count mutation.

I inspected root's `query812-runtime-5fa659` result/invocation, runtime and exact-id cleanup receipts, final inventory comparison, and raw-log summary. It binds to 5fa, native exit 0/no timeout, 29.931 seconds, six files/78 tests passed. The independently recomputed raw-log size/hash are 153,217 bytes / `8555382dec678d2b16641d2e1d4813d956834a568c0c85fac9debe0c3f159ebe`. Saved cleanup records 23 containers/109 volumes/seven networks unchanged; the private environment file is absent. These are inspected root-owned receipts, not a new runtime execution or live Docker-state observation. They are focused evidence on 5fa, not a full runtime result at 247.

Direct Git checks independently preserve all 18 owned entries from 5fa and all three incoming entries from accepted 1305, with no same-path overlap and exactly the three-path first-parent import. All 15 original full-review-owned source/test entries are unchanged except their designated own review note; the two fixture paths are the newly inspected repair. The prior #789 whole-tree-equivalence error was already explicitly withdrawn in its authentic composition correction; I do not revive it.

**Separate B verdict: CLEAR.** No authority regression or weakened permission oracle appears in this fixture repair or composition. Existing GM-9 impersonation-decision/double-audit, per-request authority/revocation, durable-activity single-use and notification limitations retain their original disclosed scope; this verdict does not certify them closed.

## Shared accepted-#813 import in A, B and D

The exact incoming paths are `apps/api/src/auth/repository.ts`, `tests/api-integration/local-factor-policy.test.ts`, and `docs/07-planning/security-reviews/query-ownership-step-up-session-580.md`. I read the actual production/test diff, the retained full security report in that note, and surrounding consumers. The production change only makes the two existing session selects async/materialized. All three consumers retain first-row destructuring and no-row rejection. Exact session/user/agent-portal/expiry predicates, the supplied transaction executor, UTC-wall-clock expiry expression, row lock and limit remain. No array-truthiness bypass or global-connection fallback is introduced. The accepted regression covers deleted-session HTTP preflight plus non-agent-session denial during operation and pending-action issuance, with the authentication verifier uncalled.

These imports are blob-identical to accepted 1305; A's time-entry controller and B's approval fixtures do not alter the auth callers or session query contract. I examined the intervening commit graph as well as endpoint trees; the authentic intermediate 455 defect and later 7d301 repair remain in the accepted history and review record. They are not hidden by a net-tree comparison. Accepted-#813 clearance remains source-bound to its prior reviewers and acceptance evidence, not a new full auth audit performed here.

## C — operation-proof persistence at dcf4071f

**Reviewed head:** dcf4071f79c7046cab343e51acadc2e9983b9e09

- Worktree: `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`.
- First parent / fully reviewed source: `7f4f0a2865e9ff1006f88edab264f4c9d3031324`.
- Other exact parent: accepted #813 `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Both first-parent and current tree: `d15260509b29f187945946c64a8ebf785db622e3`.
- Prior full-source comparison base: `433ea7769d1b8440046cfe7ba39acc23e029489c`; full two-path security report `operation7f4-full-security-61-sol.md`.

I verified the exact parents, complete tree equality, empty first-parent path diff and both owned mode/blob entries. The source already contains accepted #813's publication; this normal merge adds accepted-parent metadata without changing source. The intervening graph introduces accepted merge1305 and the final metadata composition, not an unreviewed reverted source experiment. There is no new lifecycle source delta requiring another full two-file audit.

I read the two original ordinary reports, both authentic wording corrections, the full independent security report and the current ordinary composition confirmation. The retained full review covers the three awaited repository lifecycle batches using the exact caller transaction and materialized rows, with existing operation/session/person/route/version/hash/state/expiry bindings and rollback seams. Its analysis stays attributed to source7f4 and its original reviewer. The earlier dependent-base caveat is resolved only as to the accepted-parent composition established here, not as to current candidate CI/image acceptance.

I independently inspected the exact-7f4 result/invocation/runtime records and raw footer: four files/159 tests, native exit 0/no timeout, 67.76 seconds. Raw log is 362,634 bytes / SHA-256 `4cf595ead210ed81d84984d0046fec479c3a0f175e6794b10d66543ac7e32cd2`; saved cleanup comparison is unchanged 23/109/7, private environment absent. The run's four files are local-factor policy, policy concurrency, and the two identity non-UTC wrappers. Role/policy concurrency is not an operation-proof race test. The audit-savepoint-failure case followed by a successful protected mutation is not an outer proof-plus-mutation rollback test. Canonicalization unit coverage was inspected previously but was not one of those executed files. The attempt-limit throw is inside its transaction callback. Those precise coverage corrections remain controlling.

**Separate C verdict: CLEAR for lightweight metadata-only composition.** Prior full source clearance remains valid for what it actually covered; no duplicate full-audit claim or new runtime claim is made. Shipping image build, boot, migration and health proof remain mandatory for the candidate and are not supplied by this focused PostgreSQL evidence.

## D — records #803 at 6f990aae

**Reviewed head:** 6f990aae91590ef79db60c6433fa425b2390424e

- Worktree: `/Users/heinthura/.codex/worktrees/takeover-status-20261016`.
- Previously published records base: `9d7d01eb6434122bd257e5b268b111a4fd20b9f8`.
- Normal accepted-#813 merge: `24893ab7662b13d9c9d7b0ba868528cd97dfc0ff`, parents 9d7 and `130508ef24f6442a59dbccaf305712891c8b3fbb`.
- Dated-record commit: `402558cc003a3a36b2c9f5c2e4ca94851056bb99`, single parent24893ab7.
- Current one-line correction: 6f990aae, single parent402558cc; current tree `2236c04f1e65f4256f451431cf7b9ea98c2b328e`.
- Retained full normative review: source `a92e2798d6eb28f6f1ee58821473b8a65dc7fec0` against accepted `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`, `records803-a92-full-ordinary-luna.md` and `records803-a92-full-security-61-sol.md`.

I read the full new status/queue/decision-log diff, preservation and timestamp proofs, current ordinary blocked report and authentic CLEAR correction, and prior full normative reviews. I independently compared raw Git objects: all 1,326,849 old status bytes and 225,676 old queue bytes remain exact suffixes; all 662,278 old decision-log bytes remain an exact prefix, with the proof's original hashes matching. The normal merge imports exactly the same three accepted paths assessed above, whose current blobs match1305. The API-design and CI/CD normative files are exactly blob-identical to reviewed a92 (respectively `73e4a93c4b3d6aa757cc20b58bf5cdc540c15364` and `4a54d988498bf4bdfdc16c20a576fba146fd93f5`). No new release classification, erasure entitlement, reviewer authority, retry policy, exception or waiver is introduced by the dated records.

The retained normative scope still requires live GitHub prerelease classification, fail-closed uncertainty and exact independently reviewed finding fingerprints. The erasure summary stays bound to the authenticated deletion subject's current persisted memberships and member/owner safety counts, with joined workspace names only for the existing conflict message. No other-member identity disclosure or general reach exemption follows. Those are conserved prior contracts, not product implementation approved here.

The new accepted-#813 facts match the supplied protected-acceptance/readiness and run receipts: normal merge02:55:50Z, accepted1305/publication433, exact publication/synthetic tree, 18 completed successful contexts, PostgreSQL222files/3284tests/five tasks, browser63/G1122 and the stated medians, final unit12/API121files872tests/web186files1023tests, and the candidate shipping-image record125migrations/UID10001/health200/nohostports/owned isolation/cleanup. I independently matched raw PG and final-unit log byte counts/hashes and their suite footers. I did not reauthenticate hosted jobs or rerun image verification. These remain accepted-813 facts at the snapshot cutoff, not current passes for records6f990 or the other three candidates.

The sole 402 ordinary blocker is closed: the current snapshot uses job117282971158 completion02:42:53Z, matching `813-pg-success-receipt.json`. Raw Vitest summary02:42:50.559Z is a distinct timestamp. The ordinary report's mistaken second-parent description for402 is explicitly corrected by its authentic addendum; actual Git metadata agrees with that correction.

The new A/B/C paragraphs retain adverse runs and required new gates honestly. Carrier addendum6/frozen5 and earlier main5a references are historical source-bound observations, not claims of present Carrier readiness or current accepted main. Old dated text remains immutable. The remaining held performance, owner decisions/deferrals, final signed artifact, exact-digest SIT, nonempty-attachment backup/usable isolated restore, final audit and phase obligations remain open. I did not audit every old snapshot or current Carrier implementation.

**Separate D verdict: CLEAR.** No dated-fact, authority inflation, provenance-erasure or composition security blocker remains in the assigned current records delta.

## Actual checks, preserved coverage and limits

I read the supplied user instructions, then reloaded the actual accepted guide/mission/workflow/provider-adapter versions from candidate worktrees and verified their blobs equal accepted1305 in all four worktrees. Relevant specialist reads covered the current CI security-path list and review/evidence-reuse rules, query-ownership/results/executor and UTC rules, approval reach/authority/private visibility, legacy time-entry routing/repository scope, PA-15 and session step-up contracts, and the conserved release/erasure standards. Read the newest dated record and decision context. No open product question was invented.

Read-only checks actually performed: `pwd`; bounded `cat`, `sed`, `rg`, `head`, `tail`, `ls`; exact `git status`, `log`, `show`, `rev-parse`, `diff`, `ls-tree`; read-only Python subprocess/pathlib/json/hashlib for parent/tree/path/mode/blob conservation, old-byte preservation and saved-log verification. `git diff --check` exits0 for A:e30..c332, B:d65..247, C:7f4..dcf, D:9d7..6f990. Final pre-report assertions confirm all four exact heads and clean candidate worktrees.

Some initial combined reads exceeded tool output limits; relevant guide, source and prior-report ranges were subsequently read separately or verified directly against Git objects. Two initially guessed specialist-document paths were absent and corrected to `docs/01-architecture/pending-actions.md` and `docs/01-architecture/api-design.md`. No conclusion relies on unseen truncated text or absent-file output.

**No tests/reproductions, typecheck, install, build, PostgreSQL, Docker, browser, live inventory, CI action, GitHub/ref mutation, source/shared-document edit, commit, push, merge or delegation was performed by this reviewer.** No live GitHub state was queried; the assignment froze exact local heads and authorized source/actual saved-receipt inspection. Current remote readiness must still be established by the conductor. The only new file is this authentic external report, exclusively created with mode0600.

Earlier full reviews remain at their real scope: A40 paths, B15 paths and its real earlier import, C2 paths, and D's full normative/records candidate. The 21 A and13 B authentic-publication report sets and their earlier publication proofs are preserved, not claimed newly re-verified byte-for-byte by this bounded review. `accepted813-next-hosted-count-expectations.json` is explicitly expectations only, not an executed result or pass. Old811 green CI never accepts the repaired source. No required GitHub check is reused. No existing source-review report becomes runtime/SIT evidence or supplies a gate waiver.

**Completed at:** 2026-10-17T03:06:39.911519+00:00

## Reviewer precision addendum before delivery

The B paragraph saying the original 15 entries are unchanged “except their designated own review note” should read precisely: **all 15 original full-review-owned source/test paths are unchanged; the designated own review note is an additional publication path outside those original 15, and the two fixture paths are the newly reviewed repair.** This clarifies the original inventory and changes no finding, source comparison or verdict. The full text above is retained.


## Current exact source binding

All reports retain their stated scopes. Only this candidate's own regular review note is added/appended after the independently reviewed source. Exact-publication full hosted/image gates remain outstanding.

**Reviewed head:** `dcf4071f79c7046cab343e51acadc2e9983b9e09`
