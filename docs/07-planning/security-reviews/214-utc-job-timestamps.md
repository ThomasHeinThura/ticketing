# Security review — PR #214 (issue #212: compare time-gated timestamps in UTC)

**Reviewed head:** `274c03ced5a147dc87189dffb4e0351c7dcf89b8`

Substantively reviewed at `be79b656c7ca7543839e0b669f63714a613ff91a`; clearance extended to
this head (a merge of `origin/main` into the branch, via an intervening note-only commit
`c4070bd` that recorded this review) by the same reviewer, who independently verified the
full `be79b65..9435ddc` diff touches exactly three files (`.husky/pre-commit`,
`docs/07-planning/status.md`, and this note) and confirmed all eight reviewed artifacts
(three source, three test, two doc files) are byte-identical by git blob hash. Also
re-confirmed at the new head in a fresh isolated worktree: `tsc --noEmit` clean, and the
four relevant integration test files — including `session-cleanup-purge.test.ts` — green
(4 files / 31 tests) under `Australia/Lord_Howe`/`Pacific/Kiritimati`. Issue #221
independently re-checked as accurately recording finding F2.

One further main-sync landed after that confirmation, at `9435ddc`, bringing in PR #217's
migration-comment edit (already independently proven comment-only by its own reviewer,
twice over) — no file shared with this PR. Re-checked directly by the orchestrating session
rather than a further reviewer round: `git diff 9435ddc24d9dc3730c2cd0b93f7e367beba037f4
274c03ced5a147dc87189dffb4e0351c7dcf89b8 -- apps/api/src/utils/db-time.ts
apps/api/src/scheduler/leader-lock.ts apps/api/src/scheduler/session-cleanup.ts
tests/api-integration/leader-lock.test.ts
tests/api-integration/session-cleanup-server-ahead-of-utc.test.ts
tests/api-integration/session-cleanup-server-behind-utc.test.ts` is empty.

## What this PR does

Fixes two places in the API that compared a `timestamp without time zone` column against
the database's bare `now()`, which is wrong whenever the database server's own timezone
isn't UTC: on `session-cleanup` this could **delete live sessions** when the server is
ahead of UTC; on `job_lease` the lease could **never expire** when the server is behind it.
Both are fixed by comparing against `now() AT TIME ZONE 'UTC'` (the `dbNowUtc()` helper in
`apps/api/src/utils/db-time.ts`) instead.

## Prior review round (ordinary tier)

One round already ran (Copilot/DeepSeek, not Claude), correctly deferred to Opus before
merge (the PR carried a `SECURITY REVIEW PENDING — OPUS CAPACITY` placeholder note rather
than a fabricated clearance). That round found the fix itself correct but broke
`leader-lock.test.ts`'s fixtures under non-UTC session timezones (the fixtures wrote
`now() +/- interval` coerced through the session `TimeZone` while the new predicate
compares UTC wall clock) — remediated and re-verified: full suite under `Asia/Kolkata` →
60 files/533 tests; targeted set under `America/Denver` → 12 tests. Also fixed: a comment
claiming wrapping a `timestamptz` was "harmless" when it shifts the boundary in both
directions; a comment crediting a nonexistent schema lint; and `background-jobs.md`
documenting a heartbeat/renewal that exists nowhere in the code (fixed to state design
intent, not current behavior — implemented verbatim, the old text would have re-introduced
this PR's own bug in the one statement whose job is to hold a lock).

## Mandatory Opus review (this pass)

**Verdict: CLEAR WITH FINDINGS — nothing blocks merge.**

Independently re-derived rather than accepted from the ordinary round:

- **Premise verified** against the installed `drizzle-orm` mapper code directly: both
  columns are genuinely `timestamp without time zone`, and better-auth's session writes go
  through this exact mapper.
- **Both predicates confirmed correct**: `dbNowUtc()` returns a parenthesized fragment (no
  misparse risk); `ttl` is a bound `interval`-cast parameter (no injection surface).
- **Same-pattern sweep**: a case-insensitive grep across the repo for every Postgres
  now-family function found no other bare-`now()`-vs-`timestamp`-column comparison.
  Specifically cleared `due-date-reminders.ts` as a plausible next candidate — confirmed a
  different, safe class (binds ISO strings via the query builder).
- **Independent adversarial run under a zone pair the ordinary round hadn't tried**: DB
  session `Australia/Lord_Howe` (+10:30, half-hour offset, DST zone), process `TZ=
  Pacific/Kiritimati` (+14) — full integration suite 60 files/533 tests, unit suite 48
  files/323, all green.
- **Non-vacuity independently proven**, not trusted from the PR's claim: reverted
  `dbNowUtc()` to `now()` in an isolated worktree — 4 tests went red, including the live
  session actually being deleted under the ahead-of-UTC case. Wrote and ran fresh probes (8
  concurrent `withJobLease` acquirers under non-UTC — exactly one wins; nested re-acquire of
  a live lease correctly refused; expiry lands within 2s of the expected UTC value) — all
  deleted after use.
- **Exact-head discipline verified substantively intact**: the ordinary round's recorded
  head is `a44b9b9`; the diff from there to this candidate touches only docblock comments in
  production source — no executable line changed. Test-fixture and doc changes were
  independently re-verified in this pass, not merely trusted.

**Findings, all non-blocking:**
- **F1**: `coding-standards.md`/`db-time.ts` name only 3 example `timestamp`-without-zone
  columns, but 100 of 102 timestamp columns in `schema.ts` are actually without time zone —
  the stated "exception" is the rule, which could lead a future reader to wrongly assume an
  unlisted column is safe to compare with bare `now()`.
- **F2**: the PR's "Not done" commits to a follow-up issue cataloguing the full latent
  population — filed as **#221**.
- **F3**: no mechanical guard exists for the `dbNowUtc()` convention (a sentence + docblock
  only); both current call sites have real regression tests, so this is a recommendation.
- **F4**: trivial — two new test files trigger a biome warning (not error) for an
  undeclared env var (`PGOPTIONS`) in `turbo.json`.
- **F5**: no lease renewal exists — pre-existing, carried by handler idempotence, confirmed
  the release is owner-scoped so no replica can delete another's lease.
