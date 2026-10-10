/**
 * Issue #251 (found by PR #250's Opus review of #134, finding L-1).
 *
 * `workspace_role_workspace_id_role_unique` is a real PostgreSQL constraint, added by
 * hand-written migration `apps/api/drizzle/0051_workspace_role_unique.sql` (issue #118), and
 * is the `onConflictDoNothing` target `seedDefaultWorkspaceRoles` relies on to close #134's
 * concurrent-startup seed race. It was never declared in `apps/api/src/database/schema.ts`,
 * so `drizzle-kit`'s own tracked snapshot didn't know it existed — meaning `drizzle-kit
 * generate`/`check` could not warn if a future schema change accidentally dropped it.
 *
 * This test is the drift detector the issue asked for: it runs the REAL `drizzle-kit
 * generate` (the same tool `pnpm db:generate` invokes) against the actual schema and
 * migration history, and asserts it is a no-op. If `workspaceRoleTable`'s `unique(...)`
 * declaration ever stops matching migration `0051`'s constraint byte-for-byte (wrong name,
 * wrong columns, or the declaration is removed entirely), `generate` will want to emit a new
 * migration to reconcile them, and this test fails.
 *
 * Runs against a scratch copy of `apps/api/drizzle/` (migrations + snapshots) so it never
 * writes into the real working tree, and needs no live database — `generate` only diffs
 * `schema.ts` against the last committed snapshot, never touches a real connection.
 */
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "../../../apps/api");
const realDrizzleDir = resolve(apiDir, "drizzle");
const drizzleKitBin = resolve(apiDir, "node_modules/.bin/drizzle-kit");

let scratchDir: string | undefined;

afterEach(async () => {
  if (scratchDir) {
    await rm(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

/**
 * The schema files the real `apps/api/drizzle.config.ts` hands to drizzle-kit, read from that
 * file so this test can never drift from it (it once listed only `schema.ts` and broke when
 * the config gained `migration-schema.ts` and `shadow-schema.ts`). Throws rather than falling
 * back, so a config shape this parser does not understand fails loudly.
 */
async function realConfigSchemaFiles(): Promise<string[]> {
  const source = await readFile(resolve(apiDir, "drizzle.config.ts"), "utf8");
  const match = source.match(/schema:\s*(\[[^\]]*\]|"[^"]*")/);
  if (!match?.[1]) {
    throw new Error(
      "apps/api/drizzle.config.ts: could not find its `schema:` entry",
    );
  }
  const entries = [...match[1].matchAll(/"([^"]+)"/g)].map(
    (m) => m[1] as string,
  );
  if (entries.length === 0) {
    throw new Error("apps/api/drizzle.config.ts: `schema:` lists no files");
  }
  return entries.map((entry) => resolve(apiDir, entry));
}

/**
 * A throwaway copy of `apps/api/drizzle/` (migrations + `meta/` snapshots) plus a config
 * that points `schema` at the same REAL, unmodified schema files as `drizzle.config.ts` and `out` at the
 * copy. `generate`
 * only ever writes into `out`, so the real migration history is never touched.
 */
async function scratchDrizzleConfig(): Promise<string> {
  scratchDir = await mkdtemp(join(tmpdir(), "schema-drift-251-"));
  const outDir = join(scratchDir, "drizzle");
  await mkdir(outDir, { recursive: true });
  await cp(realDrizzleDir, outDir, { recursive: true });

  // `out` MUST be relative (drizzle-kit mis-joins an absolute `out` path, e.g. resolving
  // "/tmp/x" to ".//tmp/x" and then failing to find its own journal) — resolved against the
  // spawned process's cwd, which is set to `scratchDir` below. `schema` is absolute, which
  // resolves correctly regardless of cwd.
  const schemaFiles = await realConfigSchemaFiles();
  const configPath = join(scratchDir, "drizzle.config.mjs");
  await writeFile(
    configPath,
    `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  out: "./drizzle",
  schema: ${JSON.stringify(schemaFiles)},
  dialect: "postgresql",
  dbCredentials: { url: "postgresql://user:pass@localhost:5432/unused" },
});
`,
  );
  return configPath;
}

describe("#251 -- workspace_role_workspace_id_role_unique tracked, no schema drift", () => {
  // ponytail: 20s not the vitest 5s default -- spawnSync'ing drizzle-kit flaked past 5s
  // once under CI load (#451); local runs are ~0.86s. Bump the ceiling, not the design.
  it("drizzle-kit generate is a no-op against the real schema and migration history", async () => {
    const configPath = await scratchDrizzleConfig();
    const before = await readdir(join(scratchDir as string, "drizzle"));

    const result = spawnSync(
      drizzleKitBin,
      ["generate", "--config", configPath],
      { cwd: scratchDir, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/No schema changes, nothing to migrate/);

    // Belt-and-suspenders: assert no new file appeared, independent of the exact wording
    // `drizzle-kit` happens to print.
    const after = await readdir(join(scratchDir as string, "drizzle"));
    expect(after.sort()).toEqual(before.sort());
  }, 20_000);
});
