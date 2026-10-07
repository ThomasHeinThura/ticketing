import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { reorderTupleByCatalogKeys } from "./helpers/drizzle-catalog-order";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");
const apiDir = join(repoRoot, "apps/api");
const migrationsFolder = join(apiDir, "drizzle");
const drizzleKitBin = join(apiDir, "node_modules/.bin/drizzle-kit");

type ColumnMetadata = {
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  default?: string | number | null;
};
type IndexColumnMetadata = {
  expression: string;
  asc: boolean;
  nulls: "first" | "last";
  isExpression: boolean;
  opclass?: string;
};
type IndexMetadata = {
  name: string;
  columns: IndexColumnMetadata[];
  isUnique: boolean;
  concurrently: boolean;
  method: string;
  where?: string;
  with: Record<string, unknown>;
  nullsNotDistinct?: boolean;
};
type KeyMetadata = {
  name: string;
  columns: string[];
  nullsNotDistinct?: boolean;
  [key: string]: unknown;
};
type ForeignKeyMetadata = {
  name: string;
  tableFrom: string;
  tableTo: string;
  schemaTo?: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
};
type CheckMetadata = { name: string; value: string };
type SnapshotTable = {
  name: string;
  columns: Record<string, ColumnMetadata>;
  indexes: Record<string, IndexMetadata>;
  foreignKeys: Record<string, ForeignKeyMetadata>;
  compositePrimaryKeys: Record<string, KeyMetadata>;
  uniqueConstraints: Record<string, KeyMetadata>;
  checkConstraints: Record<string, CheckMetadata>;
};
type MigrationSnapshot = {
  id?: string;
  prevId?: string;
  version?: string;
  dialect?: string;
  tables: Record<string, SnapshotTable>;
};

type JournalEntry = { idx: number; tag: string; [key: string]: unknown };

