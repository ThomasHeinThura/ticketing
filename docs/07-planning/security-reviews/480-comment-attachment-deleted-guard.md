# Security review — comment/attachment reach ignores a soft-deleted or archived work item (#480)

**Reviewer (final):** Opus, fresh independent context commissioned by the orchestrating
session (via the `Agent` tool, `model: opus`). Did not author, direct, or remediate this
change. The commit under review is authored by the implementing session (Claude Sonnet 5,
per its `Co-Authored-By` trailer).
**Reviewed head:** `577737eae12932c7e3b92869c98bd744a0c7efd6`
**Pull request:** #484 (closes #480), branch `fix/480-comment-attachment-deleted-guard`
**Base:** `origin/main` at `d590cb60c7b6a777a2ba84dd8f71f3f2d0a4afff` (the reviewed head is
one commit on top of it)
**Date:** 2026-09-28

**Verdict: CLEAR WITH FINDINGS.** The fix closes the described gap on every route the two
middlewares gate. The four new regression tests are real: verified directly that they fail
with the fix reverted and pass with it applied. Nothing found here blocks merge. The findings
below are non-blocking. F1 matters most: the "already fixed" reference pattern for #276 is
**not on `main`**.

## Scope

- `apps/api/src/work-item/require-comment-reach.ts` (+2 predicates, comment)
- `apps/api/src/attachment/require-attachment-reach.ts` (+2 predicates, comment)
- `tests/api-integration/work-item-comment.test.ts` (+2 tests)
- `tests/api-integration/attachment.test.ts` (+2 tests)

Auth/reach-check machinery, which puts it in `ci-cd.md`'s security-review scope. No other
path is touched.

## Surfaces examined

- Both middlewares in full, at the reviewed head.
- Every mount point: `grep` for `requireCommentReach`/`requireAttachmentReach` across
  `apps/api/src`:
  - `requireCommentReach()` is used by `PATCH /api/comments/{id}` and
    `DELETE /api/comments/{id}` (`work-item/index.ts`).
  - `requireAttachmentReach()` is used by `POST /api/attachments/{id}/complete`,
    `GET /api/attachments/{id}` and `DELETE /api/attachments/{id}` (`attachment/index.ts`).
  - All five routes now 404 on a comment or attachment whose work item has `deleted_at` or
    `archived_at` set, because the predicate lives in the one shared lookup.
- The handlers behind those routes (`update-comment.ts`, `delete-comment.ts`,
  `download-attachment.ts`, `delete-attachment.ts`, `complete-attachment.ts`), checked for
  their own re-scoping and locking.
- `delete-work-item.ts`, to see what a soft-delete actually does to child rows (nothing:
  there is no cascade and no read of comments or attachments).
- Every file in `apps/api/src` that references `workItemTable`, plus every table with a
  `work_item_id` column (`comment`, `attachment`, `activity`, `watcher`,
  `scheduled_transition`, `work_item_key_claim`/`_alias`), checked for any other lookup keyed
  by a child row's own id that joins through `work_item`. There are none beyond these two
  middlewares. `activity`, `watcher` and `scheduled_transition` are only ever reached through
  the work-item key (`requireWorkItemReach`) or inside a work-item controller. The legacy
  `apps/api/src/comment/**` and `activity/**` routes run on the legacy `task`-keyed tables,
  not `work_item`, so they are outside this class.
- `origin/fix/276-patch-soft-deleted-guard`, the sibling fix this PR is modelled on.

## Test verification (run by this reviewer, not carried from the PR)

Private database `opus480_test` on `td-lane-pg`, from the worktree at the reviewed head:

- **Fix applied:** `work-item-comment.test.ts` + `attachment.test.ts` gave **2 files, 29/29
  passed**.
- **Fix reverted** (both `apps/api/src/**` files checked out from `HEAD~1`, tests kept):
  **4 failed / 25 passed**. Exactly the four `issue #480` tests fail:
  - comment soft-deleted: `expected 200 to be 404` (PATCH succeeded pre-fix)
  - comment archived: `expected 200 to be 404`
  - attachment soft-deleted: `expected 302 to be 404` (download redirect minted pre-fix,
    which also proves `complete` succeeded and the row was `ready`)
  - attachment archived: `expected 302 to be 404`
- Restored afterwards. `git status` was clean and HEAD was still
  `577737eae12932c7e3b92869c98bd744a0c7efd6`.

The tests use the real attack path at the HTTP layer: a caller who legitimately has
workspace access addresses the child row by its own id after the parent work item is gone.
They set `deleted_at`/`archived_at` directly in the database instead of calling
`DELETE /api/work-items/{key}`. For a middleware-level predicate the effect is the same.

## Findings

### F1 — the #276 reference fix is not on `main` (non-blocking for this PR; process/ordering)

