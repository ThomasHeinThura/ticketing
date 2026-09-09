/**
 * Finding 2 red probe (post-#19-freeze review) — the `next` override's protection ("next
 * does not resolve at all", which is how `sharp` leaves the graph too) was asserted only
 * in a comment: "an emergent pnpm behavior around overrides + auto-installed optional
 * peers, not one pnpm documents", verified once by hand. Nothing executable checked it
 * against pnpm-lock.yaml, the one artifact that shows what pnpm actually resolved.
 *
 * `lib/override-removal.mjs` reads that artifact directly: for each entry in
 * REMOVAL_INVARIANTS, does the override still exist in pnpm-lock.yaml's own `overrides:`
 * mirror, AND does a resolved `name@version` entry exist in its `packages:` list anyway?
 * `check-overrides.mjs` calls it and fails the build when the answer is yes.
 *
 * `oldCheckOverridesPassed` reproduces exactly the logic `check-overrides.mjs` had before
 * this fix — the override-population and nested-manifest checks, nothing that reads
 * pnpm-lock.yaml at all — the same way `hardcodedMembership` and `flatScanSaw` reproduce
 * prior logic elsewhere in these probes, so the non-vacuity proof does not depend on a
 * specific commit staying reachable. Every RED case below pairs its assertion with that
 * predicate reporting "fine" in the identical scratch repository.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  evaluateInRepo,
  initRepo,
  installCheckers,
  remove,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const PACKAGE_JSON = `${JSON.stringify(
  { name: "root", version: "0.0.0", private: true },
  null,
  2,
)}\n`;

function workspaceYaml(overridesBlock) {
  return `packages:\n  - packages/**\n  - apps/**\noverrides:\n${overridesBlock}`;
}

function lockYaml({ overridesBlock, packagesBlock }) {
  return (
    "lockfileVersion: '9.0'\n\n" +
    "settings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\n" +
    `overrides:\n${overridesBlock}\n` +
    "importers:\n\n  .:\n    dependencies: {}\n\n" +
    `packages:\n\n${packagesBlock}\n` +
    "snapshots: {}\n"
  );
}

/** A scratch repo with the real checkers, a workspace override block, and a lockfile. */
function repoWithLockfile(name, { overridesBlock, packagesBlock }) {
  const dir = scratchDir(`override-removal-${name}`);
  initRepo(dir);
  installCheckers(dir); // copies scripts/ci and the real pnpm-workspace.yaml
  write(dir, "package.json", PACKAGE_JSON);
  write(dir, "pnpm-workspace.yaml", workspaceYaml(overridesBlock));
  write(dir, "pnpm-lock.yaml", lockYaml({ overridesBlock, packagesBlock }));
  return dir;
}

/**
 * The PRE-FIX predicate: `check-overrides.mjs` before this probe's fix, reproduced
 * inline. It checked which of package.json / pnpm-workspace.yaml populate `overrides`,
 * and never opened pnpm-lock.yaml for anything.
 */
function oldCheckOverridesPassed(dir) {
  return evaluateInRepo(
    dir,
    `import path from "node:path";
     import { readText, repoRoot } from "./scripts/ci/lib/repo.mjs";
     const manifest = JSON.parse(await readText(path.join(repoRoot, "package.json")));
     const manifestKeys = Object.keys(manifest?.pnpm?.overrides ?? {});
     const workspaceText = await readText(path.join(repoRoot, "pnpm-workspace.yaml"));
     const lines = workspaceText.split("\\n");
     const start = lines.findIndex((l) => /^overrides:\\s*(#.*)?$/.test(l));
     const workspaceKeys = [];
     if (start !== -1) {
       for (const line of lines.slice(start + 1)) {
         if (/^\\S/.test(line)) break;
         const m = line.match(/^\\s+('[^']+'|"[^"]+"|[^:#\\s]+)\\s*:/);
         if (m) workspaceKeys.push(m[1]);
       }
     }
     const populated = [manifestKeys.length > 0, workspaceKeys.length > 0].filter(Boolean).length;
     // Pre-fix: populated exactly one source, nothing else was checked -- in
     // particular, pnpm-lock.yaml was never read.
     console.log(JSON.stringify({ passed: populated === 1 }));`,
  ).passed;
}

describe("Finding 2 -- the next/sharp removal invariant is checked against pnpm-lock.yaml", () => {
  it("1. a resolved `next@` entry alongside its override is RED", () => {
    const dir = repoWithLockfile("next-resolved", {
      overridesBlock: "  next: ^16.3.3\n",
      packagesBlock:
        "  next@16.3.3:\n    resolution: {integrity: sha512-fake==}\n",
    });

    // NON-VACUITY: the pre-fix checker never read pnpm-lock.yaml, so it passes this
    // exact scenario -- the defect genuinely reproduces here.
    assert.equal(
      oldCheckOverridesPassed(dir),
      true,
      "the pre-fix predicate already failed here, so this scenario is not the defect",
    );

    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /next/);
    assert.match(result.output, /GHSA-p293-qw3h-jr36/);
    assert.match(result.output, /GHSA-2xp9-vwfh-vxw4/);
  });

  it("2. a resolved `sharp@` entry alongside its override is RED", () => {
    const dir = repoWithLockfile("sharp-resolved", {
      overridesBlock: "  sharp: ^0.35.4\n",
      packagesBlock:
        "  sharp@0.35.4:\n    resolution: {integrity: sha512-fake==}\n",
    });

    assert.equal(oldCheckOverridesPassed(dir), true);

    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /sharp/);
    assert.match(result.output, /GHSA-rgj7-g3m4-5g8c/);
  });

  it("3. override present, nothing resolved -- GREEN", () => {
    const dir = repoWithLockfile("absent", {
      overridesBlock: "  next: ^16.3.3\n",
      packagesBlock:
        "  react@18.2.0:\n    resolution: {integrity: sha512-fake==}\n",
    });

    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  it("4. a resolved `next@` entry with NO override declared is out of THIS check's scope", () => {
    // A different problem (the override was deleted entirely, not silently bypassed) --
    // shows this specific invariant is scoped to "override present AND resolved", not to
    // any resolution of next/sharp whatsoever.
    const dir = repoWithLockfile("no-override", {
      overridesBlock: "  ajv: 8.18.0\n",
      packagesBlock:
        "  next@16.3.3:\n    resolution: {integrity: sha512-fake==}\n",
    });

    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 0, result.output);
  });

  it("5. an unreadable pnpm-lock.yaml fails CLOSED", () => {
    const dir = repoWithLockfile("missing-lockfile", {
      overridesBlock: "  next: ^16.3.3\n",
      packagesBlock:
        "  react@18.2.0:\n    resolution: {integrity: sha512-fake==}\n",
    });
    remove(dir, "pnpm-lock.yaml");

    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /pnpm-lock\.yaml could not be read/);
  });

  it("6. a pnpm-lock.yaml with no recognisable `overrides:`/`packages:` mapping fails CLOSED", () => {
    const dir = repoWithLockfile("malformed-lockfile", {
      overridesBlock: "  next: ^16.3.3\n",
      packagesBlock:
        "  react@18.2.0:\n    resolution: {integrity: sha512-fake==}\n",
    });
    write(dir, "pnpm-lock.yaml", "this is not a lockfile at all\n");

    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /no top-level.*mapping this parser recognises/);
  });
});
