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
 * One file per direction keeps each test's explicit session-local timezone unambiguous.
 * The helper changes only pooled session settings after production UTC startup and restores
 * them after each test; it never changes a database or role default.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  deleteExpiredSessions,
  runSessionCleanup,
} from "../../apps/api/src/scheduler/session-cleanup";
import { resetTestDatabase } from "./helpers/database";
import { setTestDatabaseTimezone } from "./helpers/database-timezone";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";
import {
  plantPreferenceHandoff,
  preferenceHandoffExists,
} from "./helpers/preference-handoff-fixture";

const HOUR_MS = 60 * 60 * 1000;
let restoreDatabaseTimezone: (() => Promise<void>) | undefined;

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
    restoreDatabaseTimezone = await setTestDatabaseTimezone("America/New_York");
  });

  afterEach(async () => {
    await restoreDatabaseTimezone?.();
    restoreDatabaseTimezone = undefined;
  });

  it("purges only expired UTC handoffs through the real leased job", async () => {
    const member = await createWorkspaceMember();
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, member.user.id)),
      "handoff recipient",
    );
    const expired = await plantPreferenceHandoff(person.id, -1);
    const live = await plantPreferenceHandoff(person.id, 5);
    const result = await runSessionCleanup();
    expect(result.notificationPreferenceHandoffsDeleted).toBe(1);
    expect(await preferenceHandoffExists(expired)).toBe(false);
    expect(await preferenceHandoffExists(live)).toBe(true);
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
