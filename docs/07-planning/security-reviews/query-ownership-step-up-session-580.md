# Step-up session reads — existing #580 recovery

**Reviewed head:** `7d301db75547482aade063956fb5f94d487346fc`

**Comparison base:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`. Bounded production change: materialize the two existing session query result arrays; all three callers retain original first-row rejection. No SQL, authority, proof, lock, clock or audit redesign. The intermediate455 array-truthiness blocker is retained below and independently closed at current7d301. Two independent ordinary reviews and a separate full independent GPT-6.1 Sol security pass CLEAR the exact current source. Explicit requested/accepted model routes are distinct from unavailable served fingerprints. This note is a publication wrapper, not another independent review.

Actual root PostgreSQL at7d301:4files159tests/native0/61.972seconds, including local factor/concurrency and both actual non-UTC identity clock wrappers. Full log361306bytes SHA256dc6a0bd4bc91d6945c333cdda0456dddbbbb8a475dc36cf6557f90686b0e9648; exact owned cleanup23containers109volumes7networks with no added/missing entries and private environment removed. API source/test TypeScript and scoped Biome pass after frozen installation and necessary domain/permissions/email declaration builds. These scoped checks are not full hosted/image acceptance. Current exact-publication CI, image proof and protected merge remain mandatory. No whole580, stage, release, SIT or final audit claim.

All six authentic reports follow verbatim, including the adverse original review and source-author reports. No report is relabelled as a different role or rewritten. Only this regular own-note publication commit may follow the reviewed source before checks.

## Evidence file

`remaining580-stepup-session-read-author-luna.md`

# #580 bounded recovery — step-up session/preflight reads

**Author:** GPT-6 Luna implementation lane. This is not an independent review or acceptance verdict.

## Candidate and isolation

- **Accepted base:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`.
- **Base verification:** fetched `origin/main` in the original checkout; `origin/main` resolved to the accepted base SHA. The original checkout had unrelated modifications and was left untouched.
- **Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-stepup-session-read-20261017/Ticketing.v2`.
- **Branch:** `codex/remaining580-stepup-session-read-20261017`.
- **Candidate head:** `45522ee311f8189be6cdf5c3ae9e5d274a89a1ec` — `refactor(api): materialize step-up session reads`.
- **Files changed:** `apps/api/src/auth/repository.ts`, `apps/api/src/auth/step-up-api.ts`, `apps/api/src/auth/step-up-service.ts`.

## Contract and source reconciliation

The #580 query-ownership contract in `docs/04-engineering/coding-standards.md` requires repository functions to await statements and return rows/DTOs/scalars instead of builders. The step-up section of `docs/01-architecture/security-model.md` requires operation-bound fresh proof and a session-bound check; the preserved recovery plan additionally directs retaining exact predicates, executor/transaction identity and lock ordering.

I inspected current source and every matched caller. I also inspected the corresponding functions/callers at historical source pointer `0d694754d7410ae633de6ca240cee35947917547`; that source was used only to confirm lineage and was not imported wholesale.

The two repository helpers now await and return their query results. The preflight caller and both transaction callers consume the materialized result directly. The session id, user id, `portal = 'agent'`, and unexpired predicates remain exact. The preflight retains its passed `now`; the lock retains `dbNowUtc()`, `FOR UPDATE`, and the caller-supplied `StepUpExecutor`. Advisory-lock and row-lock order and transaction boundaries are unchanged. No challenge/proof mutation, audit, route policy, MFA, SCIM/OIDC, schema, dependency, or gate code changed.

## Diff and checks actually run

- Diff: 3 files, 7 insertions, 7 deletions.
- `git diff --check`: passed before commit.
- `biome ci apps/api/src/auth/repository.ts apps/api/src/auth/step-up-api.ts apps/api/src/auth/step-up-service.ts`: passed; 3 files checked, no fixes.
- Call-site search for both helpers across TypeScript source: exactly the 3 expected call sites plus the 2 declarations; all were updated.
- Commit created on the isolated branch; no push, PR, merge, or shared documentation update was performed.

No API typecheck or unit/integration test was run. The isolated worktree had no installed `node_modules`; the available dependencies in the original checkout belong to a later tree whose package manifests and lockfile differ from this accepted base. I did not install dependencies or use that mismatched dependency graph for a typecheck. PostgreSQL, Docker, browser, image, and other heavy checks were not run.

## Pending checks and residuals

- API source typecheck and relevant step-up unit/integration coverage remain pending for the orchestrator's scheduled verification window.
- This auth-path candidate still needs the applicable fresh ordinary review and independent GPT-6 Sol security confirmation at this exact candidate head, along with any required exact-head gates. This report supplies no review clearance.
- No runtime behavior or PostgreSQL locking behavior is claimed from the static source change alone.

## Evidence file

`stepup455-full-ordinary-a-luna.md`

# Ordinary review A — step-up session read recovery

**Model:** GPT-6 Luna (platform-reported model for this reviewer context)
**Role:** Fresh independent ordinary reviewer A
**Candidate head:** `45522ee311f8189be6cdf5c3ae9e5d274a89a1ec`
**Comparison base:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-stepup-session-read-20261017/Ticketing.v2`
**Independence:** I did not author, direct, or remediate the candidate. I read the implementation author report and recovery plan as claims to verify, not as review evidence.
**Coverage:** Complete candidate diff across all three changed files; all definitions and call sites of both changed repository helpers; relevant session/step-up security model, PA-15 route contract, UTC timestamp convention, and candidate source behavior.

