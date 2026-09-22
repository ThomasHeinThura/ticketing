# Security review — PR #225 (issue #17: revoke sessions minted before the MCP OAuth / device flows were removed)

**Reviewed head:** `b6565835fb2101db09be8399e587fa1fadd59dbf`

Reviewer: Opus 5, fresh independent context. Did not author, direct, or remediate this
change. Reviewed in an isolated worktree checked out at the exact head SHA above, against a
dedicated `opusrev225_test` Postgres database — not against `main`, and not by reading the
PR body.

Merge-base with `main`: `cd21e5a7def504af84d1fe2dcea1553c92a96d65`. `main` at review time:
`665ceb4`.

## What this PR does

Adds one hand-written, data-only migration
`apps/api/drizzle/0060_revoke_pre_oauth_removal_sessions.sql`:

```sql
UPDATE "session"
SET "expires_at" = "created_at"
WHERE "created_at" < TIMESTAMPTZ '2026-09-07T09:15:26Z';
```

plus its snapshot/journal metadata and a 7-case integration regression test. No schema
change, no route, policy, or handler code touched.

---

## Findings, in the order verified

### 1. The cutoff timestamp — VERIFIED CORRECT

`git show -s b75cf02` in the isolated checkout:

```
b75cf02816596fc2ae103e85f79888546d5df15d
2026-09-07 15:45:26 +0630
Merge pull request #16 from ThomasHeinThura/feat/p0-remove-inherited-surfaces
```

- **+06:30 → UTC conversion:** `15:45:26 − 06:30 = 09:15:26` UTC, same day. Correct.
- **Both flows really left in this merge**, not one earlier and one later. `git show --stat
  b75cf02` deletes `apps/api/src/mcp/oauth.ts` (135 lines), `apps/api/src/mcp/oauth-store.ts`,
  `apps/api/src/mcp/controllers/oauth-consent.ts`, `apps/web/src/routes/mcp.authorize.tsx`,
  and `packages/mcp/src/auth/device-flow.ts`. The first-parent diff of
  `apps/api/src/auth.ts` in the same merge removes the `deviceAuthorization` import and its
  `deviceAuthorization({ … })` plugin registration (and, incidentally, `anonymous()`,
  `bearer()` and `openAPI()` — all covered by the same cutoff for free).
- So the cutoff is the *later* of the two removals, which is what a blanket time bound
  requires. Using an earlier instant would have under-invalidated.

### 2. The no-distinguishing-column claim — VERIFIED CORRECT

`sessionTable` in `apps/api/src/database/schema.ts` at this head has exactly:
`id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id,
active_organization_id, active_team_id, impersonated_by`. No `provider`, `auth_method`,
`origin`, `client_id`, or equivalent.

Checked the whole migration history too, not just current schema: `grep 'ALTER TABLE
"session"' apps/api/drizzle/*.sql` shows every column `session` has ever gained
(`0003`: token/created_at/updated_at/ip_address/user_agent; `0004`/`0005`:
active_workspace_id/active_team_id; `0007`: rename to active_organization_id; `0031`:
impersonated_by). None is an origin discriminator, and none was ever dropped. The claim
holds for every point in the table's history, not just today.

