/**
 * Structural guard for the open N2 forward item (docs/07-planning/migration-ledger.md,
 * "Open forward items after 0120").
 *
 * `custom_field_type_visibility` and `custom_field_value` carry no `workspace_id`, so the
 * database cannot stop a cross-tenant reference on them. They are inert until a runtime
 * writes them. (`approval` was anchored by migration 0120 and is no longer guarded.) This test fails as soon as any file under
 * `apps/api/src` other than the two schema declaration files references one of them, so
 * the tenant-anchoring work cannot be skipped by a runtime slice that just starts using
 * the tables.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../../apps/api/src", import.meta.url));
const ALLOWED = new Set(["database/schema.ts", "database/migration-schema.ts"]);

const REFERENCE =
  /\b(customFieldTypeVisibility(Table)?|customFieldValue(Table)?|custom_field_type_visibility|custom_field_value)\b/i;

export function findUnanchoredTableReferences(root: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|js|mjs|sql)$/.test(entry.name)) continue;
      const rel = relative(root, full).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      if (REFERENCE.test(readFileSync(full, "utf8"))) hits.push(rel);
    }
  };
  walk(root);
  return hits.sort();
}

const GUIDANCE =
  "custom_field_type_visibility and custom_field_value have no workspace_id and no tenant-composite FK. " +
  'Do not reference them from runtime code until they are anchored: see "Open forward items after 0120" in docs/07-planning/migration-ledger.md.';

describe("N2 forward item: unanchored tables are not used by runtime code", () => {
  it("no file under apps/api/src references them outside the schema declarations", () => {
    const hits = findUnanchoredTableReferences(SRC);
    expect(hits, `${GUIDANCE}\nReferenced from: ${hits.join(", ")}`).toEqual(
      [],
    );
  });

  it("is non-vacuous: a reference added to a temp copy is detected, schema files are exempt", () => {
    const root = mkdtempSync(join(tmpdir(), "n2-guard-"));
    try {
      mkdirSync(join(root, "database"), { recursive: true });
      mkdirSync(join(root, "feature"), { recursive: true });
      writeFileSync(
        join(root, "database", "schema.ts"),
        "export const customFieldValueTable = 1;\n",
      );
      writeFileSync(
        join(root, "feature", "ok.ts"),
        '// custom field gates are described here\nexport const a = 1;\nconst approvalTable = 1;\nconst q = "insert into approval (id) values (1)";\n',
      );
      expect(findUnanchoredTableReferences(root)).toEqual([]);
      writeFileSync(
        join(root, "feature", "bad.ts"),
        'import { customFieldValueTable } from "../database/schema";\n',
      );
      writeFileSync(
        join(root, "feature", "bad2.ts"),
        "const q = sql`select * from custom_field_value`;\n",
      );
      writeFileSync(
        join(root, "feature", "bad3.ts"),
        "const q = sql`insert into custom_field_type_visibility (id) values (1)`;\n",
      );
      expect(findUnanchoredTableReferences(root)).toEqual([
        "feature/bad.ts",
        "feature/bad2.ts",
        "feature/bad3.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
