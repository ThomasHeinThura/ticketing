# PR #774 security review record: a failed submission accept releases the claim (#743)

PR #774 closes #743 under Thomas's 2026-10-15 decision. The accept route takes the claim inside the conversion transaction, so a failed accept (a missing or unreachable destination) rolls the claim back and leaves no audit or outbox row. IQ-5a and IQ-16a are updated, and the decision-log entry that supersedes the 2026-10-14 consequence is PR #780.

A Claude Sonnet 5.5 lane implemented the change; the conductor (Claude Opus 5.5) edited the IQ text after review. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review B by Claude Sonnet 5.5: REQUEST CHANGES at `1e2380b4` (IQ-5a, IQ-16a, decision-log supersession); APPROVE at `13f41514` once fixed, with the supersession in #780.
- Ordinary review C by Claude Sonnet 5.5: APPROVE at `1e2380b4` (rollback on every path, 4 mutations) and at the docs delta `13f41514`.
- Security review by Claude Opus 5.5: CLEAR at `13f41514` (nothing left behind on failure; identical 422 for missing and unreachable; races serialized on the submission row lock; audit lock taken last; 3 mutations caught).

**Reviewed head:** `13f4151408bda2e83bd5aafb622ab940f463d499`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `774-ordinary-b-sonnet.md` | Ordinary review B (main..13f41514) | Claude Sonnet 5.5 | `13f41514` | APPROVE | `14cd816338eafdce85af8e9c81b8cb76aa34aca5c8f0b9bc596facac2d2a5523` |
| 2 | `774-ordinary-c-sonnet.md` | Ordinary review C (main..13f41514) | Claude Sonnet 5.5 | `13f41514` | APPROVE | `a52a914bc9897ba513188948dabd7116228ee8af0eb5483e93a49c6c35eb24a2` |
| 3 | `774-security-opus.md` | Security review (main..13f41514) | Claude Opus 5.5 | `13f41514` | CLEAR | `130ce25488ade222111216707aca2e5cf144492d58c9487a0f17085167d01483` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/774-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 14cd816338eafdce85af8e9c81b8cb76aa34aca5c8f0b9bc596facac2d2a5523) -->
# Ordinary review B, PR #774 (#743: release a failed accept's claim): spec, contract, vocabulary

**Reviewed head:** 1e2380b431e5791e2a330bbe5bc23c5bafbba509
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** main c35666c531c4b84c300bac5432fd4dc8dca3ed4f (merge base)
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only. Reviewer C's reports were not read.

## Commands and counts
- `gh pr view 774 --json headRefOid` = head above. Diff: intake/repository.ts (+/-), intake-queue.md (+4/-2), intake-triage-negative.test.ts, project-reach-writes.test.ts (+3).
- `CI=true vitest run --config vitest.integration.config.ts ../../tests/api-integration/intake-triage-negative.test.ts ../../tests/api-integration/project-reach-writes.test.ts`: 2 files, **32 tests passed**, 0 failed (targeted only, per instruction).
- Read the owner decision on #743 (issue comment): "release on failed accept. Validate the destination before the claim is committed, or roll the claim back in the same transaction ... No new route, policy or timeout ... will be recorded in the decision log."

