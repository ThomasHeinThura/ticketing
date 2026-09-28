# PR #487 — set-parent's SUBJECT-item deleted/archived guard (issue #486)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (spawned as `pal-reviewer`; fell back
from `pal-mcp`'s `coder` chain to a direct Sonnet review because `pal-mcp`/9Router was
unreachable for this review — the same outage affecting other reviews the same day,
recorded per the model-tier fallback rule rather than guessing)
**Session:** subagent `a5f90cda5b61462cf`

**Reviewed head:** `44f4548f6780844d4f630498e4de09f1c5be46c2`

**Verdict: clear with findings (non-blocking).** Confirmed against the real schema
(`database/schema.ts:2310-2311`) that `archivedAt`/`deletedAt` are nullable `Date` columns,
so the new condition can only reject a genuinely soft-deleted/archived row, never a live one
— no false-positive path. Gave a precise account of why the `FOR UPDATE` lock closes the
race with no residual window: either the concurrent delete already committed before this
transaction's locked read returns (in which case the new guard catches it), or the delete's
own transaction blocks on the advisory lock/row lock until this transaction commits first
(correct serialization order, not a race either way). Noted the asymmetry with the
project-level check — the project row is never row-locked here, so `projectNotDeleted` is
deliberately re-checked again in the final `UPDATE`'s `WHERE` clause — is pre-existing
behavior this PR doesn't need to touch. Confirmed the new test genuinely bypasses
`require-work-item-reach.ts`: it calls `setWorkItemParent` directly, so no Hono middleware
runs, meaning the 404 it asserts can only come from the new transaction-internal guard, not
the pre-existing middleware check — a non-vacuous test of the guard this PR adds.

**Finding (non-blocking, already addressed):** the new doc comment's "matching #481's own
guard on the parent lookup just below" referenced PR #483, which had not yet merged when
this branch was written. Confirmed (by the orchestrating session, directly, against
`origin/main`) that PR #483 merged as `bbc50708` before this review completed, so the
comment is accurate as of now — nothing to change.

**Also raised, and resolved:** whether this PR genuinely needed security-review-scope
treatment at all. Moot — `apps/api/src/work-item/controllers/**` is on `ci-cd.md`'s
security-review-scope path list, and the mandatory Opus pass below already ran and cleared
it regardless.

## Security review (mandatory, Opus)

**Model:** Opus, fresh independent context, did not author or orchestrate this change
**Session:** subagent `a3e5f27f044517159`

**Reviewed head:** `44f4548f6780844d4f630498e4de09f1c5be46c2` (merge-base `74239ddb` at
review time; `main` has since advanced to `bbc50708` via PR #483 — a textual, non-conflicting
gap in the parent-lookup lines a few lines below this change, not this diff's own lines;
left for the orchestrating session's final gate verification to reconcile before merge)

**Verdict: clear**, with one non-blocking follow-up finding filed separately (below).

- Confirmed the guard can't false-positive: `archivedAt`/`deletedAt` are `Date | null`,
  truthy only when actually set.
- Confirmed the race is genuinely real, not theoretical: traced that `delete-work-item.ts`
  sets `deletedAt` **without** bumping `version`, so the existing optimistic-concurrency
  version check could never have caught this on its own.
- Traced the READ COMMITTED interleaving both directions (delete-in-flight vs.
  delete-already-committed relative to this transaction's locked read) and confirmed the
  new guard closes the race either way.
- Confirmed statement ordering is optimal: the guard runs immediately after the lock and the
  locked re-read, before every other read (`projectAlive`, the parent lookup) and before any
  write — a rejected attempt does no wasted work and leaks nothing extra.
- Confirmed no bad interaction with `runWithParentWriteDeadlockRetry`: the thrown
  `HTTPException` is rethrown immediately, never treated as the retryable `40P01` case, and
  a genuine retry re-runs this same read against fresh post-rollback state regardless.
- Confirmed no new enumeration leak: same 404 status and message as every other "not found"
  outcome on this route.
- Confirmed the new test is non-vacuous: the outer `pre` read (used only to pick the
  advisory-lock namespace) does not filter `deletedAt`/`archivedAt`, and the direct
  controller call bypasses `require-work-item-reach.ts` entirely, so the test's 404 can only
  come from the new transaction-internal guard.

**Follow-up finding (F1, low, non-blocking, correctly out of scope for this PR):**
`detach-work-item-parent.ts` has the identical gap — `if (!item)` after its own
`.for("update")` read, no `archivedAt`/`deletedAt` check, same root cause (a soft-delete
does not bump `version`). Impact is data-integrity only (the caller already had real
authorization on the item), not an authorization bypass. Filed as its own follow-up issue
by the orchestrating session rather than folded into this PR.

**What was reviewed:** the pasted diff, the full resulting `set-work-item-parent.ts`, and
the full new test, all checked against this session's own understanding of the live schema
and the sibling `delete-work-item.ts`/`update-work-item.ts`/`require-work-item-reach.ts`
behavior described in the review prompt. Not independently re-run in a fresh checkout by
this Opus session; the orchestrating session's own local test run (13/13 pass with the fix,
confirmed to fail without it) was taken as given and cross-checked for internal consistency
rather than re-executed.

---

## Mechanical reconfirmation after merging main past PR #483 (9012c75c)

**Confirmed by:** the orchestrating session, directly — not a fresh Opus pass.

**Why this needed more than a disjoint-file check:** PR #483 (issue #481's parent-side
guard, merged `bbc50708`) touches the same file this PR changes,
`apps/api/src/work-item/controllers/set-work-item-parent.ts` — a real content overlap, not
just two branches touching unrelated files. This branch was updated with `main` (merge
commit `9012c75c`); the merge was automatic, no textual conflict (the two guards sit on
different lines of the same function).

**Verified beyond a diff check:** confirmed via direct grep that both guards are present in
the merged file — `if (!item || item.archivedAt || item.deletedAt)` (this PR's subject-item
guard, line 126) and `if (!parent || parent.archivedAt || parent.deletedAt)` (PR #483's
parent guard, line 154). Ran the real test suite in a fresh worktree against a private
Postgres database (`wt487_test` on `td-lane-pg`, dropped afterward):
`work-item-hierarchy.test.ts` — **15/15 pass**, covering both PRs' regression tests together.

**Verdict:** both reviews above (ordinary and Opus, at `44f4548f`) remain valid at `9012c75c`.
This is a stronger basis than the usual disjoint-file argument: it's a real, passing test
run of the actual merged code.

**Reviewed head:** `9012c75c49acacb549df5ba16017c1a6f17cc1f0`

---

## Mechanical reconfirmation after merging main past PR #484 (9904cfe0)

**Confirmed by:** the orchestrating session, directly.

**What happened:** `main` advanced to `c503301a` (PR #484, issue #480's fix) after the last
reconfirmation. This branch was updated with `main` (merge commit `9904cfe0`).

**Verified directly:** `git show c503301a --stat` touches
`require-attachment-reach.ts`, `require-comment-reach.ts`, and their test files — none of
which is `set-work-item-parent.ts`, the file this review covers.

**Verdict:** both reviews above remain valid at `9904cfe0`.

**Reviewed head:** `9904cfe073dd9fbcecaf46db997b02b1d33182b0`