## Verdict: BLOCKED

A row-array result is consumed as a single row at all three call sites. Empty arrays are truthy in JavaScript, so missing, revoked, or expired database sessions are not rejected by these checks. This defeats the explicit active-session preflight and in-transaction session lock intended to bind step-up to a current agent session. Fix the result-shape handling and add/run regression coverage before this candidate can clear ordinary review.

## Blocking finding

**B1 — Empty row arrays bypass active-session rejection (high, auth/session validation).** In `apps/api/src/auth/repository.ts`, `getActiveSessionForStepUp` and `lockActiveStepUpSession` now `await` their Drizzle select statements and return their resolved result arrays. The three consumers in `step-up-api.ts` and `step-up-service.ts` assign the returned array directly to `activeSession` and test `if (!activeSession)`. For a no-match query Drizzle returns `[]`, which is truthy, so the denial branches do not run. Previously the callers destructured the first row (`const [activeSession] = await ...`), which correctly made a no-match result `undefined`.

The preflight at `step-up-api.ts:128` therefore proceeds to factor loading when no matching `(session id, user id, agent portal, unexpired at passed JS now)` row exists. The two transaction paths at `step-up-service.ts:850` and `:1081` similarly continue past the intended locked active-session check when no matching row exists; they then may accept a challenge and execute the configured verifier/update path. The security model requires current-session-bound, operation-bound proof and fail-closed authentication. This result-shape error violates that contract. At the transaction call sites, keeping the query on the supplied `StepUpExecutor` and retaining `FOR UPDATE` does not compensate for ignoring the empty result.

**Required disposition:** restore first-row semantics at each caller (or return a scalar/row from the repository helper with equivalent no-match behavior) and verify tests cover the empty result in preflight and both issuance transactions. This reviewer did not remediate the candidate.

## Other checks and findings

- The diff is exactly three auth source files, 7 insertions / 7 deletions. No proof/challenge mutation, audit, route policy, schema, factor-verifier, or dependency change appears in the diff.
- Query predicates appear textually preserved: session id, user id, `portal = 'agent'`; preflight still compares expiry to its passed `new Date()`, and transactional lock still uses `dbNowUtc()` for the UTC wall-clock `timestamp` column. The latter retains `FOR UPDATE` and receives the caller's transaction executor.
- Transaction/advisory lock order and surrounding `await` sequencing are textually unchanged. The defect is the result consumption, not a changed lock order.
- No separate defect found in exception propagation: awaited query errors continue to reject and propagate through the existing route/transaction paths. The materialized return remains a row array; it did not become a row object.
- The security model's PA-15 contract calls for a current agent session and single-use action/operation-bound proof. The implemented bug permits those routes to continue without this database revalidation. This review does not claim that every later endpoint/action is thereby exploitable; downstream session/proof checks still exist and runtime exploitability was not tested.

