# Pre-merge security review — issue #452 (comment rows merged into the work-item activity read stream)

**Final verdict (round 3, head `fcdfa58`): CLEAR WITH FINDINGS.** Both blocking findings
from the earlier rounds (B1, B2) are fixed and each has a regression test that fails on the
code it guards against. The findings left are two small, non-blocking notes (N1, N2 below).
No waiver was sought or used.

**Reviewer:** Opus 5.5. A fresh, independent context for every round. It did not write,
direct or fix any part of this change. Branch `feat/452-comment-read-route`, worktree
`/home/ubuntu/.agent-tmp/worktrees/feat-452-comment-read`. Base is `main` at `732cea27`
(the merge of PR #457).

Rounds 1 and 2 were both blocked, so no note was committed for them. Their findings are
recorded here, in this note, for the first time. One `**Reviewed head:**` line per round,
following `scripts/ci/lib/security-review-note.mjs`. The newest one (round 3) is the head
this note clears. Any later commit outside `docs/07-planning/security-reviews/` voids it
and needs a delta review.

---

## Round 1: `732cea2..67d2b39`, verdict BLOCKING FINDINGS

**Reviewed head:** `67d2b3929cc309f7c777e66ec5d74885b63996ef`

**Scope:** the full branch diff at that head:

- `apps/api/src/work-item/controllers/list-work-item-activity.ts`
- `apps/api/src/work-item/index.ts` (route description only)
- `apps/api/src/work-item/policy.ts` (comment only; capability and reach unchanged)
- `apps/api/src/work-item/response.ts` (the `kind` discriminated union)
- `tests/api-contract/openapi.json`
- `tests/api-integration/work-item-activity-read.test.ts`

**What checked out:**

- The route's authorization is unchanged: `requireWorkItemReach()` plus
  `work_item:read`, and the same policy-registry entry as before.
- The comment query is scoped by `comment.work_item_id = item.id`. `item` is resolved by
  key and then checked against the caller's workspace, which returns 404 on a mismatch.
  So the new comment rows cannot leak across workspaces.
- Visibility is still not filtered, for comments or for activity. This is a deliberate,
  documented choice that matches the route's earlier behavior (there is no live portal
  caller yet). It was already flagged in the PR body. It is not a new gap.
- The cursor decoder validates its input and returns 400 on malformed input.
- The top-K merge of two sorted streams (fetch `limit + 1` from each table) and its
  `hasMore` logic are correct.

**B1 (blocking): comments that share a millisecond were skipped across pages.**

- `comment.created_at` is filled by the database's `DEFAULT now()`, so it is stored to the
  microsecond.
- The cursor and the in-memory merge both use a JS `Date`, which only holds milliseconds.
- The comment query's continuation filter compared the millisecond cursor against the raw
  microsecond column. So `eq(created_at, cursor)` could never match a row with nonzero
  microseconds.
- Result: every comment after the first one in a shared millisecond was never returned on
  any page.

---

## Round 2 (delta): `67d2b39..7aef450`, verdict BLOCKING FINDINGS

**Reviewed head:** `7aef45046e829c80d014ced35fb1c9d1cfce6031`

**B1: confirmed fixed.** The comment query now uses
`date_trunc('milliseconds', comment.created_at)` in both its `ORDER BY` and its
continuation filter. That makes the database's order match the millisecond order the
merge assumes. The regression test pins it: three comments forced microseconds apart in
the same millisecond, paged at `limit=1`, with an exact count of 4.

**B2 (blocking, introduced by the B1 fix): the cursor was bound using the server's
local timezone.**

- After the B1 fix, the comment side's comparison had a computed SQL expression on its
  left side, not a column.
- Drizzle's `lt`/`eq` only encode the right-hand value through the left side's column
  encoder when the left side is a column (`bindIfParam`). With an expression on the left,
  the bare cursor `Date` went straight to node-postgres.
- node-postgres serializes a bare `Date` in the Node process's local timezone, with an
  offset. `comment.created_at` is `timestamp` without time zone, so Postgres throws the
  offset away.
- Reproduced: green under `TZ=UTC`, but rows repeated under `TZ=Asia/Yangon` and were
  skipped under `TZ=America/New_York`.
- CI runs in UTC, so CI could not see it.

---

## Round 3 (delta): `7aef450..fcdfa58`, verdict CLEAR WITH FINDINGS

**Reviewed head:** `fcdfa58fba9e24a9924de28654023a515776ce0d`

**Scope:** `git show fcdfa58f`, 2 files:

- `list-work-item-activity.ts`, +28/-6
- `work-item-activity-read.test.ts`, +115/-29

I confirmed the head with `git rev-parse HEAD`.

### B2: confirmed fixed

- **The binding is the same on both call sites.** `cursorContinuationOn` now takes
  `createdAtColumnForEncoding`, which is typed as one of the two real `createdAt` columns.
  It builds a single `cursorParam = sql.param(cursorDate, createdAtColumnForEncoding)`.
  That one param is used in **both** the `lt(createdAtExpr, cursorParam)` and the
  `eq(createdAtExpr, cursorParam)` comparisons, so there is no half-fix. The activity call
  site passes `activityTable.createdAt` and the comment call site passes
  `commentTable.createdAt`.
