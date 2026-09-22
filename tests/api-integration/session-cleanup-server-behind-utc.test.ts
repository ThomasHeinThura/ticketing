/**
 * `session-cleanup` against a database server whose own `TimeZone` is **behind UTC** — the
 * mirror of `session-cleanup-server-ahead-of-utc.test.ts`, and the opposite harm.
 *
 * Ahead of UTC the unqualified `expires_at <= now()` deletes a session that is still live
 * (data loss). Behind UTC the same expression never fires for the session it should: a row
 * that expired an hour ago compares as still-valid, so the purge silently does nothing and
 * expired sessions accumulate — a retention failure rather than a destructive one, but still
 * the job not doing the thing `background-jobs.md` says it does.
 *
 * One file per direction because the session's `TimeZone` is fixed for the life of the pool
 * that a file uses; the two directions cannot be exercised from one pool. The mechanism, and
 * why `PGOPTIONS` rather than `ALTER DATABASE`, is documented in the sibling file.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { deleteExpiredSessions } from "../../apps/api/src/scheduler/session-cleanup";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

// America/New_York is UTC-04:00 in September, so a UTC wall clock read as local lands four
// hours in the future.
process.env.PGOPTIONS = "-c timezone=America/New_York";

const HOUR_MS = 60 * 60 * 1000;

async function sessionTimeZone() {
  const result = await db.execute<{ timezone: string }>(
    sql`SELECT current_setting('TimeZone') AS timezone`,
  );
  return requireRow(result.rows, "sessionTimeZone").timezone;
}

async function makeSession(userId: string, expiresInMs: number) {
  const now = new Date();
  const createdAt = new Date(now.getTime() - 2 * HOUR_MS);
  return requireRow(
    await db
      .insert(schema.sessionTable)
      .values({
        id: `session-${randomUUID()}`,
        token: `token-${randomUUID()}`,
        userId,
        expiresAt: new Date(now.getTime() + expiresInMs),
        createdAt,
        updatedAt: createdAt,
      })
      .returning(),
    "makeSession",
  );
}

async function sessionExists(sessionId: string) {
  const [row] = await db
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.id, sessionId));
  return row !== undefined;
}

describe("API integration: session-cleanup on a database server behind UTC", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(() => {
    delete process.env.PGOPTIONS;
  });

  it("runs against a session that is genuinely not UTC", async () => {
    expect(await sessionTimeZone()).toBe("America/New_York");
  });

  it("still deletes a session that expired an hour ago", async () => {
    const member = await createWorkspaceMember();
    const expired = await makeSession(member.user.id, -HOUR_MS);
    const live = await makeSession(member.user.id, HOUR_MS);

    const deleted = await deleteExpiredSessions();

    expect(deleted).toBe(1);
    expect(await sessionExists(expired.id)).toBe(false);
    expect(await sessionExists(live.id)).toBe(true);
  });
});
