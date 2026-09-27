/**
 * #414 red probe — running `check-deps` (or any other `repoRoot`-based checker) from a cwd
 * that resolves to a real but UNRELATED git repository must fail loudly, not report "0
 * workspace packages/apps and 0 source files ... acyclic", exit 0.
 *
 * The bug (found by PR #410's Opus security review of the #399 fix): once `repoRoot`
 * resolves against the CALLING process's cwd via `git rev-parse --show-toplevel` (#399),
 * invoking a checker by absolute path while cwd sits inside some other, unrelated git
 * repository resolves `repoRoot` to THAT repository's top level. `check-deps` then walks
 * `apps/`/`packages/` under that unrelated root, finds none, and reports a vacuous, silently
 * clean pass — checking nothing while claiming everything held.
 *
 * The fix lives in `scripts/ci/lib/repo.mjs`'s `resolveRepoRoot`, not in `check-deps.mjs`
 * itself, so every `repoRoot` consumer benefits the same way. This probe exercises it
 * end-to-end through the real `check-deps` binary, the same way `repo-root-cwd.test.mjs`
 * exercises `repoRoot`/`changedFiles()` directly.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { repoRoot } from "../lib/repo.mjs";
import {
  cleanUpScratchRepos,
  commit,
  initRepo,
  installCheckers,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const NODE = process.execPath;

/**
 * A scratch repo carrying a byte-for-byte copy of this branch's checker code.
 *
 * `check-deps.mjs` is the one checker that imports the `typescript` package, which
 * `installCheckers` does not copy (every other probe's checker has no such dependency).
 * Symlinking the real `node_modules` in makes Node's package resolution find it the same
 * way it would in a real worktree of this project (which always has its own real
 * `node_modules`, installed by `pnpm install`, not a symlink — the symlink here is only a
 * test-time stand-in for that).
 */
function scriptCheckout(name) {
  const dir = scratchDir(`check-deps-vacuous-${name}`);
  initRepo(dir);
  installCheckers(dir);
  symlinkSync(
    path.join(repoRoot, "node_modules"),
    path.join(dir, "node_modules"),
  );
  commit(dir, "chore: bootstrap checker checkout");
  return dir;
}

/** Run `check-deps.mjs` (living in `scriptDir`) with an independent cwd. */
function runCheckDepsAcross(scriptDir, cwd) {
  const result = spawnSync(
    NODE,
    [path.join(scriptDir, "scripts/ci/check-deps.mjs")],
    { cwd, encoding: "utf8", env: { ...process.env, GITHUB_BASE_REF: "main" } },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("check-deps refuses to vacuously pass when cwd resolves to an unrelated repo (#414)", () => {
  it("fails loudly, instead of '0 files ... acyclic, exit 0', when cwd is a real UNRELATED git repository", () => {
    const scriptDir = scriptCheckout("script-owner");
    const unrelatedRepo = scratchDir("check-deps-vacuous-unrelated");
    initRepo(unrelatedRepo);
    write(unrelatedRepo, "README.md", "a project that isn't this one\n");
    commit(unrelatedRepo, "chore: bootstrap an unrelated repository");

    const { status, output } = runCheckDepsAcross(scriptDir, unrelatedRepo);

    assert.notEqual(
      status,
      0,
      `expected check-deps to fail loudly from an unrelated repo, got:\n${output}`,
    );
    assert.doesNotMatch(
      output,
      /0 workspace packages\/apps and 0 source files/,
      "must not report the vacuous 'nothing to check' clean pass",
    );
    assert.match(output, /does not look like this project's checkout/);
  });

  it("still passes normally when cwd is a real worktree of THIS SAME project", () => {
    const scriptDir = scriptCheckout("script-owner-worktree-ok");
    const sameProjectWorktree = scratchDir("check-deps-vacuous-same-project");
    initRepo(sameProjectWorktree);
    installCheckers(sameProjectWorktree); // carries the #414 marker, same project
    commit(
      sameProjectWorktree,
      "chore: bootstrap a real worktree of this project",
    );

    const { status, output } = runCheckDepsAcross(
      scriptDir,
      sameProjectWorktree,
    );

    assert.equal(status, 0, `expected a clean pass, got:\n${output}`);
  });
});
