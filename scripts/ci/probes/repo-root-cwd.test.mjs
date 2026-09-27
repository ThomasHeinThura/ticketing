/**
 * #399 red probe — `repoRoot` must resolve against the CALLING process's cwd, not against
 * wherever `repo.mjs`'s own file happens to live.
 *
 * The bug: `repoRoot` used to be `path.resolve(here, "../../..")`, derived from
 * `import.meta.url` at module load. Running a checker via an absolute path into checkout A
 * while actually operating on a different worktree B (`node /checkout-A/scripts/ci/foo.mjs`
 * with cwd inside B) silently resolved every git-backed helper (`changedFiles()`,
 * `changedPaths()`, the security-scope path list) against A's checked-out branch — not B's
 * — with no error. In real CI this never triggers (the runner's cwd and the script's own
 * checkout are always the same tree); it bites exactly the documented, encouraged manual
 * workflow of running a checker from a worktree checked out at a PR's exact head.
 *
 * These probes construct TWO separate scratch repositories — A carries the checker code,
 * B is the worktree actually being operated on — and invoke A's copy of the code with cwd
 * set to B, proving the resolved root (and everything derived from it) is B's, never A's.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  commit,
  initRepo,
  installCheckers,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const NODE = process.execPath;

/** Evaluate a module snippet that imports from an ABSOLUTE path, with an independent cwd. */
function evaluateAcross(cwd, code, env = {}) {
  const result = spawnSync(NODE, ["--input-type=module", "-e", code], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_BASE_REF: "main", ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `probe evaluation failed in ${cwd} (status ${result.status}):\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

/** Same as `evaluateAcross`, but for asserting the module load itself throws. */
function evaluateAcrossExpectingFailure(cwd, code, env = {}) {
  const result = spawnSync(NODE, ["--input-type=module", "-e", code], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_BASE_REF: "main", ...env },
  });
  if (result.status === 0) {
    throw new Error(
      `expected probe evaluation in ${cwd} to fail, but it exited 0:\n${result.stdout}`,
    );
  }
  return result.stderr;
}

/** A scratch repo carrying a byte-for-byte copy of this branch's checker code. */
function scriptCheckout(name) {
  const dir = scratchDir(`repo-root-${name}`);
  initRepo(dir);
  installCheckers(dir);
  commit(dir, "chore: bootstrap checker checkout");
  return dir;
}

describe("repoRoot resolves against the caller's cwd, not the script's own location (#399)", () => {
  it("resolves to the CALLING worktree's root when invoked via a different checkout's absolute path", () => {
    const scriptDir = scriptCheckout("a-script-owner"); // holds the code
    const callerDir = scratchDir("repo-root-b-caller"); // the worktree actually being operated on
    initRepo(callerDir);
    write(callerDir, "marker.txt", "b\n");
    commit(callerDir, "chore: bootstrap caller worktree");

    const repoModule = path.join(scriptDir, "scripts/ci/lib/repo.mjs");
    const { repoRoot } = evaluateAcross(
      callerDir,
      `import { repoRoot } from ${JSON.stringify(repoModule)};
       console.log(JSON.stringify({ repoRoot }));`,
    );

    assert.equal(
      repoRoot,
      callerDir,
      "must be the CALLER's worktree, not the script's own",
    );
    assert.notEqual(repoRoot, scriptDir);
  });

  it("changedFiles() reports the CALLING worktree's own diff, not the script checkout's diff", () => {
    const scriptDir = scriptCheckout("a-script-owner-diff");

    const callerDir = scratchDir("repo-root-b-diff");
    initRepo(callerDir);
    write(callerDir, "unrelated.txt", "base\n");
    const base = commit(callerDir, "chore: bootstrap caller worktree");
    setOriginMain(callerDir, base);
    write(callerDir, "only-in-caller-worktree.txt", "changed\n");
    commit(callerDir, "feat: change something only in the caller worktree");

    const diffModule = path.join(scriptDir, "scripts/ci/lib/diff.mjs");
    const { paths } = evaluateAcross(
      callerDir,
      `import { changedPaths } from ${JSON.stringify(diffModule)};
       console.log(JSON.stringify({ paths: changedPaths() }));`,
    );

    assert.deepEqual(paths, ["only-in-caller-worktree.txt"]);
  });

  it("falls back to the script's own location when the cwd is not inside any git work tree", () => {
    const scriptDir = scriptCheckout("a-script-owner-fallback");
    // scratchDir() alone (no initRepo) is a plain tmp directory — not a git work tree, and
    // (verified) not nested under one either, so `git rev-parse --show-toplevel` fails here.
    const nonGitCwd = scratchDir("repo-root-non-git-cwd");

    const repoModule = path.join(scriptDir, "scripts/ci/lib/repo.mjs");
    const { repoRoot } = evaluateAcross(
      nonGitCwd,
      `import { repoRoot } from ${JSON.stringify(repoModule)};
       console.log(JSON.stringify({ repoRoot }));`,
    );

    assert.equal(
      repoRoot,
      scriptDir,
      "with no git work tree at all to resolve, the fallback must still find the checker's own checkout",
    );
  });

  it("throws, rather than silently falling back, when git itself is unrunnable (Opus review F2)", () => {
    const scriptDir = scriptCheckout("a-script-owner-no-git-path");
    const callerDir = scratchDir("repo-root-no-git-path-caller");
    initRepo(callerDir);

    const repoModule = path.join(scriptDir, "scripts/ci/lib/repo.mjs");
    const stderr = evaluateAcrossExpectingFailure(
      callerDir,
      `import ${JSON.stringify(repoModule)};`,
      // No `git` on PATH at all -- this must throw, not silently resolve to
      // `scriptDir` the way "cwd genuinely isn't a work tree" correctly does.
      { PATH: "" },
    );

    assert.match(stderr, /repo\.mjs: could not resolve the repository root/);
  });

  it("throws on a broken worktree ('not a git repository: <path>'), not just a missing one (Opus review F1)", () => {
    const scriptDir = scriptCheckout("a-script-owner-broken-worktree");
    const callerDir = scratchDir("repo-root-broken-worktree-caller");
    // A `.git` FILE pointing at a gitdir that doesn't exist -- git's own message for
    // this is "not a git repository: <path>", NOT "not a git repository (or any of the
    // parent directories)". The old, broader `/not a git repository/i` regex matched
    // this too and silently fell back to the wrong root; the narrowed regex must not.
    write(callerDir, ".git", "gitdir: /nonexistent/gitdir/for/this/probe\n");

    const repoModule = path.join(scriptDir, "scripts/ci/lib/repo.mjs");
    const stderr = evaluateAcrossExpectingFailure(
      callerDir,
      `import ${JSON.stringify(repoModule)};`,
    );

    assert.match(stderr, /repo\.mjs: could not resolve the repository root/);
  });
});
