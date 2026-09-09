/**
 * L4 red probe — typecheck coverage must be tied to the tsconfigs the package's own
 * `typecheck` script INVOKES, not to whichever `tsconfig*.json` files happen to exist.
 *
 * The guard used to read the directory. So an ORPHAN config could satisfy it while
 * `pnpm typecheck` never invoked it: the orphan includes `tests/api/**`, the guard is
 * happy, and a broken import in that tree still cannot fail typecheck. Silence in both
 * directions — the same shape as F11, one level along.
 *
 * Asserted against the real manifest rather than a scratch repo, because the property is
 * about THIS package's script and the configs beside it.
 *
 * **A4 — and then the fix's own predicate was textual.** L4 replaced "every tsconfig on
 * disk" with "every tsconfig the script NAMES", matching `-p (\S+)` against the script's
 * text. The second describe block below is what that accepted, and it is the same defect
 * a third time: the claim ("the configs typecheck runs") was wider than the inspection
 * ("the configs the text mentions"). The projects now come from a real execution with a
 * recording shim in place of `tsc` — `lib/tsc-invocations.mjs`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "../lib/repo.mjs";
import {
  recordedTscProjects,
  textuallyNamedProjects,
} from "../lib/tsc-invocations.mjs";

const apiDir = path.join(repoRoot, "apps/api");

async function typecheckScript() {
  const manifest = JSON.parse(
    await fs.readFile(path.join(apiDir, "package.json"), "utf8"),
  );
  return manifest?.scripts?.typecheck ?? "";
}

async function invokedConfigs() {
  return [...(await typecheckScript()).matchAll(/-p\s+(\S+)/g)].map(
    (m) => m[1],
  );
}

async function configsOnDisk() {
  return (await fs.readdir(apiDir))
    .filter((name) => /^tsconfig.*\.json$/.test(name))
    .sort();
}

describe("L4 — coverage is tied to the invoked typecheck path", () => {
  it("the typecheck script invokes at least one config, and every one exists", async () => {
    const invoked = await invokedConfigs();
    assert.ok(
      invoked.length > 0,
      `apps/api's typecheck script invokes no -p <config>: ${await typecheckScript()}`,
    );
    for (const name of invoked) {
      await fs.access(path.join(apiDir, name));
    }
  });

  it("there is NO orphan config — every tsconfig on disk is invoked", async () => {
    const invoked = new Set(await invokedConfigs());
    const orphans = (await configsOnDisk()).filter(
      (name) => !invoked.has(name),
    );
    assert.deepEqual(
      orphans,
      [],
      `${orphans.length} tsconfig(s) exist but are never invoked by the typecheck ` +
        `script — ${orphans.join(", ")}. An uninvoked config that includes a test tree ` +
        "makes the coverage guard pass while nothing typechecks that tree.",
    );
  });

  it("the config covering tests/api IS on the invoked path, not merely present", async () => {
    // The specific regression the finding names: tsconfig.tests.json exists AND is
    // invoked. Removing it from the script while leaving the file must fail — that is
    // asserted by the case above, which this one anchors to a named tree.
    const invoked = await invokedConfigs();
    const covering = [];
    for (const name of invoked) {
      const source = await fs.readFile(path.join(apiDir, name), "utf8");
      if (source.includes("tests/api")) covering.push(name);
    }
    assert.ok(
      covering.length > 0,
      "no INVOKED tsconfig includes tests/api. The tree would be outside every " +
        "typecheck program again, which is what F11 closed and L4 reopened.",
    );
  });
});

describe("A4 — the projects come from a real invocation, not from the script's text", () => {
  const apiRelative = "apps/api";

  it("1. a config named only in an `echo` is NOT counted, and the text said it was", () => {
    // The false-pass direction, and the only one that hides anything: the text claims
    // `tests/api` is covered by a config no compiler ever opens.
    const script =
      'echo "remember to use -p tsconfig.tests.json" && tsc --noEmit -p tsconfig.json';

    // NON-VACUITY: the pre-fix predicate returned the echoed config — mangled, quote and
    // all, which is its own comment on parsing shell with a regular expression.
    const textual = textuallyNamedProjects(script);
    assert.ok(
      textual.some((name) => name.startsWith("tsconfig.tests.json")),
      `the textual predicate must accept the echoed config, or this is not the defect: ${textual.join(", ")}`,
    );

    const recorded = recordedTscProjects(
      script,
      path.join(repoRoot, apiRelative),
    );
    assert.deepEqual(
      recorded,
      ["tsconfig.json"],
      "only the config a real compiler was handed may count",
    );
  });

  it("2. `--project` in long form IS counted, where the text predicate saw nothing", () => {
    const script = "tsc --noEmit --project tsconfig.tests.json";
    assert.deepEqual(textuallyNamedProjects(script), []);
    assert.deepEqual(
      recordedTscProjects(script, path.join(repoRoot, apiRelative)),
      ["tsconfig.tests.json"],
    );
  });

  it("3. `tsc -b`'s positional projects ARE counted", () => {
    const script = "tsc -b tsconfig.json tsconfig.tests.json";
    assert.deepEqual(textuallyNamedProjects(script), []);
    assert.deepEqual(
      recordedTscProjects(script, path.join(repoRoot, apiRelative)),
      ["tsconfig.json", "tsconfig.tests.json"],
    );
  });

  it("4. a config behind a shell condition that is FALSE is not counted", () => {
    const script = "false && tsc --noEmit -p tsconfig.tests.json";
    assert.ok(textuallyNamedProjects(script).includes("tsconfig.tests.json"));
    assert.deepEqual(
      recordedTscProjects(script, path.join(repoRoot, apiRelative)),
      [],
      "a compiler that is never reached compiles nothing",
    );
  });

  it("5. the real script records exactly what its text says — no change today", () => {
    // Stated rather than glossed: on this repository both predicates agree. A4 closes
    // the hole; it does not report a violation.
    const script = readFileSync(
      path.join(repoRoot, apiRelative, "package.json"),
      "utf8",
    );
    const typecheck = JSON.parse(script).scripts.typecheck;
    assert.deepEqual(
      recordedTscProjects(typecheck, path.join(repoRoot, apiRelative)).sort(),
      textuallyNamedProjects(typecheck).sort(),
    );
  });
});