## Fit with the owner decision
- The accept claim is now taken inside the conversion transaction (`claimSubmissionInTransaction`), so any failure after it (missing or unreachable destination, stale configuration) rolls the claim back. This is the second option the owner allowed. No new route, policy, timeout or release action. The claim audit row is deferred through a thunk (`beforeAcceptedAudit`) and appended just before `submission.accepted`, which keeps the audit-chain advisory lock from being held while waiting on the project lock (stated rationale; sound).
- The standalone `POST /claim` keeps its behaviour (claim and audit commit together) via the same helper, so IQ-16a's other two triggers are unchanged. An earlier explicit claim by the same actor remains in place if a later accept fails (the rollback only covers this transaction), and a claim by another triager still gives 409; both correct.
- Client-visible behaviour: status codes unchanged. Check order inside the transaction is the same as before (404 missing, 409 not open, 409 claimed by another, then snapshot and conversion validation, 422 for a missing or unreachable destination, 409 "changed before it could be accepted"). Response body for success unchanged. The visible difference is only the intended one: after a failed accept the submission stays unclaimed, so another triager can accept and the customer can still withdraw.
- Tests prove it non-vacuously: missing destination leaves `claimedBy`/`claimedAt` null, state `new`, no new audit or outbox rows, and a second triager then accepts with 200; the unreachable-destination case is asserted in project-reach-writes for both a missing and an out-of-reach project; a successful accept still records the claim, the `submission.claimed` and `submission.accepted` audit rows and exactly one outbox event; the withdrawal-after-accept test was correctly changed from "failed attempt" to "successful accept".
- Vocabulary: `submission.claimed` is an existing audit-only action (audit-trail.md line 234: "Audit-only; no outbox event"); no new action or event key; events.md unaffected. On a successful accept the claimed audit row now sits immediately before the accepted row instead of in an earlier committed transaction; both still exist, same payload.

## Findings
**Blocking**
1. Stale spec text left in the same file the PR edits. `intake-queue.md` line 85 (IQ-5a) still says an unreachable destination answers "the same 422 as a missing destination, **after the claim** as for any failed destination check". After this PR a failed destination check happens before any claim survives. Reword (for example "and the claim is released, IQ-16a").
2. Decision log. The 2026-10-14 entry "Submission accept answers an unreachable destination exactly like a missing one" states "after the claim has committed", "the claim is committed before destination validation on purpose" and, under Consequences, "A failed accept leaves the submission claimed by the caller. Stuck claims are tracked in #743." Those sentences are now false. The log is append-only, so the owner decision on #743 needs its own entry (the issue says it "will be recorded in the decision log") that names it supersedes that consequence and the reversal path (re-commit the claim before validation). The PR does not touch the decision log; this is a control-plane file owned by the orchestrator, so I flag it as required before merge rather than a code defect.

**Non-blocking**
3. IQ-16a's first sentence still says withdrawal is refused "the moment a triager takes any action ... starting acceptance". Now only a committed accept refuses withdrawal. The edited sentence further down is correct; align the earlier wording ("a successful acceptance").
4. The edited IQ-16a sentence is placed on one overlong line; cosmetic.
5. The claim now takes the submission row lock for the whole conversion transaction (previously a short separate claim transaction). This is the same `FOR UPDATE` the accept already took, so contention is unchanged in kind; a note in the PR on lock duration would help.

## Residual risk
Concurrency with a customer withdrawal and with two simultaneous accepts is argued from the row lock and the existing tests, not from a new race test. Full integration suite not run.

**Verdict:** REQUEST CHANGES

---
## Delta review (1e2380b4 to 13f41514)

**Reviewed head:** 13f4151408bda2e83bd5aafb622ab940f463d499
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Live head confirmed by `gh pr view`; parent is 1e2380b4, my reviewed head. The delta is one file, `docs/03-features/intake-queue.md` (+4/-4); no code or test change, so the behaviour I verified (32 tests) is unchanged.
- Finding 1 (IQ-5a "after the claim") fixed: now "so no existence signal, and the failed accept leaves no claim (IQ-16a)". Finding 3 (IQ-16a first sentence) fixed: "a successful acceptance" with "(a failed acceptance leaves no claim)". Grep for `starting acceptance` and `after the claim` in docs/03-features and docs/01-architecture: none remain. One benign leftover at intake-queue.md line 244 ("an accept attempt racing a withdrawal each resolve to exactly one winner") is still accurate as an edge-case description.
- Finding 2 (decision log) is addressed by PR #780, whose entry "Owner decisions on acceptance risks..." states under **Supersedes** that the 2026-10-14 consequence "A failed accept leaves the submission claimed by the caller" is replaced. **Ordering condition: #774 must merge with or after #780**, otherwise main would carry code and spec saying "no claim left" while the decision log still says the opposite. The branch merges cleanly with current main (merge-tree clean).