## Checks actually performed

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, current status, relevant decision log search results, `docs/01-architecture/security-model.md` (sessions/step-up), `docs/01-architecture/pending-actions.md` (PA-15 routes), and `docs/04-engineering/coding-standards.md` (UTC database-time rule). Read the complete three-file candidate diff and the relevant current function/caller source. Searched the current TypeScript tree for every `getActiveSessionForStepUp` and `lockActiveStepUpSession` declaration/use. Verified the worktree HEAD and merge base.

No tests, typecheck, build, PostgreSQL, Docker, browser, dependency install, or runtime checks were performed, per assignment. Runtime behavior, SQL execution under PostgreSQL, and regression coverage remain pending. The author report's Biome and diff-check claims were not rerun by this reviewer.

## Evidence file

`stepup455-array-contract-repair-author-luna.md`

# #580 step-up session-array contract repair

**Author:** GPT-6 Luna implementation lane. This report is not independent review or approval.

## Candidate and lineage

- **Accepted base:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`.
- **Original candidate:** `45522ee311f8189be6cdf5c3ae9e5d274a89a1ec`.
- **Independent finding:** `stepup455-full-ordinary-a-luna.md` blocked the original candidate because its callers treated a materialized row array as a single row. The report was read first; it remains unchanged.
- **Repair head:** `7d301db75547482aade063956fb5f94d487346fc`.
- **Worktree/branch:** `/Users/heinthura/.codex/worktrees/remaining580-stepup-session-read-20261017/Ticketing.v2`, `codex/remaining580-stepup-session-read-20261017`.
- **Repair commit:** `7d301db7 fix(api): reject missing step-up session rows`.

## Repair and regression coverage

The repository helpers continue to await and return their query result arrays. I restored first-row destructuring at all three consumers:

- Preflight: `step-up-api.ts` → `getActiveSessionForStepUp`.
- Pending-action proof issuance transaction: `step-up-service.ts` → `lockActiveStepUpSession`.
- Operation proof issuance transaction: `step-up-service.ts` → `lockActiveStepUpSession`.

Thus a no-match result becomes `undefined` and follows each existing fail-closed branch. Query predicates, executor identity, `FOR UPDATE`, advisory/row-lock order, and transaction boundaries are unchanged.

I added a PA-15 integration regression in `tests/api-integration/local-factor-policy.test.ts`. It first deletes the database session and expects the actual challenge preflight to return 401. It then creates valid operation and pending-action challenges, changes the retained session row to the customer portal so it no longer matches the active agent-session predicate, and calls both actual issuance services. Both must return `null`, and the authentication verifier must remain uncalled. The fixtures keep the challenge rows valid so the transaction tests specifically detect a bypass of the active-session lock.

## Checks actually run

- `git diff --check`: passed.
- `pnpm exec biome ci apps/api/src/auth/repository.ts apps/api/src/auth/step-up-api.ts apps/api/src/auth/step-up-service.ts tests/api-integration/local-factor-policy.test.ts`: passed; 4 files checked.
- Initial `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json`: failed because the fresh worktree lacked generated declarations for `@taskdesk/domain`, `@taskdesk/permissions`, and `@taskdesk/email`.
- Built only those declared workspace prerequisites: `pnpm --filter @taskdesk/domain build`, `pnpm --filter @taskdesk/permissions build`, `pnpm --filter @taskdesk/email build`; all passed.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json`: passed after declaration builds.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json`: passed, including the changed integration test.
- Commit hook Biome check: passed; 3 staged code/test files checked.

The PostgreSQL integration test itself was not run, per the bounded assignment; the orchestrator owns the local heavy verification window. No Docker, browser, full suite, push, PR, merge, or shared documentation update occurred. The prior author report and adverse review remain intact.

## Remaining status

The repair addresses ordinary finding B1 at all three call sites and adds negative coverage. The new integration regression remains unexecuted. This lane does not independently approve or review its remediation; exact-head review and security confirmation remain for fresh contexts.

## Evidence file

`stepup7d301-full-ordinary-a-luna.md`

# Ordinary review A — step-up session-array repair

**Model:** GPT-6 Luna (platform-reported model for this reviewer context)
**Role:** Independent ordinary reviewer A, repair follow-up
**Candidate head:** `7d301db75547482aade063956fb5f94d487346fc`
**Comparison base:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`
**Prior reviewed head:** `45522ee311f8189be6cdf5c3ae9e5d274a89a1ec`
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-stepup-session-read-20261017/Ticketing.v2`
**Independence:** I did not author, direct, or remediate the candidate. I verified the author's repair report and regression against source.
**Coverage:** Complete current net diff (two paths), changed integration test and relevant setup/helpers, the three helper call sites, current query predicates, session/step-up behavior, executor/lock flow, and prior finding B1.

## Verdict: CLEAR — ordinary review A

The original B1 is closed in this candidate. The repository functions await/materialize the Drizzle selects and return arrays; the existing callers again destructure the first row at all three sites. An empty result therefore produces `undefined` and follows the existing denial/null path. The added integration test exercises both the HTTP preflight and the two proof-issuance transaction paths with real matching challenge/action rows, then makes the session fail the `portal = 'agent'` predicate. Its assertions would fail on the original array-truthiness behavior.

This is source review only. The PostgreSQL integration regression remains unrun and is pending the orchestrator's scheduled runtime verification. No runtime or test-pass claim is made here.

## B1 disposition and regression assessment

- **Preflight:** the test inserts a matching agent session, mocks the authenticated session to that id, deletes the database row, and submits a validly shaped operation challenge request. The request has no session cookie, so the global CSRF middleware's no-cookie test path proceeds; the mocked auth session remains available. With the repaired destructuring, the database preflight returns no row and the handler returns 401. Under the prior bug, the empty array would pass the check; this fixture's nonexistent/disabled target would then cause the later MFA-reset target check to return 409, so the expected 401 still distinguishes and catches the bypass rather than passing due to that downstream denial. A real enabled target would make this stronger by reaching challenge creation, but it is not needed for the assertion to catch the specific preflight defect.
- **Operation issuance:** `createMfaResetChallenge` creates a real, unexpired operation-bound challenge with a canonical body matching the arguments passed to `issueMfaResetToken`. The helper does not require the target account at issuance time; target validation is in the API challenge/ultimate reset route. The target id here is therefore sufficient to make the service's proof-binding path viable, though it is not an end-to-end reset target. The test then changes the session row to `portal = 'customer'` and calls the real issuance service. On a no-match session lock, the repaired path returns null before challenge lookup/verifier/update. If B1 remained, the valid challenge/body/nonce reaches the verifier and update path, returning a proof; the test's null and `verifyAuthentication`-not-called assertions fail.
- **Pending-action issuance:** the test creates a valid pending-state action row with a nonempty target, valid confirmation kind, requester/person, credential/session id, future expiry, and valid hash shape, then creates a matching, unexpired PA-15 challenge through `createPendingActionChallenge`. After changing the session portal, it calls the real `issuePendingActionToken`. The row/action/challenge lookups and nonce can succeed if the session check is bypassed; thus this is not an invalid-challenge or absent-action false positive. The same null/verifier assertions distinguish the regression.
- **Writes and audit:** the test does not assert table snapshots or audit counts explicitly. However, with these valid fixtures, a bypassed session check proceeds past the verifier and successful challenge update; the returned-proof and verifier assertions detect that prior behavior. The issuance services themselves do not append audit rows; the API handler appends issuance audit only after a successful service result. The preflight route's challenge creation path has its own behavior after preflight, and status 401 is checked. Explicit row/audit snapshots would strengthen the test but are not needed to close B1 by source inspection. This remains a minor coverage improvement, not a blocker.

## Source and contract checks

- Net diff is exactly `apps/api/src/auth/repository.ts` and `tests/api-integration/local-factor-policy.test.ts`; API/service caller files are restored to base, with first-row destructuring unchanged.
- The three consumers are `requireCurrentAgentSession`, `issuePendingActionToken`, and `issueOperationToken`; all use `const [activeSession] = await ...` and reject/return null when absent.
- The preflight retains its passed `new Date()` comparison and exact session id, user id, agent portal, and expiry predicates.
- The lock query retains exact session id, user id, agent portal, `dbNowUtc()` expiry comparison for the UTC wall-clock timestamp, `FOR UPDATE`, and the supplied transaction executor. Advisory lock, row lock, challenge/action lock, verifier, update, and transaction order are unchanged.
- Awaited query exceptions still propagate through the existing route/transaction code. The materialized helpers continue to return row arrays; callers now consume the first element correctly.
- No proof-binding, challenge/proof mutation, audit, route policy, schema, authority, factor-verifier, dependency, or gate semantics change is present in the production diff.

## Checks actually performed

Verified worktree HEAD and merge base; confirmed clean `git status`; read the complete two-path net diff; searched and read all current helper declarations/call sites; read the author repair report; inspected the integration test, mock-auth and CSRF helpers, operation/pending-action challenge constructors, issuance services, lock predicates, and relevant security/time contracts; ran `git diff --check` successfully.

No tests, typecheck, build, PostgreSQL, Docker, browser, dependency installation, or other runtime check was run by this reviewer. The author reports Biome and TypeScript checks passed; I did not rerun them. Exact-head PostgreSQL integration evidence is pending.

## Non-blocking improvement

For stronger end-to-end evidence, a follow-up test can use an enabled, existing MFA-reset target and assert no challenge/proof state or audit delta on session denial. The current regression still catches the specific empty-array bypass with its expected 401, valid operation and pending-action challenges, eligible action row, and uncalled verifier. This is not a blocking finding.

## Evidence file

`stepup7d301-full-ordinary-b-luna.md`

# Ordinary review B — #580 step-up session-read materialization repair

**Model:** GPT-6 Luna (assigned ordinary-review tier; fresh reviewer context)
**Role:** Independent ordinary reviewer B
**Candidate head:** `7d301db75547482aade063956fb5f94d487346fc`
**Comparison base:** `5a26ca75e60c7232ab8280a13e599fcbe4fd3518`
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-stepup-session-read-20261017/Ticketing.v2`
**Independence:** I did not author, direct, or remediate this candidate. I read the implementation reports and original ordinary review A as claims/context, and verified the candidate source and diff independently.

