/**
 * Issue #17 — the MCP OAuth consent flow and the OAuth device-authorization flow were
 * both removed (PR #16: `fc34d20`, `c6ab6d5`, merged to `main` as `b75cf02` at
 * 2026-09-07T09:15:26Z), but deleting the route is not revocation: either flow could
 * mint an ordinary 30-day `session` row indistinguishable from a ordinary login.
 * `session` has no column recording which flow created a row (see `sessionTable` in
 * `apps/api/src/database/schema.ts`), so migration
 * `0060_revoke_pre_oauth_removal_sessions.sql` takes the only sound blanket approach:
 * every session created before the cutoff instant is expired, because it cannot be
 * proven not to have come from one of the removed flows; every session created at or
 * after the cutoff is left alone, because the code that could mint one no longer exists
 * on `main` at that point.
 *
 * Runs the shipped migration file itself, split on statement-breakpoint, the same
 * pattern `time-entry-duration.test.ts` uses for `0043_backfill_time_entry_durations`
 * — so this test covers the artifact that actually reaches an upgraded installation,
 * not a hand-copied restatement of its SQL that could silently drift from it.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const CUTOFF = new Date("2026-09-07T09:15:26.000Z");

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

const FAR_FUTURE = new Date("2027-01-01T00:00:00.000Z");

beforeEach(async () => {
  await resetTestDatabase();
});

describe("migration 0060: revoking sessions that predate the OAuth/device flow removal", () => {
  it("expires a session created well before the cutoff (a plausible MCP-OAuth-minted row)", async () => {
    const { user } = await createWorkspaceMember();
    const before = await makeSession(
      user.id,
      new Date("2026-09-01T00:00:00.000Z"),
      FAR_FUTURE,
    );

    await runOAuthRemovalRevocationMigration();

    const repaired = await loadSession(before.id);
    expect(repaired.expiresAt).toEqual(repaired.createdAt);
    expect(repaired.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("expires a session created one second before the cutoff (the boundary)", async () => {
    const { user } = await createWorkspaceMember();
    const justBefore = await makeSession(
      user.id,
      new Date(CUTOFF.getTime() - 1000),
      FAR_FUTURE,
    );

    await runOAuthRemovalRevocationMigration();

    const repaired = await loadSession(justBefore.id);
    expect(repaired.expiresAt).toEqual(repaired.createdAt);
  });

  it("leaves a session created exactly at the cutoff untouched", async () => {
    const { user } = await createWorkspaceMember();
    const atCutoff = await makeSession(user.id, CUTOFF, FAR_FUTURE);

    await runOAuthRemovalRevocationMigration();

    const untouched = await loadSession(atCutoff.id);
    expect(untouched.expiresAt).toEqual(FAR_FUTURE);
  });

  it("leaves a session created one second after the cutoff untouched", async () => {
    const { user } = await createWorkspaceMember();
    const justAfter = await makeSession(
      user.id,
      new Date(CUTOFF.getTime() + 1000),
      FAR_FUTURE,
    );

    await runOAuthRemovalRevocationMigration();

    const untouched = await loadSession(justAfter.id);
    expect(untouched.expiresAt).toEqual(FAR_FUTURE);
  });

  it("leaves an ordinary current session (created long after the cutoff) untouched", async () => {
    const { user } = await createWorkspaceMember();
    const current = await makeSession(
      user.id,
      new Date("2026-09-20T00:00:00.000Z"),
      FAR_FUTURE,
    );

    await runOAuthRemovalRevocationMigration();

    const untouched = await loadSession(current.id);
    expect(untouched.expiresAt).toEqual(FAR_FUTURE);
  });

  it("only invalidates the pre-cutoff rows out of a mixed set, in one run", async () => {
    const { user } = await createWorkspaceMember();
    const preCutoff = await makeSession(
      user.id,
      new Date("2026-09-05T00:00:00.000Z"),
      FAR_FUTURE,
    );
    const postCutoff = await makeSession(
      user.id,
      new Date("2026-09-10T00:00:00.000Z"),
      FAR_FUTURE,
    );

    await runOAuthRemovalRevocationMigration();

    expect((await loadSession(preCutoff.id)).expiresAt.getTime()).toBeLessThan(
      Date.now(),
    );
    expect((await loadSession(postCutoff.id)).expiresAt).toEqual(FAR_FUTURE);
  });

  it("is idempotent — running it twice leaves the same rows in the same state", async () => {
    const { user } = await createWorkspaceMember();
    const before = await makeSession(
      user.id,
      new Date("2026-09-01T00:00:00.000Z"),
      FAR_FUTURE,
    );
    const after = await makeSession(
      user.id,
      new Date("2026-09-20T00:00:00.000Z"),
      FAR_FUTURE,
    );

    await runOAuthRemovalRevocationMigration();
    const firstPassBefore = await loadSession(before.id);
    const firstPassAfter = await loadSession(after.id);

    await runOAuthRemovalRevocationMigration();
    const secondPassBefore = await loadSession(before.id);
    const secondPassAfter = await loadSession(after.id);

    expect(secondPassBefore.expiresAt).toEqual(firstPassBefore.expiresAt);
    expect(secondPassAfter.expiresAt).toEqual(firstPassAfter.expiresAt);
  });
});
