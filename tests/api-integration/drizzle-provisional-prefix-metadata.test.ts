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
import { reorderTupleByCatalogKeys } from "./helpers/drizzle-catalog-order";

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

type OrderedConstraintColumns = {
  table_key: string;
  constraint_name: string;
  constraint_type: "p" | "u";
  columns: string[];
  nulls_not_distinct: boolean;
};

type OrderedIndexColumn = {
  table_key: string;
  index_name: string;
  position: number;
  attnum: number;
  expression: string;
  opclass: string;
  default_opclass: boolean;
  access_method: string;
  is_unique: boolean;
  predicate: string | null;
  descending: boolean;
  nulls_first: boolean;
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

function normalizeIdentifierQuotes(expression: string): string {
  return expression.replace(/"([^"]+)"/gu, "$1").trim();
}

async function restoreCatalogColumnOrder(
  snapshot: Snapshot,
  pool: Pool,
): Promise<void> {
  const foreignKeys = await pool.query<ForeignKeyColumns>(`
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

  for (const row of foreignKeys.rows) {
    const table = snapshot.tables[row.table_key];
    const tableForeignKeys = table?.foreignKeys as
      | Record<string, { columnsFrom: string[]; columnsTo: string[] }>
      | undefined;
    const foreignKey = tableForeignKeys?.[row.constraint_name];
    if (foreignKey) {
      foreignKey.columnsFrom = reorderTupleByCatalogKeys(
        foreignKey.columnsFrom,
        row.columns_from,
        (column) => column,
        `${row.table_key}.${row.constraint_name} source columns`,
      );
      foreignKey.columnsTo = reorderTupleByCatalogKeys(
        foreignKey.columnsTo,
        row.columns_to,
        (column) => column,
        `${row.table_key}.${row.constraint_name} target columns`,
      );
    } else {
      throw new Error(
        `Drizzle introspection omitted catalog foreign key ${row.table_key}.${row.constraint_name}`,
      );
    }
  }

  const constraints = await pool.query<OrderedConstraintColumns>(`
    SELECT
      source_namespace.nspname || '.' || source_table.relname AS table_key,
      constraint_row.conname AS constraint_name,
      constraint_row.contype AS constraint_type,
      array_agg(source_column.attname ORDER BY key.position)::text[] AS columns,
      COALESCE(bool_or(index_row.indnullsnotdistinct), false) AS nulls_not_distinct
    FROM pg_constraint AS constraint_row
    LEFT JOIN pg_index AS index_row
      ON index_row.indexrelid = constraint_row.conindid
    JOIN pg_class AS source_table
      ON source_table.oid = constraint_row.conrelid
    JOIN pg_namespace AS source_namespace
      ON source_namespace.oid = source_table.relnamespace
    CROSS JOIN LATERAL unnest(constraint_row.conkey)
      WITH ORDINALITY AS key(source_attnum, position)
    JOIN pg_attribute AS source_column
      ON source_column.attrelid = source_table.oid
      AND source_column.attnum = key.source_attnum
    WHERE constraint_row.contype IN ('p', 'u')
      AND (
        constraint_row.contype = 'u'
        OR cardinality(constraint_row.conkey) > 1
      )
      AND source_namespace.nspname = 'public'
    GROUP BY
      source_namespace.nspname,
      source_table.relname,
      constraint_row.conname,
      constraint_row.contype
  `);

  for (const row of constraints.rows) {
    const table = snapshot.tables[row.table_key];
    const category =
      row.constraint_type === "u"
        ? "uniqueConstraints"
        : "compositePrimaryKeys";
    const items = table?.[category] as
      | Record<string, { columns: string[]; nullsNotDistinct?: boolean }>
      | undefined;
    const constraint = items?.[row.constraint_name];
    if (constraint) {
      constraint.columns = reorderTupleByCatalogKeys(
        constraint.columns,
        row.columns,
        (column) => column,
        `${row.table_key}.${row.constraint_name}`,
      );
      if (row.constraint_type === "u") {
        constraint.nullsNotDistinct = row.nulls_not_distinct;
      }
    } else {
      throw new Error(
        `Drizzle introspection omitted catalog ${row.constraint_type === "u" ? "unique constraint" : "composite primary key"} ${row.table_key}.${row.constraint_name}`,
      );
    }
  }

  const indexes = await pool.query<OrderedIndexColumn>(`
    SELECT
      table_namespace.nspname || '.' || source_table.relname AS table_key,
      index_table.relname AS index_name,
      index_key.position::int AS position,
      index_key.attnum::int AS attnum,
      CASE
        WHEN index_key.attnum > 0 THEN key_column.attname
        ELSE pg_get_indexdef(index_row.indexrelid, index_key.position::int, true)
      END AS expression,
      operator_class_row.opcname AS opclass,
      operator_class_row.opcdefault AS default_opclass,
      access_method.amname AS access_method,
      index_row.indisunique AS is_unique,
      pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate,
      COALESCE((index_option.option_bits & 1) <> 0, false) AS descending,
      COALESCE((index_option.option_bits & 2) <> 0, false) AS nulls_first
    FROM pg_index AS index_row
    JOIN pg_class AS source_table
      ON source_table.oid = index_row.indrelid
    JOIN pg_namespace AS table_namespace
      ON table_namespace.oid = source_table.relnamespace
    JOIN pg_class AS index_table
      ON index_table.oid = index_row.indexrelid
    CROSS JOIN LATERAL unnest(index_row.indkey)
      WITH ORDINALITY AS index_key(attnum, position)
    JOIN LATERAL unnest(index_row.indclass)
      WITH ORDINALITY AS operator_class(opclass_oid, position)
      ON operator_class.position = index_key.position
    JOIN pg_opclass AS operator_class_row
      ON operator_class_row.oid = operator_class.opclass_oid
    JOIN pg_am AS access_method
      ON access_method.oid = operator_class_row.opcmethod
    LEFT JOIN LATERAL unnest(index_row.indoption)
      WITH ORDINALITY AS index_option(option_bits, position)
      ON index_option.position = index_key.position
    LEFT JOIN pg_attribute AS key_column
      ON key_column.attrelid = index_row.indrelid
      AND key_column.attnum = index_key.attnum
    WHERE table_namespace.nspname = 'public'
      AND index_key.position <= index_row.indnkeyatts
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS backing_constraint
        WHERE backing_constraint.conindid = index_row.indexrelid
          AND backing_constraint.contype IN ('p', 'u', 'x')
      )
    ORDER BY table_namespace.nspname, source_table.relname, index_table.relname, index_key.position
  `);
  const indexGroups = new Map<string, OrderedIndexColumn[]>();
  for (const row of indexes.rows) {
    const key = `${row.table_key}.${row.index_name}`;
    indexGroups.set(key, [...(indexGroups.get(key) ?? []), row]);
  }
  for (const [key, orderedColumns] of indexGroups) {
    const separator = key.lastIndexOf(".");
    const tableKey = key.slice(0, separator);
    const indexName = key.slice(separator + 1);
    const table = snapshot.tables[tableKey];
    const tableIndexes = table?.indexes as
      | Record<
          string,
          {
            columns: Array<{
              expression: string;
              opclass?: string;
              asc?: boolean;
              nulls?: string;
            }>;
          }
        >
      | undefined;
    const index = tableIndexes?.[indexName] ?? {
      name: indexName,
      columns: [],
      isUnique: orderedColumns[0]?.is_unique ?? false,
      concurrently: false,
      method: orderedColumns[0]?.access_method ?? "btree",
      with: {},
      ...(orderedColumns[0]?.predicate
        ? { where: orderedColumns[0].predicate }
        : {}),
    };
    if (!tableIndexes) {
      throw new Error(
        `Drizzle introspection omitted catalog table ${tableKey}`,
      );
    }
    tableIndexes[indexName] = index;
    if (index.columns.length === 0) {
      index.columns = orderedColumns.map((column) => ({
        expression: column.expression,
        isExpression: column.attnum <= 0,
        ...(column.access_method === "btree"
          ? {
              asc: !column.descending,
              nulls: column.nulls_first ? "first" : "last",
            }
          : {}),
        ...(column.default_opclass ? {} : { opclass: column.opclass }),
      }));
      continue;
    }
    index.columns = reorderTupleByCatalogKeys(
      index.columns,
      orderedColumns.map((column) =>
        normalizeIdentifierQuotes(column.expression),
      ),
      (item) => normalizeIdentifierQuotes(item.expression),
      key,
    );
    const columnsByExpression = new Map(
      orderedColumns.map((column) => [
        normalizeIdentifierQuotes(column.expression),
        column,
      ]),
    );
    for (const item of index.columns) {
      const catalog = columnsByExpression.get(
        normalizeIdentifierQuotes(item.expression),
      );
      if (!catalog)
        throw new Error(`Catalog index tuple key missing for ${key}`);
      if (catalog.default_opclass) delete item.opclass;
      else item.opclass = catalog.opclass;
      if (catalog.access_method === "btree") {
        item.asc = !catalog.descending;
        item.nulls = catalog.nulls_first ? "first" : "last";
      }
    }
  }
}

describe("provisional migration snapshot metadata", () => {
  const baseUrl = requireDatabaseUrl();
  const parentName = new URL(baseUrl).pathname.replace(/^\//u, "");
  const testDatabaseName = `taskdesk_snapshot_prefix_${randomUUID().replaceAll("-", "")}_test`;
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
      process.stdout.write(
        `Owned migration-prefix test database: ${testDatabaseName}\n`,
      );
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
      const remaining = await admin.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [testDatabaseName],
      );
      if ((remaining.rowCount ?? 0) > 0) {
        throw new Error(
          `Owned migration-prefix test database remains after cleanup: ${testDatabaseName}`,
        );
      }
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
        await restoreCatalogColumnOrder(actual, pool);
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
        if (index === LAST_PROVISIONAL_PREFIX) {
          const taskConstraints = actual.tables["public.task"]
            ?.uniqueConstraints as Record<string, { columns: string[] }>;
          expect(taskConstraints.task_project_number_unique?.columns).toEqual([
            "project_id",
            "number",
          ]);
          const pluginConfigConstraints = actual.tables[
            "public.instance_plugin_config"
          ]?.uniqueConstraints as Record<string, { columns: string[] }>;
          expect(
            pluginConfigConstraints.instance_plugin_config_instance_unique
              ?.columns,
          ).toEqual(["plugin_id", "instance_key"]);
          const labelConstraints = actual.tables["public.label"]
            ?.uniqueConstraints as Record<string, { columns: string[] }>;
          expect(labelConstraints.label_task_name_unique?.columns).toEqual([
            "task_id",
            "name",
          ]);
          const nullsNotDistinctConstraints = [
            actual.tables["public.notification_digest"]?.uniqueConstraints as
              | Record<string, { nullsNotDistinct?: boolean }>
              | undefined,
            actual.tables["public.notification_preference"]
              ?.uniqueConstraints as
              | Record<string, { nullsNotDistinct?: boolean }>
              | undefined,
            actual.tables["public.policy_shadow_tally"]?.uniqueConstraints as
              | Record<string, { nullsNotDistinct?: boolean }>
              | undefined,
          ];
          expect(
            nullsNotDistinctConstraints.map((constraints) =>
              Object.values(constraints ?? {}).some(
                (constraint) => constraint.nullsNotDistinct === true,
              ),
            ),
          ).toEqual([true, true, true]);
          expect(
            actual.tables["public.custom_field_type_visibility"]
              ?.compositePrimaryKeys,
          ).toHaveProperty(
            "custom_field_type_visibility_custom_field_id_work_item_type_id_",
          );
          expect(
            actual.tables["public.external_identity"]?.indexes,
          ).toHaveProperty("external_identity_connection_id_unique");
        }
      }
    } finally {
      await pool.end();
    }
  }, 600_000);
});
