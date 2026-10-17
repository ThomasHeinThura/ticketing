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


## Completed pending-action lifecycle extraction — current source f220

This appendix supersedes current source/readiness only, preserving every historical byte and report. Current exactsourcef220a9d659394e4a9dad2e856b24b80f867cb141 includes creation plus the remaining issuance and consumption statement families, in the same two auth files. It does not include preflight getPendingActionForStepUp, which remains explicitly unconverted. Source1198 and ownnoteb65 were normally pushed and preserved; the conductor chose one coherent eventual three-lifecycle PR before full CI, avoiding separate near-identical hosted runs. No scope/quality gate or evidence requirement is waived.

Current ordinaryA/B contexts are the same two independent-from-author contexts reused for the changed-source delta; they were not newly spawned for f220. Both inspect the complete new delta and connected callers and return CLEAR. The same independent GPT-6.1 Sol security context then performs a FULL current combined two-file audit against acceptedmaine848 and the new delta againstb65, CLEAR with inheritedN1 unchanged. Earlier source clearance does not transfer to current head; the new reports supply actual coverage.

Root actual current API TypeScript check passes. Exactcurrent PostgreSQL7files218tests/native0/83.792seconds (04:33:03.132291–04:34:26.924822UTC), raw398269bytes SHA2564ecba17236bd5acb045b885453a63cc0c86caa51bf974625f212969a49072d60. Files are the prior5 plus pending-action-service and pending-actions-decisions. Exactownedcleanup23containers109volumes7networksunchanged/privateenvremoved; sourcecleanunchanged. Selected integration coverage is not direct limit/deadlock/insert-failure/verifier-exception/concurrent-single-use/outer protected-mutation rollback proof. The full Sol review explicitly checks these boundaries by source and retains the runtime gaps. No claim that the pending-action-service test itself invokes the changed proof service.

N1 remains exactly the inherited action/advisory lock-order inversion, non-blocking for statement-preserving extraction and not reproduced or fixed. Invalid nonce or verifier-null expires the exact challenge and returns normally inside issuance TX, preserving expiry commit intent; a thrown verifier still rejects the TX. Proof consumption remains within the supplied protected-action TX. All statements use that executor and materialize results. No new authority, schema, route, dependency, event or process-clock expiry.

Publication precision correction: the earlier root introduction's phrase four metadata hardbreaks each was inaccurate. Byte inspection finds THREE trailing two-space markers in each original1198A/B report and the currentf220B report. Reviewer-authored derivatives remove those three formatting markers only, preserving semantic text and naming original hashes. Current B provenance also corrects its earlier handoff claim of no hardbreaks and clarifies actual reused independence. Original private artifacts and historical public wording are retained unchanged.

Full hosted/static/unit/browser/G11/shipping image125-migration/UID/health/isolation/cleanup and all newest exact-publication protected checks remain pending, as does current-main compatibility before the eventual PR acceptance. No whole580, PA-15 compliance, stage, signed release, SIT or mission completion is claimed.


### Preserved report `pending-action-proof-lifecycle-persistence-author-luna.md`

# Pending-action proof lifecycle persistence author handoff

