# Pending-action challenge creation persistence — #580

Reviewedsource1198edb6b36171dadd75a8d280fd5fb28a869771 on acceptedmaine848f3bd05bec95c8af657c29923a6413a11c63f changes only auth/repository.ts and auth/step-up-service.ts. One coherent challenge-creation statement family is materialized in an executor-first awaited Date|null repository operation. The service retains transaction ownership, id/nonce generation, response and the attempt-limit error thrown through its callback inside that transaction. Requester/pending/expiry/confirmation predicates, action→advisory lock sequence,15-minute scoped count, prior challenge/proof invalidation, DB-clock five-minute deadline and inserted nonce digest/fields are unchanged. Later issuance, consumption and preflight remain unconverted. No capability, route, schema, dependency, event or new policy. No whole#580/authentication/stage compliance claim.

Two fresh independent GPT-6 Luna ordinary contexts CLEAR and a separate fresh independent GPT-6.1 Sol FULL security pass CLEAR cover this exact two-file source. Root explicitly selected gpt-6-luna for authors/reviewers and gpt-6.1-sol/high/forknone for security; served-build fingerprint unavailable, original provenance retained. Root authored/composed this note and is not an independent reviewer.

Actualroot focused PostgreSQL passes5files177tests/native0/92.777seconds (local-factor-policy, local-factor-policy-concurrency, ahead/behind-clock wrappers andSCIMadmin); raw393627bytes SHA256ed3504c785ecfae8150e7014529730d63d31995269435079f54a54e95febfec4. Exactownedcleanup23containers109volumes7networksunchanged/privateenvironmentremoved. The concurrency file tests role/policy invariants, and the clock wrappers import their actual existing functional suites; neither proves pending-action limit races or direct pending-action clock boundaries. Existing limit case is operation-bound, not pending-action-bound. No pending-action limit race, insert failure or outer protected-mutation rollback is claimed. Full hosted/static/unit/browser/performance/shipping-image/migrations/health and exact-current protected checks remain mandatory.

N1 retained: creation takes action-row then session/action advisory; unchanged issuance takes advisory then action-row. Source-derived overlapping same-session/action requests can form a deadlock and PostgreSQL may abort one. This is inherited in the accepted base, non-blocking for the extraction, not reproduced or fixed. It remains an explicit availability residual for the next issuance unit, with no unauthorized-proof/partial-commit exploit inferred.

The original ordinaryA/B artifacts remain unchanged privately. Their reviewer-authored publication derivatives remove only four metadata Markdown hardbreaks each and name exact original paths/hashes; no semantic text/verdict/source is changed. B's separate authentic precision addendum corrects its malformed initial author-file path. The authorfile existed; source conclusions were independently checked. All reports below are verbatim and retain actual scope.


### Preserved report `pending-action-challenge-persistence-author-luna.md`

# Pending-action challenge persistence author handoff