The review brief describes `require-work-item-reach.ts` as "already fixed for issue #276".
**At `origin/main` (`d590cb60`) it is not.** Its `WHERE` still filters only
`isNull(projectTable.deletedAt)`. The #276 fix exists as commits `98ba8ff9` and `8d1a290d`
on `origin/fix/276-patch-soft-deleted-guard`, and **that branch has no pull request** (open
or closed, checked with `gh pr list --state all --head`). Issue #276 is still OPEN.

Consequence: until #276 lands, every key-addressed work-item route on `main` still reaches
a soft-deleted work item. That covers `GET`/`PATCH /work-items/{key}`, comment **create**,
attachment presign/list, watch, assign, rank, parent and tree. This PR is correct on its own
and merges cleanly with the #276 branch (`git merge-tree` reports no conflict). But "comments
and attachments on a deleted work item are frozen" only fully holds once both are on `main`.
For example, with only #484 merged, a caller can still `POST` a new comment onto a deleted
work item but cannot edit it afterwards.

Recommendation: open and gate a PR for `fix/276-patch-soft-deleted-guard`. This is not a
reason to hold #484.

### F2 — check-then-use window between the reach SELECT and the handler write (LOW, non-blocking)

Both middlewares run their SELECT outside the handler's transaction. The handlers then
behave as follows:

- `update-comment.ts` and `delete-comment.ts` lock the **comment** row (`FOR UPDATE`) and
  re-scope on `workspaceId`. They do not re-check the work item.
- `delete-attachment.ts` does a guarded conditional UPDATE on the attachment. It does not
  re-check the work item.
- `download-attachment.ts` is read-only.

So a `DELETE /api/work-items/{key}` that commits between the reach check and the handler's
write lets that one in-flight comment edit or delete, or attachment delete, or download-URL
mint, go through.

This is **not** the same class as the race #276 closed in `update-work-item.ts`. There the
locked and mutated row *is* the work item being deleted, so a stale read would write to a
dead row. Here the mutated row is a child row. `delete-work-item.ts` neither reads, cascades,
snapshots nor tombstones children, so the interleaving is serially equivalent to "the edit
committed just before the delete". No invariant breaks, no data is corrupted, and nothing
crosses a tenant. The actor had legitimate reach an instant earlier.

It becomes worth closing only if work-item deletion ever starts acting on children, for
example a purge job (#198), a cascade, or a pending-action approval that snapshots state. The
fix at that point is a `SELECT ... FROM work_item WHERE id = ? AND deleted_at IS NULL AND
archived_at IS NULL FOR SHARE` inside the handler transaction. No action needed now.

### F3 — test coverage gaps (non-blocking)

- `POST /api/attachments/{id}/complete` is also gated by `requireAttachmentReach` and now
  also 404s on a deleted or archived work item. No test covers that route.
- In each test, the second assertion (`DELETE`) is only reached after the first passes. So
  the fail-before evidence above proves discrimination for `PATCH` and `GET` directly, and
  for `DELETE` only by the shared-predicate argument. Post-fix, the `DELETE` assertions do
  run and pass.
- The archived-attachment test does not assert the row is unchanged (the soft-deleted one
  does: `state === "ready"`). The archived-comment test likewise does not assert
  `after === before`.

None of these is a hole in the fix. They are cheap follow-ups if the file is touched again.

### Informational

- **No new existence oracle.** The filtered row takes the same `404 "… not found"` path as
  a nonexistent id, and it does so *before* `validateWorkspaceAccess`. A deleted, archived,
  missing or out-of-tenant comment or attachment all look the same from outside. That matches
  the #290/#261-F2 404-not-403 policy both files already document.
- **`work_item.archived_at` has no writer today** (grepped: no archive route). The predicate
  is defence in depth and matches sibling controllers (`assign-work-item.ts`,
  `unassign` in `index.ts`, `rank-work-item.ts`, `list-work-items.ts`), which already treat
  `archived_at` and `deleted_at` identically.
- **Pre-existing, out of scope:** `PUT /api/storage/filesystem-attachment-upload` is
  authenticated only by its HMAC token and does not re-check work-item liveness. A token
  minted before the delete can still write bytes until it expires. With this fix,
  `complete` then 404s, so the object is never served. It stays orphaned at the pending key
  until attachment GC removes it. No data exposure.
- Legacy `apps/api/src/comment/**` and `activity/**` routes are keyed on the legacy `task`
  table and are outside this class.

## What this review did not do

- Did not run the full integration suite or `test:permissions`. Only the two touched test
  files were run, both with and without the fix. The PR reports `test:permissions` green,
  13 files/83 tests; this reviewer did not re-run it.
- Did not check GitHub status checks on the PR. That is the merging session's job at the
  exact head.
- Did not review the #276 branch's own diff beyond confirming what it changes in
  `require-work-item-reach.ts` and that it does not conflict with this PR.
