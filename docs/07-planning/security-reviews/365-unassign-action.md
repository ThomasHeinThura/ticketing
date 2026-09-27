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
