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
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "../lib/repo.mjs";

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
