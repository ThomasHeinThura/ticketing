# Security review — parent_id write-path deadlock retry (#482, closes #295)

**Reviewer:** Opus 5.5, fresh independent context commissioned by the orchestrating session
(via the `Agent` tool, `model: opus`, subagent id `a5a6cd7f90e8f5e15`). Did not author,
direct, or remediate this change — every code edit in this pull request was made directly
by the orchestrating Claude Sonnet 5 session (see `## Implemented by` on the PR).
**Reviewed head:** `09469a9cc6a5a13d840d126d600d12f520d1509e`
**Pull request:** #482, branch `fix/295-parent-write-deadlock-retry`
**Base:** `11f328e1` (main's tip at the time of review, after PR #476 merged)
**Date:** 2026-09-28

## Scope

`apps/api/src/work-item/controllers/set-work-item-parent.ts`,
`apps/api/src/work-item/controllers/detach-work-item-parent.ts` (both in `ci-cd.md`'s
`apps/api/src/**/controllers/**` security-review-scope glob), plus the new
`apps/api/src/work-item/parent-write-deadlock-retry.ts` and the two new test files
(`tests/api/work-item/parent-write-deadlock-retry.test.ts`,
`tests/api-integration/work-item-parent-write-deadlock-retry.test.ts`). No other path is
touched by this pull request.

## What the pull request does

Closes issue #295: migration 0056's own SQL comment (`apps/api/drizzle/0056_lonely_gorilla_man.sql`)
records that the `work_item_claim_key` trigger (migration 0055, fires `BEFORE INSERT OR
UPDATE OF "key"`) and the `work_item_reject_parent_cycle` trigger (migration 0056, fires
`BEFORE INSERT OR UPDATE OF parent_id`) can deadlock each other (`40P01`) when one
transaction hits a genuine key collision while another concurrently runs a cycle check
that locks the same rows in the opposite order, and states that "whichever code builds
#23's actual write path must retry on `40P01` regardless of which trigger raised it."
`set-work-item-parent.ts` and `detach-work-item-parent.ts` (added by PR #432) are that
write path today, and neither had any such retry.

The fix adds `runWithParentWriteDeadlockRetry` (new file), reusing
`transition-work-item.ts`'s own `isPostgresDeadlockError` predicate (added for a
different, earlier deadlock between that route and `set-work-item-parent.ts`, Opus
review of PR #457 D2/D3) rather than a second copy of that cause-chain walk. Both
controllers now wrap their ENTIRE `db.transaction(...)` call in this retry, bounded to
4 total attempts (1 first try + 3 retries), retrying only on a genuine `40P01` and
rethrowing any other error (including every ordinary `HTTPException` — 404/400/422/409 —
these routes already throw for their own control flow) immediately, unretried.

## Review

**Verdict: CLEAR WITH NON-BLOCKING NOTES.** No blocking findings.

Confirmed directly, by reading the actual file content rather than trusting the PR
description:

- Wrapping the whole `db.transaction` callback (not just the final `UPDATE`) is the
  correct shape: a `40P01` aborts the entire Postgres transaction, so `db.transaction`
  opens a genuinely new transaction on retry and every read re-runs from scratch (the
  locked re-read, the ancestor-chain/depth check, and — in `set-work-item-parent.ts` —
  the `pg_advisory_xact_lock`, which is transaction-scoped and is correctly re-acquired
  fresh each attempt, not held stale across a failed attempt).
- `publishEvent(...)` and the activity-row write both sit inside (activity) or after
  (the event) the retry-wrapped transaction resolves, in both controllers — a retry can
  never cause a write to apply twice, an activity row to double-write, or a duplicate
  event to publish. Traced Drizzle 0.45.2's actual transaction/rollback implementation in
  `node_modules` directly to confirm a thrown `40P01` inside the callback fully rolls
  back the transaction before `runWithParentWriteDeadlockRetry`'s `catch` ever sees it.
- `isPostgresDeadlockError`'s cause-chain walk correctly returns `false` for every
  `HTTPException` these two routes throw for ordinary control flow (404/400/422/409) —
  none of these carry a `.code`/`.cause.code` of `40P01` — so the retry can never
  misclassify a normal rejection as a retryable deadlock. It also correctly matches a
  genuine `40P01`, whether raised directly by the driver or wrapped by Drizzle's own
  `DrizzleQueryError` (`.cause.code`).
- No retry-storm/denial-of-service concern at this bounded attempt count and this
  narrow, transient condition.
- `set-work-item-parent.ts`'s existing `WORK_ITEM_HIERARCHY_LOCK_NAMESPACE` advisory
  lock's existing safety argument (project-scoped `pg_advisory_xact_lock`, serializing
  reparents within one project) is unaffected by the retry: each attempt re-acquires it
  fresh as the first statement of its own new transaction, exactly as before this change,
  never held across attempts.
- Read both new test files in full. The integration test's two-session, raw-`pg`-client
  construction is a genuine (not staged) circular wait, verified against the actual
  trigger SQL directly: T1 claims a key then blocks on `root`'s ancestor lock; T2 locks
  `root` then blocks on the key-claim row T1 holds. Verified the final assertions hold
  correctly under EITHER possible deadlock-victim outcome, not just one.
- Ran the full targeted suite three times for stability: 10/10 unit
  (`parent-write-deadlock-retry.test.ts` + `transition-deadlock.test.ts`), 27/27
  integration (this PR's two new tests plus `work-item-parent-cycle-guard.test.ts`,
  `work-item-hierarchy.test.ts`, `work-item-transition.test.ts`), clean `tsc --noEmit`.
  No flakes across three runs.
- **Mutation test, not merely a passing suite:** set `MAX_ATTEMPTS = 1` in
  `parent-write-deadlock-retry.ts` and reran — the main deadlock-retry integration test
  correctly failed (no retry available, the deadlock-losing side surfaced its raw
  `40P01`), while the unwrapped "sanity check" control test still passed unchanged (it
  never used the retry helper in the first place). Restored the file to its original
  state afterward. This is a real fail-before/pass-after demonstration of the fix, not
  just green CI.

Five non-blocking notes (N1–N5):

- **N1 (low)** — the deadlock proof is at the helper level, via a hand-built two-session
  transaction, not through the actual HTTP routes — because today's routes literally
  cannot trigger this exact cross-trigger deadlock through normal use (see N2).
  Disclosure only, no fix needed.
- **N2 (low, worth a doc note)** — read the two trigger function bodies directly:
  neither `set-work-item-parent.ts` nor `detach-work-item-parent.ts` can actually reach
  the documented key-collision deadlock today. Neither route's own write ever touches
  `key` (so neither can independently fire `work_item_claim_key`'s side of the race), and
  `detach-work-item-parent.ts` sets `parent_id` to `NULL`, which `work_item_reject_parent_cycle`
  explicitly short-circuits on (`IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;`)
  before taking any ancestor lock at all. The retry still correctly covers whatever
  `40P01`s these two routes CAN hit today (e.g. a real deadlock between
  `set-work-item-parent.ts` and itself or against `transition-work-item.ts`'s own lock
  order), and the fix becomes load-bearing for the EXACT documented scenario the moment a
  future create/update slice (issue #26) lets a caller set `parentId` directly on
  insert/rekey. Not a defect — correct, forward-looking coverage, not closure of an
  actively-reachable path today. Worth a one-line note on issue #26 that any future such
  slice must reuse this same shared helper rather than inventing its own retry.
  (Independently reached by the ordinary `pal-reviewer` review too, via the same
  trigger-SQL trace — see the PR's `## Reviewed by` section.)
- **N3** — the integration test file's own header comment already discloses that it does
  not model a true identical-retry collision (retrying with the exact same colliding key
  after a rollback); no action needed beyond the existing disclosure.
- **N4 (optional)** — the new helper imports `isPostgresDeadlockError` from a controller
  module (`transition-work-item.ts`) rather than a shared `utils/` location. Suggest
  relocating it to `utils/is-deadlock.ts` next to `is-raise-exception.ts`/
  `is-unique-violation.ts` for a cleaner dependency direction (a `utils/` module
  importing from `controllers/` is backwards). Optional, not required — no behavioural
  change either way, and it would touch an already-reviewed, unrelated file for no
  functional gain.
- **N5** — no backoff/jitter between the bounded retry attempts. Fine as-is given the
  narrow, transient nature of this specific deadlock and the very small fixed attempt
  count; would be worth revisiting only if this condition becomes materially more
  frequent (e.g. once a bulk-import path exists — migration 0056's own comment already
  flags bulk multi-row inserts as order-sensitive across the two triggers, OS3/OS4).

## Authorship

Every line of every diff on this branch was written directly by the orchestrating Claude
Sonnet 5 session's own `Edit`/`Write` tool calls. No implementation step used `pal-mcp`.
