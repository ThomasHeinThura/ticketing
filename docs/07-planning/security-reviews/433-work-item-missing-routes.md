# PR #433 — work-item missing routes (issue #23)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (spawned as `pal-reviewer`; used
`pal-mcp`'s `coder` chain as a second pass on the four riskiest areas, but its expert-
synthesis step timed out twice at 300s — genuinely unreachable for that call — so the
verdict is the reviewer's own direct analysis, not an externally-validated `pal-mcp`
synthesis, per the documented fallback)
**Session:** subagent `a8e4b8743be83d280`

**Reviewed head:** `e41faab3367c8a7ea49469f0f63255addb5d1c2a`

**Verdict: APPROVE.** No high/critical findings; two low-severity, non-blocking notes (a
generic catch-all in bulk masking systemic vs. per-item failures; no test for ranking
against a concurrently-deleted neighbour). Full detail in the PR body's own "Reviewed by"
section.

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `aadab9fbe294cad04`

**Reviewed head:** `8366a30736f3eae5e82c6f331c857cb7870fae70`

**Verdict: BLOCKING.**

**F1 (BLOCKING, real, reproduced live):** bulk delete and bulk assign get around the
soft-deleted-project freeze (#202/#204's protection). `requireWorkItemReach()`
(`apps/api/src/work-item/require-work-item-reach.ts`) is the only place enforcing
`project.deletedAt IS NULL` for work-item routes. `deleteWorkItem` filters only on
key/workspace/own-`deletedAt`; `assignWorkItem` filters only on key/archived/own-`deleted`.
Neither checks the *project's* own deletion state. The bulk routes call these controllers
directly with `middleware: []`, so they never go through `requireWorkItemReach()`.

Confirmed by running it: after soft-deleting the project, single `DELETE
/api/work-items/{key}` correctly returns 404; bulk `delete` returns 200 with the item in
`succeeded`, and the row is stamped `deletedAt`; bulk `assign` returns 200 with the item in
`succeeded`, and the row's `assigneeId` changes. Test was run against a real, temporary
Postgres database and removed afterward; the scratch database was dropped. This also makes
bulk an existence oracle for items in soft-deleted projects within the caller's own
workspace (no cross-tenant exposure — same-workspace exposure only).

**Fix (required):** add the `project.deleted_at IS NULL` join directly inside
`deleteWorkItem` and `assignWorkItem` themselves — not just at the route/middleware level —
so every caller, including bulk, goes through it. Add a regression test in
`tests/api-integration/work-item-bulk.test.ts` asserting bulk delete/assign against an item
in a soft-deleted project fails with "Work item not found" and leaves the row unchanged.

**F2 (non-blocking, real):** bulk assign never succeeds on an already-assigned item, because
`expectedCurrentAssigneeId` is never passed to the internal compare-and-swap, which always
expects "unassigned." Fails closed (safe) but untested for the reassign case.

**F3 (non-blocking, real):** bulk takes `workspaceId` from the request body, which
`assertCallerHasCapability`'s own contract note says never to do — safe today only because
every per-item write independently filters on that same `workspaceId`; should be documented
as a load-bearing invariant for any future bulk operation.

**F4 (non-blocking):** internal-visibility activity rows will need portal-visibility
filtering once a real portal-caller identity exists — needs a tripwire/issue so it isn't
forgotten.

**F5 (non-blocking):** rank's neighbour lookup reads the whole project/state partition
instead of just the two named neighbour ids, and accepts archived items as neighbours —
inefficient, not a security issue.

**F6 (non-blocking):** a soft-deleted item's activity remains readable (200) — matches
pre-existing, documented `GET`-on-deleted-item behavior.

**Surfaces examined:** `delete-work-item.ts`, `assign-work-item.ts`, `bulk-work-items.ts`,
`require-work-item-reach.ts`, `rank-work-item.ts`, watch/unwatch controllers, the
activity-read controller, `policy.ts`'s new entries, and a live two-request race against a
real database reproducing F1.

Full test suites (integration: 98 files / 1300 tests; permissions: 12 files / 82 tests; API
unit: 60 files / 494 tests) all passed on the reviewer's own private `opus433_test`
database, since dropped.

A fix for F1 (required) is being commissioned as a delta, with F2/F3 addressed in the same
pass if cheap. F4/F5/F6 remain out of scope / correctly deferred, matching the reviewer's own
recommendation. A fresh Opus pass is required on the new head — this is a code-changing fix,
not a no-op mechanical reconfirmation.
