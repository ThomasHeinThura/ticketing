/**
 * The regression mechanism for a gap that had no failure mode.
 *
 * `tests/api/**` sat outside every TypeScript program: `apps/api/tsconfig.json`
 * includes `src/**​/*` only, and `tsconfig.permissions.json` covers
 * `tests/permissions/**`. Asking tsc to list its program files returned ZERO
 * under `tests/api`, so a broken import there was invisible to `pnpm typecheck`
 * — and vitest transforms with esbuild, which strips types without resolving
 * them, so it was invisible at run time too. #16 shipped a dangling import that
 * way and a green 189-test suite never noticed.
 *
 * Adding `tsconfig.tests.json` closed it. This asserts it STAYS closed, because
 * the failure mode of the fix is silence: delete the include, or add a new test
 * directory, and nothing complains.
 *
 * Cheap on purpose — it reads the tsconfigs and the file tree, and never invokes
 * tsc, so it runs in the fast `test:ci-scripts` stage rather than gating on a
 * full typecheck.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "./repo.mjs";

/** Test trees that MUST be inside some typecheck program. */
const covered = ["tests/api", "tests/permissions"];

/**
 * Reads a tsconfig as JSONC.
 *
 * Only WHOLE-LINE comments are stripped, and that restriction is load-bearing:
 * the glob `"../../tests/api/**​/*.ts"` contains `/**​/`, which is lexically
 * identical to an empty block comment. A regex that strips comments anywhere in
 * the text rewrites that pattern to `"../../tests/api*.ts"` and this file's own
 * config stops parsing. Trailing commas are legal in tsconfig and are dropped
 * too.
 */
function parseTsconfig(text) {
  const body = text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(body);
}

async function includeGlobs() {
  const dir = path.join(repoRoot, "apps/api");
  const globs = [];
  for (const name of await fs.readdir(dir)) {
    if (!/^tsconfig.*\.json$/.test(name)) continue;
    const config = parseTsconfig(
      await fs.readFile(path.join(dir, name), "utf8"),
    );
    for (const pattern of config.include ?? []) {
      globs.push(path.resolve(dir, pattern));
    }
  }
  return globs;
}

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `**​/*.ts` style prefix match — enough for the include shapes in use here. */
function matches(file, glob) {
  const base = glob.replace(/\/\*\*\/\*\.tsx?$/, "").replace(/\/\*\*\/\*$/, "");
  return base !== glob ? file.startsWith(`${base}/`) : file === glob;
}

describe("typecheck coverage of the test trees", () => {
  it("every test file under tests/api and tests/permissions is in a typecheck program", async () => {
    const globs = await includeGlobs();
    const uncovered = [];
    for (const tree of covered) {
      const root = path.join(repoRoot, tree);
      for (const file of await walk(root)) {
        if (!globs.some((glob) => matches(file, glob))) {
          uncovered.push(path.relative(repoRoot, file));
        }
      }
    }
    assert.deepEqual(
      uncovered,
      [],
      "these test files are in NO typecheck program, so a broken import in them " +
        "would be invisible to `pnpm typecheck`. Add them to an apps/api/tsconfig*.json " +
        `"include", or extend this test's \`covered\` list if the tree moved:\n  ${uncovered.join("\n  ")}`,
    );
  });

  it("apps/api's typecheck script actually runs every tsconfig that provides that coverage", async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.join(repoRoot, "apps/api/package.json"), "utf8"),
    );
    const script = manifest.scripts.typecheck;
    const dir = path.join(repoRoot, "apps/api");
    for (const name of await fs.readdir(dir)) {
      if (!/^tsconfig.*\.json$/.test(name)) continue;
      const config = parseTsconfig(
        await fs.readFile(path.join(dir, name), "utf8"),
      );
      if (!(config.include ?? []).some((p) => p.includes("../../tests/")))
        continue;
      assert.ok(
        script.includes(name),
        `${name} covers a test tree but \`pnpm --filter @taskdesk/api typecheck\` does not run it. ` +
          "A tsconfig nothing invokes is not coverage.",
      );
    }
  });
});
