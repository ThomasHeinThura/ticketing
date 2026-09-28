# PR closing issue #276 — soft-deleted/archived work-item reach guard

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (spawned as `pal-reviewer`; `pal-mcp`
genuinely unreachable this session — `listmodels` and `challenge` both failed with "Invalid
request parameters", not a usage error — so this is the reviewer's own direct analysis, per
the documented fallback)

**Reviewed head:** `98ba8ff97d64d871bcb1502561adcee8335db899`

**Verdict: APPROVE WITH FINDINGS.** Confirmed the fix mechanism is correct: one shared
lookup in `requireWorkItemReach()` covers every single-item work-item route at once, and
correctly reasoned through Postgres `SELECT ... FOR UPDATE` row-locking semantics for why a
single check inside `update-work-item.ts`'s own transaction closes the reach-check-to-
transaction race (unlike the project's `deletedAt`, which lives on a different, unlocked
row and needs two checks). Independently corroborated the `archivedAt`/`deletedAt`-
equivalence judgment call by citing a pre-existing partial index in `schema.ts`
(`work_item_assigneeId_idx ... where archived_at is null and deleted_at is null`) that
already treats the two columns as equivalent.

One **Medium** finding (closed during this review): wanted direct confirmation that every
route claimed to share `requireWorkItemReach()` actually does, and that no restore/undelete
route exists that would need to bypass the guard. Confirmed directly against the actual
branch: `requireWorkItemReach()` is mounted on every single-item work-item route in
`apps/api/src/work-item/index.ts` (GET, PATCH, DELETE, assign, unassign, rank, parent
set/detach, tree, watch, unwatch, activity list, transition, transitions list, comment
create — 15 mount points) plus both attachment routes in `apps/api/src/attachment/index.ts`;
`grep -rniE "restoreWorkItem|undeleteWorkItem|unarchiveWorkItem|restore-work-item|undelete-
work-item|unarchive-work-item"` across `apps/api/src` returns nothing — no such route
exists for `work_item` anywhere in this codebase.

One **Low** finding, fixed at `8d1a290d`: the archived-item PATCH test didn't assert the
response body text the way the deleted-item test does — added for consistency.

## Security review

**Model:** Opus 5.5, fresh independent context, spawned separately from and never
orchestrating this change

**Reviewed head:** `98ba8ff97d64d871bcb1502561adcee8335db899`
**Reviewed head:** `8d1a290dd00b9cbf52973aa8a90bfb1036fc8fa8`

**Verdict: CLEAR WITH FINDINGS (non-blocking).**

Verified independently, in its own detached worktree and its own scratch Postgres
database (both removed afterward), without touching the shared checkout: the fix is
correct and complete for issue #276's own wording; enumerated every route mounted with
`requireWorkItemReach()` in both `work-item/index.ts` and `attachment/index.ts` and
confirmed each benefits; confirmed via grep that nothing writes `archivedAt`/resets
`deletedAt` for `work_item` anywhere, so tightening the middleware breaks no legitimate
caller; reasoned through this codebase's default READ COMMITTED isolation and reproduced
both lock orderings with two real concurrent `psql` sessions to confirm `update-work-
item.ts`'s single-check-location claim actually holds (no race window survives); confirmed
`bulk-work-items.ts` never reaches `updateWorkItem` and is unaffected; ran all 28
`work-item`/`attachment`/`comment` integration test files (640 tests) against a fresh
database, confirmed 5 of the new/rewritten tests fail against the base code with the fix
reverted (proving they test the fix, not vacuous assertions).

**F1 (Medium, non-blocking, outside #276's own scope):** `require-comment-reach.ts` and
`require-attachment-reach.ts` join through `work_item` but only filter
`isNull(projectTable.deletedAt)` — neither checks the work item's own `deletedAt`/
`archivedAt`. So `PATCH`/`DELETE /api/comments/{id}` and the attachment routes still reach
a soft-deleted work item's comments/attachments. Same class of gap as #276, one level down.
Filed as a follow-up (spawn-task `task_85b2cef4`); PRs #484/#483 appear to already be in
flight for this and the related F2 (see below), opened against issues #480/#481.

**F2 (Low, non-blocking, outside #276's own scope):** `set-work-item-parent.ts`'s parent-
row lookup doesn't check the proposed parent's own `deletedAt`/`archivedAt` — a live item
can be re-parented under a soft-deleted/archived one. `rank-work-item.ts:82` already guards
its own target row the same way. Filed as a follow-up (spawn-task `task_293464f0`).

**F3 (Info, non-blocking):** comment-create and watch still have a small window between
the middleware's check and their own write (no row lock the way `update-work-item.ts` now
takes). Lower severity than the PATCH case #276 named; no action required now.

**F4 (Nit, fixed at `8d1a290d`):** the watch regression test's title claimed the route "has
no independent guard of its own" — `watch-work-item.ts`'s own `resolveCallerPersonAndItem`
already checks `deletedAt` directly (just not `archivedAt`). Title corrected.

**Delta confirmation at `8d1a290d`:** the one commit landed after the first reviewed head
touches only two test files (the F4 title fix and the Low body-assertion fix above, three
lines total, no application code) — confirmed byte-for-byte by fetching and diffing the
branch directly, not from a pasted copy. Both changed test files re-run in a fresh worktree
against a fresh database: 32/32 pass. Verdict confirmed to still hold at this head.