Confirmed the removed code's own behaviour rather than trusting the PR: `git show
fc34d20^:apps/api/src/mcp/oauth.ts` line 125 inserts
`{ id, token, userId, expiresAt, createdAt, updatedAt }` — no `ip_address`, no
`user_agent`, no marker of any kind. The device flow was better-auth's own
`deviceAuthorization()` plugin, minting through better-auth's internal session path, so
TaskDesk route code never had a hook to tag those rows either.

### 3. Narrower scoping — considered and correctly rejected

I looked for a narrower predicate rather than accepting the PR's reasoning:

- **`ip_address` / `user_agent`:** the MCP consent flow's insert left both NULL, so
  "NULL ip_address" looks like a signal — but it is a *weak* one in the unsafe direction.
  Better-auth's device-flow path populates them from the polling client, so filtering on
  NULL would have **missed every device-flow session**. Both columns are also
  client-controlled and therefore unusable as a security predicate.
- **A surviving side table:** there is none. `mcp_oauth_state` and `device_code` were the
  flows' only state, and `0048`/`0049` dropped them (`DROP TABLE … CASCADE`) — the very
  fact that created this issue. `grep 'pgTable("(oauth|device|mcp)…"' schema.ts` returns
  nothing; no `oauth_application` / `oauth_access_token` table exists in this codebase.
- **`account.provider_id`:** records linked external identity providers, not which flow
  minted a given `session` row, and has no join to `session` beyond `user_id`. Useless here.

Conclusion: no narrower scoping is available from data that actually exists. The blanket
time bound is the only sound predicate, and the PR's reasoning on this point is complete.

### 4. Is "expire everyone before the cutoff" the right boundary?

**Direction of error is correct.** Over-invalidation costs a re-login; under-invalidation
leaves a live credential minted by a flow that was removed *because* it was unsafe (`0049`'s
own comment: the device flow "laundered an API key into a session token that OUTLIVED the
key's own revocation"). Erring wide is right.

**Blast radius is genuinely near-zero here.** Verified rather than assumed: session rows are
better-auth's 30-day sessions, and the cutoff is 2026-09-07 — more than 15 days before
today (2026-09-22). Any pre-cutoff session in a real database is within days of expiring on
its own regardless. `status.md` and the decision log confirm no live deployment has ever run
this codebase. So the real-world false-positive population is "whatever a stale dev/CI
database holds", not a customer's logged-in users.

**Expire-not-delete is the right call** and I re-derived why: `auth.ts` has
`cookieCache` disabled, so better-auth re-reads `session` on every request and an expired
row is refused on the next request with no code change; the row's `created_at` /
`ip_address` / `user_agent` survive for `session-cleanup`'s normal purge and for
investigation; and nothing is destroyed, so no `legal_hold` interaction (PR #208) has to be
reasoned about. A `DELETE` would have needed that reasoning and would have been strictly
worse.

### 5. Migration numbering, journal and snapshot chain — VERIFIED CLEAN

- `_journal.json` gains exactly one entry: `idx 60`, `version "7"`,
  `tag "0060_revoke_pre_oauth_removal_sessions"`, `breakpoints true`, appended after `idx 59`.
  Nothing else in the journal changed.
- `0060_snapshot.json`'s `prevId` = `3973c3fc-6241-4426-b952-ede43b230a3f` = `0059_snapshot.json`'s
  `id`. Chain correct.
- `0060_snapshot.json` is byte-equivalent to `0059_snapshot.json` in every key except
  `id`/`prevId` (compared key by key, JSON-normalised). That is exactly right for a
  `--custom`, data-only migration and proves nothing was hand-edited into the schema model.
- `0059_work_item_integrity_checks.sql` and `0059_snapshot.json` are untouched by this PR
  (empty `git diff` against the merge-base), so #215's migration is intact.
- `drizzle-kit check` in the isolated checkout: **`Everything's fine 🐶🔥`**.
- `drizzle-kit migrate` against a clean `opusrev225_test`: all 61 migrations applied, no error.
- `drizzle-kit generate` afterwards: **`No schema changes, nothing to migrate 😴`** — no drift
  between `schema.ts` and the snapshot chain. Working tree left clean.

### 6. Regression test — RUN, PASSES, AND SURVIVES MUTATION

Run by me at this head, against my own `opusrev225_test` on `td-lane-pg` (port 55440):

```
vitest run --config vitest.integration.config.ts ../../tests/api-integration/session-oauth-removal-revocation.test.ts
Test Files  1 passed (1)
     Tests  7 passed (7)
```

The test reads and executes the **shipped `.sql` file**, not a restatement, so it cannot
drift from the artifact. I mutated the shipped SQL five ways and re-ran each; every mutation
was caught:

| Mutation | Result |
| --- | --- |
| `<` → `<=` (at-cutoff row now expired) | 1 failed / 6 passed |
| `<` → `>` (inverted) | 5 failed / 2 passed |
| `WHERE` clause deleted (expire everything) | 4 failed / 3 passed |
| cutoff `09:15:26Z` → `15:45:26Z` (the un-converted local time) | 2 failed / 5 passed |
| `SET expires_at = created_at` → `= now()` | 3 failed / 4 passed |

