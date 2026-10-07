import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type MigrationEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: MigrationEntry[];
};

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

type ForeignKeyColumns = {
  table_key: string;
  constraint_name: string;
  columns_from: string[];
  columns_to: string[];
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");
const apiDir = join(repoRoot, "apps/api");
const migrationsFolder = join(apiDir, "drizzle");
const metadataFolder = join(migrationsFolder, "meta");
const drizzleKitBin = join(apiDir, "node_modules/.bin/drizzle-kit");
const FIRST_PROVISIONAL_PREFIX = 88;
const LAST_PROVISIONAL_PREFIX = 117;
const FROZEN_PREFIX_ENTRY_COUNT = LAST_PROVISIONAL_PREFIX + 1;

function requireDatabaseUrl(): string {
  const url = process.env.TASKDESK_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TASKDESK_DATABASE_URL must be defined for migration metadata verification",
    );
  }
  return url;
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

function buildPrefixFolder(
  tempRoot: string,
  journal: MigrationJournal,
  lastIndex: number,
): string {
  const prefix = String(lastIndex).padStart(4, "0");
  const folder = join(tempRoot, prefix);
  const metaFolder = join(folder, "meta");
  mkdirSync(metaFolder, { recursive: true });

  writeFileSync(
    join(metaFolder, "_journal.json"),
    JSON.stringify({
      version: journal.version,
      dialect: journal.dialect,
      entries: journal.entries.slice(0, lastIndex + 1),
    }),
  );

  for (const entry of journal.entries.slice(0, lastIndex + 1)) {
    symlinkSync(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(folder, `${entry.tag}.sql`),
    );
  }

  return folder;
}

function schemaWithoutIdentity(snapshot: Snapshot) {
  const { id: _id, prevId: _prevId, ...schema } = snapshot;
  return schema;
}

async function restoreForeignKeyColumnOrder(
  snapshot: Snapshot,
  pool: Pool,
): Promise<void> {
  const result = await pool.query<ForeignKeyColumns>(`
    SELECT
      source_namespace.nspname || '.' || source_table.relname AS table_key,
      constraint_row.conname AS constraint_name,
      array_agg(source_column.attname ORDER BY key.position)::text[] AS columns_from,
      array_agg(target_column.attname ORDER BY key.position)::text[] AS columns_to
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS source_table
      ON source_table.oid = constraint_row.conrelid
    JOIN pg_namespace AS source_namespace
      ON source_namespace.oid = source_table.relnamespace
    JOIN pg_class AS target_table
      ON target_table.oid = constraint_row.confrelid
    JOIN pg_namespace AS target_namespace
      ON target_namespace.oid = target_table.relnamespace
    CROSS JOIN LATERAL unnest(
      constraint_row.conkey,
      constraint_row.confkey
    ) WITH ORDINALITY AS key(source_attnum, target_attnum, position)
    JOIN pg_attribute AS source_column
      ON source_column.attrelid = source_table.oid
      AND source_column.attnum = key.source_attnum
    JOIN pg_attribute AS target_column
      ON target_column.attrelid = target_table.oid
      AND target_column.attnum = key.target_attnum
    WHERE constraint_row.contype = 'f'
      AND source_namespace.nspname = 'public'
      AND target_namespace.nspname = 'public'
    GROUP BY source_namespace.nspname, source_table.relname, constraint_row.conname
  `);

  for (const row of result.rows) {
    const table = snapshot.tables[row.table_key];
    const foreignKeys = table?.["foreignKeys"] as
      | Record<string, { columnsFrom: string[]; columnsTo: string[] }>
      | undefined;
    const foreignKey = foreignKeys?.[row.constraint_name];
    if (foreignKey) {
      foreignKey.columnsFrom = row.columns_from;
      foreignKey.columnsTo = row.columns_to;
    }
  }
}

