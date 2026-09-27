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