## Verdict: CLEAR

No blocking or non-blocking code findings in the reviewed slice. The frozen repair makes both repository helpers materialize their Drizzle statement result arrays while preserving the consumers' first-row semantics. A missing row is therefore `undefined` and follows the existing fail-closed branches at preflight and both issuance transactions.

## Coverage and findings

I verified `HEAD` and the base, clean worktree status, complete base-to-head diff, both repository helper definitions, every TypeScript call site, their surrounding route/transaction logic, and the new integration regression. The net diff is two files: `apps/api/src/auth/repository.ts` and `tests/api-integration/local-factor-policy.test.ts`. The three call sites in `step-up-api.ts` and `step-up-service.ts` retain first-row destructuring, matching the base; this is the repaired behavior after the intermediate 455 candidate had assigned the row arrays directly.

The repository functions now `await` the query builder and return resolved row arrays, meeting the repository result contract. The preflight query still filters by exact session id, user id, agent portal and caller-provided current `Date`. The transactional lock still uses the supplied `StepUpExecutor`, exact session id/user/agent predicates, UTC `dbNowUtc()` comparison for `session.expires_at`, `FOR UPDATE`, and `LIMIT 1`. The callers retain advisory-lock-before-row-lock order and use the locked query within their existing transaction. Query errors continue to reject through the existing awaited paths. I found no change to challenge/proof bindings, verifier ordering, mutations, routes, policy, schema or dependencies.