function requireFreshGeneratedSnapshot(args: {
  outputFolder: string;
  beforeHashes: Record<string, string>;
  generatorOutput: string;
  previousSnapshot: MigrationSnapshot;
  previousJournalEntries: JournalEntry[];
}): { snapshot: MigrationSnapshot; sqlPath: string } {
  const { outputFolder, beforeHashes, generatorOutput, previousSnapshot } =
    args;
  if (
    !generatorOutput.trim() ||
    /No schema changes, nothing to migrate/iu.test(generatorOutput)
  ) {
    throw new Error(
      "Configured-schema generation did not produce validated change output",
    );
  }
  const sqlFiles = readdirSync(outputFolder).filter(
    (name) => name.startsWith("0118_") && name.endsWith(".sql"),
  );
  if (sqlFiles.length !== 1) {
    throw new Error(
      `Expected exactly one fresh 0118 SQL output, found ${sqlFiles.length}`,
    );
  }
  const sqlName = sqlFiles[0];
  if (!sqlName) throw new Error("Fresh SQL artifact was not identified");
  const sqlPath = join(outputFolder, sqlName);
  const relativeSqlPath = relative(outputFolder, sqlPath);
  if (beforeHashes[relativeSqlPath] !== undefined) {
    throw new Error(
      "Generated 0118 SQL output was present before this generator run",
    );
  }

  const snapshotRelativePath = "meta/0118_snapshot.json";
  const snapshotPath = join(outputFolder, snapshotRelativePath);
  if (
    !existsSync(snapshotPath) ||
    beforeHashes[snapshotRelativePath] !== undefined
  ) {
    throw new Error(
      "Configured-schema generation did not produce a fresh 0118 snapshot",
    );
  }
  let snapshot: MigrationSnapshot;
  try {
    snapshot = JSON.parse(
      readFileSync(snapshotPath, "utf8"),
    ) as MigrationSnapshot;
  } catch {
    throw new Error("Fresh 0118 snapshot is malformed JSON");
  }
  if (
    typeof snapshot.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      snapshot.id,
    ) ||
    snapshot.id === previousSnapshot.id ||
    snapshot.prevId !== previousSnapshot.id ||
    snapshot.version !== previousSnapshot.version ||
    snapshot.dialect !== "postgresql" ||
    !snapshot.tables ||
    typeof snapshot.tables !== "object" ||
    Object.keys(snapshot.tables).length === 0
  ) {
    throw new Error(
      "Fresh 0118 snapshot has stale identity, wrong predecessor, or invalid schema provenance",
    );
  }

  let journal: { entries: JournalEntry[] };
  try {
    journal = JSON.parse(
      readFileSync(join(outputFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: JournalEntry[] };
  } catch {
    throw new Error(
      "Configured-schema generation produced a malformed journal",
    );
  }
  const beforeEntries = args.previousJournalEntries;
  const lastBefore = beforeEntries.at(-1);
  const lastAfter = journal.entries.at(-1);
  if (
    stableJson(journal.entries.slice(0, beforeEntries.length)) !==
      stableJson(beforeEntries) ||
    journal.entries.length !== beforeEntries.length + 1 ||
    !lastBefore ||
    !lastAfter ||
    lastAfter.idx !== lastBefore.idx + 1 ||
    lastAfter.tag !== sqlFiles[0]?.slice(0, -4)
  ) {
    throw new Error(
      "Configured-schema generation did not append exactly one matching journal entry",
    );
  }
  return { snapshot, sqlPath };
}

type DefaultRenderingPair = { expected: unknown; proposed: unknown };

/** The same fail-closed inventory gate is used by generation and mutation tests. */
function inventoryDifferences(
  expected: MigrationSnapshot,
  proposed: MigrationSnapshot,
  allowedDefaultRenderings: Readonly<Record<string, DefaultRenderingPair>> = {},
): string[] {
  const differences: string[] = [];
  const expectedTables = Object.keys(expected.tables).sort();
  const proposedTables = Object.keys(proposed.tables).sort();
  if (stableJson(expectedTables) !== stableJson(proposedTables)) {
    differences.push("tables:inventory");
  }

  for (const tableName of [
    ...new Set([...expectedTables, ...proposedTables]),
  ].sort()) {
    const left = expected.tables[tableName];
    const right = proposed.tables[tableName];
    if (!left || !right) continue;
    if (left.name !== right.name) {
      differences.push(`tables:${tableName}:name`);
    }
    const leftColumns = Object.keys(left.columns).sort();
    const rightColumns = Object.keys(right.columns).sort();
    if (stableJson(leftColumns) !== stableJson(rightColumns)) {
      differences.push(`columns:${tableName}:inventory`);
    }
    for (const columnName of [
      ...new Set([...leftColumns, ...rightColumns]),
    ].sort()) {
      const oldColumn = left.columns[columnName];
      const newColumn = right.columns[columnName];
      const key = `${tableName}.${columnName}`;
      if (!oldColumn || !newColumn) continue;
      const oldWithoutDefault = { ...oldColumn, default: undefined };
      const newWithoutDefault = { ...newColumn, default: undefined };
      if (stableJson(oldWithoutDefault) !== stableJson(newWithoutDefault)) {
        differences.push(`columns:${key}:type-nullability-primary-key`);
      }
      if (stableJson(oldColumn.default) !== stableJson(newColumn.default)) {
        const permitted = allowedDefaultRenderings[key];
        if (
          !permitted ||
          stableJson(permitted.expected) !== stableJson(oldColumn.default) ||
          stableJson(permitted.proposed) !== stableJson(newColumn.default)
        ) {
          differences.push(`columns:${key}:default`);
        }
      }
    }

    const entries = (category: keyof SnapshotTable) =>
      Object.entries(left[category] as Record<string, unknown>).map(
        ([name, value]) => [name, value] as const,
      );
    const proposedEntries = (category: keyof SnapshotTable) =>
      Object.entries(right[category] as Record<string, unknown>).map(
        ([name, value]) => [name, value] as const,
      );
    for (const category of [
      "foreignKeys",
      "uniqueConstraints",
      "compositePrimaryKeys",
      "indexes",
      "checkConstraints",
    ] as const) {
      const normalize = (values: readonly (readonly [string, unknown])[]) =>
        values
          .map(([name, raw]) => {
            const value = raw as Record<string, unknown>;
            if (category === "foreignKeys") {
              return stableJson({
                ...value,
                name: name.slice(0, 63),
                schemaTo: value.schemaTo ?? "public",
              });
            }
            const { name: _name, ...fields } = value;
            return stableJson({ name, ...fields });
          })
          .sort();
      if (
        stableJson(normalize(entries(category))) !==
        stableJson(normalize(proposedEntries(category)))
      ) {
        differences.push(`${category}:${tableName}:inventory-or-semantics`);
      }
    }
  }
  return differences;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function expressionTokens(value: string): string[] {
  const result: string[] = [];
  const tokenPattern =
    /(?:E)?'(?:''|[^'])*'|"(?:""|[^"])*"|::|[A-Za-z_][\w$]*|[0-9]+|<=|>=|<>|!=|@>|<@|!~~\*|~~\*|!~~|!~|~~|~|->>|->|\?&|\|\||&&|[()[\],.:=<>+*/-]/giu;
  let offset = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const token = match[0];
    if (value.slice(offset, match.index).trim()) {
      throw new Error(
        `Unsupported SQL expression syntax near ${value.slice(Math.max(0, offset - 30), (match.index ?? offset) + 30)}`,
      );
    }
    offset = (match.index ?? 0) + token.length;
    if (token.startsWith('"'))
      result.push(token.slice(1, -1).replaceAll('""', '"'));
    else if (/^(?:E)?'/u.test(token)) result.push(token);
    else result.push(token.toLowerCase());
  }
  if (value.slice(offset).trim()) {
    throw new Error(
      `Unsupported SQL expression syntax near ${value.slice(offset)}`,
    );
  }
  return result;
}

