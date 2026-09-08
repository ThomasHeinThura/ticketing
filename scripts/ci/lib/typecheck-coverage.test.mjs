/**
 * The regression mechanism for a gap that had no failure mode.
 *
 * `tests/api/**` sat outside every TypeScript program: `apps/api/tsconfig.json`
 * includes `src/**​/*` only, and `tsconfig.permissions.json` covers
 * `tests/permissions/**`. Asking tsc to list its program files returned ZERO under
 * `tests/api`, so a broken import there was invisible to `pnpm typecheck` — and vitest
 * transforms with esbuild, which strips types without resolving them, so it was
 * invisible at run time too. #16 shipped a dangling import that way and a green suite
 * never noticed.
 *
 * Adding `tsconfig.tests.json` closed it. This asserts it STAYS closed, because the
 * failure mode of the fix is silence: delete the include, exclude the tree, or add a new
 * test directory, and nothing complains.
 *
 * F11 — WHY THIS NOW SHELLS OUT TO tsc.
 *
 * The previous version matched `include` globs textually and never invoked tsc, so it
 * never read `exclude`. Proven: adding `"exclude": ["../../tests/api/**​/*"]` to
 * `apps/api/tsconfig.tests.json` left this guard at 2 pass / 0 fail while real
 * `tsc --listFiles` coverage of `tests/api` collapsed from 40 files to 1. A guard that
 * exists specifically to stop coverage regressing silently must not be satisfiable by
 * the exact edit it is meant to catch.
 *
 * So membership is now read from the compiler itself: `tsc -p <config> --noEmit
 * --listFiles` prints every file in the program, after include, exclude, files,
 * references and extends have all been resolved. That is the only authoritative answer,
 * and it costs about a second per config.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "./repo.mjs";

/** Test trees that MUST be inside some typecheck program. */
const covered = ["tests/api", "tests/permissions"];

const apiDir = path.join(repoRoot, "apps/api");
const tsc = path.join(apiDir, "node_modules/.bin/tsc");

/** Every `tsconfig*.json` in apps/api — the configs `pnpm typecheck` actually runs. */
async function tsconfigNames() {
  const names = (await fs.readdir(apiDir))
    .filter((name) => /^tsconfig.*\.json$/.test(name))
    .sort();
  assert.ok(names.length > 0, "apps/api has no tsconfig files");
  return names;
}

/**
 * The program's file list, straight from the compiler.
 *
 * `--listFiles` writes to stdout and exits non-zero when the program has type errors,
 * which is fine: we want the membership, not the verdict. execFileSync throws on a
 * non-zero exit, so the output is recovered from the error.
 */
function programFiles(configName) {
  let stdout;
  try {
    stdout = execFileSync(tsc, ["-p", configName, "--noEmit", "--listFiles"], {
      cwd: apiDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    stdout = error.stdout ?? "";
    assert.ok(
      stdout !== "",
      `tsc -p ${configName} --listFiles produced no output: ${error.message}`,
    );
  }
  return new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && /\.tsx?$/.test(line))
      .map((line) => path.resolve(apiDir, line)),
  );
}

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("typecheck coverage of the test trees", () => {
  it("every file under tests/api and tests/permissions is in a real tsc program", async () => {
    const names = await tsconfigNames();
    const union = new Set();
    for (const name of names) {
      for (const file of programFiles(name)) union.add(file);
    }

    const uncovered = [];
    for (const tree of covered) {
      for (const file of await walk(path.join(repoRoot, tree))) {
        if (!union.has(path.resolve(file)))
          uncovered.push(path.relative(repoRoot, file));
      }
    }

    assert.deepEqual(
      uncovered,
      [],
      `${uncovered.length} test file(s) are in NO TypeScript program, so a broken ` +
        "import in them cannot fail `pnpm typecheck`. Add the tree to an apps/api " +
        `tsconfig include — and check no config EXCLUDES it:\n  ${uncovered.join("\n  ")}`,
    );
  });

  it("each covered tree has a meaningful number of files in the program, not one", async () => {
    // A single stray file matching by accident is not coverage. This is the shape the
    // exclude probe produced: tests/api collapsed from 40 members to 1.
    const names = await tsconfigNames();
    const union = new Set();
    for (const name of names) {
      for (const file of programFiles(name)) union.add(file);
    }

    for (const tree of covered) {
      const root = path.join(repoRoot, tree);
      const onDisk = await walk(root);
      const inProgram = onDisk.filter((file) => union.has(path.resolve(file)));
      assert.equal(
        inProgram.length,
        onDisk.length,
        `${tree}: ${inProgram.length} of ${onDisk.length} files are in a tsc program. ` +
          "A partial program is how an excluded tree looks from the outside.",
      );
      assert.ok(
        onDisk.length > 1,
        `${tree} has ${onDisk.length} file(s) on disk — did the tree move?`,
      );
    }
  });
});