- **Drizzle passes the param through unchanged.** Checked in the installed drizzle-orm
  0.45.2 (`sql/expressions/conditions.js`): `bindIfParam` returns an existing `Param`
  as-is (`!is(value, Param)`). So `cursorParam` reaches the query builder unchanged for
  both the column left side (activity) and the SQL-expression left side (comment). The
  builder then calls `chunk.encoder.mapToDriverValue(chunk.value)` (`sql/sql.js:141`).
- **Why this removes the timezone dependency.** Both `createdAt` columns are
  `timestamp("created_at", { mode: "date" })` without time zone, so they are
  `PgTimestamp`. Its `mapToDriverValue` is `value.toISOString()`, which always produces a
  UTC `...Z` string, whatever `TZ` is. Postgres reads that into a `timestamp` column by
  dropping the `Z`, which leaves the UTC wall-clock time. That is what the values are
  compared against:
  - Activity rows are written through the same encoder.
  - Comment rows are written by `now()` in the database session's timezone, which is
    `Etc/UTC` here.
  - Both are read back through drizzle's own string parser plus `value + "+0000"`
    (`PgTimestamp.mapFromDriverValue`, and the `TIMESTAMP` type-parser override in
    `node-postgres/session.js`).

  So every path, in and out, is UTC and ignores the process's `TZ`. The reasoning in the
  fix's commit message and doc comment is correct.
- **No third instance of the same bug in this file.**
  - The cursor has only one `Date`-to-SQL crossing, and it is `cursorContinuationOn`,
    which is now covered.
  - The `ORDER BY` clauses bind no values.
  - `encodeActivityCursor` uses `toISOString()`, which is always UTC.
  - `decodeActivityCursor` and `new Date(cursor.createdAt)` parse that same `...Z`
    string, which does not depend on `TZ`. (A hand-made cursor string without an offset
    is the one exception. See N2.)
  - `created_at` is read back through drizzle's `+0000` parser.
- **The regression test is real, and it fails on the old code.**
  - The new B2 test sets `process.env.TZ = "America/New_York"` inside the test and
    restores it in `finally`. It then walks the stream at `limit=1` with the shared
    `pageThroughAll` helper, which also asserts that no id repeats, and asserts an exact
    count of 4.
  - I checked fail-then-pass myself. I swapped in the round-2 controller
    (`git show 7aef4504:<controller>`) and left the new test file in place:
    - Under a process `TZ=UTC`, the B2 test **failed** (1 failed / 11 passed). So the
      in-process `TZ` change really does drive the buggy path. The test does not depend
      on the runner's own zone.
    - Under `TZ=Asia/Yangon`, 3 tests failed: the B2 test, the B1 test and the mixed
      pagination test.
  - I then restored the head's controller and confirmed the worktree was clean.

**Test runs at head `fcdfa58`** (my own runs, private `td452test` database on `td-lane-pg`,
database timezone `Etc/UTC`):

| Process `TZ` | Result |
| --- | --- |
| unset (default) | 1 file, 12/12 passed |
| `Asia/Yangon` | 12/12 passed |
| `America/New_York` | 12/12 passed |
| `Pacific/Kiritimati` (+14) | 12/12 passed |

**Nothing else changed.** The only non-test change is the new parameter and its binding.
Route, policy, response schema and OpenAPI are untouched since round 1. The
`pageThroughAll` refactor keeps the id-repeat assertion and the page-count safety valve
from the loops it replaced.

### Non-blocking

- **N1: the test's TZ restore can leave `TZ` set to the string `"undefined"`.** If the
  runner had no `TZ` set, `originalTz` is `undefined`, and
  `process.env.TZ = originalTz` stores the string `"undefined"`. Node turns every value
  assigned to `process.env` into a string. The tests that run after it in this file still
  pass, because an unknown zone falls back to UTC. But this is a leak between tests, and
  the restore is not as clean as the test intends. Suggested fix:
  `if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;`.
- **N2: a hand-made cursor with no offset is read in the server's local time.**
  `decodeActivityCursor` accepts any string `Date.parse` understands. For an ISO date-time
  with no offset, JS uses the process's local time. The server only ever sends
  `toISOString()` (`...Z`) cursors, so real clients are not affected. A client that forges
  or edits a cursor only changes its own page position, inside a work item it is already
  allowed to read. There is no authorization or data-exposure impact. Optional hardening:
  require a trailing `Z` or an offset.

**Out of scope (noted, not a finding for this PR):** reading comment timestamps correctly
assumes the Postgres session timezone is UTC (`now()` into `timestamp` without time zone,
read back as `+0000`). That assumption is repo-wide and existed before this PR, and it
holds on this host (`Etc/UTC`). It should be written down as a deployment requirement at
some point. #452 does not change it.