type InventoryValue<K extends keyof SnapshotTable> = K extends "columns"
  ? ColumnMetadata
  : K extends "indexes"
    ? IndexMetadata
    : K extends "foreignKeys"
      ? ForeignKeyMetadata
      : K extends "compositePrimaryKeys" | "uniqueConstraints"
        ? KeyMetadata
        : K extends "checkConstraints"
          ? CheckMetadata
          : never;

function inventoryEntries<K extends keyof SnapshotTable>(
  snapshot: MigrationSnapshot,
  category: K,
): Array<[string, string, InventoryValue<K>]> {
  return Object.entries(snapshot.tables).flatMap(([tableName, table]) =>
    Object.entries(
      table[category] as unknown as Record<string, SnapshotTable[K]>,
    ).map(([name, value]) => [
      tableName,
      name,
      value as unknown as InventoryValue<K>,
    ]),
  );
}

function sourceColumnDefault(
  directory: string,
  tableName: string,
  columnName: string,
): string {
  let latest: string | undefined;
  for (const fileName of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const source = readFileSync(join(directory, fileName), "utf8");
    for (const statement of source.split("--> statement-breakpoint")) {
      const isTableDefinition = new RegExp(
        `CREATE TABLE "${tableName}"(?:\\s|\\()`,
        "iu",
      ).test(statement);
      const isAddedColumn = new RegExp(
        `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}"\\s`,
        "iu",
      ).test(statement);
      const isAlteredDefault = new RegExp(
        `ALTER TABLE "${tableName}" ALTER COLUMN "${columnName}" SET DEFAULT\\b`,
        "iu",
      ).test(statement);
      if (isTableDefinition || isAddedColumn) {
        const columnOffset = statement.indexOf(`"${columnName}"`);
        if (columnOffset < 0) continue;
        const defaultOffset = statement.indexOf("DEFAULT", columnOffset);
        if (defaultOffset < 0) continue;
        const endOffset = statement.indexOf("NOT NULL", defaultOffset);
        if (endOffset >= 0) {
          latest = statement
            .slice(defaultOffset + "DEFAULT".length, endOffset)
            .trim();
        }
      } else if (isAlteredDefault) {
        const defaultOffset =
          statement.indexOf("SET DEFAULT") + "SET DEFAULT".length;
        const endOffset = statement.indexOf(";", defaultOffset);
        if (endOffset >= 0) {
          latest = statement.slice(defaultOffset, endOffset).trim();
        }
      }
    }
  }
  if (!latest)
    throw new Error(
      `No frozen SQL default found for ${tableName}.${columnName}`,
    );
  return latest;
}

function generatedColumnDefault(
  sql: string,
  tableName: string,
  columnName: string,
): string {
  const statement = sql.match(
    new RegExp(
      `ALTER TABLE "${tableName}" ALTER COLUMN "${columnName}" SET DEFAULT([\\s\\S]*?);`,
      "iu",
    ),
  );
  if (!statement?.[1]) {
    throw new Error(
      `No generated SQL default found for ${tableName}.${columnName}`,
    );
  }
  return statement[1].trim();
}

function canonicalDefault(value: string): string {
  return expressionTokens(value).join(" ");
}

function hashesIn(directory: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        hashes[relative(directory, path)] = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
      }
    }
  };
  visit(directory);
  return hashes;
}

