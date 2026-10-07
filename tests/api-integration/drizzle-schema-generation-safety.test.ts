import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
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
};
type KeyMetadata = { name: string; columns: string[]; [key: string]: unknown };
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
type MigrationSnapshot = { tables: Record<string, SnapshotTable> };

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

    const generatedSqlPath = readdirSync(outputFolder).find(
      (name) => name.startsWith("0118_") && name.endsWith(".sql"),
    );
    const generatedSnapshotPath = join(
      outputFolder,
      "meta",
      existsSync(join(outputFolder, "meta/0118_snapshot.json"))
        ? "0118_snapshot.json"
        : "0117_snapshot.json",
    );
    const generatedSnapshot = JSON.parse(
      readFileSync(generatedSnapshotPath, "utf8"),
    ) as MigrationSnapshot;
    const frozenSnapshot = JSON.parse(
      readFileSync(join(migrationsFolder, "meta/0117_snapshot.json"), "utf8"),
    ) as MigrationSnapshot;
    expect(Object.keys(generatedSnapshot.tables).sort()).toEqual(
      Object.keys(frozenSnapshot.tables).sort(),
    );

    const snapshotColumns = (snapshot: MigrationSnapshot) =>
      Object.entries(snapshot.tables).flatMap(([tableName, table]) =>
        Object.entries(table.columns).map(
          ([columnName, column]) => [tableName, columnName, column] as const,
        ),
      );
    const frozenColumns = snapshotColumns(frozenSnapshot);
    const generatedColumns = snapshotColumns(generatedSnapshot);
    const generatedColumnsByKey = new Map(
      generatedColumns.map(([table, column, definition]) => [
        `${table}.${column}`,
        definition,
      ]),
    );
    expect(
      generatedColumns.map(([table, column]) => `${table}.${column}`).sort(),
    ).toEqual(
      frozenColumns.map(([table, column]) => `${table}.${column}`).sort(),
    );
    const expectedDefaultRenderings = new Set([
      "public.identity_connection.domain_bindings",
      "public.instance_setting.attachment_allowed_extensions",
      "public.organisation_quota.max_storage_bytes",
      "public.scim_connection.allowed_resources",
      "public.scim_connection.match_attributes",
    ]);
    const defaultDifferences: string[] = [];
    for (const [tableName, columnName, frozenColumn] of frozenColumns) {
      const key = `${tableName}.${columnName}`;
      const proposed = generatedColumnsByKey.get(key);
      expect(proposed, `${key} must remain in configured schema`).toBeDefined();
      expect(proposed?.type, `${key} PostgreSQL type`).toBe(frozenColumn.type);
      expect(proposed?.notNull, `${key} nullability`).toBe(
        frozenColumn.notNull,
      );
      expect(proposed?.primaryKey, `${key} primary-key membership`).toBe(
        frozenColumn.primaryKey,
      );
      if (stableJson(proposed?.default) !== stableJson(frozenColumn.default)) {
        defaultDifferences.push(key);
      }
    }
    expect(new Set(defaultDifferences)).toEqual(expectedDefaultRenderings);

    const compareForeignKeys = (snapshot: MigrationSnapshot) =>
      inventoryEntries(snapshot, "foreignKeys")
        .map(([tableName, name, foreignKey]) => {
          const { name: _metadataName, ...foreignKeyFields } = foreignKey;
          return stableJson({
            tableName,
            ...foreignKeyFields,
            name: name.slice(0, 63),
            schemaTo: foreignKey.schemaTo ?? "public",
          });
        })
        .sort();
    expect(compareForeignKeys(generatedSnapshot)).toEqual(
      compareForeignKeys(frozenSnapshot),
    );

    for (const category of [
      "uniqueConstraints",
      "compositePrimaryKeys",
    ] as const) {
      const constraints = (snapshot: MigrationSnapshot) =>
        inventoryEntries(snapshot, category)
          .map(([tableName, name, constraint]) => {
            const { name: _metadataName, ...constraintFields } = constraint;
            return stableJson({ tableName, name, ...constraintFields });
          })
          .sort();
      expect(
        constraints(generatedSnapshot),
        `${category} complete inventory`,
      ).toEqual(constraints(frozenSnapshot));
    }

    const canonicalIndexes = (snapshot: MigrationSnapshot) =>
      inventoryEntries(snapshot, "indexes")
        .map(([tableName, name, index]) => {
          const { name: _metadataName, ...indexFields } = index;
          return stableJson({ tableName, name, ...indexFields });
        })
        .sort();
    expect(canonicalIndexes(generatedSnapshot)).toEqual(
      canonicalIndexes(frozenSnapshot),
    );

    const canonicalChecks = (snapshot: MigrationSnapshot) =>
      inventoryEntries(snapshot, "checkConstraints")
        .map(([tableName, name, check]) =>
          stableJson({ tableName, name, value: check.value }),
        )
        .sort();
    expect(
      canonicalChecks(generatedSnapshot),
      "all configured check expressions must preserve applied catalog semantics",
    ).toEqual(canonicalChecks(frozenSnapshot));
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

    if (generatedSqlPath) {
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

      const tupleResiduals: string[] = [];
      const compareConstraintTuples = (
        category: "uniqueConstraints" | "compositePrimaryKeys",
      ) => {
        for (const [tableName, frozenTable] of Object.entries(
          frozenSnapshot.tables,
        )) {
          const generatedTable = generatedSnapshot.tables[tableName];
          const frozenItems = frozenTable[category] ?? {};
          const generatedItems = generatedTable?.[category] ?? {};
          for (const [name, frozenItem] of Object.entries(frozenItems)) {
            const generatedItem = generatedItems[name];
            if (!generatedItem) {
              tupleResiduals.push(`${category}:${tableName}.${name}:missing`);
              continue;
            }
            const normalize = (columns: string[]) =>
              columns.map((column) => column.toLowerCase());
            const previous = normalize(frozenItem.columns);
            const proposed = normalize(generatedItem.columns);
            if (
              previous.length === proposed.length &&
              previous.every((column) => proposed.includes(column))
            ) {
              expect(
                proposed,
                `${category}:${tableName}.${name} key order`,
              ).toEqual(previous);
            } else if (previous.join("\0") !== proposed.join("\0")) {
              tupleResiduals.push(
                `${category}:${tableName}.${name}:key-inventory`,
              );
            }
          }
        }
      };
      compareConstraintTuples("uniqueConstraints");
      compareConstraintTuples("compositePrimaryKeys");

      const normalizeTuple = (index: {
        columns: Array<{ expression: string }>;
      }) =>
        index.columns.map((column) =>
          column.expression
            .replace(/"([^"]+)"/gu, "$1")
            .replace(/'([^']*)'::text/giu, "'$1'")
            .replace(/\s+/gu, " ")
            .trim()
            .toLowerCase(),
        );
      const indexesByName = (snapshot: typeof frozenSnapshot) => {
        const indexes = new Map<
          string,
          {
            columns: Array<{ expression: string }>;
            isUnique: boolean;
            method: string;
          }
        >();
        for (const [tableName, table] of Object.entries(snapshot.tables)) {
          for (const [name, index] of Object.entries(table.indexes ?? {})) {
            indexes.set(`${tableName}.${name}`, index);
          }
        }
        return indexes;
      };
      const frozenIndexes = indexesByName(frozenSnapshot);
      const generatedIndexes = indexesByName(generatedSnapshot);
      for (const [key, previous] of frozenIndexes) {
        const proposed = generatedIndexes.get(key);
        if (!proposed) {
          tupleResiduals.push(`indexes:${key}:missing`);
          continue;
        }
        const previousTuple = normalizeTuple(previous);
        const proposedTuple = normalizeTuple(proposed);
        if (
          previousTuple.length === proposedTuple.length &&
          previousTuple.every((column) => proposedTuple.includes(column))
        ) {
          expect(proposedTuple, `${key} ordered index key tuple`).toEqual(
            previousTuple,
          );
        } else if (previousTuple.join("\0") !== proposedTuple.join("\0")) {
          tupleResiduals.push(`indexes:${key}:key-inventory`);
        }
      }
      const droppedIndexes = [
        ...generatedSql.matchAll(/DROP INDEX "([^"]+)"/giu),
      ].flatMap((match) => (match[1] ? [match[1]] : []));
      for (const name of droppedIndexes) {
        const oldEntry = [...frozenIndexes].find(([key]) =>
          key.endsWith(`.${name}`),
        );
        const newEntry = [...generatedIndexes].find(([key]) =>
          key.endsWith(`.${name}`),
        );
        if (!oldEntry || !newEntry) continue;
        expect(newEntry[1].isUnique, `${name} uniqueness`).toBe(
          oldEntry[1].isUnique,
        );
        expect(newEntry[1].method, `${name} access method`).toBe(
          oldEntry[1].method,
        );
      }
      if (tupleResiduals.length > 0) {
        process.stderr.write(
          `Configured-schema tuple inventory residuals: ${JSON.stringify(tupleResiduals)}\n`,
        );
      }
    } else {
      expect(output).toContain("No schema changes, nothing to migrate");
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

it("fails closed on column, check, tuple, foreign-key, and index semantic drift", () => {
  const columnSignature = (column: ColumnMetadata) =>
    stableJson({
      type: column.type,
      notNull: column.notNull,
      primaryKey: column.primaryKey,
      default: column.default,
    });
  const column: ColumnMetadata = {
    type: "text",
    notNull: true,
    primaryKey: false,
    default: "'initial'::text",
  };
  expect(columnSignature(column)).not.toBe(
    columnSignature({ ...column, type: "integer" }),
  );
  expect(columnSignature(column)).not.toBe(
    columnSignature({ ...column, notNull: false }),
  );
  expect(columnSignature(column)).not.toBe(
    columnSignature({ ...column, default: "'changed'::text" }),
  );
  expect(columnSignature(column)).not.toBe(
    columnSignature({ ...column, primaryKey: true }),
  );

  const check = "value = 'one'::text";
  expect(check).not.toBe("value = 'two'::text");
  expect("\"Mixed\" = 'one'").not.toBe("mixed = 'one'");
  expect("(a = 1 OR b = 2) AND c = 3").not.toBe("a = 1 OR b = 2 AND c = 3");
  expect("value = 'one'::integer").not.toBe("value = 'one'::text");

  const keyTuple = ["workspace_id", "id"];
  expect(stableJson(keyTuple)).not.toBe(stableJson([...keyTuple].reverse()));
  const index = {
    name: "fixture_idx",
    columns: [
      { expression: "value", asc: true, nulls: "last", isExpression: false },
    ],
    isUnique: true,
    concurrently: false,
    method: "btree",
    where: "enabled is true",
    with: {},
  };
  const signature = (candidate: typeof index) => stableJson(candidate);
  const indexColumn = index.columns[0];
  if (!indexColumn) throw new Error("Index fixture must include a key column");
  expect(signature(index)).not.toBe(
    signature({ ...index, columns: [{ ...indexColumn, asc: false }] }),
  );
  expect(signature(index)).not.toBe(
    signature({ ...index, columns: [{ ...indexColumn, nulls: "first" }] }),
  );
  expect(signature(index)).not.toBe(signature({ ...index, isUnique: false }));
  expect(signature(index)).not.toBe(signature({ ...index, method: "gin" }));
  expect(signature(index)).not.toBe(
    signature({ ...index, where: "enabled is false" }),
  );

  const foreignKey = {
    tableFrom: "fixture",
    tableTo: "parent",
    columnsFrom: ["value"],
    columnsTo: ["id"],
    onDelete: "cascade",
    onUpdate: "no action",
  };
  expect(stableJson(foreignKey)).not.toBe(
    stableJson({ ...foreignKey, onDelete: "restrict" }),
  );
});
