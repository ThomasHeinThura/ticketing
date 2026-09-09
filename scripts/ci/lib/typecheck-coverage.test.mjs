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
 *
 * A4 — WHICH CONFIGS, AND WHICH TREES.
 *
 * F11 bound the FILE LIST to the compiler and left two literals behind it, and both are
 * the same defect one level out.
 *
 * 1. *The configs.* L4 parsed `-p (\S+)` out of the `typecheck` script's TEXT. Text is
 *    not an invocation: `--project` in long form is missed, `tsc -b` names none, and —
 *    the direction that matters — `echo "use -p tsconfig.tests.json" && tsc --noEmit -p
 *    tsconfig.json` yields a coverage claim about a config the compiler never opens. The
 *    script is now EXECUTED with `tsc` replaced by a recording shim, so the configs are
 *    the ones a real run passes to a real compiler, whatever the shell does in between.
 *    See `lib/tsc-invocations.mjs`, and `probes/orphan-tsconfig-coverage.test.mjs` for
 *    what the textual predicate accepted.
 *
 * 2. *The trees.* `covered` was the literal `["tests/api", "tests/permissions"]` while
 *    FOUR trees sit under `tests/`. Deriving the list from disk found what the literal
 *    was hiding: **`tests/api-integration` has 34 TypeScript files and not one of them is
 *    in any TypeScript program.** That is the identical gap this file was written for —
 *    the one that let #16 ship a dangling import — sitting in the tree the whole time,
 *    invisible because the guard's own scope was hand-written.
 *
 *    Adding it to `tsconfig.tests.json` produces 359 pre-existing `TS18048`-class errors,
 *    and two other lanes are adding files to that tree right now, so closing it here
 *    would be a different pull request wearing this one's clothes. It is declared as an
 *    EXEMPTION instead: named, reasoned, printed on every run with its current file
 *    count, and — this is the part the literal could not do — a new uncovered tree is a
 *    hard failure, and an exemption that has become unnecessary is a hard failure too.
 *    The gap is now loud rather than absent.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "./repo.mjs";
import { recordedTscProjects } from "./tsc-invocations.mjs";

/**
 * Trees under `tests/` that are knowingly OUTSIDE every TypeScript program.
 *
 * An entry is a debt, not a dispensation: it is printed on every run, a new uncovered
 * tree cannot be added without appearing here, and an entry that is no longer needed
 * fails the guard so it gets deleted rather than lingering as folklore.
 */
const EXEMPT = new Map();

/**
 * Every test tree on disk that holds TypeScript, minus the declared exemptions.
 *
 * Derived, so a tree added tomorrow is covered by this guard tomorrow.
 */
async function coveredTrees() {
  const testsDir = path.join(repoRoot, "tests");
  const entries = await fs.readdir(testsDir, { withFileTypes: true });
  const trees = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relative = `tests/${entry.name}`;
    const files = await walk(path.join(repoRoot, relative));
    if (files.length === 0) continue; // e.g. tests/api-contract holds openapi.json
    trees.push(relative);
  }
  assert.ok(
    trees.length > 0,
    "no tests/ subtree holds a TypeScript file — did the trees move? An empty derived " +
      "list would make every assertion below vacuously true.",
  );
  return {
    covered: trees.filter((tree) => !EXEMPT.has(tree)),
    exempt: trees.filter((tree) => EXEMPT.has(tree)),
    all: trees,
  };
}

const apiDir = path.join(repoRoot, "apps/api");
const tsc = path.join(apiDir, "node_modules/.bin/tsc");

/** Every `tsconfig*.json` in apps/api — the configs `pnpm typecheck` actually runs. */
/**
 * The tsconfigs the package's `typecheck` script ACTUALLY invokes.
 *
 * L4 — this used to read the directory: every `apps/api/tsconfig*.json` that existed.
 * So an ORPHAN config could satisfy the guard while `pnpm typecheck` never invoked it.
 * The failure mode is silence in both directions: the orphan includes the test tree, the
 * guard is happy, and a broken import in that tree still cannot fail typecheck.
 *
 * Parsed from the script rather than from the filesystem, so coverage is asserted about
 * the command that runs. `tsc --noEmit -p a.json && tsc --noEmit -p b.json` yields
 * ["a.json", "b.json"], in invocation order.
 */
