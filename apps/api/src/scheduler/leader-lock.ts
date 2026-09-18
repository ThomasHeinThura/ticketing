import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import db from "../database";
import { dbNowUtc } from "../utils/db-time";

const INSTANCE_ID = randomUUID();

const DEFAULT_LEASE_MS = 15 * 60 * 1000;

/**
 * Acquires `name`'s lease, or reports that someone else holds it.
 *
 * ## The lease's clock, and why neither side of it is a bare `now()`
 *
 * `job_lease.expires_at` is `timestamp without time zone` (migration
 * `0044_needy_triathlon.sql`), and the convention every such column in this schema uses is
 * **UTC wall clock** — see `utils/db-time.ts`. This statement used to break that convention
 * twice, in two independent ways, which is why both halves are written the way they are:
 *
 * - **The write.** `VALUES (…, ${expiresAt})` handed node-postgres a `Date` inside a raw
 *   `sql` template, which drizzle passes through with its `noopEncoder`. `pg` then serializes
 *   a `Date` with `dateToString()` — in the *process's* local time zone, offset and all — and
 *   PostgreSQL drops the offset for a `timestamp` column. Measured: a `Date` for
 *   `2026-09-18T12:00:00Z` stores as `12:00:00` under `TZ=UTC`, but as `18:30:00` under
 *   `TZ=Asia/Yangon` and `08:00:00` under `TZ=America/New_York`. The expiry is now taken from
 *   the database's own clock instead, so the application's clock and time zone cannot enter
 *   into it — which is also what `background-jobs.md` § Leasing documents (`now() + $3::interval`).
 * - **The read.** `job_lease."expires_at" < now()` coerced the column through the session's
 *   `TimeZone`. On a server ahead of UTC a lease that is still live compares as expired, so a
 *   second replica takes it over while the first is running.
 *
 * Both halves now use `dbNowUtc()`, so the whole lease lives on one clock.
 */
export async function withJobLease<T>(
  name: string,
  run: () => Promise<T>,
  whenHeldElsewhere: () => T,
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<T> {
  const ttl = `${leaseMs} milliseconds`;

  const claimed = await db.execute(sql`
    INSERT INTO job_lease ("name", "owner", "expires_at")
    VALUES (${name}, ${INSTANCE_ID}, ${dbNowUtc()} + ${ttl}::interval)
    ON CONFLICT ("name") DO UPDATE
      SET "owner" = EXCLUDED."owner", "expires_at" = EXCLUDED."expires_at"
      WHERE job_lease."expires_at" < ${dbNowUtc()}
    RETURNING "name";
  `);

  if ((claimed.rowCount ?? 0) === 0) {
    return whenHeldElsewhere();
  }

  try {
    return await run();
  } finally {
    await db
      .execute(
        sql`DELETE FROM job_lease WHERE "name" = ${name} AND "owner" = ${INSTANCE_ID};`,
      )
      .catch((error) => {
        console.error(`Failed to release the ${name} lease`, error);
      });
  }
}
