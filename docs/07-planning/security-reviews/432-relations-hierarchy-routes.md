# PR #432 — work-item hierarchy routes (issue #26)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (spawned as `pal-reviewer`; read the
actual worktree files directly given this PR's size, rather than a pasted diff)
**Session:** subagent `aa07e1e4e7cd1298d`

**Reviewed head:** `8c5cd58d8a3ee90bae5915e4c23d3590ec02e9fb`

**Verdict: no blocking correctness or security defect, one medium finding.** Confirmed the
cycle/depth guard (`validateReparent`) generalizes correctly over arbitrary intermediate
nodes; the DB trigger (migration 0056) is untouched and remains the real race-free
authority; the claimed `loadSubtreeRows` bug fix (querying by `parent_id` not `id`) is
correct by direct line read; all cross-tenant/cross-project test cases exist and assert
real state; the "one capability check" design is structurally forced correct since the
parent lookup is scoped to the same `workspaceId` variable the child's own reach-check
already resolved; idempotent detach is correct. Independently confirmed the composite
self-FK on `work_item.parent_id` (`(project_id, parent_id) -> work_item(project_id, id)`)
genuinely exists in `schema.ts`.

**Medium finding:** `GET .../tree` had no response-size cap, contradicting the spec's own
"200 children paginates" requirement (`relations-and-hierarchy.md` line 120).

## Fix (commit `84b87cf`, merged into `d0eedd0`)

