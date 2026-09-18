# Pre-merge security review — PR #214 (UTC timestamps for the time-gated jobs)

**Reviewed head:** none — **no security review has been performed**, so this field cannot be filled honestly. `check:pr-template` requires a forty-character SHA here and rejects a note without one, which means the required `pull request template + security review` check on PR #214 is **correctly red** and must stay red until an Opus review runs and writes its verdict below. Do not "fix" that red by inventing a head, and do not weaken the gate to let a pending note pass.

## Status: SECURITY REVIEW PENDING — OPUS CAPACITY

**This is not a security review.** It is the record the pull-request template requires, filed
in advance so the review has a home and so the gap is visible rather than implied. It asserts
nothing about the change's security properties.

**Why it is pending.** This change is in security-review scope: the classifier reaches it
through `apps/api/src/utils/**` and `apps/api/src/scheduler/**`. `AGENTS.md` and `CLAUDE.md`
require an independent **Opus** pass. Claude is currently unavailable, and `CLAUDE.md` is
explicit: *"Capacity exhaustion means wait, not substitute."* The candidate waits, marked,
rather than being downgraded or cleared by a context that is not independent.

**What must not happen to this branch in the meantime:** it must not be merged, and the
Opus security-review checkbox must not be ticked.

## What the ordinary review did and did not cover

It ran in a GitHub Copilot context (DeepSeek V4.1 Flash) — **not Claude**; the real model is
named in the pull request because recording it is required. It is not a security review.

**Verdict: BLOCKING**, remediated. It confirmed the production fix correct — `deleteExpiredSessions`
and `withJobLease` behave correctly with the database ahead of and behind UTC, with a differing
process `TZ`, and with a `Date.now()+6h` skew; a 1500 ms lease was stored, held, skipped and
taken at the right instants — and then found the repository's own integration suite **red
whenever the database session timezone is not UTC**, because the *fixtures* still wrote
session-local `now()`. Both directions were reproduced (`Asia/Kolkata` and `America/Denver`,
failing opposite tests) and both are green at this head.

## What an Opus reviewer should examine first

Named so the pass starts from the risk rather than the diff:

1. **The lease predicate is a concurrency control, not merely a timestamp comparison.**
   `job_lease."expires_at" < dbNowUtc()` decides whether a replica may run a job another
   replica may still be running. Confirm that under a database ahead of *and* behind UTC,
   and that nothing else in the acquire/insert/delete path re-introduces a second clock.
   Note there is **no renewal** — a handler that outlives `leaseMs` is unprotected, so the
   correctness of the lease depends on handler idempotence, which this PR does not change.
2. **`dbNowUtc()` is a convention with no enforcement.** Nothing in `scripts/ci/` prevents a
   new `now()` comparison against a `timestamp` column. The helper's docblock now carries the
   measured counter-example for `timestamptz` (wrapping one shifts the boundary by the session
   offset in both directions), but a docblock is not a gate — judge whether one is needed
   before more time-gated jobs are written.
3. **The class is far wider than this PR.** 35 `timestamp` columns in `schema.ts` carry
   `defaultNow()`, and `migrate-notification-preferences-schema.ts` has twelve
   `DEFAULT now()` occurrences. None is compared against `now()` today (grepped), so all are
   latent — but #198 adds a job that deletes far more than sessions, and a latent
   wrong-clock default in a destructive job is a data-loss primitive. Decide whether the
   full set needs a follow-up issue before #198 lands.
4. **`invitation.created_at`** is the one concrete instance: defaulted to `NOW()` on a
   `timestamp` column at `apps/api/src/utils/migrate-session-column.ts:112` and
   `apps/api/drizzle/0007_careful_moira_mactaggert.sql:45`. Latent at UTC, 5.5 hours wrong
   under `Asia/Kolkata`.
5. **Does correcting `background-jobs.md` create a false impression?** This PR changed that
   document's `expires_at` type, its acquire SQL, and relabelled an unimplemented
   heartbeat/renew as design intent. Confirm the file now describes what the code does.

## Reviewer instruction

Replace this file's status with a real verdict, name the exact reviewed SHA, state what was
checked (not merely read), and record any blocking finding.
