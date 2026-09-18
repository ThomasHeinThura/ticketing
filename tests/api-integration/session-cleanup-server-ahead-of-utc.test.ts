/**
 * `session-cleanup` against a database server whose own `TimeZone` is **ahead of UTC**.
 *
 * `docs/01-architecture/background-jobs.md` lists `session-cleanup` as "expired sessions …
 * and soft-deleted rows past their window"; the destructive half is the hard `DELETE` this
 * file runs. `session.expires_at` is `timestamp without time zone` holding a UTC wall clock,
 * and `now()` is `timestamptz`, so `expires_at <= now()` used to be evaluated through the
 * session's `TimeZone` — the *database server's* setting, which nothing in this repository
 * pins. On a server ahead of UTC that reads a session which expires in an hour as already
 * expired and deletes it.
 *
 * The defect is latent rather than live: nothing in `Dockerfile`, `deploy/` or `charts/` sets
 * `TZ`, and both this project's `td-lane-pg` container and the upstream Postgres image default
 * to UTC. It is a real behavioural defect all the same, and these tests are what make the fix
 * checkable rather than asserted — the same run under the old predicate deletes a live session.
 *
 * ## How the non-UTC server is simulated, and why that way
 *
 * `PGOPTIONS` is read by `pg` when it *opens a connection* (`connection-parameters.js` →
 * `val('options', config)` → `process.env.PGOPTIONS`), and it is set before the first query in
 * this file, so every connection the shared pool opens carries `TimeZone=Asia/Yangon` for the
 * whole file. That is the server's setting as far as that session is concerned, which is
 * exactly the variable under test.
 *
 * A file-scoped `ALTER DATABASE … SET timezone` was rejected as the mechanism: it outlives the
 * file, so a crash mid-run would leave the shared test database non-UTC for every later file
 * that reuses the name. `PGOPTIONS` is scoped to the process running this file. The first test
 * asserts the session really is non-UTC, so this file cannot pass vacuously if that mechanism
 * ever stops working.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { withJobLease } from "../../apps/api/src/scheduler/leader-lock";
import { deleteExpiredSessions } from "../../apps/api/src/scheduler/session-cleanup";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

// Must be set before the pool opens its first connection — see the header. Asia/Yangon is
// UTC+06:30, deliberately not a whole number of hours from UTC.
process.env.PGOPTIONS = "-c timezone=Asia/Yangon";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

async function sessionTimeZone() {
  const result = await db.execute<{ timezone: string }>(
    sql`SELECT current_setting('TimeZone') AS timezone`,
  );
  return requireRow(result.rows, "sessionTimeZone").timezone;
}

/** Written through the Drizzle column mapper, like better-auth's drizzle adapter writes it. */
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

/** Also written through the column mapper, so the row is UTC wall clock by construction. */
async function placeLease(name: string, owner: string, expiresInMs: number) {
  await db.insert(schema.jobLeaseTable).values({
    name,
    owner,
    expiresAt: new Date(Date.now() + expiresInMs),
  });
}

describe("API integration: session-cleanup on a database server ahead of UTC", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(() => {
    // Hygiene: the assignment above is process-wide, so do not leave it behind for whatever
    // runs in this process next.
    delete process.env.PGOPTIONS;
  });

  it("runs against a session that is genuinely not UTC", async () => {
    expect(await sessionTimeZone()).toBe("Asia/Yangon");
  });

  it("deletes the expired session and leaves the unexpired one alone", async () => {
    const member = await createWorkspaceMember();
    const expired = await makeSession(member.user.id, -HOUR_MS);
    const live = await makeSession(member.user.id, HOUR_MS);

    const deleted = await deleteExpiredSessions();

    // Two-sided: the live session is the one the old predicate destroyed, and it must be
    // deleted *neither* by being wrongly purged nor by the statement matching nothing.
    expect(deleted).toBe(1);
    expect(await sessionExists(expired.id)).toBe(false);
    expect(await sessionExists(live.id)).toBe(true);
  });

  it("does not take over a lease another replica is still holding", async () => {
    await placeLease(
      "ahead-of-utc-held-lease",
      "other-replica",
      10 * MINUTE_MS,
    );

    let ran = false;
    const result = await withJobLease(
      "ahead-of-utc-held-lease",
      async () => {
        ran = true;
        return "ran";
      },
      () => "skipped",
    );

    expect(result).toBe("skipped");
    expect(ran).toBe(false);
  });

  it("still takes over a lease whose expiry has passed", async () => {
    await placeLease("ahead-of-utc-dead-lease", "dead-replica", -MINUTE_MS);

    const result = await withJobLease(
      "ahead-of-utc-dead-lease",
      async () => "ran",
      () => "skipped",
    );

    expect(result).toBe("ran");
  });
});
