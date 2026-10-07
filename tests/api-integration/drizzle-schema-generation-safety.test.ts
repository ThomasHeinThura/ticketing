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
    ) as {
      tables: Record<
        string,
        {
          foreignKeys?: Record<string, unknown>;
          uniqueConstraints?: Record<string, { columns: string[] }>;
          compositePrimaryKeys?: Record<string, { columns: string[] }>;
          checkConstraints?: Record<string, unknown>;
          indexes?: Record<
            string,
            {
              columns: Array<{ expression: string }>;
              isUnique: boolean;
              method: string;
            }
          >;
        }
      >;
    };
    const frozenSnapshot = JSON.parse(
      readFileSync(join(migrationsFolder, "meta/0117_snapshot.json"), "utf8"),
    ) as typeof generatedSnapshot;
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

      const frozenConstraints = new Set(
        Object.values(frozenSnapshot.tables).flatMap((table) => [
          ...Object.keys(table.foreignKeys ?? {}),
          ...Object.keys(table.uniqueConstraints ?? {}),
          ...Object.keys(table.compositePrimaryKeys ?? {}),
          ...Object.keys(table.checkConstraints ?? {}),
        ]),
      );
      const physicalConstraintName = (name: string) => name.slice(0, 63);
      const addedConstraints = [
        ...generatedSql.matchAll(/ADD CONSTRAINT "([^"]+)"/giu),
      ].flatMap((match) => (match[1] ? [match[1]] : []));
      const unexpectedConstraintAdds = addedConstraints.filter(
        (name) => !frozenConstraints.has(physicalConstraintName(name)),
      );
      expect(unexpectedConstraintAdds).toEqual([
        "apikey_reference_id_user_id_fk",
      ]);
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
          unmatchedConstraintAdds: unexpectedConstraintAdds,
        })}\n`,
      );

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