**Verdict:** APPROVE
<!-- END REPORT (sha256 14cd816338eafdce85af8e9c81b8cb76aa34aca5c8f0b9bc596facac2d2a5523) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/774-ordinary-c-sonnet.md; Claude Sonnet 5.5; sha256 a52a914bc9897ba513188948dabd7116228ee8af0eb5483e93a49c6c35eb24a2) -->
# PR #774 ordinary review C (#743: release the intake claim when accept fails)

**Reviewed head:** 1e2380b431e5791e2a330bbe5bc23c5bafbba509
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 774`; base c35666c5. Diff: `apps/api/src/intake/repository.ts` (+/-), `docs/03-features/intake-queue.md`, `tests/api-integration/intake-triage-negative.test.ts`, `tests/api-integration/project-reach-writes.test.ts`. Author notes read from 743-impl-sonnet.md. Targeted runs only (load control). Scratch worktree, removed afterwards.

## Commands

| Check | Result |
| --- | --- |
| install frozen, `pnpm turbo typecheck` | exit 0 |
| `CI=true` integration: 8 `intake-*` files + `project-reach-writes` + `project-organisation-binding` | exit 0, 10 files, 75 tests passed |
| `pnpm test:permissions` | exit 0, 16 files, 107 tests passed |
| Mutations (4) on the accept transaction | all 4 killed (below) |

## Line-level findings

- Structure: `claimSubmissionInTransaction(tx, ...)` is the old claim body verbatim (same row lock `FOR UPDATE of submission`, same state, already-claimed-by-other 409, idempotent re-claim by the same actor, version-conditional update, same 409 on a lost update, same audit payload). `claimSubmission` (the explicit route) now calls it and appends the audit immediately, so its behaviour is unchanged. `acceptSubmission` calls it as the first statement of the single conversion transaction instead of committing a claim beforehand.
- Rollback on every failure path: all failures inside `convertSubmissionInTransaction` are thrown `HTTPException`s (no catch, no early `return` of an error value): missing project id (422), missing/foreign/archived/deleted project (422), unreachable project (the `canReachProject` callback, same 422 text as missing, so the 404/422 behaviour is identical), snapshot or form version missing (409), type unavailable (422), no default state (422), bad title (422), unsupported priority (422), workspace unavailable (409), SLA policy unavailable (422), failed insert (500), and the lost-update 409. Any throw rolls back the whole transaction, including the claim update and the deferred claim audit. Verified by reading each branch (lines ~846-1123) rather than by individual tests for each (see N1).
- Audit ordering: the claim audit row is a thunk (`appendAudit`) invoked by `beforeAcceptedAudit()` after the optimistic-update 409 check and immediately before the `submission.accepted` audit append, so the chain order is claimed then accepted and nothing is written for a failed accept. The thunk is a no-op when the actor had already claimed (as the old code wrote no second audit row). Default parameter `async () => {}` keeps the other caller of `convertSubmissionInTransaction` (line ~793) unchanged.
- Advisory-lock reasoning: `appendAuditLog` takes the audit-chain advisory lock. Work-item creation takes the project number lock first and the audit lock afterwards, so the global order is project lock then audit lock. Appending the claim audit before conversion would hold the audit lock while waiting for the project lock and could deadlock with a concurrent work-item creation (the author saw it break the queue test). Deferring the append until after `claimWorkItemNumber` keeps the same order. I agree with the reasoning; the submission row lock is taken first in both the old and new accept path, so no new inversion.
- Outbox and after-commit: unchanged (`enqueueOutboxEvent` still inside the same transaction after the accepted audit; no new side effects); a failed accept still writes no audit or outbox row (asserted by the new test).
- 404/identical responses: `parseSubmissionReference` 404, row-not-found 404 and the 422 text for unreachable vs missing project are unchanged; `project-reach-writes` now also asserts that both the missing-project and unreachable-project attempts leave `claimedBy` null, identically.
- Concurrency: two triagers: the second accept blocks on the submission row lock; if the first commits it sees a closed state (409, existing test "two different triagers accepting concurrently ... the loser gets 409" still passes); if the first fails and rolls back, the second now proceeds instead of being locked out by a leftover claim (new test "another triager can accept"). Withdraw vs accept: both take the submission row lock, so they serialise: accept first makes withdraw refuse (claimed/accepted), withdraw first makes accept see a non-open state (409). No lost-update window.
- IQ rules and the changed assertion: docs change drops the word "attempt" from the IQ-16a trigger list and states the accept claim is rolled back on failure (owner decision #743), consistent with the new tests. The edited "withdrawal refused after a failed accept attempt" assertion now performs a successful accept, so it is faithful to the new rule, but it is weaker: after a successful accept the withdrawal is refused because the submission is no longer open, not because of `claimed_by`, so that third reference no longer proves a claim blocks withdrawal (the explicit-claim and staff-message references still do). The dropped behaviour (failed accept blocks withdrawal) is intentionally gone but no test pins its replacement, "withdrawal is allowed after a failed accept" (N2).

## Mutations (all killed)

Re-add the pre-transaction `claimSubmission` (2 tests fail: the new missing-destination test and the project-reach unreachable test); remove `beforeAcceptedAudit()` (2 fail incl. the atomic-conversion race test and the audit-rows test); stop setting `claimedBy` in the claim update (4 fail); pass a no-op audit thunk (2 fail).

## Findings

Blocking: none.

Non-blocking:
- N1. Rollback is tested for the missing-destination and unreachable-destination paths only; the type, assignee/default-state, title, priority and SLA validation failures are covered by structure (all throw inside the transaction) but not by a per-path claim-null assertion. A table-driven test over those 422s would pin it.
- N2. No test asserts the new consequence that a customer may withdraw after a failed accept (see above); consider adding it, since it is the observable change owners will rely on.
- N3. The `intake-queue.md` edit leaves a long line (the sentence continues into the withdraw sentence); cosmetic.

## Residual risk

Lock-order reasoning was verified by reading, not by a two-connection deadlock test; the full integration suite was not run (load control). Security-scope path list not evaluated here.

**Verdict:** APPROVE

---

## Delta review: 1e2380b4 to 13f41514

**Reviewed head:** 13f4151408bda2e83bd5aafb622ab940f463d499
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 774`; single commit, parent 1e2380b4. `git diff --stat`: one file, `docs/03-features/intake-queue.md`, +4/-4; no code or test file touched, so my earlier command results (typecheck, 75 integration tests, 107 permissions tests, 4 killed mutations) still apply unchanged.