Original file restored; `git status` clean afterwards. **Idempotency** is genuinely proven —
the test runs the migration twice and asserts identical `expires_at` on both a pre- and a
post-cutoff row — and holds by construction anyway (the statement assigns a column to itself-
derived value; a second pass assigns the same value). The boundary is strictly `<`, so a row
created *at* the cutoff instant is left alone, and the test asserts that in both directions
(exactly-at, and one second either side).

### 7. Diff scope — VERIFIED CORRECT

`git diff cd21e5a..b656583 --stat`: 4 files, all additions, nothing else.

```
apps/api/drizzle/0060_revoke_pre_oauth_removal_sessions.sql   |   52 +
apps/api/drizzle/meta/0060_snapshot.json                      | 5333 +
apps/api/drizzle/meta/_journal.json                           |    7 +
tests/api-integration/session-oauth-removal-revocation.test.ts|  191 +
```

No source file, no route, no policy, no dependency, no lockfile. One commit, conventional.

---

## BLOCKING FINDING — the cutoff comparison is time-zone dependent, in the unsafe direction

**`session.created_at` is `timestamp without time zone`. The migration compares it against a
`TIMESTAMPTZ` literal. That coerces the column through the database server's `TimeZone`
setting, and on a server behind UTC it silently leaves genuinely pre-cutoff sessions live.**

Verified against the live table, not inferred:

```
\d session
 expires_at | timestamp without time zone
 created_at | timestamp without time zone
```

The values in that column are **UTC wall clock** — Drizzle writes them through
`PgTimestamp.mapToDriverValue` → `toISOString().slice(0,-1)` (confirmed in the installed
`drizzle-orm/pg-core/columns/timestamp.js:68`) and reads them back re-attaching `+0000`. So
`"created_at" < TIMESTAMPTZ '…'` makes PostgreSQL reinterpret a UTC wall-clock value as
*local* time in the server's `TimeZone`, and the boundary slides by the server's offset.

Proved end to end against `td-lane-pg`, running the migration's exact statement inside a
rolled-back transaction, with two seeded rows: `s-pre` at `2026-09-07 06:00:00` (3h15m
**before** the cutoff — squarely inside the window the removed flows still existed) and
`s-post` at `2026-09-07 14:00:00` (4h45m **after** it):