**Role:** GPT-6 Luna implementation author. This context authored the candidate and is not eligible to independently review or approve it.
**Branch:** `codex/remaining580-pending-action-challenge-luna`
**Base:** `b65e9bb5898ac6d8cf837197ce6a89311b621492` (clean pushed creation candidate; includes `1198edb6b36171dadd75a8d280fd5fb28a869771` and its authentic review note publication)
**Candidate:** `f220a9d659394e4a9dad2e856b24b80f867cb141`
**Commit:** `refactor(api): own pending action proof persistence in repository`
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`

## Result

Completed the remaining pending-action proof issuance and consumption persistence moves in the two authorized auth files. With the earlier creation commit preserved, the branch now covers the pending-action challenge/issue/consume lifecycle family for one eventual focused PR. This commit changes only `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts`.

The service retains the transaction opening for issuance, incoming canonical nonce/token validation, random token creation, SHA-256 hashing and response encoding. Its authentication verifier remains a service-supplied callback and is invoked by the repository once, only after the session, requester-owned action and exact bound challenge have been locked and the nonce matches. Failed nonce and failed verification still expire only that challenge and return null from inside the transaction callback, preserving the existing commit of that expiry intent. Unsupported verification remains fail-closed. Issuance returns the same authentication method and database-derived expiry, with the token returned only after transaction success.

Consumption retains canonical 32-byte base64url token validation and digest construction at the service boundary. The repository receives the caller-supplied protected-action transaction first, locks only an issued/unexpired confirmation matching token digest, person, session, pending-action binding and action id, then marks that exact proof consumed with `now()` and requires one returned row. It opens no transaction and commits nothing independently; the proof remains composed with the protected action.

The old builder-returning `lockPendingActionById` and `lockPendingActionChallenge` helpers had only the issuance caller; `lockPendingActionProof` had only the consumption caller. They were absorbed into awaited repository methods. Existing `lockActiveStepUpSession` remains materialized and is reused. The preflight `getPendingActionForStepUp` and its callers remain outside scope and are still unconverted. No broad auth repository cleanup was made.

## Statement mapping and preserved order

- **Issuance:** the service transaction calls `issuePendingActionTokenRecord(executor, input)`. Within it the existing session/action advisory lock runs first, followed by active agent session row lock (`dbNowUtc()` for the UTC-wall-clock expiry), requester-owned pending-action row lock, exact person/session/action/challenge-expiry challenge row lock, nonce comparison, one verifier callback, the original PostgreSQL issued/expiry clock query, and the same conditional challenge-to-issued update with `RETURNING` cardinality check.
- **Consume:** `consumePendingActionProofRecord(executor, input)` performs the exact proof `FOR UPDATE` selection and consumed-state update through the supplied executor, preserving the state and unexpired token predicates and one-row return requirement.
- **Pre-existing N1 retained unchanged:** creation locks the requester-owned action row before its advisory lock, while issuance takes the advisory lock before the same action row. The full Sol review of creation identified this inversion as a pre-existing availability/deadlock risk, non-blocking for the reviewed creation extraction. The task explicitly kept lock order unchanged; this patch does not mitigate it or claim a race/deadlock result.

## Checks and limits

- `pnpm exec biome check apps/api/src/auth/repository.ts apps/api/src/auth/step-up-service.ts` — passed, no fixes.
- `git diff --check` — passed.
- Commit pre-hook Biome check — passed.
- No tests, TypeScript check, PostgreSQL, Docker, browser, build, analyzer, probe or broad suite was run under the conductor's shared execution-window restriction. Existing creation-candidate evidence (five PostgreSQL files / 177 tests and its three review verdicts) applies only to the `1198edb6` creation candidate and does not cover this new delta.
- No new test was added: inspection did not identify a guard/assertion requiring a regression for this query-ownership-only change that would not mirror the implementation. Existing five-file PostgreSQL coverage and pending-action service cases still require the conductor's appropriate exact-head validation. No new-source runtime, verifier rollback, consume-with-protected-mutation rollback, or concurrent single-use guarantee is claimed.
- Existing `getPendingActionForStepUp` preflight query ownership remains an explicit unconverted seam outside this task's assigned lifecycle family.

## Next action

Obtain fresh ordinary reviews and a full independent GPT-6 Sol security review for the new exact head, then run the conductor-owned applicable acceptance window before any PR/merge decision. This author handoff is not review or acceptance evidence. This branch commit was not pushed; the preceding creation candidate and review-note publication remain preserved remotely.


### Preserved report `pending-action-proof-f220-ordinary-a-luna.md`

# Independent ordinary A review — pending-action proof lifecycle persistence

**Reviewed head:** f220a9d659394e4a9dad2e856b24b80f867cb141
**Delta base:** b65e9bb5898ac6d8cf837197ce6a89311b621492
**Accepted lineage base:** e848f3bd05bec95c8af657c29923a6413a11c63f
**Reviewer:** GPT-6 Luna, independent ordinary reviewer (fresh context; did not author, direct, or remediate the candidate)
**Scope:** Full b65e9bb..f220a9d delta in apps/api/src/auth/repository.ts and apps/api/src/auth/step-up-service.ts, connected step-up API and pending-action service callers, relevant contracts and repository-query rules. The earlier 1198edb6 challenge-creation review is not evidence for this new issue/consume delta.

## Verdict

**CLEAR — no blocking findings.** The new issue and consume repository operations preserve their former predicates, statement ordering, service transaction boundaries, and return behavior by source inspection. This is not runtime acceptance or the required independent Sol security review.

## Review work

- Verified the clean worktree is at the exact reviewed head and resolved the delta and accepted lineage bases.
- Read the author handoff, complete two-file delta, and connected challenge issuance API, step-up service, and pending-action execution service. Confirmed the former issuance/consume helper call sites were removed and the new materializing operations are called only through the intended services.
- Checked issuance order and bindings: session/action transaction advisory lock; active agent-session row lock using the shared UTC wall-clock helper; requester-owned pending, unexpired action row lock; exact challenge id/person/session/action/state/expiry row lock; nonce comparison; verifier callback awaited once; database issuance/expiry time; conditional challenge-to-issued update with one-row RETURNING requirement. The service still owns transaction opening, canonical nonce validation, token generation/hash and one-time response encoding. Failure nonce/authentication expires only the selected challenge and returns null within the transaction callback, preserving the existing commit-intent behavior by code structure.
- Checked consumption: canonical 32-byte base64url validation and digest creation remain in the service; the repository locks only an issued, unexpired proof bound to digest/person/session/pending-action id, then conditionally marks that same row consumed and requires exactly one returned row. The supplied protected-action transaction remains the executor, so this operation opens or commits no transaction of its own.
- Confirmed later challenge creation from 1198edb6 is preserved in the new branch lineage. The existing creation-review and five-file/177-test evidence remains limited to that creation candidate and is not counted as coverage of this delta.
- Noted the pre-existing N1 lock-order inversion remains: creation locks the requester-owned action before taking the advisory lock; issuance takes the advisory lock before locking that action. This delta does not introduce or resolve it, and I make no concurrency/deadlock claim.
- Confirmed the preflight getPendingActionForStepUp remains outside this lifecycle move and is still a builder-returning seam.
- Ran git diff --check b65e9bb5898ac6d8cf837197ce6a89311b621492 f220a9d659394e4a9dad2e856b24b80f867cb141 — passed. No tests, TypeScript checks, PostgreSQL, Docker, browser, build, analyzer, probe or broad suite were run.

## Findings

None blocking for this delta. The changes are confined to the two authorized auth files and do not change the existing lock order or the preflight seam.

## Limits

This verdict is based on source inspection and diff hygiene. It does not establish actual verifier callback count under runtime conditions, challenge-expiry commit behavior, outer rollback behavior, protected-action rollback coupling, concurrent single-use behavior, or deadlock outcomes. Those runtime checks remain with the conductor; the full independent Sol security review is still required after ordinary review clears.


### Preserved report `pending-action-proof-f220-ordinary-b-publication-luna.md`

# Independent ordinary review B — pending-action proof lifecycle persistence

**Reviewed head:** `f220a9d659394e4a9dad2e856b24b80f867cb141`
**Comparison base:** `b65e9bb5898ac6d8cf837197ce6a89311b621492` (creation candidate plus its published review record); accepted lineage base: `e848f3bd05bec95c8af657c29923a6413a11c63f`
**Reviewer:** GPT-6 Luna, independent ordinary reviewer in a fresh context; did not author, direct, or remediate the candidate.
**Scope:** New b65→f220 source delta in `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts`; connected pending-action proof issue/consume callers; PA-15/security model and repository query ownership/executor rules. The 1198 creation extraction is included only as preserved context, not newly reviewed by this delta report.

## Verdict

**CLEAR — no blocking source-level finding.** The issue and consume persistence paths are moved into awaited materializing repository operations. Transaction ownership, nonce/token validation and generation, authentication callback, response construction, and protected-action composition remain at the service boundary. This is source inspection only; it establishes no runtime, race, or rollback result.

## Checks performed

- Confirmed the worktree HEAD is the exact reviewed SHA and the base resolves to `b65e9bb5898ac6d8cf837197ce6a89311b621492`.
- Read the actual author handoff at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/pending-action-proof-lifecycle-persistence-author-luna.md`, the full b65→f220 diff, connected repository/service functions, callers in `step-up-api.ts` and `pending-action/service.ts`, the PA-15 contract, security-model step-up rule, and query ownership/executor contract.
- Confirmed this delta touches only the two assigned auth files. New operation names are `issuePendingActionTokenRecord` and `consumePendingActionProofRecord`; the service has one call site for each and the absorbed builder helpers have no remaining references.
- Issuance source sequence is preserved: `(sessionId, pendingActionId)` transaction advisory lock; active agent session lock using `dbNowUtc()` for the UTC-wall-clock session expiry; requester-owned pending/unexpired action lock; exact challenge id/person/session/pending-action/binding/state/unexpired challenge lock; nonce digest comparison; one authentication callback; database clock read for five-minute issue/token-expiry timestamps; conditional challenge→issued update and one-row `RETURNING` result. Wrong nonce or failed verification expires only the matching locked challenge and returns null from the transaction callback. Service still owns the transaction, canonical nonce parsing, random token generation and digest, callback, and response encoding after commit.
- Consumption retains service-side canonical 43-character base64url/32-byte token validation and SHA-256 digest. Repository receives the caller’s executor first, locks only a matching issued/unexpired proof bound to token digest, person, session, and pending-action id, then conditionally consumes that row with database time and returns success only for one returned row. The caller invokes it with the existing protected-action transaction; the repository opens no transaction.
- `git diff --check b65e9bb5898ac6d8cf837197ce6a89311b621492 f220a9d659394e4a9dad2e856b24b80f867cb141 -- apps/api/src/auth/repository.ts apps/api/src/auth/step-up-service.ts` passed.

