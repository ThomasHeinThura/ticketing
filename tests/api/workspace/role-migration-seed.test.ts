import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { LEGACY_PAIR_CAPABILITY } from "../../../apps/api/src/permissions/legacy-statements";
import { WORKSPACE_BUILT_IN_ROLE_KEYS } from "../../../apps/api/src/workspace/built-in-roles.repository";

/**
 * Migration 0145 stores the six workspace built-ins as literals. This pins them to the compiled
 * data, so a change to `BUILT_IN_ROLES` or to the legacy translation table cannot silently
 * diverge from what the migration seeded.
 */
const sql = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../apps/api/drizzle/0145_canonical_workspace_roles.sql",
  ),
  "utf8",
);

describe("migration 0145 literals", () => {
  const builtinBlock = sql.slice(
    sql.indexOf("INSERT INTO m0145_builtin"),
    sql.indexOf("CREATE TEMP TABLE m0145_pair_cap"),
  );

  it("seeds exactly the six workspace-scope built-ins with their compiled capabilities, rank and editability", () => {
    const rows = [
      ...builtinBlock.matchAll(
        /\('(\w+)', '[^']*', '[^']*', (\d+), '(\[[^']*\])'::jsonb, (true|false)\)/g,
      ),
    ];
    expect(rows.map((row) => row[1]).sort()).toEqual(
      [...WORKSPACE_BUILT_IN_ROLE_KEYS].sort(),
    );
    for (const [, key, rank, capabilities, editable] of rows) {
      const compiled = BUILT_IN_ROLES[key as keyof typeof BUILT_IN_ROLES];
      expect(Number(rank), key).toBe(compiled.rank);
      expect(JSON.parse(capabilities as string), key).toEqual(
        [...compiled.capabilities].sort(),
      );
      expect(editable === "true", key).toBe(compiled.isEditable);
    }
  });

  it("carries the same pair-to-capability table as the application", () => {
    const block = sql.slice(
      sql.indexOf("INSERT INTO m0145_pair_cap"),
      sql.indexOf("CREATE TEMP TABLE m0145_default_pair"),
    );
    const pairs = Object.fromEntries(
      [...block.matchAll(/\('([\w:]+)', '([\w:]+)'\)/g)].map((row) => [
        row[1],
        row[2],
      ]),
    );
    expect(pairs).toEqual(LEGACY_PAIR_CAPABILITY);
  });
});
