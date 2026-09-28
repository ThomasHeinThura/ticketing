# Security review -- PR #498 / issue #493: shared soft-delete/archive liveness helper

**Reviewer:** Claude Opus 5.5, fresh independent context (did not author, direct, or remediate this change)
**Session:** subagent `a74d8e5a3d2cc5bbb`
**Reviewed head:** `2fe82400e8bdec3823de65b5dec6f1b68a142c6e` (branch `fix/493-liveness-invariant-helper`)
**Scope:** `git diff 1b0c620d...2fe82400` (merge-base `1b0c620d`), 17 files, +926/-187:
- new `apps/api/src/work-item/assert-work-item-live.ts` (+72);
- eight work-item controllers: `update-work-item.ts`, `set-work-item-parent.ts`,
  `detach-work-item-parent.ts`, `transition-work-item.ts`, `assign-work-item.ts`,
  `unassign-work-item.ts`, `create-comment.ts`, `watch-work-item.ts`;
- two attachment controllers: `presign-attachment.ts`, `complete-attachment.ts`;
- five changed integration test files plus the new `attachment-liveness-race.test.ts`.
**Date:** 2026-09-28
**Verdict:** **BLOCKING WITH FINDINGS** at the reviewed head. The only blocker (B1) was a test-file
type error, not a security defect — **fixed by the orchestrating session at `73fb5ea7`** (see
the reconfirmation section at the bottom of this note). N1-N7 are non-blocking findings.

## 1. The premise, confirmed against source

- **The middlewares check liveness before the controller's transaction, without a lock.**
  `require-work-item-reach.ts:104-123` and `require-attachment-reach.ts` are unlocked
  `SELECT`s that run before any controller transaction. Each checks `work_item.deleted_at`,
  `work_item.archived_at` **and** `project.deleted_at`.
- **The soft-delete writers.** `delete-work-item.ts:88-89` runs `UPDATE work_item SET
  deleted_at` inside a transaction. `delete-project.ts` runs `UPDATE project SET deleted_at,
  purge_after WHERE id AND workspace_id AND deleted_at IS NULL`. It does not touch any
  `work_item` row.
- **No triggers link the two tables.** Only four triggers exist in `apps/api/drizzle/*.sql`:
  `work_item_claim_key`, `work_item_reject_parent_cycle`, and the two `audit_log` append-only
  triggers. None fires on a `project` update or cascades into `work_item`. So a work-item row
  lock **cannot** serialise a concurrent project soft-delete.
- **No lock-upgrade deadlock.** None of the four newly guarded writers (comment, watch,
  presign, complete) writes `work_item` later in the same transaction, and no trigger does it
  for them. The only other `work_item` lock their inserts take is the foreign-key check's
  `FOR KEY SHARE`, which is compatible with `FOR SHARE`. No new deadlock cycle.

## 2. `assert-work-item-live.ts`

- **`assertWorkItemStillLive` (241-250):** `!item || deletedAt !== null || archivedAt !== null`
  -> `HTTPException(404, message)`. Both columns are nullable `timestamp({ mode: "date" })`, so
  `!== null` behaves exactly like the old truthiness checks. A live row can't be wrongly
  rejected. The `asserts item is T` signature narrows the type correctly.
- **`assertProjectStillLive` (261-274):** the same query and the same 404 text as the three
  copies it replaces. Unlocked read, and that's fine (the project deleter reads nothing the
  caller writes, so any commit order is equivalent to running the two calls in sequence).
- **`projectNotDeletedClause`:** a module-level `sql` template with no `Param` chunks and
  table-qualified columns, safe to share across every `UPDATE ... WHERE` site (confirmed
  against drizzle-orm 0.45.2's `sql/sql.js` — `SQL.buildQueryFromSourceParams` is pure, and
  none of `append()`/`mapWith()`/`inlineParams()` is called on this constant anywhere in the
  codebase).

## 3. The five-call-site refactor preserves behaviour

Verified line-by-line against the removed inline code: `update-work-item.ts`,
`set-work-item-parent.ts` (both subject and parent checks, including the parent's distinct
"Parent work item not found" message override), `detach-work-item-parent.ts`. Every status
code, message and branch order matches exactly. The existing tests of all five sites pass
unchanged in the full run (section 5).

## 4. The seven fixes, one interleaving at a time (READ COMMITTED)

**4a. `.for("share")` against a concurrent soft-delete (the four new writers):**
`FOR SHARE` conflicts with `FOR NO KEY UPDATE` (what a soft-delete/archive `UPDATE` takes,
since it changes only non-key columns). Traced all three interleavings (delete-before,
delete-during, delete-after the locked read) — all three are correct: either the assert
catches the now-dead row, or the write correctly lands before a delete that hasn't happened
yet.