Accuracy of the wording against the code I reviewed:
- IQ-5a: "the same 422 as a missing destination ... and the failed accept leaves no claim (IQ-16a)" replaces "after the claim as for any failed destination check". Correct: the unreachable-project check throws inside the accept transaction (same 422 text as a missing project), which rolls the claim back; `project-reach-writes` now asserts `claimedBy` is null for both cases. The link 404 sentence is unchanged.
- IQ-16a: trigger list now "a queue claim, a message, or a successful acceptance", with "a failed acceptance leaves no claim". Correct for the new transaction; the old "starting acceptance" wording would have contradicted the behaviour. Consistent with the earlier edit in the same section (accept claim taken in the conversion transaction, owner decision #743).
- No contradiction remains with the rest of the section that I could find (the enforcement paragraph still keys on `claimed_by`).

Non-blocking: the IQ-16a line is now long (cosmetic, as in N3 of the main review).

**Verdict:** APPROVE
<!-- END REPORT (sha256 a52a914bc9897ba513188948dabd7116228ee8af0eb5483e93a49c6c35eb24a2) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/774-security-opus.md; Claude Opus 5.5; sha256 130ce25488ade222111216707aca2e5cf144492d58c9487a0f17085167d01483) -->
# #774 security review (#743: a failed accept releases the claim)

**Reviewed head:** 13f4151408bda2e83bd5aafb622ab940f463d499
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge base c35666c531c4b84c300bac5432fd4dc8dca3ed4f (origin/main at review time 9297362b5f2dd1f17da935c8051c1562b473638a)
**Role:** sampled security reviewer; did not author, direct or remediate this change. Read-only; no push, comment, approval or merge.

