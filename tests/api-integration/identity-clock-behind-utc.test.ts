import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { setTestDatabaseTimezone } from "./helpers/database-timezone";

/**
 * #631: the identity, session, step-up and comment suites with BOTH the Node process and the
 * database session in America/New_York. `session.expires_at` and `comment.created_at` are
 * `timestamp without time zone` columns holding a UTC wall clock; comparing them with a bare
 * `now()` (or leaving a `DEFAULT now()` to stamp them) lets the session `TimeZone` shift
 * the boundary, so a live session read as expired (ahead of UTC) or an expired one as live and a
 * comment edit window that is wrong by the zone offset (behind UTC). Each suite below failed in
 * this zone before the comparisons used the UTC wall-clock helper. Mirrors
 * The test fixture sets the process zone and then applies a session-local PostgreSQL
 * timezone after the production pool has pinned its connections to UTC.
 */
const previousProcessTimezone = process.env.TZ;
process.env.TZ = "America/New_York";
const restoreDatabaseTimezone =
  await setTestDatabaseTimezone("America/New_York");
afterAll(restoreDatabaseTimezone);
afterAll(() => {
  if (previousProcessTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = previousProcessTimezone;
});

describe("time zone is really non-UTC for this file", () => {
  it("moves the Node process and the database session off UTC", async () => {
    expect(new Date().getTimezoneOffset()).not.toBe(0);
    const result = await db.execute<{ timezone: string }>(
      sql`SELECT current_setting('TimeZone') AS timezone`,
    );
    expect(result.rows[0]?.timezone).toBe("America/New_York");
  });
});

await import("./work-item-comment.test");
await import("./instance-users-guards.test");
await import("./instance-users.test");
await import("./session-freshness.test");