Added `MAX_TREE_NODES = 500` (2.5× the spec's own "200 children" figure) plus a `truncated`
flag on the tree response, ordered by `work_item.position`. Filed follow-up issue #434 for
real per-node pagination (cursor pagination doesn't translate cleanly onto a nested tree
shape).

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a8749e7789a947d1f`

**Reviewed head:** `7bb026cd3ae0eeb960ed2eeed1dc5c44f2eaf547`

**Verdict: CLEAR WITH FINDINGS.** Confirmed permissions, tenant scoping, and cycle safety
all hold — reran the domain unit tests (11/11), hierarchy + cycle-guard integration tests
(24/24), and permissions suite (82/82) directly. Independently verified the `MAX_TREE_NODES`
fix builds the tree after the cap; confirmed cycle detection is structurally complete
against three of the reviewer's own adversarial shapes beyond the existing unit tests;
confirmed all three new `policy.ts` entries are correctly scoped.

**F1 (medium, real, reproduced live):** the depth-5 cap can be bypassed by two concurrent
requests. `validateReparent`'s ancestor/depth reads are unlocked; the DB trigger enforces
cycle-freedom but not depth. The reviewer constructed and ran a real two-transaction race
(move X under P, hold open; concurrently move Y under Z where Z is now under X under P;
both individually valid at read time, together producing depth 7) against a real database,
then deleted the test and dropped the scratch DB. Depth has only one enforcement layer
where cycle detection has two. **Recommended fix:** a per-project
`pg_advisory_xact_lock` at the start of `set-work-item-parent.ts`'s transaction, matching
an existing lock pattern already used elsewhere in this codebase for workspace ownership
transfer — serializes all moves within one project, closing both the depth race and any
residual cycle race together.

**F2 (medium-low, real):** truncation ordering is not deterministic. No code writes
`work_item.position`, so every row keeps the default `"0"` and the tree's
`.orderBy(workItemTable.position)` sort ties on everything — which rows survive the cut is
up to Postgres and can change after an unrelated edit. Also breaks this codebase's own rule
that every sort ends with an `id` tie-break (`list-query.ts` lines 115-143). Fix:
`.orderBy(workItemTable.position, workItemTable.id)`.

**F3 (low-medium, real):** `loadSubtreeRows`'s per-level query has no `LIMIT` — a parent
with many children loads all rows into memory before the 500-node slice. Fix:
`.limit(remaining + 1)` on the level query.

**F4 (low, real):** a truncated tree can look shallower than it is, some returned nodes can
look like leaves despite having real children, and the requested item can be omitted
entirely if deep and past the cut. Suggested: always include the path from root to the
current item, or track as a known limitation on #434.

**F5 (informational, correctly out of scope):** neither route filters
`deletedAt`/`archivedAt` — matches `get-work-item`'s own current behavior (neither column
is set on any work item yet); flagged for whoever builds delete/archive to apply the same
filter `assign-work-item.ts` already has.

**Surfaces examined:** `apps/api/src/work-item/hierarchy.ts`,
`set-work-item-parent.ts`, `get-work-item-tree.ts`, `detach-work-item-parent.ts`,
`is-raise-exception.ts`, `policy.ts`'s three new entries in full, the DB trigger's own
migration comment, and a live-reproduced two-transaction race test.

A fix for F1 (required) and F2/F3 (should-fix, cheap) is being commissioned as a delta. F4
is being tracked on #434 rather than fixed inline (matches the reviewer's own suggested
scope).

---

## Security review — delta (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a0dc0be34f0681759`

**Reviewed head:** `7055b218705edbfec1cc22b0255be15d0658513a`

**Verdict: CLEAR WITH FINDINGS, one blocking (D1).** The code fix is correct and verified
live; the regression test meant to guard it is not.

**F1 confirmed closed — reproduced live, both directions.** Ran the same interleaving
against a pre-fix worktree (`356ad00`) and the fix (`7055b21`), on private `*_test`
databases: pre-fix, 24-25 of 25 concurrent rounds both succeeded and broke the depth cap
(final depth 6); at the fix, 0 of 25 rounds broke it (second request correctly waits on
advisory lock classid 4012, gets 422 `max_depth`, final depth stays 5). Confirmed the lock
is genuinely the transaction's first statement, confirmed namespace 4012 doesn't collide
with any other lock site (1524/4002/4003/4004 two-argument, 2026/4010/4011 single-argument
— separate key space), confirmed `projectId` is never written anywhere in this codebase
(checked every write site), confirmed the unlocked pre-read's 404 path leaks nothing new
(same filter, same message as the locked re-read), confirmed no deadlock/starvation path
(single lock order, single-row locks elsewhere, short transaction, project-scoped only).

**D1 (BLOCKING — the test, not the code):** the new "RH-7 concurrency" regression test
passed 4/4 runs **against the pre-fix code** — it fires both requests via one `Promise.all`
on a cold connection pool, and opening the second connection delays it enough that the two
requests accidentally run sequentially rather than actually racing. If the advisory lock
were ever removed, this test would stay green and catch nothing. **Required fix:** make the
interleaving deterministic — open a side `pg` `Client`, `LOCK TABLE activity IN ACCESS
EXCLUSIVE MODE` to park the first request's transaction, poll `pg_locks` until the first
request is blocked on `activity`, fire the second request, assert it is waiting on the
advisory lock (`classid = 4012`), then release and assert final state ([200, 422], depth
≤ 5). Reviewer confirmed this exact shape fails on `356ad00` and passes on `7055b21`.

**D2 (low, non-blocking):** add a fail-closed guard inside the lock —
`if (item.projectId !== pre.projectId) throw 409` — cheap insurance against a future
cross-project move feature silently reopening F1.

**D3 (informational):** the fix depends on this codebase's existing READ COMMITTED
default; documented as a known, already-shared assumption with every other advisory-lock
site here, not a new risk.

**D4 (doc nit, non-blocking):** `hierarchy.ts`'s doc comment on `ancestorChain` still calls
the DB trigger "the sole race-free authority at write time" — no longer accurate for
set-parent, which now runs under the advisory lock. Update next touch.

**Test runs at `7055b218`:** work-item/relation/cycle-guard integration 15/15 files,
534/534 tests; full integration 94/94 files, 1276/1276 tests; permissions 12/12 files,
82/82 tests; `packages/domain` unit 12/12 files, 555/555 tests; `apps/api` typecheck clean.

D1's fix is being commissioned as a delta. Per the reviewer's own recommendation, the
re-review after that fix can be narrow — confirm the new test fails on `356ad00` and passes
on the new head — not a full fresh pass.

---

## Security review — narrow re-review (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a9e5ecbf728e3bc7e`

**Reviewed head:** `9523be221d1ddc9b6923a5959c170fe81e7529c2`

**Scope:** narrow, per the prior delta pass's own recommendation — confirm D1's rewritten
test genuinely fails on the pre-fix commit and passes on the new head; not a re-litigation
of F1/F2/F3, which the prior pass already confirmed closed.

**Verdict: CLEAR.** D1 is closed — the rewritten test genuinely guards the fix. D2 and D4
confirmed present and correct.

Independently reproduced the fail-then-pass behavior on a separate worktree and a private
`opus432d1_test` database: head `9523be2` passed 3/3; the pre-fix `set-work-item-parent.ts`
(with `hierarchy-lock.ts` removed) swapped in failed 4/4, each time correctly at the
`classid = 4012` advisory-lock probe after ~5.3s (proving the lock genuinely isn't there
pre-fix — the test doesn't just fail for an unrelated reason). An additional adversarial
variant (lock present but moved to after `validateReparent`) also correctly failed
(`[200, 200]` instead of `[200, 422]`), confirming the test catches the depth-cap violation
itself, not merely the lock's absence. D2's `item.projectId !== pre.projectId` guard is
present, correctly placed inside the lock after the authoritative re-read, fails closed. D4's
doc comment is accurate. Full file passed 12/12, three separate runs. `apps/api` typecheck
clean.

**One correction to the record (non-blocking):** the D1 fix commit's own message claims the
pre-fix test fails with "both requests succeed, depth cap violated" in under a second — this
is not what actually happens. Pre-fix, it fails by hitting the 5-second timeout while polling
for the advisory-lock probe (since no such lock exists pre-fix), not by an instant depth-cap
violation. This doesn't change the verdict — the test still correctly goes red pre-fix and
green post-fix — but the mechanism recorded in the commit message is inaccurate and worth
noting here for anyone reading the history later.

F1/F2/F3 were not re-reviewed in this pass (out of scope, already confirmed in the prior
delta). Full integration suite was not re-run in this pass (out of scope); the prior delta
pass already confirmed it green at the code-fix commit, and this pass's own scope was
narrowly the test file plus D2/D4.

Clear to merge.

---

## Re-confirmation after branch update (2026-09-27)

**Reviewed head:** `cd7ee60da39ba47850664aa3ca996ecf43d01c0d`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. `git diff 9523be221d1ddc9b6923a5959c170fe81e7529c2..cd7ee60da39ba47850664aa3ca996ecf43d01c0d`
scoped to every file this PR touches is empty. The intervening commits are already-merged,
already-reviewed content from #423, #417, #419, #429 and #431 landing via routine branch
updates — confirmed each is an ancestor of `origin/main`. No new, unreviewed logic reached
this branch. (Verified from a worktree freshly reset via `git reset --hard
origin/<branch>`, not merely fetched — see PR #430's own note for why this matters.)

---

## Security review — conflict-resolution verification (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a1c88d5440edb246d`

**Reviewed head:** `358143dc894d01a40e863b1fa0afb5a569a9eb66`

**Scope:** a real merge conflict arose against `main` after PR #430 (unassign action, already
merged) touched the same shared `work-item/index.ts`/`policy.ts` files this PR also touches.
An implementing lane resolved it via a genuine two-parent merge commit; this pass verifies
the resolution preserved both sides, not either PR's own design (already cleared separately).

**Verdict: CLEAR.** Confirmed a real merge (two parents: `79330d2` pre-conflict head,
`e6a4d95` main tip), not a squash/rebase. Rebuilt the automatic merge via `git merge-tree`
and confirmed the manual resolution differs from it only by adding the closing braces each
side's hand-edit needed — no substantive rewrite. Diffed against both parents directly:
zero deleted lines from `main` (this PR's 3 routes/policy entries are pure additions), and
zero deleted lines from the pre-conflict head except two import lines correctly subsumed by
main's own wider import (confirmed `membershipTable`/`personTable` still present) — #430's
unassign route/handler/policy entry is byte-for-byte unchanged. Confirmed 11 `createRoute`
definitions match 11 `.openapi()` registrations one-to-one, no duplicate registration, no
route commented out, no leftover conflict markers anywhere. Confirmed the committed
`openapi.json` matches what the resolved code actually generates (115 operations, no
hand-merge drift). Full suites reproduced on a fresh database: hierarchy+unassign together
(20/20), full integration (95 files/1284 tests), permissions (13/83), API unit (60/494),
`packages/permissions` (13/262), `packages/domain` (12/555) — all green. Typecheck clean
across all three `apps/api` tsconfigs.

**Note:** the branch is BEHIND `main` again (#438 merged after this resolution) — a further
branch update and reconfirmation is needed before merge, tracked separately.