## Surfaces examined
- `apps/api/src/intake/repository.ts`: `acceptSubmission`, new `claimSubmissionInTransaction`, `claimSubmission`, `convertSubmissionInTransaction` (new `beforeAcceptedAudit` hook), and for races `withdrawSubmission`, `postSubmissionMessage`, `findPortalSubmission`.
- `apps/api/src/intake/index.ts` accept/claim routes (reach callback from #741 unchanged).
- `docs/03-features/intake-queue.md` IQ-5a / IQ-16a wording.
- Tests: `tests/api-integration/intake-triage-negative.test.ts`, `tests/api-integration/project-reach-writes.test.ts`.

## Analysis
- **Atomicity.** The claim (row update + version bump) now runs in the same transaction as conversion. Every failure after it (missing/unreachable/foreign project, missing type/state/version/SLA policy, bad title or priority, version CAS miss) throws inside the transaction, so the claim, its audit row, the work item, activity, events, comments, attachment/participant moves and the outbox row all roll back together. No path found that commits a claim or partial work.
- **No existence oracle.** Missing and unreachable destinations still return the same 422 and message, and now both leave the submission unchanged. Before, a failed accept left a claim that the customer could observe (withdraw refused, `canWithdraw` false); that side effect is gone. `project-reach-writes` asserts `claimedBy` null for both cases.
- **Races.** All writers (accept, claim, message, withdraw, decline, duplicate) take `FOR UPDATE` on the submission row first. Two triagers: the second waits, then gets 409 "claimed by another triager". Accept vs withdraw: whichever commits first wins; withdraw is conditional on `claimed_by IS NULL`, accept re-reads the locked row and refuses a non-open state. Claim/message vs accept: serialized on the same row lock; the claim's version bump is carried into the accept CAS correctly.
- **Lock order.** submission row -> project row (`NO KEY UPDATE`) -> number counter -> audit-chain advisory lock last. The claim audit row is deferred via `appendAudit` so the advisory lock is never held while waiting on the project lock. Audit chain order is `submission.claimed` then `submission.accepted`.
- **Withdraw after a failed accept.** Allowed now; it is the requester's own right under IQ-16a and returns the submission to its pre-attempt state. No abuse path found.

## Commands (scratch detached worktree under $TMPDIR/opus-774, removed afterwards)
- `pnpm install --frozen-lockfile --prefer-offline`: exit 0
- `pnpm turbo typecheck`: exit 0, 9/9 tasks
- `CI=true vitest run --config vitest.integration.config.ts tests/api-integration/intake-* tests/api-integration/project-reach-writes.test.ts`: exit 0, 9 files, 56 tests passed
- Mutations (run against intake-triage-negative, project-reach-writes, intake-atomic-conversion; 3 files, 38 tests each run):
  - M1 claim committed in its own transaction before conversion: exit 1, 2 failed (unreachable-destination claim assertion; #743 missing-destination test). Killed.
  - M2 claim survives a failed accept (conversion in a savepoint, outer commit): exit 1, 2 failed (same two). Killed.
  - M3 claim audit appended right after the claim, before validation and the project lock: exit 1, 1 failed ("serializes three acceptances for one project before a queued archive"). Killed by the existing lock-order test.
  - A first M2 attempt that re-claimed in a second connection self-blocked on the row lock; it was a mutation-design artifact, stopped and redesigned. Source restored; worktree clean before removal.

## Findings
- None blocking.
- Non-blocking: the #743 success test checks that both audit actions exist but not their order in the chain. Order is correct by construction.

## Residual risk / not checked
- A small timing difference between a missing project and an existing unreachable one (the lock plus reach lookup) predates this PR (#741). It is staff-only, and the status, body and side effects are now identical.
- Claim and accept are not filtered by the triager's submission list reach. This predates the PR and was not changed by it.
- No full suites run (load control). No load or concurrency soak beyond the existing concurrent-accept tests.

**Verdict:** CLEAR
<!-- END REPORT (sha256 130ce25488ade222111216707aca2e5cf144492d58c9487a0f17085167d01483) -->
