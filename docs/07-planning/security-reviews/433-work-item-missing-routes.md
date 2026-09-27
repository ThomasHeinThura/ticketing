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

---

## Security review — delta (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a88f2f71075bbc7a8`

**Reviewed head:** `8a2b2b880de0812a93a0aee45f43e0d21456fea3`

**Verdict: CLEAR WITH FINDINGS.** Neither finding blocks merge.

**F1 confirmed closed — reproduced live.** Wrote a temporary test against a private
`opus433d_test` database (`td-lane-pg`). After soft-deleting the project: bulk delete and
bulk assign both return 200 with the item in `failed` ("Work item not found"), an empty
`succeeded`, and the row genuinely unchanged (`deletedAt`, `assigneeId`, `version`,
`updatedAt` all identical to before; no per-item audit row written). Single-item routes
still correctly 404 — no regression. A mixed batch (one item in a live project, one in a
deleted project) resolves each independently. Control case (project still live) still
succeeds, confirming the failing case isn't failing by accident. Verified the fix is
actually what makes the difference: reverted both controllers to their pre-fix state,
confirmed the new regression tests then fail; restored the fix, confirmed they pass again.
Test file deleted and scratch database dropped afterward.

**N1 (non-blocking, new observation):** the fix's "read inside the same transaction"
framing doesn't actually make it race-free — this codebase runs at Postgres's default
READ COMMITTED isolation (confirmed: nothing overrides it; `delete-project.ts`'s own
comment says so), and a project soft-delete only writes the `project` row, never
`work_item`, so it isn't blocked by any lock the pre-check takes. In practice this is the
same window `requireWorkItemReach()` already has for single-item routes (it also checks
outside any transaction before the controller runs) — the fix doesn't create a new bypass
or make anything worse than the existing single-item behavior, it just doesn't add a
*stronger* guarantee than what already exists elsewhere. Optional hardening if ever wanted:
`.for("share", { of: projectTable })` on delete's pre-check; assign's pre-read would need
moving inside its transaction too. Not required now — matches existing codebase precedent.

**N2 (cosmetic, non-blocking):** `assign-work-item.ts`'s new comment says "no relations are
declared on these tables" — inaccurate (`workItemTableRelations` does declare `project`),
but doesn't affect behavior. Fix the comment wording next time this file is touched; not
worth a dedicated commit.

**F2 confirmed accurate:** bulk-assigning an already-assigned item fails closed (goes to
`failed`, original assignee unchanged) — correctly left as a documented design deferral, not
a bug.

**Full suites at this head:** work-item integration 18/18 files, 558/558 tests; full
integration 98/98 files, 1302/1302 tests (1300 + 2 new); permissions 12/12 files, 82/82
tests; API unit 60/60 files, 494/494 tests.

No new blocking finding. Clear to merge once ordinary CI is green.

---

## Re-confirmation after branch update (2026-09-27)

**Reviewed head:** `4061a8697b4aee93c64aed77851c674a0a8e7227`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. `git diff 8a2b2b880de0812a93a0aee45f43e0d21456fea3..4061a8697b4aee93c64aed77851c674a0a8e7227`
scoped to every file this PR touches is empty. The intervening commits are already-merged,
already-reviewed content from #416, #418, #423, #417, #419, #429 and #431 landing via
routine branch updates — confirmed each is an ancestor of `origin/main`. No new,
unreviewed logic reached this branch. (Verified from a worktree freshly reset via
`git reset --hard origin/<branch>`, not merely fetched — see PR #430's own note for why
this matters.)

---

## Security review — narrow verification of CI fixes (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `aa19ac272166a8a0c`

**Reviewed head:** `eb0f74e29b63700591d7cba764e67280d9ec7268`

**Scope:** narrow — verifying two CI-only fixes the orchestrating session made directly
(not an implementing lane) after `main`'s advancement surfaced two real, previously-latent
gaps in this PR's own content: a stale hardcoded event-key count and a never-regenerated
OpenAPI contract. Application feature logic (delete/rank/watch/bulk/activity-read
controllers) was NOT re-reviewed in this pass — untouched by this commit, already
CLEAR WITH FINDINGS from the prior full review cycle.

**Verdict: CLEAR.** Confirmed `work_item.deleted` was already documented in
`docs/01-architecture/events.md` before this PR (no doc change in this PR's diff);
confirmed `delete-work-item.ts` is the only new `publishEvent` call this PR adds; ran
`check-events.mjs` directly and confirmed it genuinely reports 28 keys across 316 files
(vs. 27/311 on `main`) and exits 0 — the file-count change proves it actually scanned the
real tree rather than short-circuiting. Ran the updated test (34/34 pass). Confirmed the
regenerated OpenAPI contract is derived from the real code (`check-openapi.mjs` without
`--write` matches, 117 operations) and adds exactly the 6 expected new operations with no
removals; `test-contract.mjs` reports 0 unapproved breaking changes, Redocly baseline
unchanged. Spot-checked two of the new operations' request bodies (rank, bulk) against the
real Zod schemas — both match. Confirmed the commit touches only the two intended files —
no application logic changed. Full gate-checker suite: 788/788 tests, 102 suites.

Clear to merge.