## Findings and limits

No blocking or non-blocking new-delta finding. The known N1 lock-order inversion remains: challenge creation locks the requester-owned action before the advisory lock, while issuance takes the advisory lock before the action. This is pre-existing creation behavior and is explicitly preserved; this review does not claim that a deadlock or race was reproduced or resolved. Preflight `getPendingActionForStepUp` remains unchanged and outside this lifecycle persistence delta.

No tests, TypeScript check, PostgreSQL, transaction/rollback probe, concurrency probe, build, Docker, browser, analyzer, full suite, or GitHub mutation was run, under the shared execution-window restriction. Earlier exact-head evidence for 1198 covers creation only and supplies no coverage for this new source delta. In particular, this review does not claim observed verifier rollback, proof consumption composed with protected mutation rollback, or concurrent single-use behavior.

Publication provenance: faithful publication of the authentic report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/pending-action-proof-f220-ordinary-b-luna.md` (SHA-256 `e772efd84412da0a37323fd10070bee7c4dc07f3012e5b662b7a16cec59a7825`). Transformation: removed only the three trailing two-space Markdown hard-break markers, on original lines 3, 4, and 5, replacing them with ordinary newlines for diff-check compatibility. No report wording, verdict, source, scope, findings, or coverage was changed or removed. The report author's earlier handoff said it had no trailing hard-breaks; byte inspection found three, so that handoff statement was inaccurate.

Reviewer-context clarification: this is the same independent reviewer context that reviewed the 1198 creation candidate, now reviewing the f220 delta. It is independent of the f220 author and did not author, direct, or remediate this delta. “Fresh context” in the report's reviewer field describes independence from the author, not a newly spawned context for f220.


### Preserved report `pending-action-proof-f220-full-security-61-sol.md`

# Independent full security review — pending-action lifecycle persistence

**Model:** GPT-6.1 Sol
**Role:** Full independent security reviewer
**Context:** `/root/pending_action_challenge_1198_security_sol`
**Reviewed head:** f220a9d659394e4a9dad2e856b24b80f867cb141
**Delta base:** b65e9bb5898ac6d8cf837197ce6a89311b621492
**Accepted lineage base:** e848f3bd05bec95c8af657c29923a6413a11c63f
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-operation-proof-persistence-author-luna`
**Invocation provenance:** The conductor supplied requested model `gpt-6.1-sol`, reasoning `high`, and `fork_turns=none` for this context's initial independent spawn. A served-model fingerprint is not exposed to this context; this records requested invocation provenance only.
**Independence:** This is the same independent reviewer context that reviewed creation at 1198, reused for the new source and full combined scope. It was not newly spawned for f220. I did not author, direct or remediate either source change. I checked the current source and reached the verdict independently; the earlier verdict and test results do not transfer approval to this head.

