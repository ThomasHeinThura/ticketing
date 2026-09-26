/**
 * Migration `0070_audit_log_project_id.sql` (#344, AU-10) — proves the migration is
 * forward-only AND correct over PRE-EXISTING rows, which the ordinary integration path
 * cannot: `resetTestDatabase()` always migrates an EMPTY database, so a column added to
 * a non-empty `audit_log` is never exercised there. This file follows the exact harness
 * `workspace-role-is-system-backfill-migration.test.ts` (issue #318) established:
 *
 *   1. its OWN uniquely-named database, never the shared `TASKDESK_DATABASE_URL` target;
 *   2. a temporary migrations folder with only the journal entries up to `0069`, so the
 *      database is brought to exactly the pre-`0070` schema;
 *   3. audit rows inserted with RAW SQL (the `project_id` column does not exist yet);
 *   4. the real `0070_audit_log_project_id.sql` applied, split on the same
 *      `--> statement-breakpoint` marker drizzle's migrator uses;
 *   5. asserts: the column exists, every pre-existing row's `project_id` is NULL (the
 *      "not project-scoped" reading the read filter gives them), and a NEW row can carry
 *      a value;
 *   6. drops its database unconditionally.
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
const CUTOFF_TAG = "0069_policy_shadow_tables";
const TARGET_MIGRATION_TAG = "0070_audit_log_project_id";

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

  const tempDir = mkdtempSync(join(tmpdir(), "taskdesk-pre-0070-migrations-"));
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
    writeFileSync(
      join(tempDir, `${entry.tag}.sql`),
      readFileSync(join(realMigrationsFolder, `${entry.tag}.sql`)),
    );
  }

  return tempDir;
}

describe("migration 0070_audit_log_project_id.sql — forward-only, over pre-existing audit rows (#344)", () => {
  const baseUrl = requireDatabaseUrl();
  const testDatabaseName = `audit344_migration_${randomUUID().replaceAll("-", "_")}`;
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

  it("adds the nullable column, leaves every existing row project_id NULL, and accepts a value on new rows", async () => {
    const pool = new Pool({ connectionString: testDatabaseUrl });
    const testDb = drizzle(pool);

    try {
      await migrate(testDb, { migrationsFolder: tempMigrationsFolder });

      // Pre-0070 rows, written the way the app wrote them: the column does not exist,
      // so raw SQL is the only honest way to insert them. `prev_hash`/`row_hash` must
      // satisfy `audit_log_prev_hash_shape` (64 hex characters), the same shape the
      // writer's `canonicalRowHash` produces.
      const existingId = `audit-${randomUUID()}`;
      const hashA = "a".repeat(64);
      const hashB = "b".repeat(64);
      const hashC = "c".repeat(64);
      await testDb.execute(
        `INSERT INTO audit_log (
           id, actor_type, action, entity_type, entity_id, prev_hash, row_hash
         ) VALUES ('${existingId}', 'system', 'plugin.changed', 'plugin', 'p-1', '${hashA}', '${hashB}')`,
      );

      // Apply the REAL migration file, statement by statement, the same way drizzle's
      // migrator does.
      const sqlText = readFileSync(
        join(realMigrationsFolder, `${TARGET_MIGRATION_TAG}.sql`),
        "utf8",
      );
      for (const statement of sqlText.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) {
          await testDb.execute(trimmed);
        }
      }

      // The column exists, is nullable text, and every pre-existing row reads NULL --
      // which is also, deliberately, what the read filter shows every workspace reader
      // for a "not project-scoped" row.
      const column = await testDb.execute<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'audit_log' AND column_name = 'project_id'`,
      );
      expect(column.rows[0]?.is_nullable).toBe("YES");

      const existing = await testDb.execute<{ project_id: string | null }>(
        `SELECT project_id FROM audit_log WHERE id = '${existingId}'`,
      );
      expect(existing.rows[0]?.project_id).toBeNull();

      // New rows can carry a value (and only a value -- no FK, no cascade, per
      // data-model.md's registration of the column).
      const newId = `audit-${randomUUID()}`;
      const projectId = `prj-${randomUUID()}`;
      await testDb.execute(
        `INSERT INTO audit_log (
           id, actor_type, action, entity_type, entity_id, workspace_id, project_id,
           prev_hash, row_hash
         ) VALUES ('${newId}', 'person', 'work_item.assigned', 'work_item', 'wi-1',
                   'ws-1', '${projectId}', '${hashB}', '${hashC}')`,
      );
      const inserted = await testDb.execute<{ project_id: string | null }>(
        `SELECT project_id FROM audit_log WHERE id = '${newId}'`,
      );
      expect(inserted.rows[0]?.project_id).toBe(projectId);
    } finally {
      await pool.end();
    }
  });
});