The regression is materially targeted at the old defect:

- With the database session deleted, the actual challenge-preflight route must return 401. If the prior array-as-row bug returns `[]` as a truthy value, preflight continues; the test's active admin identity and initialized instance setting let factor-state loading succeed, and the mfa-reset target has no enabled-factor row, which would produce the later 409 rather than 401. Thus later target validation does not create a false-positive 401.
- For each transaction path, the test first creates a valid mfa-reset operation challenge and a valid pending-action challenge, then changes the persisted session to `portal = customer`, making only the active-agent-session predicate fail. It calls the actual token issuance services with correctly bound ids/nonces/body inputs and a viable verifier spy. If an empty row array were treated as an active row, both paths would proceed to verification; the explicit `null` and `not.toHaveBeenCalled()` assertions would fail. The valid challenge and pending-action fixtures prevent unrelated missing-challenge or stale-action checks from masking the session-read regression.

The PA-15 security model requires a live session and single-use action/operation-bound proof. The relevant coding standard requires repository functions to await statements and return rows/DTOs/scalars. The UTC timestamp rule and transaction-executor contract are preserved.

## Checks performed and limitations

- Read `AGENTS.md`, the active mission, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the PA-15 sections of `docs/01-architecture/security-model.md` and `pending-actions.md`, and the repository executor/results and UTC rules in `docs/04-engineering/coding-standards.md`.
- Inspected complete candidate diff, exact helper definitions and all call sites; searched the TypeScript tree for both helper names; compared the three call-site shapes with base and intermediate 455 source.
- No tests, typecheck, build, PostgreSQL, Docker, browser, install or other runtime checks were run, per assignment and the conductor's shared verification-window constraint. The integration regression remains runtime-pending; this verdict is source review only.

