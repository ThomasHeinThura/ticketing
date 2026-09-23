/**
 * Issue #318 (security) — proves migration `0068_workspace_role_is_system.sql`'s backfill
 * actually repairs a PRE-EXISTING `viewer`/`member`/`admin` row, not just a freshly-seeded
 * one. Independent Sonnet review of pull request #322 (head `8f8e9d6`) reproduced the
 * defect the first version of this migration had: it added `is_system boolean DEFAULT
 * false NOT NULL` with no backfill, so every already-existing default-role row stayed
 * `is_system = false` after deploy — and both resolvers now require `is_system` for a
 * non-`owner` grant, so every existing admin, member and viewer would have lost their
 * built-in capabilities. CI never caught it because `resetTestDatabase()` always migrates
 * an EMPTY database (no pre-existing row to lose) — this file exists specifically to cover
 * the case CI's ordinary path cannot.
 *
 * WHY THIS DOES NOT USE `resetTestDatabase()` / the shared `TASKDESK_DATABASE_URL`. Every
 * other integration test in this suite runs against a database already migrated to the
 * CURRENT head (`ensureTestDatabaseMigrated()`, `tests/api-integration/helpers/database.ts`)
 * — exactly the state this test must NOT start from, since the whole point is to apply
 * migrations only up to `0067`, insert rows the way a pre-`0068` deployment actually would
 * have, and only THEN apply `0068` and inspect what happened. So this file:
 *
 *   1. connects to its OWN dedicated, uniquely-named database (never the shared
 *      `TASKDESK_DATABASE_URL` target) — built from the same connection info, host and
 *      port, with the database name swapped for one this file owns end to end;
 *   2. builds a TEMPORARY migrations folder containing only `apps/api/drizzle`'s journal
 *      entries with `idx <= 67` (copies of the real, unmodified `.sql` files — nothing
 *      hand-written) and runs `drizzle-orm`'s own migrator against it, bringing the
 *      database to exactly the pre-`0068` schema;
 *   3. inserts `viewer`/`member`/`admin` `workspace_role` rows with RAW SQL (the column
 *      does not exist yet at this point, so `schema.ts`'s current, `is_system`-aware
 *      table definition cannot be used for this insert);
 *   4. applies `0068_workspace_role_is_system.sql` itself, split on the same
 *      `--> statement-breakpoint` marker `drizzle-orm`'s migrator uses, so this step
 *      exercises the EXACT SQL the real migration runs, not a paraphrase of it;
 *   5. asserts `is_system = true` for all three rows and that `permission` (the
 *      capabilities) is untouched, byte for byte;
 *   6. drops its database, unconditionally, even on failure.
 *
 * MUTATION-CHECKED BY HAND, per this issue's review instruction: with the migration file's
 * `UPDATE` statement removed, this test's step-5 assertion goes red (`is_system` stays
 * `false` for all three rows) — confirmed by running this file against a deliberately
 * reverted copy of `0068_workspace_role_is_system.sql` (the `ALTER TABLE` alone, no
 * `UPDATE`) before restoring the real migration. Recorded here rather than automated as a
 * second CI variant, because standing up a second temporary database and a mutated
 * migration file inside the suite itself would need to intentionally ship a broken
 * migration alongside the real one — exactly the shape this suite otherwise refuses.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const realMigrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const CUTOFF_TAG = "0067_audit_log_table";
const BACKFILL_MIGRATION_TAG = "0068_workspace_role_is_system";

function requireDatabaseUrl(): string {
  const url = process.env.TASKDESK_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TASKDESK_DATABASE_URL must be defined for this migration test",
    );
  }
  return url;
}

function databaseNameOf(connectionString: string): string {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

function withDatabaseName(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

function adminConnectionString(connectionString: string): string {
  return withDatabaseName(connectionString, "postgres");
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** A journal containing only the entries up to and including `CUTOFF_TAG`, plus a temp
 * folder holding copies of exactly those migration `.sql` files -- everything
 * `drizzle-orm`'s migrator needs (it reads only the journal and the `.sql` files it names;
 * it does not read `meta/*_snapshot.json` at all). */
