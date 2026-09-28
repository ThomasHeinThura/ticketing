# Security review -- PR #491 / issue #490: transition/assign/unassign deleted/archived guard

**Reviewer:** Claude Opus 5.5, fresh independent context (did not author, direct, or remediate this change)
**Session:** this subagent (spawned by the orchestrating session for this review only)
**Reviewed head:** `3aecd2deee370d8630b03643d66d0f3d9c3a9e09` (merge of `origin/main` through
#487 into `fix/490-transition-assign-deleted-guard`; fix commit `64db3ebf`)
**Scope:** `git diff origin/main...3aecd2de` (merge-base `78b99076`) touches exactly six files --
`transition-work-item.ts` (+17/-2), `assign-work-item.ts` (+7), `unassign-work-item.ts` (+8),
and `work-item-transition.test.ts` (+128), `work-item-assign.test.ts` (+122/-2),
`work-item-unassign.test.ts` (+118). The merge commit (`64db3ebf..3aecd2de`) brings in only
PR #487's `set-work-item-parent.ts`, its test, and its review file -- none of them this diff's
files.
**Date:** 2026-09-28
**Verdict:** **CLEAR WITH FINDINGS** (non-blocking; no finding needs a change to this PR)

## 1. The premise, confirmed against source

- `delete-work-item.ts:87-91`: `UPDATE work_item SET deleted_at = now WHERE id = ? AND
  deleted_at IS NULL`. It does not bump `version`, so optimistic concurrency can't see it. It is
  an ordinary row `UPDATE`, so it takes the `work_item` row lock and gets in line behind any
  `FOR UPDATE` / `UPDATE` already holding that lock.
- Nothing in `apps/api/src` writes `work_item.archived_at` today. The only `archivedAt` writer
  is `archive-project.ts`, which archives projects. The `archivedAt` half of the fix, and its
  two tests, protect against a future archive route. Adding it now is right: it matches
  `require-work-item-reach.ts`, which already treats the two columns the same way.
- `require-work-item-reach.ts:104-123` is a plain, unlocked `SELECT` that runs before any
  controller transaction.
- `archivedAt` and `deletedAt` are nullable timestamp columns, so `isNull(...)` / `!== null`
  can only reject a row where one of them is actually set. A live row can't be wrongly
  rejected.

## 2. transition-work-item.ts -- closes the race

Order of statements inside `db.transaction`:

1. `SELECT state_id, assignee_id, deleted_at, archived_at FROM work_item WHERE id = ? FOR UPDATE` (316-325)
2. **`if (!locked || stateId !== fromStateId || deletedAt !== null || archivedAt !== null) throw TransitionConflictError`** (333-340). This is the fix.
3. Children `FOR SHARE`, then guard evaluation, `offerTransition`, and the B2 eligibility check.
   These are reads only.
4. `UPDATE ... WHERE id = ? AND state_id = ? AND deleted_at IS NULL AND archived_at IS NULL`
   (442-460). The last two conditions are the fix's second guard.
5. Scheduled-transition inserts, activity, audit, and comment. After commit, events.

**Interleavings under READ COMMITTED:**
- *Delete commits before step 1:* the `FOR UPDATE` read returns the latest committed version,
  so `deletedAt` is set and step 2 throws.
- *Delete is running but not committed when step 1 runs:* step 1 waits on the row lock. When
  the delete commits, Postgres re-reads the row (EvalPlanQual). The `WHERE` is `id` only, so
  the row still matches, comes back with `deletedAt` set, and step 2 throws.
- *Delete starts after step 1:* the delete's own `UPDATE` waits until this transaction
  commits. That is a correct serial order (transition, then delete), not a race.

The guard runs straight after the lock, before every other read and write. A rejected
attempt does nothing and writes nothing.

**Deadlock wrapper:** `TransitionConflictError` has no `code` and no `cause`, so
`isPostgresDeadlockError` returns false at depth 0 and `runTransactionCatchingDeadlock`
rethrows it unchanged. The wrapper also has no retry loop, so nothing is retried either way.
In the other direction, a real `40P01` is still turned into the same `TransitionConflictError`
as before, and the new check doesn't change which locks are taken or in what order. There is
no misclassification either way.

**The `isNull` conditions in step 4's `WHERE`:** these can't be reached while step 2 exists.
Once step 1 holds the row lock, no other transaction can commit a change to `deleted_at` or
`archived_at` on this row before step 4 runs. The same reasoning is already in the file's own
comment at 463-465 about `state_id`. They are cheap, correct defence in depth. I checked this
by experiment: with step 2's new conditions removed but step 4's kept, both #490 transition
tests still pass (14/14). Step 4 then matches zero rows, falls to the existing
`if (!updated)` branch, and returns the same 409. So each guard closes the race on its own.
See N4 for what this means for the tests.

**Response and information:** the handler (`index.ts` ~1329) turns `TransitionConflictError`
into `HTTPException(409, { message })` with a fixed message. `currentStateId` is not
serialized, so nothing leaks.

## 3. assign-work-item.ts / unassign-work-item.ts -- closes the race

Both controllers do their liveness check in an unlocked pre-read, then one conditional `UPDATE`
in the transaction. The fix adds `deleted_at IS NULL AND archived_at IS NULL` to that
`UPDATE`'s `WHERE`. Under READ COMMITTED:

- if the delete committed first, the `UPDATE` sees it and matches zero rows;
- if the delete is still running, the `UPDATE` waits on the row lock, then EvalPlanQual
  re-checks the whole `WHERE` against the new row version, and it matches zero rows;
- if the `UPDATE` gets the lock first, the delete waits. That is a correct serial order.

A zero-row match goes to the existing `WorkItemAssigneeConflictError` branch before any
activity, audit, or event write. The `publishEvent` call is after commit and outside the
transaction, so the thrown error skips it too. `bulk-work-items.ts` calls `assignWorkItem`
directly, with no middleware, so this fix covers the bulk path as well.

**Information on the conflict path:** the re-select after a zero-row match (`SELECT
assignee_id WHERE id = ?`) doesn't filter liveness, so the 409 body can carry the
`assigneeId` of a row that was just soft-deleted. That is not a new leak:

- the caller passed `requireWorkItemReach` and workspace-access validation on this same item
  moments before;
- a soft-delete doesn't change `assignee_id`, so the value is either what the caller already
  saw or what a rival assign wrote while the caller legitimately had reach;
- the bulk route maps any non-`HTTPException` error to `reason: "failed"`, so nothing is
  serialized there.

No cross-tenant or out-of-reach disclosure is possible, because reaching this code at all
takes reach on this exact id.

**SQL:** every new condition is Drizzle `isNull(column)` on a schema column. No raw SQL, no
user input, no new injection surface. **Authorization:** unchanged. No capability check,
predicate, or route policy was touched.

## 4. Do the six tests exercise the new guards? -- yes, confirmed by running them

**Is a sequential test vacuous? It depends on the controller:**

- **assign/unassign:** correct. `assignWorkItem`'s pre-read (93-112) and `unassignWorkItem`'s
  (71-77) both filter `isNull(archivedAt)` and `isNull(deletedAt)` before the transaction. A
  sequential soft-delete followed by a direct call would 404 there and never reach the
  `UPDATE`.
- **transition: this claim is wrong.** `loadWorkflowTransitionContext`
  (`workflow-transition-context.ts:76-91`) selects by `id` only and doesn't filter either
  column. A sequential soft-delete followed by a direct `transitionWorkItem()` call would reach
  the new locked check, so that test would not have been vacuous. It doesn't matter here: the
  race tests used instead are stronger. See N3.

**How the race tests work:** a rival transaction (a Drizzle `db.transaction` for
assign/unassign, a raw `pg` client for transition) runs `UPDATE work_item SET deleted_at` (or
`archived_at`) and holds the row lock without committing. The controller call runs next.

- Its pre-reads are plain `SELECT`s, which don't wait on row locks and see the last committed
  (live) version, so they pass. For transition this covers `requireWorkItemReach` and
  `loadWorkflowTransitionContext`; for assign/unassign, their own pre-reads.
- It then blocks at the in-transaction `FOR UPDATE` or `UPDATE`.
- The rival commits after 200-300 ms, and the controller's in-transaction guard produces the
  rejection.

If timing ever let a pre-read run after the commit, the test would fail rather than falsely
pass: it would get a 404 or an `HTTPException`, where it asserts a 409 or
`WorkItemAssigneeConflictError`. Each test also checks that nothing was written: state or
assignee unchanged, no `assigneeId` activity rows, and for unassign, `publishEvent` not
called.

**Run by this reviewer** at `3aecd2de`, in a scratch worktree against a private database
(`opus491_review_test` on `td-lane-pg`):

- As committed: `work-item-transition`, `work-item-assign`, `work-item-unassign`, and
  `work-item-hierarchy` -- **4 files, 58/58 passed**. This matches the orchestrating
  session's count.
- With the three production files reverted to `origin/main` (`78b99076`), tests unchanged:
  **6 failed / 37 passed (43)**. The failures are exactly the six #490 tests. The two
  transition tests got `expected 200 to be 409`; the four assign/unassign tests got
  `promise resolved ... instead of rejecting`. Restored afterwards.

This independently reproduces the orchestrating session's report.

## 5. Sweep for the same class outside this diff

| Site | State at this head | Status |
| --- | --- | --- |
| `transition-work-item.ts`, `assign-work-item.ts`, `unassign-work-item.ts` | guarded (this PR) | **fixed here** |
| `update-work-item.ts` | locked `WHERE` has `isNull(deletedAt/archivedAt)`; project re-checked in the `UPDATE` | fixed (#276) |
| `set-work-item-parent.ts` | subject and parent guards | fixed (#486 / #481, on `main`) |
| `detach-work-item-parent.ts` | `if (!item)` only on `main` | fix in open PR #489 |
| `rank-work-item.ts` | `!target \|\| archivedAt \|\| deletedAt` after `FOR UPDATE` | guarded |
| `work-item/controllers/create-comment.ts` | no liveness check; bare `INSERT` into `comment` plus `work_item.commented` event | **still present, out of this diff** (PR #489 review N1) |
| `watch-work-item.ts` | `isNull(deletedAt)` only, no `archivedAt` (line 47) | **still present, out of this diff** (PR #489 review N2) |

New instances, not named in #490 or in the #489 review. All are low severity and none is an
authorization bypass: the caller had real reach moments before, so the impact is
data-integrity or observable fan-out only.

- **N1 -- attachment writers (`presign-attachment.ts`, `complete-attachment.ts`):** same shape
  as `create-comment.ts`. `presign` does a bare `INSERT` into `attachment` for the `workItemId`
  that reach resolved (lines ~183-198), with no check that the item is still live. `complete`
  updates the attachment and writes work-item activity without re-checking the item. A
  soft-delete landing between reach and the write leaves a pending or ready attachment, plus
  its activity or event, on a dead item. The fix shape is the same as `create-comment.ts`'s.
- **N2 -- the project soft-delete freeze on these three routes:** `update-work-item.ts`
  deliberately re-checks `project.deleted_at` inside its transaction and in its final
  `UPDATE` (`projectNotDeleted` EXISTS, #204/T3). Its comment explains why: the project row is
  not locked by a `work_item` lock, so a concurrent project soft-delete isn't serialized by
  the row lock.
  - `assign-work-item.ts` checks `project.deleted_at` only in its unlocked pre-read.
  - `unassign-work-item.ts` and `transition-work-item.ts` rely on `requireWorkItemReach`
    alone.
  - None of the three re-checks the project inside the transaction.

  So an assign, unassign, or transition can still land on a work item whose project was
  soft-deleted a moment earlier, against the #202 freeze. This is a sibling race on a
  different row, correctly outside #490's scope, which covers the item's own columns. The fix
  shape is `update-work-item.ts`'s `projectNotDeleted` clause. Together with N1 and the two
  items above, this is the fifth-plus instance of the class. The #490 issue suggested a shared
  `assertWorkItemStillLive(tx, item)` helper once another instance turned up. That threshold
  has now been passed, and the helper should cover the project check as well.
- **N3 (record accuracy, no code change):** the claim that transition's
  `loadWorkflowTransitionContext` "already filters `isNull(archivedAt)`/`isNull(deletedAt)`
  before the transaction" is incorrect (section 4). It changes nothing in this PR. It's
  recorded so the premise isn't copied into later reviews.
- **N4 (test precision, non-blocking):** because either transition guard alone passes the
  tests (section 2), the transition tests prove that the race is closed, not specifically that
  the locked-read check exists. A regression removing just one of the two guards would not be
  caught. That is acceptable, because the other guard still closes the race. A direct-call
  sequential test of `transitionWorkItem()`, which is not vacuous (N3), would pin the
  locked-read check specifically if anyone wants that.
- **N5 (behaviour note, non-blocking):** the raced case now returns 409 with a message
  written for the stale-state or stale-assignee case. #276, #486 and #488 return 404 for the
  same situation. It's not a security issue: there is no existence oracle, since the caller
  had reach and a retry 404s through the middleware. But the wording is misleading ("the
  assignee changed... now assigned to X", where X may be exactly the holder the caller
  expected), and #490's own suggested fix said "404 or no-op". Reusing the existing conflict
  path was the smallest correct change, and this review doesn't ask for it to change.

None of N1-N5 is in this PR's diff, and none blocks it.

## 6. Verdict

**CLEAR WITH FINDINGS** at `3aecd2deee370d8630b03643d66d0f3d9c3a9e09`.

All three fixes close the READ COMMITTED race in every interleaving. The transition guard
comes before every read and write after the lock, and the deadlock wrapper can't mistake it
for a deadlock. Nothing can wrongly reject a live row. There is no new SQL surface, no
authorization change, and no new information disclosure. The six new tests exercise the
in-transaction guards through a held row lock, and this reviewer independently confirmed they
fail without the fix. N1 and N2 are new, pre-existing, out-of-diff instances of the same class
and should become follow-up issues. N3-N5 are record, test-precision, and behaviour notes.

Not checked: CI status checks, the PR body's `## Gates` table, and branch protection. The
orchestrating session verifies those. The full integration suite was not run, only the four
files listed in section 4.

---

## Mechanical reconfirmation after merging main past PR #489 (cbe78e03)

**Confirmed by:** the orchestrating session, directly.

**What happened:** `main` advanced to `0b95ed08` (PR #489, issue #488's fix to
`detach-work-item-parent.ts`) after the reviewed head above. This branch was updated with
`main` via GitHub's update-branch API (merge commit `cbe78e03`), reported no conflicts.

**Verified directly:** `git diff` confirms this PR's own guards
(`transition-work-item.ts`'s `locked.deletedAt !== null || locked.archivedAt !== null`,
`assign-work-item.ts`'s/`unassign-work-item.ts`'s `isNull(archivedAt)`/`isNull(deletedAt)`)
are intact and unchanged at the merged head. PR #489 touches only
`detach-work-item-parent.ts` — a different file.

**Verified beyond the diff:** ran the real, merged test suite (all four affected files —
`work-item-transition.test.ts`, `work-item-assign.test.ts`, `work-item-unassign.test.ts`,
`work-item-hierarchy.test.ts`) against a fresh private Postgres database at the merged head:
**60/60 passed**.

**Verdict:** the review above remains valid at `cbe78e03`.

**Reviewed head:** `cbe78e03559b74bdfa9ad432a758d57ab81ec4b6`