**Blocking findings:** none.
**Non-blocking findings:** none.
**Residual:** PostgreSQL execution of the new regression and exact-head required gates remain pending with the conductor.

## Evidence file

`stepup7d301-full-security-61-sol.md`

# Full independent security review — #580 step-up session-read materialization

**Model:** GPT-6.1 Sol
**Role:** Fresh independent full security reviewer, after ordinary reviews A and B cleared the exact candidate.
**Reviewed head:** 7d301db75547482aade063956fb5f94d487346fc
**Comparison base:** 5a26ca75e60c7232ab8280a13e599fcbe4fd3518
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-stepup-session-read-20261017/Ticketing.v2`
**Context:** `/root/stepup7d301_full_security_sol`.
**Route provenance:** The conductor reports the actual dispatch arguments as `task_name=stepup7d301_full_security_sol`, `fork_turns=none`, `model=gpt-6.1-sol`, `reasoning_effort=high`, and the returned canonical context above. This is explicit requested/accepted model-route provenance. A served-model build/version fingerprint is not exposed in this reviewer context; I cannot independently attest such a fingerprint and have not invented one.
**Independence:** This fresh context did not author, direct, or remediate the candidate or its preceding defect. Author reports and ordinary verdicts were treated as claims to verify against source and evidence. I made no source, ref, shared-record, dependency, or runtime changes.

## Verdict: CLEAR — full security review of this bounded candidate

No blocking or non-blocking security findings in the current two-path net diff. The intermediate candidate's real array-truthiness defect is closed at all three consumers. Relative to the accepted base, the production change materializes two repository query results without changing authorization predicates, result consumption, locks, transaction boundaries, proof verification, or audit behavior. This conclusion follows a full review of the bounded auth change and relevant surrounding paths, not a lightweight path-only confirmation.

This is not merge authorization, whole-#580 acceptance, a stage finalizer, release/image approval, or SIT acceptance. Current required CI, image build/boot/health, and the conductor's other applicable gates remain separate requirements.

## Coverage and security reasoning

I verified clean worktree status, exact HEAD, merge base, both commits since the base, the complete two-path net diff, and `git diff --check`. The net change is exactly `apps/api/src/auth/repository.ts` and `tests/api-integration/local-factor-policy.test.ts` (128 additions / four deletions). `step-up-api.ts` and `step-up-service.ts` have no net changes from the base. I searched all declarations and consumers of both repository helpers and read their surrounding route, transaction, challenge, proof, nonce, verifier, mutation, and error paths.

1. **Session scope and expiry.** `getActiveSessionForStepUp` still selects only the id from the exact session id + user id + `portal = agent` + `expiresAt > now` match, with `LIMIT 1`. Its `now` remains the caller's `new Date()` and is bound through the Drizzle timestamp column encoder. No raw-Date SQL binding or changed boundary is introduced. `lockActiveStepUpSession` retains the same exact session/user/portal match and strict expiry comparison against `dbNowUtc()`. `session.expires_at` remains a UTC wall-clock `timestamp without time zone`; `dbNowUtc()` remains `now() AT TIME ZONE 'UTC'`, avoiding session-timezone coercion. The query does not broaden across users, portals, or tenants.
2. **Result shape and fail-closed behavior.** Both helpers now await their select and return resolved row arrays. All three consumers use `const [activeSession] = await ...`. A no-match `[]` therefore becomes `undefined`, producing the existing preflight 401 or transactional null before factor verification or proof mutation. None tests the array's truthiness. This matches the base behavior and the repository result-materialization contract.
3. **Transactions and locks.** The transactional helper uses its supplied `StepUpExecutor` directly and retains `FOR UPDATE` and `LIMIT 1`; it never opens or commits another transaction or falls back to the shared pool. Pending-action issuance still takes the session/action advisory lock, locks/revalidates the active session, then locks the action and challenge before nonce verification, the authentication callback, and conditional challenge-to-issued update. Operation issuance still takes its session/operation advisory lock, locks/revalidates the active session, then locks the exact operation/route/version/session/person challenge and compares canonical-body and nonce hashes before invoking authentication. Awaiting the statement does not move the query outside the transaction, release its row lock early, or alter either sequence. This review does not assert a new general lock-order invariant across all pre-existing challenge and lifecycle paths.
4. **Errors, rejection, and effects.** Query construction/execution failures reject the async helper and propagate through each existing awaited caller. No catch converts a database failure into a successful session or proof. Transaction exceptions continue through Drizzle's rollback path; a null session result follows the pre-existing denial branch before challenge/proof writes and the authentication callback. No credential, capability, policy, schema, dependency, verifier, proof-binding, audit payload, response, or gate authority changes occur in the production diff.

## Prior blocker and regression validity

Ordinary A's original `45522ee311f8189be6cdf5c3ae9e5d274a89a1ec` BLOCKED report is authentic retained adverse evidence, not a verdict on this head. In that intermediate source, direct assignment of arrays allowed empty arrays to pass `if (!activeSession)`. Current source restores first-row destructuring at all three sites. My independent disposition is **B1 CLOSED on 7d301db75547482aade063956fb5f94d487346fc**.

I read the complete new regression plus database reset, mock-session, configured-host, CSRF, staff-identity, factor-policy, challenge-construction, and issuance helpers:

- **HTTP preflight:** The test creates a real active staff person/admin and singleton factor setting; the mock resolves the same agent session id. It then deletes the actual session row and posts a schema-valid MFA-reset challenge request. Its no-cookie request passes the harness's existing no-cookie CSRF branch. The active person and valid default factor policy allow factor-state loading if the session check is bypassed; the missing/unenrolled reset target produces the later 409 rather than the expected 401. Thus this is not an invalid-body, CSRF, or downstream-target 401 false positive. It exercises the actual route but does not perform a real browser-cookie authentication journey.
- **Operation transaction:** The session is reinserted, and `createMfaResetChallenge` creates a real unexpired challenge with the same target id, verification note, fixed operation/route/version, person, and session used by `issueMfaResetToken`. The constructor returns a genuine 32-byte canonical base64url nonce; issuance reconstructs the same canonical body. The absent reset target is not queried by this service's issuance path, so it cannot mask a session bypass. After the persisted portal changes to customer, only the active-agent-session match fails before the otherwise viable challenge/verifier path. A bypass would call the verifier and could issue a proof, failing both the null and uncalled-verifier assertions.
- **Pending-action transaction:** The fixture inserts a future-expiring pending action for the same person/session with a step-up confirmation kind, then creates a real matching pending-action challenge and nonce. It remains service-eligible by pending state, requester, expiry, and challenge bindings. The work-item fixture is intentionally a service-level regression; it is not evidence that the narrower current HTTP deactivation challenge API admits that target type. The retained customer-portal session makes the session query return no row. If the empty array were accepted, the valid action/challenge/nonce would reach the verifier and conditional issuance, so null plus uncalled-verifier detects the original defect.

No mutation test or exploit reproduction was executed by me. The sensitivity assessment above is source-derived. Explicit denied-path row/audit snapshots, a real enabled MFA-reset target, and a full pending-action HTTP/browser journey are not supplied by this regression; those omissions do not mask the specific prior defect or block this bounded result-materialization change.

## Runtime evidence independently inspected

I did not rerun tests or activate PostgreSQL/Docker. I inspected the actual retained evidence under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/stepup7d301-runtime/`, including the launcher source, candidate check, invocation, result receipt, full log, runtime/readiness/tmpfs/cleanup receipts, and inventory comparison. I independently recomputed the full-log SHA-256 and byte count.

