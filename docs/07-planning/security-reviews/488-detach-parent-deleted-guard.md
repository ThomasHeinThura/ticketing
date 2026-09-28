# Security review -- PR #489 / issue #488: detach-parent SUBJECT-item deleted/archived guard

**Reviewer:** Claude Opus 5.5, fresh independent context (did not author, direct, or remediate this change)
**Reviewed head:** `dc2d0951a5969c7f908ade209d85bfa99b598f1c` (merge of `origin/main` through #484 into `fix/488-detach-parent-deleted-guard`; fix commit `d5c86e40`)
**Scope:** `git diff origin/main...dc2d0951` touches exactly two files --
`apps/api/src/work-item/controllers/detach-work-item-parent.ts` (+6/-1) and
`tests/api-integration/work-item-hierarchy.test.ts` (+106). The merge commit itself brings in
nothing beyond #484, which is already on `main`.
**Date:** 2026-09-28
**Verdict:** **CLEAR WITH FINDINGS** (non-blocking; no finding is in this PR's diff)

## 1. Guard placement and logic -- correct, no gap

Inside the `db.transaction` callback, the order is:

1. `SELECT ... FROM work_item WHERE key = ? AND workspace_id = ? FOR UPDATE` (line 47-56)
2. **`if (!item || item.archivedAt || item.deletedAt) throw 404`** (line 63) -- the fix
3. project-alive read, 404 if the project is soft-deleted (67-79)
4. `parentId === null` no-op return (81-83)
5. `UPDATE ... SET parent_id = NULL, version = version + 1 WHERE id = ? AND version = ? AND project-not-deleted` (85-95)
6. `recordWorkItemActivity` (101-113)
7. after commit: `publishEvent("work_item.updated")`, only when `changed` (123-147)

The only statement before the guard is the locked read itself. Every write (UPDATE, activity
row, domain event) is after it. Because the row is held `FOR UPDATE` from step 1, a concurrent
`delete-work-item.ts` soft-delete (its own `UPDATE work_item SET deleted_at`) must either have
committed before step 1 -- in which case step 1 returns the row with `deletedAt` set and step 2
refuses it -- or block until this transaction commits. Archive is the same. No window remains
between check and write. The error (`HTTPException(404, "Work item not found")`) matches the
middleware's own "not there" outcome and `update-work-item.ts`'s #276 guard, so there is no
existence oracle difference between the middleware path and the in-transaction path.

Side effect, intended: a deleted/archived item that already has no parent used to return the
step-4 no-op (200 + the dead row); it now 404s. That is the correct behaviour and matches the
middleware.

## 2. `runWithParentWriteDeadlockRetry` -- does not swallow or retry the 404

`apps/api/src/work-item/parent-write-deadlock-retry.ts` rethrows immediately unless
`isPostgresDeadlockError(error)` is true. `isPostgresDeadlockError`
(`transition-work-item.ts:104-120`) returns true only when some object in the `cause` chain
(bounded depth) has `code === "40P01"`. Hono 4.13.5's `HTTPException` (checked in
`node_modules/.pnpm/hono@4.13.5/.../http-exception.js`) has only `res`, `status`, `message` and
an optional `cause` taken from `options.cause` -- which this controller never sets. So the 404
has no `code` and an `undefined` cause; the walk returns false on the first step and the
wrapper rethrows on attempt 1. No retry, no swallow. The integration tests independently
confirm it: `toBeInstanceOf(HTTPException)` with `.status === 404` passes through both
`db.transaction` and the retry wrapper. Sonnet's note (1) is resolved.

(Even hypothetically, a retry of this 404 would be harmless -- each attempt re-reads under a
fresh lock and would throw the same 404 -- but it does not happen.)

## 3. Sweep for the same unguarded-subject re-read elsewhere

Every `.for("update")` in `apps/api/src/work-item/**` and every other mutating controller in
`apps/api/src/work-item/controllers/`, at this head:

| Controller | Subject re-read guard | Status |
| --- | --- | --- |
| `detach-work-item-parent.ts` | `!item \|\| archivedAt \|\| deletedAt` | **fixed by this PR** |
| `update-work-item.ts` | `isNull(deletedAt), isNull(archivedAt)` in the locked `WHERE` | fixed (#276) |
| `rank-work-item.ts` | `!target \|\| archivedAt \|\| deletedAt` | guarded |
| `set-work-item-parent.ts` | subject: `if (!item)` only (line 120) | **known -- #486, fix in PR #487, not yet on `main`**; parent-row lookup fixed by #483 |
| `transition-work-item.ts` | locked read compares `stateId` only; final `UPDATE` matches `id` + `stateId` | **known -- open issue #490 (N1)** |
| `assign-work-item.ts`, `unassign-work-item.ts` | liveness only in an unlocked pre-read | **known -- open issue #490 (N2)** |
| `delete-comment.ts`, `update-comment.ts` | lock the *comment* row, check comment `deletedAt` | different subject; the comment-reach side was #484 |
| `delete-work-item.ts` | `isNull(deletedAt)` in both read and `UPDATE` | guarded (archive is not re-checked, but deleting an archived item is not a bypass) |

Two further, lower-severity instances of the same class that **no open issue names** (#490
lists only transition/assign/unassign):

- **N1 -- `create-comment.ts`**: no in-controller liveness re-check at all. It takes the
  `workItemId` the reach middleware resolved and inserts straight into `comment`, then
  publishes `work_item.commented`. A soft-delete/archive landing between the middleware and the
  insert produces a comment (and a fan-out event) on a dead item. Same fix shape as #490's
  suggestion: make the insert conditional on the item still being live (e.g. `INSERT ... SELECT
  ... WHERE EXISTS (live work_item)`, or a `FOR SHARE` read of the work item inside a
  transaction). Lower impact than the work-item writers -- it writes no work-item state -- but
  the event fan-out to watchers/customers is observable. Suggest adding it to #490 rather than
  a new issue.
- **N2 -- `watch-work-item.ts`**: `resolveCallerPersonAndItem` filters `isNull(deletedAt)` but
  not `archivedAt`. The route's reach middleware already refuses archived items, so this is only
  the same narrow race, and writing a `watcher` row is not a work-item mutation. Informational;
  fold into #490 if convenient.

Neither is in this PR's diff and neither blocks it.

## 4. Do the new tests test the fix, not the middleware? -- yes, proven

Both tests call `detachWorkItemParent()` directly (imported from the controller module), so
`requireWorkItemReach` never runs. Setup goes through the real HTTP routes (create two items,
set a parent), asserts `parent_id` is non-null, then soft-deletes / archives the subject with a
direct `UPDATE`, then calls the controller and asserts `HTTPException` + `status === 404` +
`parent_id` unchanged.

Run at `dc2d0951` against a fresh private database (`opus489_review_test` on `td-lane-pg`):

- As committed: **1 file, 16/16 passed.**
- With line 63 reverted locally to `if (!item) {`: **2 failed / 14 passed** -- exactly the two
  #488 tests, both `AssertionError: expected undefined to be an instance of HTTPException`
  (i.e. the detach succeeded against the dead row). File restored afterwards; worktree clean.

The tests would catch a regression of this guard. They do not assert "no activity row
written", but that is implied: the activity insert is after the `UPDATE` in the same
transaction, and `parent_id` unchanged proves the `UPDATE` did not commit.

- **N3 (style, non-blocking)** -- agrees with Sonnet's note (2): the two tests are near-copies
  differing only in the column set; an `it.each([["deletedAt"], ["archivedAt"]])` would halve
  them. Not worth a round trip on its own.

## 5. Verdict

**CLEAR WITH FINDINGS** at `dc2d0951a5969c7f908ade209d85bfa99b598f1c`.

The fix is correct, placed before every write, not defeated by the deadlock-retry wrapper, and
covered by two tests proven to fail without it. N1 (`create-comment.ts`) and N2
(`watch-work-item.ts`) are pre-existing, out-of-diff instances of the same race class, suggested
as additions to open issue #490; N3 is style. None blocks merge.

Not checked: CI status checks, the PR body `## Gates` table, and branch protection -- the
orchestrator verifies those. The full integration suite was not run; only
`work-item-hierarchy.test.ts`, the only test file this diff touches.