describe("provisional migration snapshot metadata", () => {
  const baseUrl = requireDatabaseUrl();
  const parentName = new URL(baseUrl).pathname.replace(/^\//u, "");
  const testDatabaseName = `taskdesk_snapshot_prefix_${randomUUID().replaceAll("-", "")}`;
  const testDatabaseUrl = withDatabaseName(baseUrl, testDatabaseName);
  let tempRoot: string | undefined;
  let createdDatabase = false;

  beforeAll(async () => {
    if (!parentName.endsWith("_test")) {
      throw new Error(
        `Refusing to create a migration replay database below non-test database "${parentName}"`,
      );
    }

    const admin = new Client({
      connectionString: adminConnectionString(baseUrl),
    });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(testDatabaseName)}`);
      createdDatabase = true;
    } finally {
      await admin.end();
    }

    tempRoot = mkdtempSync(join(tmpdir(), "taskdesk-snapshot-prefixes-"));
  }, 60_000);

  afterAll(async () => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    if (!createdDatabase) return;

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
  }, 60_000);

  it("matches every frozen SQL prefix 0088–0117 to Drizzle introspection", async () => {
    const journal = JSON.parse(
      readFileSync(join(metadataFolder, "_journal.json"), "utf8"),
    ) as MigrationJournal;
    expect(journal.entries.length).toBeGreaterThanOrEqual(
      FROZEN_PREFIX_ENTRY_COUNT,
    );

    const files = readdirSync(metadataFolder);
    const snapshotIds = new Set<string>();
    let previousId = (
      JSON.parse(
        readFileSync(join(metadataFolder, "0087_snapshot.json"), "utf8"),
      ) as Snapshot
    ).id;
    for (
      let prefix = FIRST_PROVISIONAL_PREFIX;
      prefix <= LAST_PROVISIONAL_PREFIX;
      prefix += 1
    ) {
      const name = `${String(prefix).padStart(4, "0")}_snapshot.json`;
      expect(
        files,
        `snapshot file for frozen migration prefix ${prefix}`,
      ).toContain(name);
      const snapshot = JSON.parse(
        readFileSync(join(metadataFolder, name), "utf8"),
      ) as Snapshot;
      expect(snapshot.prevId, `snapshot predecessor at ${name}`).toBe(
        previousId,
      );
      expect(
        snapshotIds.has(snapshot.id),
        `unique snapshot id at ${name}`,
      ).toBe(false);
      snapshotIds.add(snapshot.id);
      previousId = snapshot.id;
    }

    const pool = new Pool({ connectionString: testDatabaseUrl });
    const database = drizzle(pool);
    try {
      const acceptedBaseFolder = buildPrefixFolder(
        tempRoot as string,
        journal,
        FIRST_PROVISIONAL_PREFIX - 1,
      );
      await migrate(database, { migrationsFolder: acceptedBaseFolder });
      const acceptedBase = await pool.query(
        "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
      );
      expect(acceptedBase.rows[0]?.count).toBe(FIRST_PROVISIONAL_PREFIX);

      for (
        let index = FIRST_PROVISIONAL_PREFIX;
        index < FROZEN_PREFIX_ENTRY_COUNT;
        index += 1
      ) {
        const prefixFolder = buildPrefixFolder(
          tempRoot as string,
          journal,
          index,
        );
        await migrate(database, { migrationsFolder: prefixFolder });

        const prefix = String(index).padStart(4, "0");
        const applied = await pool.query(
          "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
        );
        expect(applied.rows[0]?.count, `migrations applied at ${prefix}`).toBe(
          index + 1,
        );

        const outputFolder = join(tempRoot as string, `introspect-${prefix}`);
        mkdirSync(outputFolder, { recursive: true });
        execFileSync(
          drizzleKitBin,
          [
            "introspect",
            "--dialect",
            "postgresql",
            "--url",
            testDatabaseUrl,
            "--out",
            outputFolder,
          ],
          {
            cwd: apiDir,
            encoding: "utf8",
            stdio: ["ignore", "ignore", "pipe"],
            maxBuffer: 50 * 1024 * 1024,
          },
        );

        const actual = JSON.parse(
          readFileSync(join(outputFolder, "meta/0000_snapshot.json"), "utf8"),
        ) as Snapshot;
        await restoreForeignKeyColumnOrder(actual, pool);
        const recorded = JSON.parse(
          readFileSync(join(metadataFolder, `${prefix}_snapshot.json`), "utf8"),
        ) as Snapshot;

        expect(
          schemaWithoutIdentity(actual),
          `schema after frozen SQL prefix ${prefix}`,
        ).toEqual(schemaWithoutIdentity(recorded));

        if (index === 88) {
          expect(actual.tables["public.sla_policy"]).toBeDefined();
          expect(actual.tables["public.project"]?.columns).not.toHaveProperty(
            "sla_policy_id",
          );
        }
        if (index === 89) {
          expect(actual.tables["public.project"]?.columns).toHaveProperty(
            "sla_policy_id",
          );
          expect(actual.tables["public.work_item"]?.columns).toHaveProperty(
            "sla_policy_version_id",
          );
          expect(actual.tables["public.workspace"]?.columns).toHaveProperty(
            "default_sla_policy_id",
          );
        }
      }
    } finally {
      await pool.end();
    }
  }, 600_000);
});
