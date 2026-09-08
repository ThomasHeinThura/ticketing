/**
 * A5 red probe — the directories a gate scans come from the workspace definition, not
 * from a literal.
 *
 * Four gates carried their own hand-written copy of `["apps", "packages"]`:
 * `check-overrides` (one level of `readdir`, under a comment claiming it came "from the
 * pnpm-workspace.yaml globs"), `check-skips`, `check-vocabulary` and `check-env`. The
 * workspace declares `packages/**` and `apps/**` — recursive — so a package nested one
 * directory deeper, or a new root such as `tools/**`, fell outside every one of them.
 *
 * Nothing would have failed. The gates would simply have stopped covering the new code,
 * which is the failure mode that does not announce itself, and it is why these are asserted
 * against constructed workspaces rather than against today's tree, where the derived answer
 * and the literal are identical.
 *
 * `hardcodedMembership` is the pre-fix predicate, evaluated in the same repository, so no
 * case here can pass without the old one having missed the thing.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  evaluateInRepo,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

/** A scratch repo carrying the checkers, the root manifest and the workspace file. */
function workspace(name, mutate = () => {}) {
  const dir = scratchDir(`a5-${name}`);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, "package.json");
  installFromRepo(dir, "pnpm-workspace.yaml");
  mutate(dir);
  return dir;
}

/** The PRE-FIX membership: one level of `readdir` over a hardcoded pair. */
function hardcodedMembership(dir) {
  return evaluateInRepo(
    dir,
    `import { readdir } from "node:fs/promises";
     import { existsSync } from "node:fs";
     const out = ["package.json"];
     for (const base of ["apps", "packages"]) {
       let entries;
       try { entries = await readdir(base, { withFileTypes: true }); } catch { continue; }
       for (const entry of entries) {
         if (!entry.isDirectory()) continue;
         const relative = base + "/" + entry.name + "/package.json";
         if (existsSync(relative)) out.push(relative);
       }
     }
     console.log(JSON.stringify({ out }));`,
  ).out;
}

function derivedMembership(dir) {
  return evaluateInRepo(
    dir,
    `import { readWorkspaceManifests, readWorkspaceRoots }
       from "./scripts/ci/lib/workspace-membership.mjs";
     console.log(JSON.stringify({
       manifests: await readWorkspaceManifests(),
       roots: await readWorkspaceRoots(),
     }));`,
  );
}

/** A workspace package that smuggles a second override source. */
function packageWithOverrides(name) {
  return `${JSON.stringify(
    { name, version: "0.0.0", overrides: { esbuild: "^0.25.0" } },
    null,
    2,
  )}\n`;
}

describe("A5 — workspace membership is derived, not hand-listed", () => {
  it("1. a package nested TWO levels deep is found; one level of readdir missed it", () => {
    const dir = workspace("nested", (repo) => {
      write(
        repo,
        "packages/group/inner/package.json",
        packageWithOverrides("@taskdesk/inner"),
      );
    });

    // NON-VACUITY: the pre-fix enumeration listed only `packages/<one>/package.json`.
    const old = hardcodedMembership(dir);
    assert.ok(
      !old.includes("packages/group/inner/package.json"),
      `the old enumeration already saw it (${old.join(", ")}), so this is not the defect`,
    );

    const derived = derivedMembership(dir);
    assert.ok(
      derived.manifests.includes("packages/group/inner/package.json"),
      `derived membership missed it: ${derived.manifests.join(", ")}`,
    );

    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /packages\/group\/inner\/package\.json/);
  });

  it("2. a NEW workspace root is scanned by check:overrides", () => {
    const dir = workspace("new-root", (repo) => {
      write(
        repo,
        "pnpm-workspace.yaml",
        "packages:\n  - packages/**\n  - apps/**\n  - tools/**\n",
      );
      write(
        repo,
        "tools/codegen/package.json",
        packageWithOverrides("@taskdesk/codegen"),
      );
    });

    const old = hardcodedMembership(dir);
    assert.ok(!old.some((entry) => entry.startsWith("tools/")));
    assert.deepEqual(derivedMembership(dir).roots, [
      "apps",
      "packages",
      "tools",
    ]);

    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /tools\/codegen\/package\.json/);
  });

  it("3. a NEW workspace root is scanned by check:skips too", () => {
    const dir = workspace("new-root-skips", (repo) => {
      write(
        repo,
        "pnpm-workspace.yaml",
        "packages:\n  - packages/**\n  - apps/**\n  - tools/**\n",
      );
      write(repo, "tools/codegen/package.json", '{ "name": "t" }\n');
      write(
        repo,
        "tools/codegen/generate.test.mjs",
        'import { it } from "node:test";\nit.skip("disabled", () => {});\n',
      );
    });

    // NON-VACUITY: with the roots hardcoded, nothing under tools/ was ever read.
    const old = hardcodedMembership(dir);
    assert.ok(!old.some((entry) => entry.startsWith("tools/")));

    const result = runChecker(dir, "check-skips.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /generate\.test\.mjs/);
  });

  it("4. an unreadable workspace definition fails CLOSED", () => {
    const dir = workspace("no-workspace-file", (repo) => {
      write(
        repo,
        "pnpm-workspace.yaml",
        "onlyBuiltDependencies:\n  - esbuild\n",
      );
    });
    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /no `packages:` globs|could not be read/);
  });

  it("5. a glob shape the reader cannot evaluate fails CLOSED", () => {
    const dir = workspace("odd-glob", (repo) => {
      write(
        repo,
        "pnpm-workspace.yaml",
        "packages:\n  - packages/{a,b}/*\n  - apps/**\n",
      );
    });
    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /pattern segment|cannot evaluate|understands/i);
  });

  it("6. a glob rooted at the repository fails CLOSED rather than scanning everything", () => {
    const dir = workspace("root-glob", (repo) => {
      write(repo, "pnpm-workspace.yaml", "packages:\n  - '**'\n");
    });
    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /wildcard|Name the directory/i);
  });

  it("7. the repository as shipped derives exactly the packages it has", () => {
    const dir = workspace("shipped", (repo) => {
      for (const name of [
        "apps/api",
        "apps/web",
        "packages/email",
        "packages/libs",
        "packages/mcp",
        "packages/permissions",
        "packages/typescript-config",
      ]) {
        write(repo, `${name}/package.json`, `{ "name": "${name}" }\n`);
      }
    });
    const derived = derivedMembership(dir);
    assert.deepEqual(derived.roots, ["apps", "packages"]);
    // Identical to the literal it replaces, which is the honest state of today's tree:
    // this fix closes a hole rather than reporting a violation.
    assert.deepEqual(
      derived.manifests,
      hardcodedMembership(dir).sort((a, b) =>
        a === "package.json"
          ? -1
          : b === "package.json"
            ? 1
            : a.localeCompare(b),
      ),
    );
    const result = runChecker(dir, "check-overrides.mjs", []);
    assert.equal(result.status, 0, result.output);
  });
});