| Server `TimeZone` | `s-pre` revoked? | `s-post` revoked? | |
| --- | --- | --- | --- |
| `Etc/UTC` (this container's default) | yes | no | correct — the only case the test suite exercises |
| `America/New_York` | **NO** | no | **under-invalidation — a live session the fix exists to kill survives** |
| `Asia/Yangon` | yes | **YES** | over-invalidation — a post-cutoff session is wrongly killed |
| `America/New_York`, naive literal (proposed fix) | yes | no | correct |

This is not a hypothetical. It is **a defect class this repository has already converted into
a rule, a named helper and two regression tests**, and this migration reintroduces it on the
same table:

- `docs/04-engineering/coding-standards.md` § Database, lines 181–191: *"Some columns predate
  that rule and are `timestamp` (without time zone) — **`session.expires_at`**, … Those hold
  UTC wall clock … **Compare such a column with `now() AT TIME ZONE 'UTC'`, never with a bare
  `now()`** … **Nothing in `Dockerfile`, `deploy/` or `charts/` pins the server's `TZ`.**"
- `apps/api/src/utils/db-time.ts` exists solely for this, with the measurement written out.
- `apps/api/src/scheduler/session-cleanup.ts` calls `dbNowUtc()` and explains at length that
  the unqualified form "is the one place in the tree where that mistake destroys rows".
- `tests/api-integration/session-cleanup-server-{ahead,behind}-utc.test.ts` pin both
  directions by setting the session `TimeZone`.

The new regression test cannot catch this: it runs only against `td-lane-pg`'s `Etc/UTC`
default, so all 7 cases pass with the defect present — as they did for me.

Severity: this is the *only* thing the migration does, and its entire premise (stated in its
own comments) is that missing one row is the unacceptable direction. On a US-hosted Postgres
the last 4–5 hours of pre-removal sessions — including any minted by the device flow, which
`0049` records as laundering an API key into a token that outlived the key's revocation —
would remain valid. That is the exact failure this migration was written to close.

### What would fix it

Two lines, both proven above:

1. **Compare `timestamp` against `timestamp`.** Change the predicate to a naive literal in
   the column's own UTC wall-clock convention:

   ```sql
   WHERE "created_at" < TIMESTAMP '2026-09-07 09:15:26'  -- UTC wall clock; see coding-standards.md § Database
   ```

   (Equivalently `WHERE "created_at" AT TIME ZONE 'UTC' < TIMESTAMPTZ '2026-09-07T09:15:26Z'`,
   which is more self-documenting. Either is `TimeZone`-independent; I measured the first.)
   Add a comment line saying *why*, since the current comment block explains everything else
   about this statement but not this.

2. **Add the regression case that would have caught it**, mirroring
   `session-cleanup-server-behind-utc.test.ts`: seed a row a few hours before the cutoff, set
   the session `TimeZone` to `America/New_York`, run the shipped migration, assert the row is
   expired. Without it, the same mutation is uncaught next time — and my mutation table above
   shows every *other* way to get this statement wrong is already pinned.

---

## Non-blocking observations (fix if convenient, not merge-blockers)

- **The cutoff is "when the code left `main`", not "when every instance stopped serving it."**
  A deployment running the pre-`b75cf02` image after the merge could still mint an affected
  session, and the migration would leave it alone. Harmless today — `status.md` and the
  decision log confirm no deployment has ever run this codebase, which I checked rather than
  assumed — but if that ever stops being true, the cutoff should be the last redeploy, not the
  merge. Worth one sentence in the migration's comment block so a future reader does not have
  to re-derive it.
- **`<` vs `<=` at the exact cutoff instant** is a microsecond-wide window, and the test pins
  `<` deliberately. `<=` would be marginally safer for the same reason as the point above and
  costs nothing, but I do not consider the current choice wrong.
- The PR body's "**Reviewed by**" section records the *orchestrating* session as the
  independent ordinary reviewer. `CLAUDE.md` requires a fresh, independent context for the
  ordinary review, and a context that directed or remediated the work (this one renumbered
  the migration itself) is explicitly not eligible to clear it. Flagging for the merging
  session's own gate check; not mine to adjudicate, and it does not change this verdict.

## What I did not do

- I did not run the full `apps/api` integration suite (62 files / 561 tests) or the unit
  suite. The PR's counts are unverified by me; I ran only the migration's own 7-case file,
  plus five mutations of it. The change touches no source file, so suite-wide regression risk
  is low, but the claim is not independently confirmed here.
- I did not run `lint`, `typecheck`, or check GitHub status checks — those are the merging
  session's gate check, not the security pass.
- I did not review `0059_work_item_integrity_checks.sql` itself; I only confirmed this PR
  leaves it untouched.

---

## Verdict

**CHANGES NEEDED (blocking).**

Everything the PR claims about the cutoff instant, the absence of a distinguishing column,
the unavailability of a narrower predicate, the expire-not-delete judgment, idempotency, the
boundary side, the `0059` → `0060` renumbering and the snapshot/journal chain is **true and
independently verified**. The reasoning is unusually thorough and the regression test is
genuinely mutation-resistant.

But the single statement this migration exists to run is time-zone dependent against a
`timestamp without time zone` column, and on a Postgres server behind UTC it fails in the
under-invalidation direction — leaving live exactly the sessions the fix is for. This
repository already has a written rule, a helper and two regression tests for this precise
defect; the migration does not follow them and the new test does not cover it.

Re-review required at the new head after the predicate is changed and the behind-UTC
regression case is added. Both are small; I expect a single follow-up pass to clear it.

---

# Delta confirmation — 2026-09-22 — reviewed head moved to `1641f1e`

**Reviewed head:** `1641f1e3fe7f1a23389c79366d05aad3f1624aba`

Reviewer: Opus 5, a fresh independent context — **not** the context that produced the
CHANGES NEEDED review above, and not the context that authored, directed or remediated the
fix. Everything above this line is the historical record of what was found at
`b6565835fb2101db09be8399e587fa1fadd59dbf` and is left exactly as written.

Scope: a **delta confirmation**, not a re-review from scratch. Two questions only — did the
one blocking finding actually close, and did the fix introduce anything new. The seven
verified findings above were not re-derived.

Reviewed in an isolated worktree checked out at the exact head SHA above, against a
dedicated `opusdelta225_test` Postgres database created for this pass alone. `main` at this
time: `16ff76c8198dec4746a466a5eb273bdbd2af6fcc`. Merge-base with `main`:
`665ceb49a656f3bb649ff24f0346da47865df1dc`.

## What landed since `b656583`

| Commit | Contents |
| --- | --- |
| `1348595` | Merge of `origin/main`, bringing in PR #224 (`665ceb4`): `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/_layout/_authenticated.tsx`, `apps/web/src/routes/_layout/_authenticated.test.tsx`. Already reviewed and merged on its own. `git show --stat 1348595` shows **no conflict-resolution edits** — the merge contributes nothing beyond the second parent. |
| `1641f1e` | The fix. Exactly three paths: `apps/api/drizzle/0060_revoke_pre_oauth_removal_sessions.sql`, `tests/api-integration/session-oauth-removal-revocation-behind-utc.test.ts` (new), and this review note. |

Confirmed: **nothing else changed.** No `apps/api/src/**`, no `packages/**`, no
`scripts/**`, and — verified explicitly — **no `drizzle/meta/**`**. The fix commit touches
neither `0060_snapshot.json` nor `_journal.json`, which is correct: rewriting a data-only
`UPDATE`'s predicate changes no schema, so the snapshot chain must not move.
`drizzle-kit check` on the isolated database reports `Everything's fine` — no drift.

Because migration `0060` is introduced *by this PR* and exists nowhere on `main`, no
database anywhere has ever executed the old predicate. Editing the file body carries none
of the usual "already-applied migration" hazard.

## 1. The blocking finding — CLOSED, proved live

The predicate now reads:

```sql
WHERE "created_at" < TIMESTAMP '2026-09-07 09:15:26';
```

I reproduced the original reviewer's live proof independently, on my own database, with
migrations applied via `drizzle-kit migrate`. Four sessions, `created_at` in UTC wall clock:
`06:00:00` (3h15m inside the window), `09:15:25` (one second before), `09:15:26` (exactly at
the cutoff), `09:15:27` (one second after). Counting matches of the **old** predicate and the
**new** one side by side, in the same session, across server time zones:

| Server `TimeZone` | Old `TIMESTAMPTZ` predicate | New `TIMESTAMP` predicate |
| --- | --- | --- |
| `UTC` | 2 | 2 |
| `America/New_York` (UTC−4) | **0** | 2 |
| `Asia/Yangon` (UTC+6:30) | **4** | 2 |
| `Pacific/Kiritimati` (UTC+14) | **4** | 2 |
| `Etc/GMT+12` (UTC−12) | **0** | 2 |

The old form is wrong in **both** directions — under-invalidating behind UTC (the security
failure the original review named) and over-invalidating ahead of UTC (revoking genuinely
post-cutoff sessions, which the original review did not need to reach). The new form returns
the correct 2 in every zone.

Running the migration's actual statement under `America/New_York`: the `06:00:00` session —
**the exact case that previously survived** — now has `expires_at = created_at`, i.e. is
expired. The at-cutoff and post-cutoff rows are untouched, so the `<` boundary is preserved.
A second run changes nothing further: idempotency holds.

I also confirmed the naive literal is not merely time-zone-independent but
**`DateStyle`-independent** — a concern the unambiguous `YYYY-MM-DD` ordering should rule
out, checked rather than assumed. Across `ISO, MDY` / `ISO, DMY` / `SQL, DMY` /
`German, DMY` / `Postgres, DMY` crossed with three time zones (15 combinations), the new
predicate returns 2 every time while the old one keeps swinging 0/2/4 with the zone.

This matches the convention `apps/api/src/utils/db-time.ts` documents for exactly these
`timestamp without time zone` columns: compare `timestamp` against `timestamp` so no session
setting can enter into the comparison.

## 2. The new regression test — RUN, PASSES, AND SURVIVES MUTATION

`tests/api-integration/session-oauth-removal-revocation-behind-utc.test.ts` (3 cases) passes
against this head. It mirrors the existing `session-cleanup-server-behind-utc.test.ts`
pattern faithfully: `PGOPTIONS="-c timezone=America/New_York"` set before the pool opens, a
first case asserting `current_setting('TimeZone')` is genuinely `America/New_York` so the
file cannot silently degrade into a UTC run, and one file per direction for the documented
reason (a session's `TimeZone` is fixed for the life of the pool a file uses).

**Not vacuous.** I reverted only the SQL predicate back to
`TIMESTAMPTZ '2026-09-07T09:15:26Z'` in my worktree and re-ran: the test fails with exactly
the predicted assertion —

```
AssertionError: expected 2027-01-01T00:00:00.000Z to deeply equal 2026-09-07T06:00:00.000Z
```

— i.e. the pre-cutoff session stayed live. Restored the predicate, re-ran, passes. The test
genuinely pins the fix.

## 3. Nothing regressed

Run on the isolated database at this head:

| File | Result |
| --- | --- |
| `session-oauth-removal-revocation.test.ts` (the original 7 cases) | 7 passed — including the one-second-before boundary, the **at-cutoff** row left untouched, the one-second-after row, the mixed-set case and **idempotency** |
| `session-oauth-removal-revocation-behind-utc.test.ts` (new) | 3 passed |
| `session-cleanup-server-behind-utc.test.ts` | 2 passed |
| `session-cleanup-server-ahead-of-utc.test.ts` | 4 passed |
| **Total** | **4 files / 16 tests, all passing** |

The predicate rewrite broke neither the boundary semantics nor idempotency, and did not
disturb the two pre-existing `db-time` regression files on the same table.

## 4. The new comment block — ACCURATE

The ten added comment lines correctly state that `created_at` is
`timestamp without time zone` holding UTC wall clock, that a `TIMESTAMPTZ` literal makes
Postgres reinterpret that value as local time in the server's own `TimeZone` and slide the
boundary by the server's offset, and that a naive `TIMESTAMP` literal keeps the comparison
`timestamp` against `timestamp`. That is the same mechanism `db-time.ts`'s doc comment
documents, cited correctly, and it matches what I measured. It also correctly attributes the
finding to the security review of PR #225 rather than presenting it as original reasoning.

## New non-blocking observations

- **The new comment describes only the behind-UTC direction.** As measured above, the old
  form was wrong ahead of UTC too (4 matches instead of 2 — revoking post-cutoff sessions
  that should stay live). The comment says "on a server behind UTC that silently leaves
  live…", which is the security-relevant half and is true, but a reader could take the
  bug as one-directional. `db-time.ts` already documents both directions; one clause here
  would close the gap. Cosmetic.
- **There is no ahead-of-UTC regression test for `0060`**, where the `session-cleanup` pair
  it is modelled on has both directions. Materially this costs nothing — any reintroduction
  of a `TIMESTAMPTZ` literal is caught by the behind-UTC file — so it is an asymmetry with
  the sibling convention, not a hole in the protection.
- **The new test file omits the `afterAll(() => { delete process.env.PGOPTIONS; })`** that
  both `session-cleanup-server-{ahead,behind}-utc.test.ts` carry. I checked whether this
  leaks a non-UTC server time zone into the 32 integration files that sort after it: it does
  **not**. With vitest's default per-file isolation a probe file run immediately after it
  sees `process.env.PGOPTIONS === undefined` and `current_setting('TimeZone') = 'Etc/UTC'`.
  So this is a deviation from the siblings' convention, not a defect; adding the hook would
  make the three files consistent and remove the question.
- The original review's third non-blocking observation — that the PR body records the
  *orchestrating* session as the independent ordinary reviewer — is unchanged by this fix
  and remains for the merging session's own gate check. Still not mine to adjudicate.

## What I did not do

- I did **not** re-derive the seven findings verified in the review above (cutoff instant,
  no distinguishing column, narrower scoping, boundary choice, migration numbering, the
  original 7-case test's mutation resistance, diff scope). This pass took them as settled and
  confirmed only that the fix did not disturb them.
- I did **not** run the full integration suite. The fix commit's message claims 63 files /
  564 tests; I ran 4 files / 16 tests — the migration's own two files plus the two
  pre-existing `db-time` siblings — and did not independently confirm the suite-wide counts.
  The change touches no application source, so suite-wide regression risk is low, but the
  claim is not verified here. CI's `integration - Postgres 18` check is SUCCESS at this head.
- I did **not** review PR #224's web changes that arrived via the `main` merge; I confirmed
  only that they came in unmodified from an already-merged, separately-reviewed commit.
- I did **not** run `lint` or `typecheck`. I did observe that every GitHub check at this head
  is SUCCESS except `pull request template + security review`, which is FAILURE precisely
  because the note had no reviewed-head declaration covering `1641f1e` — the declaration at
  the top of this section is what that gate is waiting for. The merging session should
  confirm it turns green rather than assuming it.

---

## Verdict at `1641f1e` — CLEAR WITH FINDINGS

The blocking finding is **genuinely closed**, not papered over. The predicate now compares
`timestamp` against `timestamp` in the column's own UTC wall-clock convention; I proved live
on my own database that the exact session which previously survived under
`America/New_York` is now expired, that the fix is invariant across five time zones and five
`DateStyle` settings, and that the new regression test fails against the old predicate and
passes against the new one. The at-cutoff boundary, idempotency and the two pre-existing
`db-time` regression files are all intact, the snapshot/journal chain is untouched,
`drizzle-kit check` is clean, and the diff contains nothing beyond the fix, its test and this
note.

The four findings listed above are cosmetic or conventional — a one-directional comment, a
missing mirror test that costs no protection, a missing `afterAll` I empirically confirmed
leaks nothing, and one pre-existing process point already raised. **None of them blocks the
merge**, and none requires another review round.

No waiver is involved in this verdict.

---

## Further syncs — 2026-09-22, head advanced to `f150604`

Two further main-syncs landed after the delta confirmation above (PR #216's OpenAPI 404
declarations, PR #219's calendar-preview merge — neither touches any file this review
covers). Re-checked directly by the orchestrating session rather than a third reviewer
round, given neither shares a file with this PR: `git diff
1641f1e3fe7f1a23389c79366d05aad3f1624aba f1506042b77ff7df490296ef279578f303c0d847 --
apps/api/drizzle/0060_revoke_pre_oauth_removal_sessions.sql
apps/api/drizzle/meta/0060_snapshot.json apps/api/drizzle/meta/_journal.json
tests/api-integration/session-oauth-removal-revocation.test.ts
tests/api-integration/session-oauth-removal-revocation-behind-utc.test.ts` is empty, and
`drizzle-kit check` re-run at the new head still reports no drift.

**Reviewed head:** `f1506042b77ff7df490296ef279578f303c0d847`

---

## Further sync — 2026-09-22, head advanced to `3e7e8a8`

One further main-sync landed (PR #223's #146 fix — `scripts/ci/**`, its own decision-log
entry and security-review note; no file this review covers). Re-checked directly: `git diff
f1506042b77ff7df490296ef279578f303c0d847 3e7e8a8edcf671731601fc8320662f80adf8a840 --
apps/api/drizzle/0060_revoke_pre_oauth_removal_sessions.sql
apps/api/drizzle/meta/0060_snapshot.json apps/api/drizzle/meta/_journal.json
tests/api-integration/session-oauth-removal-revocation.test.ts
tests/api-integration/session-oauth-removal-revocation-behind-utc.test.ts` is empty.

**Reviewed head:** `3e7e8a8edcf671731601fc8320662f80adf8a840`
