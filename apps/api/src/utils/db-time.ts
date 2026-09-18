import { type SQL, sql } from "drizzle-orm";

/**
 * The database's own clock (`now()`), rendered in the one convention this schema's
 * `timestamp without time zone` columns can be compared against safely: **UTC wall clock**.
 *
 * ## Why this is a named helper and not a bare `now()`
 *
 * `now()` returns `timestamptz`. Comparing it with a `timestamp without time zone` column
 * makes PostgreSQL coerce the *column* to `timestamptz` using the session's `TimeZone`
 * setting — the database server's own configuration, not the application's. The column does
 * not hold a session-local wall clock. It holds UTC:
 *
 * - the write path for every column written through Drizzle is
 *   `PgTimestamp.mapToDriverValue` → `Date.prototype.toISOString()`
 *   (`drizzle-orm/pg-core/columns/timestamp.cjs`) — UTC whatever the process's `TZ` is;
 * - the read path is `mapFromDriverValue` → `new Date(value + "+0000")`, i.e. the schema
 *   already declares the convention as UTC on the way back out.
 *
 * So on a server configured *ahead* of UTC the unqualified comparison is not merely
 * imprecise, it is wrong in the destructive direction. Measured against this project's
 * Postgres (`td-lane-pg`), for a row that expires in one hour:
 *
 * ```sql
 * SET TIME ZONE 'Asia/Yangon';
 * SELECT '2026-09-18 12:00:00'::timestamp <= '2026-09-18 11:00:00+00'::timestamptz;  -- true
 * ```
 *
 * `true` — a session that is still live compares as already expired, and a purge deletes it.
 * Behind UTC the same expression is wrong the other way and the purge never fires at all.
 * See `tests/api-integration/session-cleanup-server-ahead-of-utc.test.ts` and
 * `…-behind-utc.test.ts`, which run the real job with the session timezone set to each; both
 * fail against the unqualified predicate.
 *
 * `now() AT TIME ZONE 'UTC'` renders the same instant in the UTC wall-clock convention, so
 * the comparison is `timestamp` against `timestamp` and no session setting can enter into it.
 * The clock is still the *database's*, deliberately — a job lease is only meaningful if every
 * replica reads one common clock.
 *
 * ## Using it
 *
 * ```ts
 * WHERE "table"."expires_at" <= ${dbNowUtc()}
 * ```
 *
 * A `timestamptz` column does **not** need this: `timestamptz` comparisons are instants and
 * are already timezone-independent, and wrapping one would be harmless but pointless. This is
 * for the `timestamp without time zone` columns that exist today and that the schema's own
 * lint has not yet migrated — `session.expires_at`, `job_lease.expires_at`, `task.due_date`.
 *
 * It lives in `utils/` rather than beside its two current callers in `scheduler/` because the
 * convention is a database-layer one: the next caller may be a job, a repository or a
 * controller, none of which should have to import from the scheduler to compare a timestamp
 * correctly. `docs/04-engineering/coding-standards.md` § Database states the rule.
 */
export function dbNowUtc(): SQL {
  return sql`(now() AT TIME ZONE 'UTC')`;
}