**4b. The three new project checks** (`transition-work-item.ts`, `assign-work-item.ts`,
`unassign-work-item.ts`): `projectNotDeletedClause` folded into each route's final conditional
`UPDATE`. Both interleavings (project delete before/after the `UPDATE` starts) are correct —
either zero rows match and the route's existing conflict branch fires before any write, or
the write is equivalent to "write, then project delete".

**No information leak on the conflict paths** — the re-select returns `stateId`/`assigneeId`,
which the caller already had reach to see (consistent with the #490 review's own finding).

## 5. Do the tests race for real? Yes, independently reproduced

Ran, at the reviewed head, in a scratch worktree with all workspace packages rebuilt from
that worktree's own sources (not the shared checkout's stale `dist`):
- Integration suite: **117 files, 1473/1473 passed.**
- Unit suite: **64 files, 522/522 passed.**
- Reverted each of the seven fixes individually and confirmed only that fix's own new test(s)
  failed, then restored and confirmed all passing again. Also confirmed, for `watch-work-item.ts`
  specifically, that removing only the `.for("share")` lock (keeping the assert) still fails
  the test — proving the lock itself is load-bearing, not just the liveness check.

## 6. Blocking finding — B1, fixed

**B1 (CI gate, not a security defect):** `tests/api-integration/attachment-liveness-race.test.ts`
lines 187 and 227 failed `tsc`'s `TS2322`: `app.request()` returns `Response |
Promise<Response>`, which didn't satisfy the helper's `() => Promise<unknown>` parameter type.
This failed the required `static` CI check at the reviewed head.

**Fixed by the orchestrating session** at `73fb5ea7`: widened the parameter type to
`() => unknown | Promise<unknown>` (the function body already handles both via an implicit
await on return, since `raceSoftDeleteAgainstWorkItemRow` is itself `async`). Re-verified
directly: `tsc --noEmit -p tsconfig.json` and `-p tsconfig.tests.json` both clean; the full
integration suite re-run at the merged head (117 files, 1473/1473 passed, including both
attachment-liveness-race tests specifically).

## 7. Sweep of `apps/api/src/**/controllers/**` for the same class

| Site | Work-item liveness in the transaction | Project check in the transaction | Status |
| --- | --- | --- | --- |
| update / set-parent / detach | yes | yes | fixed (#276 / #486 / #481 / #488), refactored here |
| transition / assign / unassign | yes (#490) | **yes (this PR)** | fixed |
| create-comment / watch / presign / complete | **yes (this PR)** | no | filed as #499 (N2) |
| `rank-work-item.ts` | yes (`FOR UPDATE`) | **no** | filed as #499 (N1) |
| `create-work-item.ts` + `claim-work-item-number.ts` | n/a (new row) | **no** | filed as #499 (N3) |

**N1-N3** (new instances, filed as issue #499 rather than fixed in this PR, to keep this PR to
issue #493's own named scope): `rank-work-item.ts` has the same project-liveness gap this PR
closes for transition/assign/unassign; the four newly-guarded writers check the item but not
its project; `claimWorkItemNumber` never re-checks the project's `deleted_at` in its own
`UPDATE`.

**N4-N7 (non-blocking notes, not filed separately):**
- N4: `transition-work-item.ts`'s stale "unreachable in practice" comment on its `!updated`
  branch — the new project clause makes that branch reachable now.
- N5: a project-deleted-mid-request 409 reuses stale-state/stale-assignee wording rather than
  404 — misleading but not a leak (carries #490's own N5 forward).
- N6: `complete-attachment.ts`'s cleanup `catch` runs on any transaction error, not just the
  new 404 — a strict improvement over the prior orphaning behavior, not a regression.
- N7: the helper's doc comment overstates its locking contract slightly (the parent lookup in
  `set-work-item-parent.ts` calls it on an unlocked read, accepted since the #481 review).

None of N1-N7 blocks this PR.

## 8. Verdict

**CLEAR WITH FINDINGS** at `73fb5ea73095d0ae7717434cda3ae9fe6dd219a4` (the B1 fix, merged with
`main` past PR #495/#496, re-verified: typecheck clean on both configs, full integration suite
117/117 files and 1473/1473 tests passing at this exact head).

All seven fixes close their READ COMMITTED race in every interleaving. The shared `sql`
constant is safe to reuse. The five-call-site refactor preserves behaviour exactly. There is
no new authorization, SQL-injection or information surface, and no new lock-order deadlock.
N1-N3 are same-class instances, filed as issue #499 rather than folded in here. N4-N7 are
notes.

Not checked by the original review pass: the PR body's `## Gates` table, branch protection —
the orchestrating session verifies those before merge.
