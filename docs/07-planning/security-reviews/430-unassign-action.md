# Pre-merge security review — PR #365 (clear a work item's assignment, `DELETE /api/work-items/{key}/assign`)

**Reviewed head:** `a2ccc1d932b51c36334eb1cfbe2eab4693c19575`

**Base branch head (`feat/30-assign-action`, PR #353):** `e924f6e71ff0bca2352a66d59b3b78c9146e7606`

**Merge base with `main`:** `ecd88b048f1188ec10acb61e525a4a422ee014eb`

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5`), a fresh, review-only context. It wrote and directed none of the change. It worked in a private detached worktree against a private database, `pr365opus_test`, which was dropped afterwards. Mutation probes were reverted and not committed.

**Verdict: CLEAR.** No HIGH or MEDIUM findings. There are two LOW test-strength findings (L1, L2), both non-blocking, and one informational note (N1).

**Scope.** Only #365's own changes (`origin/feat/30-assign-action...a2ccc1d`, 14 files):
- `apps/api/src/work-item/controllers/unassign-work-item.ts`;
- the new route and handler in `apps/api/src/work-item/index.ts`;
- the `DELETE` policy entry in `work-item/policy.ts`;
- `unassignWorkItemResponseSchema`;
- `packages/permissions` (`OWNER_PREDICATES` gains `row.assignee_id === identity.personId`, `PolicyContext.row.assigneeId`, and the `ownerPredicateHolds` case);
- `rbac.md` and `assignment.md`;
- the `check-events` count, 27 to 28;
- `openapi.json`, the matrix fixture, and the tests.

#353's `assertCallerHasCapabilityOrSelf` and `WorkItemAssigneeConflictError` were read because this PR depends on them. The rest of #353 has its own review and was not re-reviewed here.

## 1. Authorization

- **The route param cannot reach another workspace.** `requireWorkItemReach()` finds the row by `work_item.key`, which is globally unique, and sets `workspaceId` from that row. Out of reach is answered 404; re-measured as exactly 404, matching the matrix's `outOfReach` for all 8 roles. The handler's own read and the controller's write are both limited to that server-set `workspaceId`.
- **The "clear my own assignment" branch.** The handler computes `callerPerson !== undefined && current.assigneeId !== null && callerPerson.id === current.assigneeId` from the loaded row, never from the body. `person_user_unique` means one person per `user_id`, so the fact is true only when the caller really is the current holder. `assertCallerHasCapabilityOrSelf` checks `work_item:assign` first. Only after that does it accept the branch, and only together with `work_item:update`. Membership must be unambiguous and the role row genuine (#318).
- **The evaluator.** `row.assignee_id === identity.personId` is false when the assignee is null, and the owner branch still requires its own capability. It is pinned by a new `evaluator.test.ts` case and by `work-item-unassign-policy.test.ts`.
- **Instance admin.** In reach: 403. There is no bypass, which matches the fixture.
- **Mutation M1.** Forcing the branch fact to `true` fails "a member with work_item:update clearing a COLLEAGUE's item is refused 403". The boundary is tested.

## 2. Concurrency

- The authority decision and the write are tied to the same observed value. The handler passes `current.assigneeId` to the controller. The controller returns 409 if its re-read shows a different holder, then writes `UPDATE … WHERE id = :id AND assignee_id = :previous`; zero rows updated is a 409 carrying the current holder.
- `version` is incremented in SQL.
- The 409 is only reachable after authorization has passed, by a caller who already has read reach.
- Clearing an already-unassigned item is a 200 no-op: no version bump, no activity row, no event. Authorization still runs first, so a caller with only `work_item:update` gets 403 on an unassigned item.
- **Mutation M2.** Removing the read-side pin fails the F1 test.

## 3. History and event

- The activity row (`updated` / `assigneeId`, old holder to null) is written in the same transaction as the update. `actorId` and `actorType` come from the session through `resolveActor`, never from the request.
- `work_item.unassigned` carries `previousAssigneeId`, the ids and the key, all from the loaded row, and the actor from the session. None of it can be forged by the client. It is published after commit, the same way `work_item.assigned` is. It matches `events.md` and is registered in `event-keys.ts`.
- The `audit_log` row is absent. That is the #344 / AU-10 dependency PR #353 also records: stated, not waived, and not a new gap.

## 4. Findings

- **L1 (LOW, test strength, non-blocking).** The UPDATE's `eq(assignee_id, previousAssigneeId)` condition is not covered by any test. Mutation M3 removed it and all 8 unassign tests stayed green: the "concurrent clears" test does not interleave in-process, and F1 exercises only the read-side pin. The code is correct. Recommendation: stub `db.query.workItemTable.findFirst` to return an out-of-date row naming A while the database holds B, call with `expectedAssigneeId = A`, and assert a 409 and that B is kept.
- **L2 (LOW, test strength, non-blocking).** The foreign-workspace case asserts `[403, 404]`. The live answer is 404, and the matrix and the anti-enumeration rule (#261 F2) require 404. Recommendation: tighten it to `toBe(404)`.
- **N1 (informational, existed before this PR).** The shadow middleware gives the evaluator no `row` facts, so the shadow decision for a holder clearing their own assignment will read as denied while the live decision allows it. #353's `orSelfTarget` body fact has the same gap. It does not enforce anything.

## 5. Evidence

- `pnpm test:permissions`: 13 files, 83/83 passed.
- `packages/permissions` vitest: 262/262 passed.
- `work-item-unassign.test.ts` + `work-item-assign.test.ts` on real Postgres 18: 24/24 passed.
- GitHub checks at this head: all green except the template/security-review gate, which is waiting on this note.

---

## Ordinary delta review (Sonnet 5)

**Reviewer:** Claude Sonnet 5, a fresh independent context. Worked in `/tmp/pr365-review` (isolated worktree, shared checkout untouched).
**Reviewed head:** `a2ccc1d932b51c36334eb1cfbe2eab4693c19575`
**Verdict: APPROVE (this delta only).**

- The delta since the last reviewed head (`543285c`) is exactly what it claims: `gh pr diff 365` shows only three commits — the original feature (`5ab81a3`), the F1 fix already reviewed (`543285c`), and this delta (`a2ccc1d`, a golden-count bump). The wider `git diff 543285c..a2ccc1d` (172 files) is #353's own scope arriving via two merge commits, not this PR's.
- The merge conflict resolution in `apps/api/src/work-item/index.ts` (merge commit `ec28615`) is a clean union: this PR's `isNull`/`HTTPException`/`workItemTable` imports and #353's `membershipTable`/`listAssignablePeople`/`listWorkItemTypes`/`isUnambiguousMembership` imports are each present once, nothing dropped or duplicated. The `unassignWorkItemRoute` definition and handler are byte-identical to the pre-merge version aside from line-number shifts.
- The `check-events.test.mjs` change is exactly a count bump, 27→28, for the newly-registered `work_item.unassigned` (AS-17) key — confirmed the key is genuinely registered in `event-keys.ts`, not just asserted.
- No other file in the PR's own diff changed beyond the merge and the test bump.
- Suites run fresh in this worktree: `pnpm turbo test:permissions --force` (13 files/83 tests), `pnpm turbo typecheck --force` (9/9), `pnpm turbo lint --force` (8/8), `pnpm --filter @taskdesk/api test:integration` against a private `pr365_review_test` database (92 files/1250 tests) — all pass, matching the claimed counts.
- `check-pr-template.mjs` on the PR body: the `## Gates` table is clean (bare `pass`/`n/a`, no waived gate). The three remaining reported problems (this review-note file not existing yet, the `audit_log` box, the Opus checkbox) are the two known, correctly-disclosed out-of-scope blockers, not new issues.

Outstanding at the time of this review (now resolved by the Opus review above, still open: the `audit_log` dependency on #344/PR #375).

---

## Delta review (Opus 5.5): the audit_log write

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context commissioned by the orchestrating session. It did not author, direct or remediate this change.
**Reviewed head:** `5c7dad6587821f8e6ef5b63df726aed4ef84fb4f`
**Range reviewed:** this PR's own commit `5c7dad6` (`unassign-work-item.ts` + `work-item-unassign.test.ts`), on top of `99d23c9` (merge of `feat/30-assign-action` at `cbd18fc`)
**Date:** 2026-09-27
**Verdict:** **CLEAR.** No blocking findings. Two LOW test gaps (L3, L4) and three non-blocking items carried over from #353 (A3, A4, A5).

### Is #353's A1 bug here? No.

The ordering in `unassign-work-item.ts`:

- `:83-90`: if the item is already unassigned, return (no transaction).
- `:95-97`: if `item.assigneeId !== expectedAssigneeId`, throw a 409. This check is unconditional.
- `:99`: `previousAssigneeId = item.assigneeId`. At this point it equals `expectedAssigneeId` and is non-null.
- `:115`: the UPDATE's WHERE clause uses that same variable.

So when the UPDATE matches, `before` is the value it overwrote. #353's A1 came from `before` using the pre-read while the WHERE clause used a separately supplied value. That split does not exist here.

### Probes

Run on real Postgres 18, in a private worktree against a private database (`pr365auditopus_test`). Both were removed afterwards.

| Probe | Result |
| --- | --- |
| P1: a rival holds `LOCK TABLE work_item IN SHARE MODE`, so the controller parks after its pre-read and check. The rival changes A to B and commits. | 409 carrying B. B keeps the item. No unassign audit row. |
| P2: the rival changes A to B to A (ABA) while the controller is parked. | 200. `before = A`, which is the value the UPDATE overwrote. |
| P3: as P1, but with a row lock (`FOR UPDATE`), so Postgres re-checks the WHERE clause. | 409. No audit row. |
| P4: the controller's pre-read is stubbed to return a stale holder B, while the database and the handler hold A. | 409 from the check. No audit row. |
| P5 / P6: one unassign, then 8 concurrent unassigns. | `verifyAuditChain` ok. Every `prev_hash` distinct. |

### Mutations (each restored afterwards; `git status` clean)

| Mutation | PR suite | Probes |
| --- | --- | --- |
| `projectId: null` | red | – |
| `entityId: key` | red | – |
| Drop the `appendAuditLog` call | red | – |
| Drop the check at `:95-97` | red (F1) | – |
| Drop `eq(assignee_id, previousAssigneeId)` from the UPDATE | **green** | red (P1, P3) |
| #353's A1 shape (no check, WHERE on `expectedAssigneeId`, `before` from the pre-read) | **green** | red (P4 records B when A was overwritten) |
| `actorId: "forged"` / `actorType: "system"` | **green** | – |

### Other checks

1. **Forgery:** none. `actorId` and `actorType` come from `resolveActor` (the session or API key). `workspaceId` comes from the reach check. `projectId` and `entityId` come from the loaded row. `after` is a literal `null`. The DELETE takes no body.
2. **Hash chain:** compatible. `projectId` is stored but not hashed, per #375's precedent.
3. **No-op case:** it writes zero audit rows, which the existing test asserts. A 409 also writes nothing, because the transaction rolls back.
4. **Advisory lock:** row locks are taken first and the audit lock last, the same as the assign route. Audit-read holds no row locks. There is no deadlock path and no double lock.
5. **`project_id` taken from the pre-read:** safe today, because no code changes `work_item.project_id`. A future work-item move must take it from `RETURNING` instead.

### Findings

- **L3 (LOW, test gap, non-blocking; extends L1 above).** No committed test catches the two regressions that matter here: dropping the UPDATE's assignee condition, or reintroducing #353's A1 shape. The code is correct today. Recommendation: commit P1 (the table-lock race) and P4 (the stale pre-read) as integration tests.
- **L4 (LOW, test gap; the same as #353's A2).** `actorId` and `actorType` are not asserted on the audit row.
- **Carried over from #353, non-blocking:** A3 (no `apiKeyId`, `actorIp`, `userAgent` or `traceId`), A4 (an audit-write failure rolls back the unassign, contrary to AU-14; one decision should cover both routes), and A5 (`.slice(-1)` without `orderBy(seq)`).

### Evidence

- `work-item-unassign.test.ts` + `work-item-assign.test.ts`: 24/24 passed.
- Full API integration suite: 93 files, 1260/1260 passed.
- `pnpm turbo typecheck`: 9/9 tasks passed.
- Probe file: 14/14 passed at this head (not committed).

### Base-branch dependency

The base branch `feat/30-assign-action` (#353) is still CHANGES NEEDED for its own A1. Merging #353's fix into #365 changes #365's head, which invalidates this clearance, so that merge needs a delta check.

---

## Re-recreation onto PR #430 (2026-09-27)

**Reviewed head:** `4ee59e11336cf98f46eb88d77a8ab56d09efc682` (branch
`feat/30-unassign-action-rebase`, PR #430)
**Reviewer:** orchestrating session (mechanical verification — byte-identical content, not
a fresh judgment call)

**Why this PR exists:** #365 never merged — it was stacked on #353's own branch and nobody
retargeted it once #353 merged, a stale-branch problem, not a design or review problem.
#353 has since merged, so `feat/30-assign-action`'s own "CHANGES NEEDED" dependency noted
above is resolved. A Sonnet lane recreated #365's exact diff (`gh pr diff 365 --patch`,
applied via `git am --3way` onto current `main`) rather than reimplementing from the spec.

**Verdict: CLEAR, unchanged — verified byte-identical, not re-reviewed.** Independently
diffed every substantive file this review covers
(`apps/api/src/work-item/controllers/unassign-work-item.ts`,
`apps/api/src/work-item/index.ts`, `policy.ts`, `response.ts`,
`packages/permissions/src/evaluator.ts`, `policy.ts`) between #365's own base/head
(`cbd18fc3ed1ea26f09254dc54b86565f2d7a0e1d`..`80bc5973c493a5ff065db8ae46ef5235523ad2d8`)
and PR #430's base/head (`main`'s current tip..`4ee59e1`) — every file's diff is
byte-for-byte identical, including `index.ts`, the one file that needed a manual
`git am` conflict resolution (an unrelated import-block interleaving from other work
merged to `main` since #365 was opened) — the FINAL diff against each PR's own respective
base is nonetheless identical, confirming the conflict resolution introduced no drift.

This is not a fresh review — it is a mechanical confirmation that PR #430 carries the exact
same, already-independently-reviewed and Opus-CLEAR content as #365, at the same quality
bar this project requires, with nothing new to evaluate. If any future push to this branch
introduces real content divergence, that would require a genuine fresh reviewer, not another
mechanical note.

---

## Re-confirmation after branch update (2026-09-27)

**Reviewed head:** `c6b0ab157c482ae9967ad2aec520c33be752eb7e`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty diff on every substantive file this review covers
between the last reviewed head (`4ee59e11336cf98f46eb88d77a8ab56d09efc682`) and this one —
the intervening commits are #418's and other already-reviewed merges, zero overlap with
this PR's own files.

---

## Re-confirmation after branch update (2026-09-27, second)

**Reviewed head:** `c3617a2a18d0e0c160f0ca4a7613b0dbc8ce4e9f`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. `git diff c6b0ab157c482ae9967ad2aec520c33be752eb7e..c3617a2a18d0e0c160f0ca4a7613b0dbc8ce4e9f`
scoped to every file this PR touches (`unassign-work-item.ts`, `work-item/index.ts`,
`policy.ts`, `response.ts`, `rbac.md`, `assignment.md`, `evaluator.ts`/`.test.ts`,
`policy.ts` (permissions), `check-events.test.mjs`, the OpenAPI contract fixture, the
unassign integration/policy tests, and the permission matrix fixture) is empty. The
intervening commits are #416's already-reviewed merge into `main` (`6403586`, confirmed an
ancestor of `origin/main`) plus its own chain of routine branch-update merges — already
fully Opus-reviewed and merged before this branch picked them up.

---

## Re-confirmation after branch update (2026-09-27, third)

**Reviewed head:** `7d3e6ae69080623f3545af9ce39876850c5f4c00`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. `git diff c3617a2a18d0e0c160f0ca4a7613b0dbc8ce4e9f..7d3e6ae69080623f3545af9ce39876850c5f4c00`
scoped to every file this PR touches is empty. The intervening commit is #429's own
already-reviewed docs-only merge into `main`, picked up via a routine branch update.

---

## Re-confirmation after branch update (2026-09-27, fourth)

**Reviewed head:** `6d26dd295b23a845b20b4b0544ab3ee233b98689`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. `git diff 7d3e6ae69080623f3545af9ce39876850c5f4c00..6d26dd295b23a845b20b4b0544ab3ee233b98689`
scoped to every file this PR touches is empty. The intervening commits are already-merged,
already-reviewed content from #423 (env-reads.mjs AST rewrite), #417 (test-contract.mjs
repoRoot fix), and #419 (check-deps vacuous-pass fix) landing via routine branch updates —
confirmed each is an ancestor of `origin/main`. No new, unreviewed logic reached this
branch.

**Process note:** this reconfirmation is written from a worktree explicitly re-synced via
`git reset --hard origin/<branch>` immediately before verification, after discovering a
prior round of "local verification" in this session had silently run against a stale,
unreset local checkout (fetched but not reset) — which produced a false "EXIT 0" that CI
then correctly caught as still-stale. `git fetch` alone updates remote-tracking refs, not
the working tree; every future reconfirmation in this session resets first.