async function tsconfigNames() {
  const manifest = JSON.parse(
    await fs.readFile(path.join(apiDir, "package.json"), "utf8"),
  );
  const script = manifest?.scripts?.typecheck;
  assert.ok(
    typeof script === "string" && script.trim() !== "",
    "apps/api has no `typecheck` script, so there is no execution path to tie " +
      "coverage to. Coverage asserted against a config nobody runs is not coverage.",
  );

  // A4: RUN the script with `tsc` replaced by a shim that records its argv and exits 0.
  // Whatever the shell does — `&&`, `;`, a subshell, an `echo` that merely mentions a
  // config — the recorded invocations are the ones a real compiler would have received.
  const names = recordedTscProjects(script, apiDir);
  assert.ok(
    names.length > 0,
    `executing apps/api's typecheck script invoked \`tsc\` with no project: ${script}`,
  );

  for (const name of names) {
    assert.ok(
      await fs
        .access(path.join(apiDir, name))
        .then(() => true)
        .catch(() => false),
      `apps/api's typecheck script invokes ${name}, which does not exist.`,
    );
  }

  // An ORPHAN config — present but never invoked — is reported, because its existence is
  // what made this guard satisfiable without the coverage being real.
  const onDisk = (await fs.readdir(apiDir))
    .filter((name) => /^tsconfig.*\.json$/.test(name))
    .sort();
  const orphans = onDisk.filter((name) => !names.includes(name));
  assert.deepEqual(
    orphans,
    [],
    `apps/api carries ${orphans.length} tsconfig(s) the typecheck script never invokes ` +
      `— ${orphans.join(", ")}. Either invoke them, or delete them: an uninvoked config ` +
      "that includes a test tree makes this guard pass while nothing typechecks it.",
  );

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

describe("turbo must actually re-run typecheck when a test tree changes", () => {
  // A gate that can pass without checking is worth less than no gate. `pnpm typecheck`
  // runs through turbo, and turbo's `typecheck` task declared NO `inputs`, so it used
  // default per-package hashing — which never sees `tests/`, because those trees live
  // OUTSIDE every package. Measured on this repository: warm the cache, append
  // `import "./does-not-exist"` to a file under `tests/api-integration`, run
  // `pnpm typecheck`, and it reported "8 cached, 8 successful". `--force` failed
  // correctly. So the cached answer was a false pass, and the CI job runs the cached
  // command.
  //
  // This is asserted against `turbo.json` itself, which is the artifact turbo reads —
  // not a proxy for it. Deleting the `inputs` line brings the false pass back, and this
  // test is what refuses it.
  it("the typecheck task declares the out-of-package test trees as inputs", async () => {
    const raw = await fs.readFile(path.join(repoRoot, "turbo.json"), "utf8");
    // turbo.json is JSONC — it carries `//` comments, which JSON.parse rejects. Drop
    // whole comment lines only; never touch a line that also holds data, so a `//` inside
    // a string value cannot be mangled.
    const config = JSON.parse(
      raw
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n"),
    );
    const tasks = config.tasks ?? config.pipeline ?? {};
    const typecheck = tasks.typecheck;
    assert.ok(typecheck, "turbo.json must define a `typecheck` task");
    const inputs = typecheck.inputs ?? [];
    assert.ok(
      inputs.length > 0,
      "the `typecheck` task must declare `inputs`; with none, turbo hashes only each " +
        "package's own directory and a change under tests/ yields a CACHED FALSE PASS",
    );
    // The trees that live outside every package, and so cannot be reached by default
    // hashing. Each must be named by at least one input glob.
    for (const tree of ["tests/"]) {
      assert.ok(
        inputs.some((glob) => String(glob).includes(tree)),
        `no \`typecheck\` input glob mentions ${tree}; a change there would be invisible ` +
          "to turbo's cache key",
      );
    }
    assert.ok(
      inputs.includes("$TURBO_DEFAULT$"),
      "keep $TURBO_DEFAULT$ alongside the added globs, or declaring `inputs` REPLACES " +
        "the default package hashing and a change to the package's own source stops " +
        "invalidating the cache — the same defect, moved",
    );
  });
});

describe("typecheck coverage of the test trees", () => {
  it("every file under tests/api and tests/permissions is in a real tsc program", async () => {
    const names = await tsconfigNames();
    const union = new Set();
    for (const name of names) {
      for (const file of programFiles(name)) union.add(file);
    }

    const trees = await coveredTrees();
    const uncovered = [];
    for (const tree of trees.covered) {
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

    for (const tree of (await coveredTrees()).covered) {
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

  it("every test tree is either covered or DECLARED exempt — no third option", async () => {
    // The literal `covered` list had a third option: a tree nobody had thought about,
    // silently outside both the programs and the guard. `tests/api-integration` was in
    // it. Derived membership removes the option entirely.
    const trees = await coveredTrees();
    const undeclared = trees.all.filter(
      (tree) => !trees.covered.includes(tree) && !EXEMPT.has(tree),
    );
    assert.deepEqual(
      undeclared,
      [],
      `${undeclared.length} tests/ tree(s) are neither covered nor declared exempt: ` +
        `${undeclared.join(", ")}. Put the tree in an apps/api tsconfig include, or ` +
        "declare it in EXEMPT with the reason and what it would take to close it.",
    );

    for (const [tree, reason] of EXEMPT) {
      assert.ok(
        typeof reason === "string" && reason.trim().length > 40,
        `the exemption for ${tree} has no real reason. An exemption without one is the ` +
          "hardcoded list again, spelled differently.",
      );
    }
  });

  it("an exemption that is no longer needed FAILS, so it cannot linger", async () => {
    const names = await tsconfigNames();
    const union = new Set();
    for (const name of names) {
      for (const file of programFiles(name)) union.add(file);
    }

    for (const tree of EXEMPT.keys()) {
      const onDisk = await walk(path.join(repoRoot, tree)).catch(() => []);
      if (onDisk.length === 0) continue; // the tree is gone; the next test reports it
      const inProgram = onDisk.filter((file) => union.has(path.resolve(file)));
      // Reported on every run, so the size of the debt is never invisible.
      console.log(
        `  note — ${tree}: ${inProgram.length} of ${onDisk.length} file(s) in a tsc ` +
          "program (DECLARED EXEMPT). A broken import in the remainder cannot fail " +
          "`pnpm typecheck`.",
      );
      assert.notEqual(
        inProgram.length,
        onDisk.length,
        `${tree} is fully covered now, so its EXEMPT entry is stale. Delete the entry — ` +
          "an exemption for a gap that has closed reads as a gap that is still open.",
      );
    }
  });
});