it("keeps SQL-owned tables and ordered keys safe during configured generation", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "taskdesk-drizzle-generate-"));
  const outputFolder = join(tempRoot, "drizzle");
  const configPath = join(tempRoot, "drizzle.config.mjs");

  let succeeded = false;
  try {
    cpSync(migrationsFolder, outputFolder, {
      recursive: true,
      dereference: true,
    });
    const config = [
      "import { defineConfig } from 'drizzle-kit';",
      `export default defineConfig({out:${JSON.stringify(relative(apiDir, outputFolder))},schema:['./src/database/schema.ts','./src/database/migration-schema.ts','./src/permissions/shadow-schema.ts'],dialect:'postgresql',dbCredentials:{url:'postgresql://unused:unused@localhost:5432/unused'}});`,
      "",
    ].join("\n");
    writeFileSync(configPath, config);

    const before = hashesIn(outputFolder);
    const beforeJournal = JSON.parse(
      readFileSync(join(outputFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    const output = execFileSync(
      drizzleKitBin,
      ["generate", "--config", configPath],
      {
        cwd: apiDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    const after = hashesIn(outputFolder);
    for (const [path, hash] of Object.entries(before)) {
      if (path === "meta/_journal.json") continue;
      expect(after[path], `${path} should remain byte-identical`).toBe(hash);
    }
    const afterJournal = JSON.parse(
      readFileSync(join(outputFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    expect(afterJournal.entries.slice(0, beforeJournal.entries.length)).toEqual(
      beforeJournal.entries,
    );

    const frozenSnapshot = JSON.parse(
      readFileSync(join(migrationsFolder, "meta/0117_snapshot.json"), "utf8"),
    ) as MigrationSnapshot;
    const generatedEvidence = requireFreshGeneratedSnapshot({
      outputFolder,
      beforeHashes: before,
      generatorOutput: output,
      previousSnapshot: frozenSnapshot,
      previousJournalEntries: beforeJournal.entries as JournalEntry[],
    });
    const generatedSnapshot = generatedEvidence.snapshot;
    const generatedSqlPath = relative(outputFolder, generatedEvidence.sqlPath);
    const expectedDefaultRenderings = new Set([
      "public.identity_connection.domain_bindings",
      "public.instance_setting.attachment_allowed_extensions",
      "public.organisation_quota.max_storage_bytes",
      "public.scim_connection.allowed_resources",
      "public.scim_connection.match_attributes",
    ]);
    const frozenColumns = Object.entries(frozenSnapshot.tables).flatMap(
      ([tableName, table]) =>
        Object.entries(table.columns).map(
          ([columnName, column]) =>
            [`${tableName}.${columnName}`, column] as const,
        ),
    );
    const generatedColumnsByKey = new Map(
      Object.entries(generatedSnapshot.tables).flatMap(([tableName, table]) =>
        Object.entries(table.columns).map(
          ([columnName, column]) =>
            [`${tableName}.${columnName}`, column] as const,
        ),
      ),
    );
    const defaultPairs: Record<string, DefaultRenderingPair> = {};
    for (const [key, frozenColumn] of frozenColumns) {
      const generatedColumn = generatedColumnsByKey.get(key);
      if (
        generatedColumn &&
        stableJson(frozenColumn.default) !==
          stableJson(generatedColumn.default) &&
        expectedDefaultRenderings.has(key)
      ) {
        defaultPairs[key] = {
          expected: frozenColumn.default,
          proposed: generatedColumn.default,
        };
      }
    }
    expect(Object.keys(defaultPairs).sort()).toEqual(
      [...expectedDefaultRenderings].sort(),
    );
    expect(
      inventoryDifferences(frozenSnapshot, generatedSnapshot, defaultPairs),
      "configured generation must preserve complete applied table and constraint semantics",
    ).toEqual([]);

    expect(
      generatedSnapshot.tables["public.custom_field_section"],
    ).toBeDefined();
    expect(generatedSnapshot.tables["public.custom_field"]).toBeDefined();
    expect(
      generatedSnapshot.tables["public.custom_field_type_visibility"],
    ).toBeDefined();
    expect(generatedSnapshot.tables["public.custom_field_value"]).toBeDefined();
    expect(generatedSnapshot.tables["public.sla_pause"]).toBeDefined();
    expect(
      generatedSnapshot.tables["public.policy_shadow_tally"],
    ).toBeDefined();
    expect(
      generatedSnapshot.tables["public.policy_shadow_event"],
    ).toBeDefined();

    const taskConstraints =
      generatedSnapshot.tables["public.task"]?.uniqueConstraints;
    expect(taskConstraints?.task_project_number_unique?.columns).toEqual([
      "project_id",
      "number",
    ]);
    const pluginConstraints =
      generatedSnapshot.tables["public.instance_plugin_config"]
        ?.uniqueConstraints;
    expect(
      pluginConstraints?.instance_plugin_config_instance_unique?.columns,
    ).toEqual(["plugin_id", "instance_key"]);
    const labelConstraints =
      generatedSnapshot.tables["public.label"]?.uniqueConstraints;
    expect(labelConstraints?.label_task_name_unique?.columns).toEqual([
      "task_id",
      "name",
    ]);

    {
      const generatedSql = readFileSync(
        join(outputFolder, generatedSqlPath),
        "utf8",
      );
      expect(generatedSql).not.toMatch(/\bDROP\s+TABLE\b/iu);
      expect(generatedSql).not.toMatch(/\bCREATE\s+TABLE\b/iu);
      expect(generatedSql).not.toMatch(/\bDROP\s+COLUMN\b/iu);
      expect(generatedSql).not.toMatch(/\bALTER\s+COLUMN\b[^;]*\bTYPE\b/iu);
      expect(generatedSql).not.toMatch(
        /\bALTER\s+COLUMN\b[^;]*\b(?:SET|DROP)\s+NOT\s+NULL\b/iu,
      );
      expect(generatedSql).not.toMatch(
        /\bALTER\s+COLUMN\b[^;]*\bDROP\s+DEFAULT\b/iu,
      );
      for (const key of expectedDefaultRenderings) {
        const [, tableName, columnName] =
          key.match(/^public\.([^.]+)\.([^.]+)$/u) ?? [];
        if (!tableName || !columnName) {
          throw new Error(`Invalid default key ${key}`);
        }
        expect(
          canonicalDefault(
            generatedColumnDefault(generatedSql, tableName, columnName),
          ),
          `${key} configured SQL default must match its applied migration default`,
        ).toBe(
          canonicalDefault(
            sourceColumnDefault(migrationsFolder, tableName, columnName),
          ),
        );
      }

      const constraints = (snapshot: typeof frozenSnapshot) =>
        Object.values(snapshot.tables).flatMap((table) => [
          ...Object.keys(table.uniqueConstraints ?? {}),
          ...Object.keys(table.compositePrimaryKeys ?? {}),
        ]);
      const frozenUniqueAndPrimaryKeys = new Set(constraints(frozenSnapshot));
      const droppedConstraints = [
        ...generatedSql.matchAll(/DROP CONSTRAINT "([^"]+)"/giu),
      ].flatMap((match) => (match[1] ? [match[1]] : []));
      expect(
        droppedConstraints.filter((name) =>
          frozenUniqueAndPrimaryKeys.has(name),
        ),
      ).toEqual([]);

      const physicalConstraintName = (name: string) => name.slice(0, 63);
      const addedConstraints = [
        ...generatedSql.matchAll(/ADD CONSTRAINT "([^"]+)"/giu),
      ].flatMap((match) => (match[1] ? [match[1]] : []));
      const droppedPhysicalNames = droppedConstraints
        .map(physicalConstraintName)
        .sort();
      expect(addedConstraints.map(physicalConstraintName).sort()).toEqual(
        droppedPhysicalNames,
      );
      const frozenPhysicalConstraints = new Set([
        ...inventoryEntries(frozenSnapshot, "foreignKeys").map(([, name]) =>
          physicalConstraintName(name),
        ),
        ...inventoryEntries(frozenSnapshot, "checkConstraints").map(
          ([, name]) => physicalConstraintName(name),
        ),
      ]);
      expect(
        droppedPhysicalNames.every((name) =>
          frozenPhysicalConstraints.has(name),
        ),
      ).toBe(true);
      const expectedPhysicalNameTruncations = addedConstraints
        .filter((name) => name.length > 63)
        .map(physicalConstraintName)
        .sort();
      expect(droppedPhysicalNames).toEqual(expectedPhysicalNameTruncations);
      const frozenCheckNames = inventoryEntries(
        frozenSnapshot,
        "checkConstraints",
      ).map(([, name]) => physicalConstraintName(name));
      const generatedCheckConstraintRewrites = droppedPhysicalNames.filter(
        (name) => frozenCheckNames.includes(name),
      ).length;
      expect(
        generatedCheckConstraintRewrites,
        "configured check expressions must not be rebuilt during generation",
      ).toBe(0);
      const addedPhysicalNames = new Set(
        addedConstraints.map(physicalConstraintName),
      );
      expect(
        droppedConstraints.filter(
          (name) => !addedPhysicalNames.has(physicalConstraintName(name)),
        ),
      ).toEqual([]);
      process.stderr.write(
        `Configured-schema SQL residual: ${JSON.stringify({
          physicalNameTruncationReplacements: addedConstraints.filter(
            (name) => name.length > 63,
          ).length,
          generatedCheckConstraintRewrites,
        })}\n`,
      );

      const generatedDefaults = [
        ...generatedSql.matchAll(
          /ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET DEFAULT/giu,
        ),
      ]
        .map((match) => `public.${match[1]}.${match[2]}`)
        .sort();
      expect(generatedDefaults).toEqual([...expectedDefaultRenderings].sort());

      const droppedIndexNames = [
        ...generatedSql.matchAll(/DROP INDEX "([^"]+)"/giu),
      ]
        .flatMap((match) => (match[1] ? [match[1]] : []))
        .sort();
      const createdIndexNames = [
        ...generatedSql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/giu),
      ]
        .flatMap((match) => (match[1] ? [match[1]] : []))
        .sort();
      expect(createdIndexNames).toEqual(droppedIndexNames);
      expect(
        droppedIndexNames,
        "equivalent catalog indexes must not be rebuilt",
      ).toEqual([]);
    }
    succeeded = true;
  } finally {
    if (succeeded) {
      rmSync(tempRoot, { recursive: true, force: true });
    } else {
      process.stderr.write(
        `Drizzle generation failure artifacts retained at ${tempRoot}\n`,
      );
    }
  }
}, 180_000);

it("reorders arbitrary catalog tuples without losing index metadata", () => {
  const inspected = [
    { expression: "gamma", opclass: "text_ops" },
    { expression: "epsilon", opclass: "text_ops" },
    { expression: "alpha", opclass: "text_ops" },
    { expression: "delta", opclass: "text_ops" },
    { expression: "beta", opclass: "text_ops" },
  ];
  const result = reorderTupleByCatalogKeys(
    inspected,
    ["alpha", "beta", "gamma", "delta", "epsilon"],
    (column) => column.expression,
    "fixture composite index",
  );

  expect(result.map((column) => column.expression)).toEqual([
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
  ]);
  expect(result.every((column) => column.opclass === "text_ops")).toBe(true);
});

it("requires independently generated snapshot evidence before inventory acceptance", () => {
  const previousSnapshot: MigrationSnapshot = {
    id: "11111111-1111-4111-8111-111111111111",
    prevId: "00000000-0000-4000-8000-000000000000",
    version: "7",
    dialect: "postgresql",
    tables: {
      "public.fixture": {
        name: "fixture",
        columns: {
          id: { type: "integer", notNull: true, primaryKey: true },
        },
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {},
        checkConstraints: {},
      },
    },
  };
  const previousJournalEntries: JournalEntry[] = [
    { idx: 117, version: "7", when: 1, tag: "0117_frozen", breakpoints: true },
  ];
  const makeOutput = (
    options: {
      snapshot?: MigrationSnapshot | string;
      journalEntries?: JournalEntry[];
    } = {},
  ) => {
    const outputFolder = mkdtempSync(
      join(tmpdir(), "taskdesk-fresh-snapshot-"),
    );
    mkdirSync(join(outputFolder, "meta"));
    writeFileSync(
      join(outputFolder, "meta/0117_snapshot.json"),
      JSON.stringify(previousSnapshot),
    );
    writeFileSync(
      join(outputFolder, "meta/_journal.json"),
      JSON.stringify({ entries: previousJournalEntries }),
    );
    const beforeHashes = hashesIn(outputFolder);
    writeFileSync(join(outputFolder, "0118_fixture.sql"), "-- generated SQL\n");
    if (options.snapshot !== undefined) {
      writeFileSync(
        join(outputFolder, "meta/0118_snapshot.json"),
        typeof options.snapshot === "string"
          ? options.snapshot
          : JSON.stringify(options.snapshot),
      );
    }
    writeFileSync(
      join(outputFolder, "meta/_journal.json"),
      JSON.stringify({
        entries: options.journalEntries ?? [
          ...previousJournalEntries,
          {
            idx: 118,
            version: "7",
            when: 2,
            tag: "0118_fixture",
            breakpoints: true,
          },
        ],
      }),
    );
    return { outputFolder, beforeHashes };
  };
  const validSnapshot: MigrationSnapshot = {
    ...previousSnapshot,
    id: "22222222-2222-4222-8222-222222222222",
    prevId: previousSnapshot.id,
  };
  const invoke = (
    fixture: ReturnType<typeof makeOutput>,
    generatorOutput = "Generated migration 0118_fixture",
  ) =>
    requireFreshGeneratedSnapshot({
      ...fixture,
      generatorOutput,
      previousSnapshot,
      previousJournalEntries,
    });

  const validFixture = makeOutput({ snapshot: validSnapshot });
  try {
    expect(invoke(validFixture).snapshot).toEqual(validSnapshot);
    expect(
      inventoryDifferences(previousSnapshot, invoke(validFixture).snapshot),
    ).toEqual([]);
  } finally {
    rmSync(validFixture.outputFolder, { recursive: true, force: true });
  }

  const missing = makeOutput();
  try {
    expect(() => invoke(missing)).toThrow(
      "did not produce a fresh 0118 snapshot",
    );
  } finally {
    rmSync(missing.outputFolder, { recursive: true, force: true });
  }

  const malformed = makeOutput({ snapshot: "{" });
  try {
    expect(() => invoke(malformed)).toThrow("malformed JSON");
  } finally {
    rmSync(malformed.outputFolder, { recursive: true, force: true });
  }

  for (const [label, snapshot] of [
    ["same identity", { ...validSnapshot, id: previousSnapshot.id }],
    [
      "wrong predecessor",
      { ...validSnapshot, prevId: previousSnapshot.prevId },
    ],
  ] as const) {
    const stale = makeOutput({ snapshot });
    try {
      expect(() => invoke(stale), label).toThrow(
        "stale identity, wrong predecessor",
      );
    } finally {
      rmSync(stale.outputFolder, { recursive: true, force: true });
    }
  }

  const copiedStale = makeOutput({ snapshot: validSnapshot });
  copiedStale.beforeHashes["meta/0118_snapshot.json"] = "preexisting";
  try {
    expect(() => invoke(copiedStale)).toThrow(
      "did not produce a fresh 0118 snapshot",
    );
  } finally {
    rmSync(copiedStale.outputFolder, { recursive: true, force: true });
  }

  const noChange = makeOutput({ snapshot: validSnapshot });
  try {
    expect(() =>
      invoke(noChange, "No schema changes, nothing to migrate"),
    ).toThrow("did not produce validated change output");
  } finally {
    rmSync(noChange.outputFolder, { recursive: true, force: true });
  }
});

it("fails closed when PostgreSQL and Drizzle tuple inventories differ", () => {
  expect(() =>
    reorderTupleByCatalogKeys(
      ["project_id", "number"],
      ["project_id", "number", "workspace_id"],
      (column) => column,
      "fixture unique constraint",
    ),
  ).toThrow("PostgreSQL has 3 keys but Drizzle introspection has 2");
  expect(() =>
    reorderTupleByCatalogKeys(
      ["project_id", "number"],
      ["project_id", "missing"],
      (column) => column,
      "fixture foreign key",
    ),
  ).toThrow("catalog tuple key missing is not introspected");
});

it("rejects every semantic inventory mutation through the generation acceptance gate", () => {
  const trusted = (): MigrationSnapshot => ({
    tables: {
      "public.parent": {
        name: "parent",
        columns: {
          id: { type: "integer", notNull: true, primaryKey: true },
        },
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {},
        checkConstraints: {},
      },
      "public.child": {
        name: "child",
        columns: {
          id: { type: "integer", notNull: true, primaryKey: true },
          parent_a: { type: "integer", notNull: true, primaryKey: false },
          parent_b: { type: "integer", notNull: true, primaryKey: false },
          value: {
            type: "text",
            notNull: false,
            primaryKey: false,
            default: "'initial'::text",
          },
        },
        indexes: {
          child_value_idx: {
            name: "child_value_idx",
            columns: [
              {
                expression: "parent_a",
                asc: true,
                nulls: "last",
                isExpression: false,
              },
              {
                expression: "value",
                asc: false,
                nulls: "first",
                isExpression: false,
              },
            ],
            isUnique: true,
            concurrently: false,
            method: "btree",
            where: "value IS NOT NULL",
            with: {},
            nullsNotDistinct: false,
          },
        },
        foreignKeys: {
          ["f".repeat(63)]: {
            name: "f".repeat(63),
            tableFrom: "child",
            tableTo: "parent",
            schemaTo: "public",
            columnsFrom: ["parent_a", "parent_b"],
            columnsTo: ["id", "id"],
            onDelete: "cascade",
            onUpdate: "no action",
          },
        },
        compositePrimaryKeys: {
          child_pk: { name: "child_pk", columns: ["parent_a", "parent_b"] },
        },
        uniqueConstraints: {
          child_value_unique: {
            name: "child_value_unique",
            columns: ["parent_a", "parent_b"],
            nullsNotDistinct: false,
          },
        },
        checkConstraints: {
          child_value_check: {
            name: "child_value_check",
            value: "value <> 'blocked'::text",
          },
        },
      },
    },
  });
  const baseline = trusted();
  const clone = (snapshot: MigrationSnapshot): MigrationSnapshot =>
    JSON.parse(JSON.stringify(snapshot)) as MigrationSnapshot;
  const accept = (candidate: MigrationSnapshot) =>
    inventoryDifferences(baseline, candidate);
  expect(accept(clone(baseline))).toEqual([]);

  const mutations: Array<[string, (candidate: MigrationSnapshot) => void]> = [
    [
      "table inventory",
      (candidate) => {
        delete candidate.tables["public.parent"];
      },
    ],
    [
      "table name",
      (candidate) => {
        const table = candidate.tables["public.child"];
        if (table) table.name = "other_child";
      },
    ],
    [
      "column inventory",
      (candidate) => {
        delete candidate.tables["public.child"]?.columns.parent_b;
      },
    ],
    [
      "column type",
      (candidate) => {
        const column = candidate.tables["public.child"]?.columns.value;
        if (column) column.type = "integer";
      },
    ],
    [
      "column nullability",
      (candidate) => {
        const column = candidate.tables["public.child"]?.columns.value;
        if (column) column.notNull = true;
      },
    ],
    [
      "column default",
      (candidate) => {
        const column = candidate.tables["public.child"]?.columns.value;
        if (column) column.default = "'changed'::text";
      },
    ],
    [
      "column primary key",
      (candidate) => {
        const column = candidate.tables["public.child"]?.columns.value;
        if (column) column.primaryKey = true;
      },
    ],
    [
      "foreign key columns",
      (candidate) => {
        const fk = Object.values(
          candidate.tables["public.child"]?.foreignKeys ?? {},
        )[0];
        if (fk) fk.columnsFrom.reverse();
      },
    ],
    [
      "foreign key action",
      (candidate) => {
        const fk = Object.values(
          candidate.tables["public.child"]?.foreignKeys ?? {},
        )[0];
        if (fk) fk.onDelete = "restrict";
      },
    ],
    [
      "missing foreign key",
      (candidate) => {
        const foreignKeys = candidate.tables["public.child"]?.foreignKeys;
        if (foreignKeys) delete foreignKeys[Object.keys(foreignKeys)[0] ?? ""];
      },
    ],
    [
      "unique tuple order",
      (candidate) => {
        candidate.tables[
          "public.child"
        ]?.uniqueConstraints.child_value_unique?.columns.reverse();
      },
    ],
    [
      "missing unique constraint",
      (candidate) => {
        const constraints = candidate.tables["public.child"]?.uniqueConstraints;
        if (constraints) delete constraints.child_value_unique;
      },
    ],
    [
      "unique NULLS NOT DISTINCT",
      (candidate) => {
        const key =
          candidate.tables["public.child"]?.uniqueConstraints
            .child_value_unique;
        if (key) key.nullsNotDistinct = true;
      },
    ],
    [
      "missing composite primary key",
      (candidate) => {
        const keys = candidate.tables["public.child"]?.compositePrimaryKeys;
        if (keys) delete keys.child_pk;
      },
    ],
    [
      "primary key tuple order",
      (candidate) => {
        candidate.tables[
          "public.child"
        ]?.compositePrimaryKeys.child_pk?.columns.reverse();
      },
    ],
    [
      "index key order",
      (candidate) => {
        candidate.tables[
          "public.child"
        ]?.indexes.child_value_idx?.columns.reverse();
      },
    ],
    [
      "missing index",
      (candidate) => {
        const indexes = candidate.tables["public.child"]?.indexes;
        if (indexes) delete indexes.child_value_idx;
      },
    ],
    [
      "index direction",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index?.columns[0]) index.columns[0].asc = false;
      },
    ],
    [
      "index null ordering",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index?.columns[0]) index.columns[0].nulls = "first";
      },
    ],
    [
      "index expression marker",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index?.columns[0]) index.columns[0].isExpression = true;
      },
    ],
    [
      "index uniqueness",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index) index.isUnique = false;
      },
    ],
    [
      "index concurrency",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index) index.concurrently = true;
      },
    ],
    [
      "index method",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index) index.method = "gin";
      },
    ],
    [
      "index predicate",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index) index.where = "value IS NULL";
      },
    ],
    [
      "index expression",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index?.columns[0]) index.columns[0].expression = "lower(value)";
      },
    ],
    [
      "index option",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index) index.with.fillfactor = 80;
      },
    ],
    [
      "index opclass",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index?.columns[0]) index.columns[0].opclass = "text_pattern_ops";
      },
    ],
    [
      "index NULLS NOT DISTINCT",
      (candidate) => {
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        if (index) index.nullsNotDistinct = true;
      },
    ],
    [
      "check expression",
      (candidate) => {
        const check =
          candidate.tables["public.child"]?.checkConstraints.child_value_check;
        if (check) check.value = "value <> 'allowed'::text";
      },
    ],
    [
      "missing check constraint",
      (candidate) => {
        const checks = candidate.tables["public.child"]?.checkConstraints;
        if (checks) delete checks.child_value_check;
      },
    ],
    [
      "mixed structural changes",
      (candidate) => {
        const column = candidate.tables["public.child"]?.columns.value;
        const index = candidate.tables["public.child"]?.indexes.child_value_idx;
        const check =
          candidate.tables["public.child"]?.checkConstraints.child_value_check;
        if (column) column.type = "integer";
        if (index) index.where = "value IS NULL";
        if (check) check.value = "value = 'allowed'::text";
      },
    ],
  ];
  for (const [label, mutate] of mutations) {
    const candidate = clone(baseline);
    mutate(candidate);
    expect(
      accept(candidate),
      `${label} must be rejected by the shared gate`,
    ).not.toEqual([]);
  }

  const physicalNameDifference = clone(baseline);
  const physicalKey = "f".repeat(63);
  const generatedForeignKey =
    physicalNameDifference.tables["public.child"]?.foreignKeys[physicalKey];
  const candidateForeignKeys =
    physicalNameDifference.tables["public.child"]?.foreignKeys;
  if (generatedForeignKey && candidateForeignKeys) {
    delete candidateForeignKeys[physicalKey];
    candidateForeignKeys[`${physicalKey}generated_suffix`] = {
      ...generatedForeignKey,
      name: `${physicalKey}generated_suffix`,
    };
  }
  expect(
    accept(physicalNameDifference),
    "PostgreSQL's physical identifier truncation is equivalent",
  ).toEqual([]);

  const catalogDefaults = clone(baseline);
  const renderedDefaults = clone(baseline);
  const renderedColumn = renderedDefaults.tables["public.child"]?.columns.value;
  if (renderedColumn) renderedColumn.default = "'initial'";
  const defaultAllowlist = {
    "public.child.value": {
      expected: catalogDefaults.tables["public.child"]?.columns.value?.default,
      proposed: renderedDefaults.tables["public.child"]?.columns.value?.default,
    },
  };
  expect(
    inventoryDifferences(catalogDefaults, renderedDefaults, defaultAllowlist),
  ).toEqual([]);
  if (renderedColumn) renderedColumn.default = "'tampered'";
  expect(
    inventoryDifferences(catalogDefaults, renderedDefaults, defaultAllowlist),
  ).not.toEqual([]);
});