## Verdict

**CLEAR — no blocking finding for the complete current-source creation, issuance and consumption persistence extraction.** Both the new b65-to-f220 issue/consume delta and the combined e848-to-f220 product diff preserve the prior predicates, lock sequence, transaction ownership, verifier ordering, failure behavior and response contract by inspection. One inherited availability finding remains non-blocking, unchanged and explicitly retained below. This is not whole PA-15 compliance, a lock-order fix, runtime acceptance or merge readiness.

## Scope and evidence inspected

I verified clean HEAD at the exact reviewed SHA. I read the complete two-file new delta and the complete combined product diff, and read both current `apps/api/src/auth/repository.ts` and `apps/api/src/auth/step-up-service.ts` in full. The new delta changes only those two files. The combined accepted-lineage diff also adds the historical creation review note, `docs/07-planning/security-reviews/query-ownership-pending-action-challenge-580.md`; it does not add another product path. I verified mechanically that the authentic creation security report, both ordinary publication derivatives and B's precision addendum are present verbatim in that note. Their original 1198 source bindings and limitations remain historical evidence.

I read the new author handoff at `pending-action-proof-lifecycle-persistence-author-luna.md` in the takeover evidence directory and both authentic exact-f220 ordinary reports at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/pending-action-proof-f220-ordinary-{a,b}-luna.md`. Both are CLEAR for their stated delta/source scope. I do not represent their reused independent contexts as newly spawned sessions or treat their earlier creation verdicts as proof of this delta.

Connected source checked includes the current-agent-session resolver, creation route, proof route and real authentication callback in `auth/step-up-api.ts`; active-person factor resolution in `auth/local-factor-service.ts`; the full relevant approval transaction from validation through proof consumption and protected mutation in `pending-action/service.ts`; the pending-action lifecycle lock/invalidation context inspected in the initial pass; the table definitions and time types; repository executor conventions; and the shared UTC clock helper. Searches covered all create/issue/consume service and repository names and all removed helper names in API source and tests.

The existing repository instructions, mission, workflow, provider adapter and security review requirements were read in the initial pass. Their relevant files and contracts are unchanged on this lineage, verified by diff. For this pass I re-read the PA-15 challenge/proof contract and repository-query rules, with the earlier security-model/session/UTC and schema review as connected context. I checked the applicable test sources rather than claiming that source inspection executes them.

## Full current-source security analysis

### Challenge creation

The current creation function still locks the exact requester-owned pending/unexpired action, requires a step-up confirmation kind, takes the same session/action transaction advisory lock, counts the same person/session/action binding over the database's last 15 minutes, applies the service-selected limit of five, expires the same live unused material, reads database time plus five minutes, and inserts the same challenge fields and nonce digest. The `onLimit` callback still throws `StepUpAttemptLimitError` inside the service transaction before invalidation/insertion. Its rejection reaches `db.transaction`, while the API retains its 429 mapping. Null eligibility, random id/nonce generation and response encoding are unchanged. Creation from 1198 is preserved in f220; I checked it as part of the current combined scope rather than silently carrying its old clearance.

### Proof issuance

The service still validates a canonical 43-character unpadded base64url nonce that decodes to exactly 32 bytes and round-trips identically. Malformed input returns null before a transaction/verifier call. It generates the 32-byte random token, computes hashes, opens the transaction and returns the token only after successful transaction completion. Moving hash computation to the repository-input construction changes neither hash bytes nor trust boundary. Cleartext nonce/token bytes are not supplied to persistence or newly logged.

`issuePendingActionTokenRecord` receives the existing transaction executor first. It takes the identical `(sessionId, pendingActionId)` transaction advisory lock; locks the active agent session by exact session id and user id with the UTC wall-clock expiry predicate; locks the exact requester-owned pending and unexpired action; and then locks the challenge by exact challenge id, person, session, pending-action binding, action id, challenge state and database-clock expiry. Missing or unrelated challenge identifiers return null before any challenge mutation or verifier invocation. This is the same statement order and reach as the old helpers plus service SQL.

The nonce digest comparison remains timing-safe. A wrong nonce expires only the selected locked challenge by its id and challenge state, then returns null from the transaction callback. A successful nonce reaches one awaited invocation of the service-supplied authentication callback per repository invocation, with no new loop, retry or fallback. Earlier denial paths invoke it zero times. A callback returning null similarly expires that challenge and returns null. Because these paths return normally inside `db.transaction`, the challenge-expiry write retains its previous commit intent even though no token is issued. A verifier exception still rejects the transaction; the extraction does not convert it to a successful null result or claim that such an exception commits an expiry. The callback's own external effects are not newly made transactional by this move.

The API callback still re-loads current active-person factor policy for the authenticated user. Password verification is refused when a factor is required/enabled; TOTP/backup-code verification still checks current factor state and the returned authenticated user. No client assertion replaces authentication. Unsupported/failed verification remains fail-closed along the existing null/error path. The API still derives person/session/user from authenticated context and returns the same generic failure and audit behavior.

On successful authentication, the repository reads the identical PostgreSQL issued-at and five-minute token-expiry query and conditionally changes that exact challenge from `challenge` to `issued`, retaining the challenge-expiry predicate. The update writes only token digest, method and timestamps and requires exactly one returned row before reporting success. The service keeps the same response shape and one-time token encoding. The all-statements-awaited repository returns a materialized method/date DTO or null; it neither opens a transaction nor leaks a builder.

### Proof consumption and protected-action composition

The service still requires canonical 43-character base64url encoding of exactly 32 token bytes, computes SHA-256, and passes the existing caller transaction to `consumePendingActionProofRecord`. The repository locks only an issued, unexpired confirmation matching digest, person, session, pending-action binding and action id. It then marks that exact locked id consumed with database time, retaining issued-state and token-expiry predicates and requiring one returned row. The unique token-digest index and primary-key update remain unchanged. A mismatch returns null without consuming another proof.

The sole production consumer remains `approveUserDeactivation`, which awaits consumption on its protected-action `tx`. I checked its existing preceding action/requester lock, pending/kind/payload-hash validation, current active staff/admin and agent-session checks, target/name checks, and subsequent same-transaction lifecycle mutation, pending-action transition and effects. No global connection replaces that executor, and no inner commit is introduced by the new repository. A thrown downstream mutation failure still rejects the enclosing transaction by code structure, so the move does not create a committed consumption before the protected action. This is not an observed rollback or race result.

### Time, query ownership and conserved seams

Action, challenge and token expiry/count columns here are `timestamptz`; bare PostgreSQL `now()` remains appropriate. The active-session lock retains `dbNowUtc()` for the existing UTC-wall-clock `timestamp without time zone` expiry. The database clock strings are parsed and written through the same column encoders, with no new process-clock expiry or raw-Date SQL interpolation.

Each new repository lifecycle operation awaits every statement and returns only a scalar/DTO/null. Service transaction orchestration remains in the service; protected-action transaction ownership remains with its caller. The absorbed proof/action/challenge lock helpers have no remaining references. Each new repository operation has its one intended service caller. Operation-bound proofs, route bindings and unrelated authorization paths are unchanged. The builder-returning preflight `getPendingActionForStepUp` remains an explicitly unconverted seam outside this lifecycle scope; this review does not claim all auth queries satisfy query ownership.

## Non-blocking inherited finding

**N1 — creation/issuance lock-order inversion remains an availability risk.** In current `repository.ts:168-188`, creation takes the action row `FOR UPDATE` before the session/action advisory lock. Current `issuePendingActionTokenRecord` at `repository.ts:350-372` takes that advisory lock, then the active-session lock, then the action row `FOR UPDATE`. The accepted-lineage base has this exact order across the old creation service/helper and issuance service/helper. b65 retains it, and f220 moves issuance without changing it.

For the same session/action with an existing challenge, issuance can hold the advisory lock and pause before taking the action row. Concurrent creation can hold the action row and wait for that advisory lock. Issuance then waits for the action row: the transactions form a wait cycle, and PostgreSQL may abort one as a deadlock victim. This is a source-derived counterexample, not an executed reproduction. It demonstrates a possible failed request rather than unauthorized issuance or committed partial mutation. The extraction neither introduces nor fixes it. I retain it as non-blocking for this bounded persistence relocation and do not propose or author a redesign here. Moving the issuance SQL in this delta does not disposition N1 as fixed; it remains a recorded residual for the conductor's owning work.

## Actual commands and verification limits

Read-only commands run for this pass were `git rev-parse HEAD`, `git status --short`, both full scoped `git diff` comparisons, `git diff --stat`, `git diff --name-only`, `git log`, source/contract searches and reads using `rg`, `sed`, `cat` and `nl`, and `git diff --check` against both bases. Both diff-checks passed. A small Python read-only inspection compared preserved review-report text with the note. One attempted shell search used a nonexistent wildcard path; I corrected it to the actual `auth/local-factor-service.ts` and read the function. No product edit was made.

No tests, TypeScript check, PostgreSQL connection, Docker operation, verifier/rollback/race probe, browser, image build/boot, analyzer, broad suite, GitHub mutation, commit, push or merge was performed by this reviewer. Current source validation remains with the conductor. The previously inspected five-file/177-test PostgreSQL pass belongs to 1198 only; it is not an f220 result and is not used as runtime coverage for this new source.

Relevant inspected test sources include the prior direct pending-action issuance/session-denial and SCIM lifecycle approval cases, the operation-only five-challenge limit test, local-factor concurrency and clock-wrapper sources, and the current pending-action-service test's scope. That service test does not itself invoke the changed proof service. These inspections do not establish pending-action limit races, the N1 schedule, exact-once verifier behavior at runtime, committed challenge expiry on failed proof, concurrent single-use consumption, or consumption rollback with a later protected-mutation failure. No such result is claimed.

There are no new blocking findings. The unchanged N1 availability risk, unconverted preflight seam and absence of direct focused race/failure-injection evidence remain visible limitations. Separate required current-head CI, appropriate tests, image/health evidence and acceptance are not waived by this source review.


## Current exact source binding

This publication appends only its own regular100644 review note after the current independently reviewed source. Every report retains its own coverage and limitations; no old check is reused.

**Reviewed head:** `f220a9d659394e4a9dad2e856b24b80f867cb141`


## Accepted #812 composition — current source confirmation

**Reviewed head:** `aea9e4edb303091a2a9945e442c9e6a6ac04ab5d`

The conductor normally composed accepted main `b78fd6853a890c6e2b10d17be18885e3b1612b2d` with the prior publication. All 3,397 mode/type/blob entries match that main plus the exact three prior overlay paths; the two auth source blobs remain identical to the full-semantic-reviewed `f220a9d659394e4a9dad2e856b24b80f867cb141`. Twenty incoming approval/work-item paths are disjoint. Fresh independent Luna and GPT-6.1 Sol composition reviews below preserve their bounded scope; prior full auth semantics retain their actual review bindings. The original Luna composition artifact remains unchanged privately; its reviewer-authored publication derivative records its exact hash and removal of ten trailing ASCII spaces across five lines, with all wording preserved.

Prior actual API typecheck and 7 PostgreSQL files / 218 tests belong to f220, not this composition's hosted acceptance. New exact-publication full CI and shipping-image build/boot/health are still required. N1's inherited lock-order availability residual and the builder-returning preflight remain unresolved; no whole #580 or PA-15 compliance is claimed. No gate is waived.

### Authentic report: pending-action-aea9-accepted812-ordinary-publication-luna.md

# Independent ordinary review — accepted #812 composition with pending-action proof ownership

**Reviewed head:** aea9e4edb303091a2a9945e442c9e6a6ac04ab5d
**Comparison:** two-parent merge; first parent f44e8633b11cbda9ede8dd8538c8b58effb726d7, accepted-main second parent b78fd6853a890c6e2b10d17be18885e3b1612b2d
**Reviewer:** GPT-6 Luna, fresh independent ordinary-review context; did not author, direct, or remediate this candidate
**Scope:** Accepted-main merge composition, exact path/tree ownership, imported identity target and approval integration-test boundary. This is not a renewed semantic review of the pending-action auth changes or approval feature.

## Verdict

**CLEAR — no blocking composition or interop finding.** The candidate is exactly accepted #812 main with the three paths from the previously reviewed pending-action publication overlaid. The two branches changed disjoint paths from their common base. The approval changes use the canonical permissions identity resolver, and the approval/work-item test targets do not exercise the changed pending-action repository or step-up service.

## Composition evidence

- Verified HEAD exactly matches the reviewed SHA, is clean, and has the stated two parents. The second parent is b78fd6853a890c6e2b10d17be18885e3b1612b2d, whose commit metadata identifies it as the merge commit for PR #812 from `codex/query789-current-main-luna`. The composition proof JSON independently records these exact parents and source/accepted-main SHAs. I did not query GitHub in this review.
- Compared recursive Git tree entries (mode, type, blob) for first parent, accepted-main parent and candidate. Reconstructing the candidate as accepted main plus the three first-parent blobs at `apps/api/src/auth/repository.ts`, `apps/api/src/auth/step-up-service.ts`, and `docs/07-planning/security-reviews/query-ownership-pending-action-challenge-580.md` exactly reproduces the candidate tree. No additional candidate-only or missing path was present.
- Independently compared changed path sets from common base e848f3bd05bec95c8af657c29923a6413a11c63f to each parent: first parent changed exactly those three paths; accepted main changed the 20 approval/work-item source, test, helper and review-note paths recorded in the composition proof. The intersection was empty. No overlapping-path resolution was needed.
- The merge commit author and committer are both TaskDesk GPT conductor. This corroborates conductor composition identity in local commit metadata.

## Import and test boundary

- `apps/api/src/approval/repository.ts` accepts `ResolvedIdentity` from `@taskdesk/permissions` and imports `resolveRequestIdentity` from `../permissions/resolve-request-identity`; that helper delegates to `resolveIdentity`. The approval code does not import `apps/api/src/auth/repository.ts` or `apps/api/src/auth/step-up-service.ts`.
- The accepted incoming test paths target approval repository/scope/feature-flag/lifecycle behavior and work-item reach/transition behavior. The approval lifecycle test imports the top-level `auth` module to call `auth.api.getSession` for session-restoration coverage; this is test setup/verification of an authenticated session, not a changed auth persistence path. No incoming test path imports or directly exercises the pending-action repository or step-up service.
- The overlay does not change the 20 incoming approval paths; this assessment is import/test boundary inspection, not approval-feature correctness approval.

## Prior review evidence and residuals

I read the supplied composition proof, the prior f220 full GPT-6.1 Sol report and the two independent f220 ordinary reports. Those reports record CLEAR for their stated source deltas. They remain bound to f220a9d659394e4a9dad2e856b24b80f867cb141; this composition review does not extend their semantic coverage to new code.

The inherited N1 creation/issuance lock-order inversion remains explicitly unresolved and not runtime reproduced. The preflight `getPendingActionForStepUp` seam remains outside the prior lifecycle extraction. The prior security review and ordinary reports do not establish runtime deadlock/rollback behavior, full PA-15 compliance, or the pending-action feature as a whole. Current API TypeScript and selected PostgreSQL evidence described in the prior notes are f220 evidence, not executed against this new merge head. Hosted CI, image/build/runtime/browser acceptance and exact-head checks are outside this review.

## Commands and files inspected

Read-only commands: `git status --short --branch`, `git rev-parse HEAD`, `git show -s --format=...` for HEAD and its second parent, `git diff-tree --raw -r HEAD`, `git diff-tree --name-status -r HEAD`, `git diff --name-status/--numstat` against each parent, `git diff --check f44e8633b11cbda9ede8dd8538c8b58effb726d7 HEAD`, and a Python comparison of recursive `git ls-tree` mode/type/blob entries. Used `rg` to inspect auth/identity imports and pending-action references in the incoming source/test paths. Read the approval repository, request identity helper, approval source, representative repository/lifecycle/feature-flag/work-item tests, active mission and required repository workflow guidance. Read the supplied JSON proof and prior f220 author/ordinary/security reports.

No tests, native API typecheck, analyzer, PostgreSQL, Docker, build, browser, hosted CI, GitHub mutation, or source change was performed.

**Blocking findings:** none.
**Non-blocking findings:** none new for this bounded composition review.
**Verdict:** CLEAR for accepted-main composition and the stated import/test boundary only.


---

## Publication provenance

Formatting-only derivative of original report: /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/pending-action-aea9-accepted812-ordinary-luna.md
Original bytes: 5642
Original SHA-256: 2c011f209cde702fb9147abc81db3c8084fb0ce8eb78891d60a1137543874541
Transform: remove ASCII spaces at line ends only; removed 10 trailing spaces across 5 lines. No wording or semantic content changed.
Reviewer context, scope, source SHA and verdict are unchanged from the original.


### Authentic report: pending-action-aea9-accepted812-security-61-sol.md

# Independent security confirmation — accepted #812 composition

**Model:** GPT-6.1 Sol
**Role:** Independent security reviewer, bounded accepted-main composition confirmation
**Context:** `/root/pending_action_aea9_accepted812_security_sol`
**Reviewed head:** aea9e4edb303091a2a9945e442c9e6a6ac04ab5d
**First parent / prior publication:** f44e8633b11cbda9ede8dd8538c8b58effb726d7
**Second parent / accepted main:** b78fd6853a890c6e2b10d17be18885e3b1612b2d
**Prior full semantic security source:** f220a9d659394e4a9dad2e856b24b80f867cb141
**Common lineage base:** e848f3bd05bec95c8af657c29923a6413a11c63f
**Invocation provenance:** The conductor supplied requested model `gpt-6.1-sol`, reasoning `high`, and `fork_turns=none`. A served-model/backend fingerprint is unavailable to this context; these are supplied requested invocation parameters, not independent backend attestation.
**Independence:** Fresh context for this composition review. I did not author, direct or remediate the candidate or the earlier pending-action implementation. No inherited author conversation was provided. Prior reports were inputs to inspect, not substitutes for my source and tree checks.

## Verdict

**CLEAR — no blocking security composition or interoperability finding.** The candidate exactly composes accepted #812 with the three intended pending-action overlay paths. Its two auth source blobs are identical to the prior full-security-reviewed f220 source. The imported approval code uses the canonical permissions identity resolver and has no new pending-action proof dependency. This is a current-head composition confirmation with connected auth inspection, not a renewed full semantic audit of every imported approval change or a new full pending-action audit.

## Source and composition evidence

I verified clean HEAD and both exact parents. Live read-only GitHub inspection of PR #812 reports `MERGED`, merge commit b78fd6853a890c6e2b10d17be18885e3b1612b2d, publication head 004492a8b0e901fe3d0644d07ae520045db251f5, and merge time 2026-10-17T04:57:22Z. Local `origin/main` resolves to that accepted merge. I read the supplied `pending-action-accepted812-composition-proof.json` and independently reconstructed the recursive candidate tree using Git mode/type/blob entries. All 3,397 entries exactly match accepted main with these first-parent paths overlaid:

- `apps/api/src/auth/repository.ts`
- `apps/api/src/auth/step-up-service.ts`
- `docs/07-planning/security-reviews/query-ownership-pending-action-challenge-580.md`

The two source entries are mode 100644 and have blobs `add1853315ee1c7db12ae09d0c8e2ffb4055bf23` and `b5cc951f66708889d02db1d14f61e12c6b0a7af7`, respectively, at f220, the first parent and the candidate. The note exactly preserves the first-parent blob `41c620dea0a8fa5e33a51caabe67fdb23789a3d7`; unlike the auth files, it legitimately differs from f220 because of later report publication. I checked the intervening f220-to-f44 raw commit history: its only change is that own note. The complete prior f220 full security report is present verbatim in the current note; its private artifact SHA-256 is `6ef515e04d8b7197ee7a20b84e3603b1ab29c1b14f7fe67868f3606c31484bf8`.

The first-parent and accepted-main changed path sets relative to e848 are disjoint. The accepted incoming set is exactly the 20 approval/work-item source, test/helper and approval-note paths in the supplied proof, and every one retains the accepted-main entry. No conflicting-path resolution, additional candidate-only path, missing entry or mode/type change was found. Diff-checks against both parents passed.

## Connected security boundary checked

I read the current pending-action creation, issuance and consumption repository implementations and their service wrappers, and checked the real issuance callback and consumption caller. Creation still receives the service transaction. Issuance still receives its service transaction, locks the active agent session and requester-owned pending action, checks the exact challenge binding and nonce digest, awaits authentication, and conditionally issues a hash-only token. Consumption still receives the caller's transaction and matches digest/person/session/action before its conditional issued-to-consumed update. The user-deactivation approval invokes it on the same `tx` used for the protected lifecycle mutation and pending-action execution. No imported approval code changes that executor or adds an inner commit. These are source observations; no rollback or race outcome was executed.

I checked actual identity imports rather than inferring identity authority from a module name. Approval repository identity types come from `@taskdesk/permissions`; `resolveApprovalIdentityIfActive` calls `../permissions/resolve-request-identity`, which delegates to `./resolve-identity`. The latter is the canonical current-facts loader and mapper, including inactive-person and banned-user rejection and credential distinctions. It does not use the overlaid auth repository as its identity resolver. The permissions implementation, pending-action implementation, step-up API, database/schema and governing instruction files have no changes from f220 to this head.

I inspected imports and relevant transaction boundaries in the incoming approval/work-item sources and representative repository, lifecycle and single-use test sources. No incoming TypeScript path references the changed pending-action repository/service, pending-action identifiers or step-up confirmation table. The approval lifecycle test's top-level `auth` import calls `auth.api.getSession` to verify restored session setup; it does not directly exercise the changed pending-action persistence family. Several tests load the full application, so this is not a claim that auth modules are absent from the loaded graph. The composition preserves their current dependencies without a detected new cross-boundary interaction.

I read the fresh ordinary composition report `pending-action-aea9-accepted812-ordinary-luna.md` (CLEAR for its bounded scope), the prior full f220 security artifact, the preserved 1198 full security report and both f220 ordinary reports in the own note. I also read the repository instructions, active mission, workflow, provider adapter, current status opening/blocked state, newest decision entries, queue context, CI security-scope rules and canonical PA-15 contract. One initially guessed feature-document path did not exist; I located and read `docs/01-architecture/pending-actions.md` instead.

## Findings and limits

**Blocking findings:** none for this bounded composition confirmation.

**New non-blocking findings:** none.

**Inherited N1 remains unresolved:** creation takes action-row then session/action advisory lock; issuance takes advisory then session-row then action-row lock. Their opposite action/advisory order can form a wait cycle for concurrent requests on the same session/action and PostgreSQL may abort a transaction. Both exact auth blobs are unchanged. This remains the prior non-blocking availability residual for the statement-preserving extraction, not a reproduced runtime result, remediation or claim of unauthorized issuance. The builder-returning preflight `getPendingActionForStepUp` remains outside the lifecycle extraction.

No tests, native/API TypeScript or compiler check, analyzer, PostgreSQL access, verifier/rollback/concurrency probe, Docker operation, image build/boot, browser, CI execution, GitHub mutation, source edit, commit, push or merge was performed. Commands were read-only Git/GitHub inspection, source/document searches and reads, plus a Python tree/blob/text comparison. The only file I created is this report outside the repository, with exclusive creation and mode 0600.

Prior 1198/f220 test results retain their original source bindings; I did not rerun or independently audit those runtime receipts in this composition pass. Accepted #812's runtime and hosted evidence was not re-executed or independently revalidated here. No full current-head hosted, image/health or runtime pass is supplied by this report. Required exact-head checks and appropriate integration/runtime acceptance remain separate gates. The prior full semantic security review remains explicitly bound to its f220 source scope; this confirmation covers only composition at aea9 and the connected boundaries stated above. It establishes neither whole #580 completion, whole pending-action/PA-15 compliance, concurrency correctness, stage closure nor merge readiness.
