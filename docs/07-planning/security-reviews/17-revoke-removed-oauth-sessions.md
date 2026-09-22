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
