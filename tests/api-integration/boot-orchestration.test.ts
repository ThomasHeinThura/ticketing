/**
 * Second ordinary delta review of PR #308, APPROVE WITH NOTES: everything up to now
 * confirmed the role/grant mechanics and the split's individual pieces
 * (`ensureApplicationRole`, `assertApplicationRoleIsNotPrivileged`,
 * `assertNoMigrationUrlInApiProcess`) directly, but nothing called
 * `runMigrationStep()`/`runApiBootTasks()` themselves — every confirmation of the actual
 * orchestration (issue #296, S1) came from manual container runs, recorded in the PR
 * description, never from an automated test.
 *
 * `isMainModule` (`apps/api/src/index.ts`) gates the only place these two functions are
 * normally invoked from -- the top-level `if (isMainModule) { ... }` block -- so importing
 * `apps/api/src/index.ts` in a test (the same thing `work-item-update.test.ts` and others
 * already do, for `createApp`) does not itself boot anything: `runMigrationStep` and
 * `runApiBootTasks` are called here directly, as plain exported functions, never by
 * spawning a real process.
 *
 * This file covers the three cases that are safe to share one `resetTestDatabase()` /
 * cached `db` (the app pool singleton, `apps/api/src/database`'s module-level `pool`) --
 * all three want `getDatabase()` to resolve as this test harness's own owner/superuser
 * connection, which is what `resetTestDatabase()`'s first call caches it as for this
 * file's whole run. The fourth case -- `runApiBootTasks` SUCCEEDING as a genuine,
 * non-privileged application role -- needs `getDatabase()` to resolve as that role
 * instead, which a shared owner-cached pool cannot do; see
 * `boot-orchestration-success.test.ts` for why that one is a separate file.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { getMigrationDatabasePool } from "../../apps/api/src/database";
import { runApiBootTasks, runMigrationStep } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function randomHex64(): string {
  return randomBytes(32).toString("hex");
}

function randomSuffix(): string {
  return randomUUID().replaceAll("-", "").slice(0, 16);
}

describe("boot orchestration (issue #296, S1) — runMigrationStep / runApiBootTasks", () => {
  let originalDatabaseUrl: string | undefined;
  let originalMigrationUrl: string | undefined;

  beforeEach(async () => {
    await resetTestDatabase();
    originalDatabaseUrl = process.env.TASKDESK_DATABASE_URL;
    originalMigrationUrl = process.env.TASKDESK_MIGRATION_DATABASE_URL;
    if (!originalDatabaseUrl) {
      throw new Error("TASKDESK_DATABASE_URL must be set for this test");
    }
  });

  afterEach(async () => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.TASKDESK_DATABASE_URL;
    } else {
      process.env.TASKDESK_DATABASE_URL = originalDatabaseUrl;
    }
    if (originalMigrationUrl === undefined) {
      delete process.env.TASKDESK_MIGRATION_DATABASE_URL;
    } else {
      process.env.TASKDESK_MIGRATION_DATABASE_URL = originalMigrationUrl;
    }
  });

  it("runMigrationStep migrates, creates the application role, and closes its own pool", async () => {
    const roleName = `taskdesk_app_bootstep_${randomSuffix()}`;
    const password = randomHex64();

    // Distinct owner (migration) URL and app URL -- the owner stays the test harness's
    // real connection (see .env.test.example), the app URL is this run's own unique
    // role, so `ensureApplicationRole` genuinely creates a role rather than taking the
    // single-URL-mode skip branch.
    process.env.TASKDESK_MIGRATION_DATABASE_URL = originalDatabaseUrl;
    const appUrl = new URL(originalDatabaseUrl as string);
    appUrl.username = roleName;
    appUrl.password = password;
    process.env.TASKDESK_DATABASE_URL = appUrl.toString();

    // Force-create the migration pool now, under the CURRENT env, so it is the exact
    // object `runMigrationStep` will reuse (the pool is a lazy module-level singleton) --
    // capturing it here is what lets the assertions below prove it was actually closed,
    // not merely that some pool, at some point, existed.
    const poolBeforeMigration = getMigrationDatabasePool();

    await expect(runMigrationStep()).resolves.toBeUndefined();

    // Migrated: a well-known table from the schema exists and is queryable.
    const tableCheck = await db.execute(
      sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_item'`,
    );
    expect(tableCheck.rows.length).toBe(1);

    // The application role was created by ensureApplicationRole.
    const roleCheck = await db.execute(
      sql`SELECT rolsuper FROM pg_roles WHERE rolname = ${roleName}`,
    );
    expect(roleCheck.rows).toHaveLength(1);
    expect((roleCheck.rows[0] as { rolsuper?: boolean }).rolsuper).toBe(false);

    // The pool is closed: the exact `Pool` object captured above can no longer run a
    // query (node-postgres rejects any use of a pool after `.end()`), and asking for
    // the migration pool again creates a genuinely NEW object -- proving
    // `closeMigrationPool()` reset the module-level singleton, not just ended one
    // connection within it.
    await expect(poolBeforeMigration.query("SELECT 1")).rejects.toThrow();
    const poolAfterMigration = getMigrationDatabasePool();
    expect(poolAfterMigration).not.toBe(poolBeforeMigration);

    // Clean up this test's own role.
    await db
      .execute(sql.raw(`DROP OWNED BY ${quoteIdentifier(roleName)}`))
      .catch(() => undefined);
    await db.execute(
      sql.raw(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`),
    );
  });

  it("runApiBootTasks refuses when TASKDESK_MIGRATION_DATABASE_URL is present in the process's own environment", async () => {
    process.env.TASKDESK_MIGRATION_DATABASE_URL = originalDatabaseUrl;
    // TASKDESK_DATABASE_URL is whatever the harness already has it as -- irrelevant
    // here, since assertNoMigrationUrlInApiProcess runs before any connection is used.

    await expect(runApiBootTasks()).rejects.toThrow(
      /TASKDESK_MIGRATION_DATABASE_URL/,
    );
  });

  it("runApiBootTasks refuses when connected as the owner (no migration URL present)", async () => {
    delete process.env.TASKDESK_MIGRATION_DATABASE_URL;
    // TASKDESK_DATABASE_URL already points at the harness's owner/superuser connection
    // by default (.env.test.example), and `db` (this file's cached app pool) was
    // initialised against exactly that URL by `resetTestDatabase()` in `beforeEach`,
    // above -- this is the single-URL-mode case.

    await expect(runApiBootTasks()).rejects.toThrow(/superuser/i);
  });
});
