/**
 * Migration `0060_revoke_pre_oauth_removal_sessions.sql` against a database server whose
 * own `TimeZone` is **behind UTC** — the regression case the mandatory security review of
 * PR #225 found missing.
 *
 * `session.created_at` is `timestamp without time zone`, holding UTC wall clock (see
 * `apps/api/src/utils/db-time.ts`). The migration's predicate is a naive `TIMESTAMP`
 * literal in that same convention specifically so the comparison never passes through the
 * server's `TimeZone` setting. Before that fix, comparing against a `TIMESTAMPTZ` literal
 * made Postgres reinterpret the UTC wall-clock value as *local* time in the server's zone,
 * sliding the boundary by the server's offset — on a server behind UTC that silently left
 * live exactly the pre-cutoff sessions this migration exists to expire (proved live under
 * `America/New_York`: a session created 2026-09-07 06:00:00, three hours and fifteen
 * minutes inside the vulnerable window, was NOT expired).
 *
 * One file per direction, per the sibling `session-cleanup-server-{ahead,behind}-utc.test.ts`
 * pair's own convention: the session's `TimeZone` is fixed for the life of the pool a file
 * uses, so this direction needs its own file/pool.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

// America/New_York is UTC-04:00 in September 2026, so a UTC wall-clock value read as
// local time lands four hours in the future -- the direction that under-invalidates.
process.env.PGOPTIONS = "-c timezone=America/New_York";

const CUTOFF = new Date("2026-09-07T09:15:26.000Z");
const FAR_FUTURE = new Date("2027-01-01T00:00:00.000Z");

async function sessionTimeZone() {
  const result = await db.execute<{ timezone: string }>(
    sql`SELECT current_setting('TimeZone') AS timezone`,
  );
  return requireRow(result.rows, "sessionTimeZone").timezone;
}

async function runOAuthRemovalRevocationMigration() {
  const file = new URL(
    "../../apps/api/drizzle/0060_revoke_pre_oauth_removal_sessions.sql",
    import.meta.url,
  );
  const statements = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function makeSession(userId: string, createdAt: Date, expiresAt: Date) {
  return requireRow(
    await db
      .insert(schema.sessionTable)
      .values({
        id: `session-${randomUUID()}`,
        token: `token-${randomUUID()}`,
        userId,
        createdAt,
        updatedAt: createdAt,
        expiresAt,
      })
      .returning(),
    "makeSession",
  );
}

async function loadSession(sessionId: string) {
  return requireRow(
    await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, sessionId)),
    "loadSession",
  );
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("migration 0060 on a database server behind UTC", () => {
  it("runs against a session that is genuinely not UTC", async () => {
    expect(await sessionTimeZone()).toBe("America/New_York");
  });

  it("still expires a session three hours and fifteen minutes inside the pre-cutoff window", async () => {
    const { user } = await createWorkspaceMember();
    // 2026-09-07 06:00:00Z: squarely before CUTOFF (09:15:26Z), the exact case a
    // TIMESTAMPTZ-literal predicate leaves live under America/New_York (proved by the
    // PR #225 security review).
    const vulnerableWindow = await makeSession(
      user.id,
      new Date("2026-09-07T06:00:00.000Z"),
      FAR_FUTURE,
    );

    await runOAuthRemovalRevocationMigration();

    const repaired = await loadSession(vulnerableWindow.id);
    expect(repaired.expiresAt).toEqual(repaired.createdAt);
    expect(repaired.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("still leaves a genuinely post-cutoff session untouched", async () => {
    const { user } = await createWorkspaceMember();
    const postCutoff = await makeSession(
      user.id,
      new Date(CUTOFF.getTime() + 1000),
      FAR_FUTURE,
    );

    await runOAuthRemovalRevocationMigration();

    const untouched = await loadSession(postCutoff.id);
    expect(untouched.expiresAt).toEqual(FAR_FUTURE);
  });
});