- `candidate-check.txt` binds the clean source to the reviewed SHA and verifies four selected paths. The launcher's source asserts HEAD and clean status before launch.
- Actual command: `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/local-factor-policy.test.ts ../../tests/api-integration/local-factor-policy-concurrency.test.ts ../../tests/api-integration/identity-clock-ahead-of-utc.test.ts ../../tests/api-integration/identity-clock-behind-utc.test.ts`.
- `vitest-result.json`: same reviewed candidate and worktree; 2026-10-17 02:08:54.780956 UTC through 02:09:56.753490 UTC; native return code 0; no timeout; 61.972 seconds total launcher duration. The actual Vitest v4.1.11 log reports **4 files / 159 tests passed**, with a runner duration of 59.60 seconds. These are distinct timing measurements, not conflicting claims.
- The selected local-factor file contains the added three-path regression. Both UTC wrappers set process and database timezones (Asia/Yangon and America/New_York), assert the actual non-UTC settings, and import the identity/user/session suites. I checked the selected files and imported suites for `.skip`, `.todo`, and `.only`; no such markers were found. The compact log does not enumerate each individual assertion, so the test identity is established jointly by the exact invocation, selected source, clean-head receipt, and all-tests-passed summary rather than an invented per-test reporter record.
- `CI` is deliberately absent in the invocation/result. I read the unchanged global setup: it returns without spawning Testcontainers in this mode, while the unchanged per-file setup consumes the explicit private `_test` database URL. The retained runtime receipt/readiness/log and launcher therefore support a real PostgreSQL18 run on the owned container, not an in-memory or mocked database claim. This is local scoped evidence, not the hosted CI job.
- Full log: **361,306 bytes**, SHA-256 **dc6a0bd4bc91d6945c333cdda0456dddbbbb8a475dc36cf6557f90686b0e9648**.
- The retained container receipt identifies the reviewed-SHA-labelled owned PostgreSQL18 container, tmpfs at `/var/lib/postgresql`, dynamic loopback-only mapping and `taskdesk_test`; tmpfs/readiness receipts support that setup. Cleanup targets that exact labelled container id and reports native 0. Final inventory comparison reports **23 containers / 109 volumes / seven networks** both before and after, with no added or missing entries. I verified `test.env` is absent. These are inspected historical receipts; I made no fresh Docker-state claim.