function buildPreCutoffMigrationsFolder(): string {
  const journal = JSON.parse(
    readFileSync(join(realMigrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };

  const cutoffIndex = journal.entries.findIndex(
    (entry) => entry.tag === CUTOFF_TAG,
  );
  if (cutoffIndex === -1) {
    throw new Error(
      `${CUTOFF_TAG} not found in apps/api/drizzle/meta/_journal.json -- has it been renamed?`,
    );
  }
  const preCutoffEntries = journal.entries.slice(0, cutoffIndex + 1);

  const tempDir = mkdtempSync(join(tmpdir(), "taskdesk-pre-0068-migrations-"));
  const tempMetaDir = join(tempDir, "meta");
  mkdirSync(tempMetaDir, { recursive: true });
  writeFileSync(
    join(tempMetaDir, "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: preCutoffEntries,
    }),
  );

  for (const entry of preCutoffEntries) {
    const source = join(realMigrationsFolder, `${entry.tag}.sql`);
    const destination = join(tempDir, `${entry.tag}.sql`);
    writeFileSync(destination, readFileSync(source));
  }

  return tempDir;
}

describe("migration 0068_workspace_role_is_system.sql — the backfill for PRE-EXISTING rows (issue #318, security)", () => {
  const baseUrl = requireDatabaseUrl();
  const testDatabaseName = `fix318_migration_backfill_${randomUUID().replaceAll("-", "_")}`;
  const testDatabaseUrl = withDatabaseName(baseUrl, testDatabaseName);
  let tempMigrationsFolder: string;

  beforeAll(async () => {
    const parentDatabaseName = databaseNameOf(baseUrl);
    if (!parentDatabaseName.endsWith("_test")) {
      throw new Error(
        `Refusing to run against non-test database "${parentDatabaseName}". TASKDESK_DATABASE_URL must point to a test database.`,
      );
    }

    const admin = new Client({
      connectionString: adminConnectionString(baseUrl),
    });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(testDatabaseName)}`);
    } finally {
      await admin.end();
    }

    tempMigrationsFolder = buildPreCutoffMigrationsFolder();
  });

  afterAll(async () => {
    if (tempMigrationsFolder) {
      rmSync(tempMigrationsFolder, { recursive: true, force: true });
    }

    const admin = new Client({
      connectionString: adminConnectionString(baseUrl),
    });
    await admin.connect();
    try {
      // Terminate any lingering connections before dropping -- this test's own pools are
      // always closed by the time this runs, but a dropped connection mid-teardown should
      // never leave the database undroppable for the next run.
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [testDatabaseName],
      );
      await admin.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabaseName)}`,
      );
    } finally {
      await admin.end();
    }
  });

  it("marks every pre-existing viewer/member/admin row is_system = true, leaves their permission JSON untouched, and never touches a differently-named row", async () => {
    const pool = new Pool({ connectionString: testDatabaseUrl });
    const testDb = drizzle(pool);

    try {
      // Step 1: migrate to exactly the pre-0068 schema.
      await migrate(testDb, { migrationsFolder: tempMigrationsFolder });

      // Step 2: seed a workspace and pre-existing default-role rows with RAW SQL -- the
      // `is_system` column does not exist at this point in the migration timeline.
      // Migration 0062 already seeds the one internal organisation
      // (`UNIQUE (is_internal)` where true), so this test reuses it rather than inserting
      // a second one, which that constraint would refuse.
      const workspaceId = `ws-${randomUUID()}`;
      const organisationRow = (
        await testDb.execute(
          `SELECT id FROM "organisation" WHERE is_internal = true LIMIT 1`,
        )
      ).rows as Array<{ id: string }>;
      const organisationId = organisationRow[0]?.id;
      if (!organisationId) {
        throw new Error(
          "migration 0062 should have seeded the internal organisation by now",
        );
      }
      await testDb.execute(`
        INSERT INTO "workspace" (id, organisation_id, slug, name, created_at)
        VALUES ('${workspaceId}', '${organisationId}', 'ws-${randomUUID()}', 'Test Workspace', now())
      `);

      const viewerPermission = JSON.stringify({ task: ["read"] });
      const memberPermission = JSON.stringify({ task: ["read", "create"] });
      const adminPermission = JSON.stringify({
        task: ["read", "create", "update", "delete"],
      });
      const customPermission = JSON.stringify({ task: ["read"] });

      const roleIds = {
        viewer: `role-${randomUUID()}`,
        member: `role-${randomUUID()}`,
        admin: `role-${randomUUID()}`,
        custom: `role-${randomUUID()}`,
      };

      for (const [role, id, permission] of [
        ["viewer", roleIds.viewer, viewerPermission],
        ["member", roleIds.member, memberPermission],
        ["admin", roleIds.admin, adminPermission],
        // A differently-named custom row, in the SAME workspace, to prove the backfill's
        // `WHERE role IN (...)` clause never touches anything outside the three names.
        ["acme-support-triage", roleIds.custom, customPermission],
      ] as const) {
        await testDb.execute(`
          INSERT INTO "workspace_role" (id, workspace_id, role, permission, created_at, updated_at)
          VALUES ('${id}', '${workspaceId}', '${role}', '${permission.replaceAll("'", "''")}', now(), now())
        `);
      }

      // Step 3: apply 0068 itself, split the same way the real migrator splits it.
      const migrationSql = readFileSync(
        join(realMigrationsFolder, `${BACKFILL_MIGRATION_TAG}.sql`),
        "utf8",
      );
      for (const statement of migrationSql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length === 0) continue;
        await testDb.execute(trimmed);
      }

      // Step 4: assert.
      const rows = (
        await testDb.execute(`
          SELECT id, role, is_system AS "isSystem", permission
          FROM "workspace_role"
          WHERE workspace_id = '${workspaceId}'
          ORDER BY role
        `)
      ).rows as Array<{
        id: string;
        role: string;
        isSystem: boolean;
        permission: string;
      }>;

      const byRole = new Map(rows.map((row) => [row.role, row]));

      for (const [role, permission] of [
        ["viewer", viewerPermission],
        ["member", memberPermission],
        ["admin", adminPermission],
      ] as const) {
        const row = byRole.get(role);
        expect(row, role).toBeDefined();
        expect(row?.isSystem, `${role}.is_system`).toBe(true);
        expect(row?.permission, `${role}.permission unchanged`).toBe(
          permission,
        );
      }

      const custom = byRole.get("acme-support-triage");
      expect(custom).toBeDefined();
      expect(
        custom?.isSystem,
        "a differently-named custom row must NOT be marked is_system by the backfill",
      ).toBe(false);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