**Role:** GPT-6 Luna implementation author. This context authored and committed the candidate and is not eligible to independently review or approve it.
**Branch:** `codex/remaining580-pending-action-challenge-luna`
**Base:** `e848f3bd05bec95c8af657c29923a6413a11c63f` (#814 accepted on this lineage; #813 session-read persistence is present)
**Candidate:** `1198edb6b36171dadd75a8d280fd5fb28a869771`
**Commit:** `refactor(api): own pending action challenge persistence in repository`
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`

## Result

Implemented the bounded challenge-creation persistence slice. Only `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts` changed. The service still owns the transaction boundary, id and nonce generation, response encoding, and `StepUpAttemptLimitError`; the repository method receives the transaction executor first, awaits all statements, and returns `Date | null`.

The repository preserves the source sequence and predicates: requester-owned pending-action row lock and step-up confirmation check; `(sessionId, pendingActionId)` transaction advisory lock; 15-minute person/session/action challenge count; existing limit exception thrown inside the transaction callback; expiry of matching live challenges then matching issued tokens; database time plus five minutes; insert with the original fields and nonce digest. Existing service SQL for issuance, consumption, and preflight remains out of scope and unchanged.

`lockPendingActionForChallenge` and `countRecentPendingActionChallenges` previously returned builders and were only called by this challenge-creation lifecycle, so they were absorbed into the materializing method. `lockPendingActionProof`, `lockPendingActionById`, and `lockPendingActionChallenge` still have later issuance/consumption callers and were left untouched.

## Checks run

- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.json` — passed, exit 0.
- `pnpm exec biome check --write apps/api/src/auth/repository.ts apps/api/src/auth/step-up-service.ts` — passed after formatting/import sorting; the commit hook's `biome check` also passed.
- `git diff --check` — passed.
- Existing relevant integration source inspected: `tests/api-integration/local-factor-policy.test.ts` directly creates a pending-action challenge and contains an operation challenge-limit integration case. These cases were inspected, not run. No pending-action challenge-limit rollback regression was found in the inspected portions.

No test, PostgreSQL/Docker/browser/build/full-suite run, race test, failure-injection test, or outer-rollback runtime test was performed. No rollback or concurrency guarantee is claimed. Focused integration coverage for pending-action challenge-limit boundary/rollback remains a gap for reviewer/conductor disposition. No report or gate is represented as independent review evidence.

## Next action

Obtain the required fresh independent ordinary reviews and exact-head GPT-6 Sol security review under current policy. Do not include issuance, consumption, or `getPendingActionForStepUp` in this slice.


### Preserved report `pending-action-challenge-1198-ordinary-a-publication-luna.md`

> Publication-format derivative of the authentic reviewer report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/pending-action-challenge-1198-ordinary-a-luna.md` (SHA-256 `b6d6b2ff909bd920b8fae410b32396102da30fb6b91cc093cbf192a005d3a32b`). Transformation: converted trailing two-space Markdown hardbreaks to ordinary newlines only. No verdict, scope, findings, or evidence claims changed; no new review pass, test, approval, or source change was performed.

# Independent ordinary review — pending-action challenge persistence

**Reviewed head:** 1198edb6b36171dadd75a8d280fd5fb28a869771
**Comparison base:** e848f3bd05bec95c8af657c29923a6413a11c63f
**Reviewer:** GPT-6 Luna, independent ordinary reviewer (fresh context; did not author, direct, or remediate this candidate)
**Scope:** Complete two-file diff in `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts`; challenge creation call sites, relevant tests, PA-15 contract, query ownership rules, and stated lifecycle sequence.

## Verdict

**CLEAR — no blocking findings.** The extracted repository operation preserves the existing challenge-creation checks and ordering by inspection. This is source review evidence only; the focused PostgreSQL run and the other required review tiers remain separate.

## What I checked

- Verified the clean worktree HEAD is the reviewed SHA and the stated base resolves to the requested commit.
- Read the repository instructions, active mission, workflow review policy, provider adapter, PA-15 portions of the security model and pending-actions contract, and repository executor/result rules in coding standards.
- Read the full net diff and checked all declarations and call sites for the moved challenge lifecycle. The removed helpers had no remaining callers; the new materializing function is called by the service, which still owns the transaction.
- Compared the implementation with the prior lifecycle: requester-owned pending action locked while pending and unexpired; step-up confirmation requirement; session/action transaction advisory lock; person/session/action rolling 15-minute count; limit callback throws inside the transaction callback; expiry of live challenges and issued tokens; database time plus five minutes; insertion of the same challenge fields and nonce digest; service response encoding and null handling.
- Inspected the current pending-action challenge use in the PA-15 API and relevant integration-test portions. The existing attempt-limit integration case exercises operation challenges; it does not directly exercise the pending-action challenge limit path.
- Ran `git diff --check e848f3bd05bec95c8af657c29923a6413a11c63f 1198edb6b36171dadd75a8d280fd5fb28a869771` — passed.
- Searched for every old/new helper and service call site. No tests, PostgreSQL, Docker, race, failure-injection, outer-rollback, browser, build, or full-suite commands were run.

## Findings

None blocking. The statement order and predicates match the source implementation. The repository method awaits its statements and returns `Date | null`; it does not open or control the transaction. The service continues to generate the id/nonce, choose the limit, throw `StepUpAttemptLimitError` from inside the transaction callback, and construct the response after the transaction.

## Coverage limits

The existing integration limit case covers operation challenge issuance, not pending-action challenge issuance. A focused PostgreSQL check of the pending-action path is useful to confirm its limit boundary and transaction behavior; the absence of that direct test is not a source-level blocker for this bounded extraction. This review does not claim observed concurrent serialization, rollback behavior, or runtime equivalence. Later issuance, consumption, and preflight paths were checked for scope stability only and are not newly reviewed behavior here.


### Preserved report `pending-action-challenge-1198-ordinary-b-publication-luna.md`

# Independent ordinary review — pending-action challenge persistence (review B)

**Reviewed head:** `1198edb6b36171dadd75a8d280fd5fb28a869771`
**Comparison base:** `e848f3bd05bec95c8af657c29923a6413a11c63f`
**Reviewer:** GPT-6 Luna, independent ordinary reviewer; fresh context, not author, director, or remediator of this candidate.
**Scope:** Complete diff in `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts`, exact helper call sites, PA-15, security-model step-up requirements, and query ownership/executor rules.

## Verdict

**CLEAR — no blocking source-level finding.** The extraction preserves the reviewed challenge flow and moves its SQL into an awaited, materializing repository function while keeping transaction ownership in the service. This is source inspection evidence; it does not establish runtime, race, or rollback behavior.

## Checks performed

- Confirmed checkout HEAD is the exact reviewed SHA and the worktree is clean.
- Read repository instructions and workflow, active mission, review policy, PA-15 contract, relevant security-model requirements, and query ownership/executor/result rules.
- Inspected the full two-file diff, repository helper implementation, service transaction and response, API caller, and all references to the old and new helper names.
- Compared the SQL predicate and sequencing with the base implementation: lock the requester-owned pending, unexpired action; require step-up confirmation; take the session/action transaction advisory lock; count this person/session/action's challenges created in the rolling 15-minute window; invoke the limit callback inside the caller's transaction; expire matching live challenges and issued proofs; read database time plus five minutes; insert the challenge with its nonce digest.
- Confirmed the repository function takes the executor first, awaits/materializes statements, returns `Date | null`, and does not own transaction boundaries. The service retains id/nonce generation, the configured limit, `StepUpAttemptLimitError` callback, transaction, and response/null behavior. The single service call site is conserved; no old helper references remain.
- `git diff --check e848f3bd05bec95c8af657c29923a6413a11c63f 1198edb6b36171dadd75a8d280fd5fb28a869771` passed.

## Findings and limits

No blocking or non-blocking source finding. The action predicate and old lifecycle ordering are preserved. The pending-action limiter counts all matching confirmation rows by `createdAt`, as before; I found no change to that value or error path. Later operation challenge, proof issuance/consumption, and preflight behavior are outside the diff and not reviewed as changed behavior.

No tests, PostgreSQL session, transaction rollback probe, concurrency/race probe, build, compile, Docker, browser, or GitHub mutation was run, per the assigned shared heavy-test-window constraint. In particular, this review makes no claim that concurrent serialization or outer rollback was observed. The cited 2026-10-15 author takeover evidence path was unavailable in this workspace; conclusions above were verified directly against the checked-out base and candidate source. Review A's report was consulted only as a lead and its claims were independently checked against source.

Publication provenance: faithful publication of the authentic report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/pending-action-challenge-1198-ordinary-b-luna.md` (SHA-256 `2b72a4b9daf8e0d702f6a65af9a631f0d00b12c5e48db4535681161078483f52`). Transformation: removed only trailing two-space Markdown hard-break markers, converting them to ordinary newlines for diff-check compatibility. Reviewer identity, source, scope, checks, findings, verdict, and limits are unchanged.


### Preserved report `pending-action-challenge-1198-ordinary-b-precision-luna.md`

# Precision addendum — ordinary review B evidence path

**Original review report:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/pending-action-challenge-1198-ordinary-b-luna.md` (SHA-256 `2b72a4b9daf8e0d702f6a65af9a631f0d00b12c5e48db4535681161078483f52`)

The review's final paragraph inaccurately said the cited author takeover evidence path was unavailable. During review, the attempted `cat` path was `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover-authorpending-action-challenge-persistence-author-luna.md`; that path was malformed because `takeover` and the filename were joined with a hyphen. The shell returned “No such file or directory.” The actual file exists at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/pending-action-challenge-persistence-author-luna.md` and was subsequently read in full.

The original review report remains unchanged. This correction narrows the provenance statement: the author handoff was available and read after the initial failed path attempt. It does not alter reviewer independence, the source checks independently performed against the base and candidate, scope, findings, verdict, or stated runtime/testing limits. This addendum is a separate factual correction, not a new review or test result.


### Preserved report `pending-action-challenge-1198-full-security-61-sol.md`

# Independent full security review — pending-action challenge persistence

**Model:** GPT-6.1 Sol
**Role:** Full independent security reviewer
**Context:** `/root/pending_action_challenge_1198_security_sol`
**Reviewed head:** 1198edb6b36171dadd75a8d280fd5fb28a869771
**Comparison base:** e848f3bd05bec95c8af657c29923a6413a11c63f
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`
**Invocation provenance:** The conductor supplied requested model `gpt-6.1-sol`, reasoning `high`, and `fork_turns=none`. A served-model fingerprint is not exposed to this context; this is requested invocation provenance, not independently attested routing metadata.
**Independence:** Fresh context. I did not author, direct, or remediate this candidate. I independently inspected source before deciding the verdict. The two existing ordinary verdicts were read as evidence and did not substitute for source inspection.

## Verdict

**CLEAR for this bounded extraction, with no blocking finding.** The complete two-file change preserves the existing challenge-creation authority checks, statement sequence and transaction error behavior. It moves persistence into an awaited repository method without extending the caller's authority. There is one non-blocking, pre-existing availability finding below; this review does not claim whole pending-action compliance or a concurrency fix.

## Source and contract coverage

I checked the complete base-to-head diff and read both candidate files in full: `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts`. Only those two files differ, with 88 insertions and 85 deletions. I also read the base service, including its old challenge lifecycle and unchanged issuance path, and checked the removed repository helpers against the diff.

Connected surfaces inspected were the current-session resolver, pending-action challenge route and proof route in `apps/api/src/auth/step-up-api.ts`; pending-action consumption at the user-deactivation approval seam in `apps/api/src/pending-action/service.ts`; `apps/api/src/pending-action/lifecycle-invalidation.ts`; relevant `pending_action` and `step_up_confirmation` schema definitions; `apps/api/src/database/executor.ts`; and `apps/api/src/utils/db-time.ts`. Searches covered every old/new repository helper and service reference across API source and tests. The new repository function has one production caller, the existing service; the removed helpers have no remaining references. Later issuance, consumption and preflight are unchanged and were inspected only to assess connected seams and risk.

Contracts read included the repository instructions, active mission, workflow and provider adapter, coding standards including query ownership and UTC rules, PA-15 in `docs/01-architecture/pending-actions.md`, the session/step-up section of `security-model.md`, and the CI security-scope/review requirements. I inspected the relevant data-model entries, the current status opening and newest decision-log entries. No new product decision, dependency, schema, route, policy entry or authority path is introduced.

## Security analysis

- The action lookup still locks one row by exact pending-action id and requesting person, with `state = pending` and unexpired database-clock expiry. Missing/ineligible actions and confirmation kinds without `_step_up` return null before challenge writes. The API continues to resolve person/session from the current authenticated agent session, reject impersonation and non-agent sessions, and perform its existing pending-action kind/route and current-admin admission checks. The helper does not make an arbitrary action id authoritative.
- The existing action-row lock is followed by the same transaction advisory lock keyed by session and action. The 15-minute count retains person, session, binding kind and pending-action predicates and counts all recent matching rows, rather than only live challenges. The service still fixes the limit at five. A client cannot supply the new repository-only `limit` or `onLimit` fields.
- At the limit, the supplied synchronous callback throws the same `StepUpAttemptLimitError` from inside the service's transaction callback, before invalidation or insertion. The async repository rejection is returned to and awaited by `db.transaction`; it is not converted to a successful null result. The existing API catch still maps that error to 429 and records its denial audit outside the failed transaction. Unexpected database/insert errors also reject the transaction. This is source reasoning, not observed rollback testing.
- Prior live challenges and issued tokens are expired using the same person/session/pending-action/binding/state/expiry predicates, in the same order, before the insert. Consumed proofs and unrelated bindings remain excluded by those statements. All statements use the supplied executor; the repository neither opens nor commits a transaction and returns only `Date | null`, never a composable builder.
- The id and 32-byte random nonce are still generated in the service. Only SHA-256 of the nonce is persisted; the same base64url nonce and ISO expiry are returned after successful transaction completion. Hashing occurs when constructing the repository input rather than at the final insert, with no changed bytes or trust boundary. The insert retains the pending-action binding and null operation-only columns, state and nonce digest. No token is minted by challenge creation.
- The challenge deadline is still derived from PostgreSQL `now() + interval '5 minutes'`; its returned offset-bearing text is parsed to Date and inserted through the timestamp column encoder. The action/challenge/count timestamps here are `timestamptz`, so bare `now()` is appropriate. The separate unchanged active-session issuance lock retains `dbNowUtc()` for the UTC wall-clock `session.expires_at` column. No process-clock expiry or raw-Date SQL binding was introduced by the extraction.
- Nonce verification, current-session recheck, fresh authentication, proof issuance and proof consumption remain on their existing paths. Consumption still receives the approval transaction, so the extraction adds no independently committed proof mutation or alternate approval path. This does not establish runtime rollback of the later protected mutation.

## Non-blocking inherited finding

**N1 — pre-existing creation/issuance lock-order inversion, availability risk.** Candidate `repository.ts:169-191` locks the pending-action row before taking the session/action advisory lock. Unchanged `step-up-service.ts:720-737` takes that advisory lock, then the active-session row lock, then the same pending-action row. The base has the identical order: old challenge creation in `step-up-service.ts:310-320` awaits `lockPendingActionForChallenge` (`FOR UPDATE`) before the advisory lock; base issuance takes the advisory lock before `lockPendingActionById`.

A source-derived counterexample is two requests for the same session/action, with an existing challenge: issuance takes the advisory lock and pauses before its action-row lock; concurrent challenge creation takes the action-row lock and waits for that advisory lock; issuance then waits for the action-row lock. The two transactions now wait on one another and PostgreSQL may abort one as a deadlock victim. This is a concrete static lock graph, not an executed reproduction. It can cause a failed request; it does not demonstrate unauthorized proof issuance or committed partial writes. The extraction preserves this behavior and does not create or worsen the inversion. It is therefore non-blocking for this candidate, retained for the next issuance-planning unit. No redesign, remediation or fix claim was made here.

## Commands and evidence actually checked

I ran read-only `git rev-parse HEAD`, `git status --short`, `git diff --stat`, the complete scoped `git diff`, `git show` for the base service, and `git diff --check` against the exact base/head. HEAD matched the requested candidate, status was clean and diff-check passed. `rg`, `sed`, `cat` and `wc` were used for source/contract/evidence inspection. A few initially guessed documentation/test paths did not exist; I located and read the actual canonical sections and actual named test files. No test or runtime command was run by this reviewer.

Both authentic ordinary reports were read at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/pending-action-challenge-1198-ordinary-{a,b}-luna.md`; both are CLEAR with their own source/testing limitations. I read the author handoff, the publication derivatives and B's separate precision addendum under the takeover evidence directory. The addendum corrects B's initially malformed author-handoff pathname, not a missing workspace or a changed verdict. Original reports remain distinct from the formatting derivatives.

I inspected the conductor's existing exact-candidate PostgreSQL evidence: `pending-action-challenge-1198-focused-pg-success-receipt.json`, the runtime invocation/result and candidate-check receipts, and the raw log summary. The recorded command selected local-factor-policy, local-factor-policy-concurrency, both identity-clock wrappers, and scim-admin: five files and 177 tests passed, native exit 0, start 2026-10-17T04:15:09.347682+00:00, end 04:16:42.124901+00:00, elapsed process time 92.777 seconds. I independently computed the raw log size as 393627 bytes and SHA-256 as `ed3504c785ecfae8150e7014529730d63d31995269435079f54a54e95febfec4`, matching the receipt. The raw Vitest summary independently states five files / 177 tests passed. These are the conductor's executed tests, not tests I ran.

Relevant test source inspected includes direct pending-action challenge creation and issuance-session denial in `local-factor-policy.test.ts`, pending-action issuance/approval paths in `scim-admin.test.ts`, the existing operation attempt-limit case, the local-factor concurrency suite and both identity-clock wrappers. The concurrency file exercises local-factor role/policy invariants, not pending-action challenge races. The clock wrappers import work-item-comment, instance-users-guards, instance-users and session-freshness; their names do not establish direct pending-action limit coverage under both zones.

## Residuals and acceptance boundary

No pending-action challenge-limit boundary/race test or injected challenge-insert failure/rollback probe was found in the inspected coverage. The existing five-attempt limit test uses the operation binding. The supplied run does not prove pending-action limit serialization, the inherited creation/issuance deadlock schedule, or outer protected-mutation rollback. These gaps are proportionate non-blocking residuals for a statement-preserving extraction; they must not be described as passed tests. The conductor's cleanup receipt reports unchanged resource inventories and removed private environment; I did not independently operate or inspect Docker to re-prove cleanup.

No tests, PostgreSQL connection, Docker operation, build, browser, full-suite run, GitHub mutation, repository edit, commit, push or merge was performed by this reviewer. This review is an exact-source security verdict and evidence inspection, not image/boot, hosted-check, runtime acceptance or stage-completion approval. Those separate gates remain with the conductor.


## Current exact source binding

Only this candidate own regular100644 review note is added after the source. Required CI/image and current-main compatibility remain pending. No gate waiver or merge readiness is implied.

**Reviewed head:** `1198edb6b36171dadd75a8d280fd5fb28a869771`