## Checks performed, limitations, and residuals

I read the repository workflow/provider guide, active mission, current status and relevant decision-log entries, PA-15/session security contracts, query result/executor contract, UTC timestamp rule, actual source/test diff and surrounding paths, both current ordinary reports, the adverse original report, and author reports. I read live open PR/issue listings only to orient the frozen assignment; I did not change GitHub state. Static checks actually run by me were exact-head/base/status/diff/call-site inspection and `git diff --check`, plus offline evidence reads, full-log hashing/counting, and an absent-env-file check.

I did not run lint, typecheck, tests, builds, browser checks, dependency installation, PostgreSQL, Docker commands, or image checks. Author-reported Biome/TypeScript passes remain author evidence, not new reviewer-run passes. Runtime results above are the conductor's actual current-head run, inspected independently here. No independent runtime adversarial run or live lock-contention reproduction is claimed. Required exact-head CI and container image build/boot/health are outside this report and remain for the conductor. Review clearance is confined to this candidate's two-path bounded slice; all broader #580, feature acceptance, release, and stage claims remain open under their own gates.

**Blocking findings:** none.
**Non-blocking findings:** none.
**Prior finding disposition:** original ordinary A B1 closed at the reviewed head.

**Reviewed head:** `7d301db75547482aade063956fb5f94d487346fc`
