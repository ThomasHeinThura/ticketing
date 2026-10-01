/**
 * #415 red probe — `test-contract.mjs` must resolve the approved-breaks allowlist against
 * `repoRoot` (`scripts/ci/lib/repo.mjs`, the CALLING process's cwd — #399), not against a
 * root it computes itself from its own file location.
 *
 * The bug: `test-contract.mjs` derived its own `root` as
 * `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")` — the exact #399
 * derivation, in the one checker #399's own fix never touched because it wasn't a
 * `repoRoot` consumer in the first place. Running it via an absolute path from checkout A
 * while actually operating on worktree B silently read A's copy of the approved-breaks
 * allowlist (and resolved A's checkout for its `git show`/`git ls-remote` calls) instead
 * of B's.
 *
 * Same shape as `probes/repo-root-cwd.test.mjs`: two separate scratch repositories — A
 * carries the checker code, B is the worktree actually being operated on — invoking A's
 * copy with cwd set to B and proving the resolved path is B's, never A's.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  commit,
  initRepo,
  installCheckers,
  scratchDir,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const NODE = process.execPath;

describe("test-contract.mjs resolves the approved-breaks path against the caller's cwd, not its own file location (#415)", () => {
  it("resolves to the CALLING worktree's root when invoked via a different checkout's absolute path", () => {
    const scriptDir = scratchDir("test-contract-root-a-script-owner"); // holds the code
    initRepo(scriptDir);
    installCheckers(scriptDir);
    commit(scriptDir, "chore: bootstrap checker checkout");

    const callerDir = scratchDir("test-contract-root-b-caller"); // the worktree actually operated on
    initRepo(callerDir);
    installCheckers(callerDir); // a real worktree of this project carries #414's checkout marker too
    commit(callerDir, "chore: bootstrap caller worktree");

    const testContractModule = path.join(
      scriptDir,
      "scripts/ci/test-contract.mjs",
    );
    const result = spawnSync(
      NODE,
      [
        "--input-type=module",
        "-e",
        `import { approvedBreaksFilePath } from ${JSON.stringify(testContractModule)};
         console.log(JSON.stringify({ approvedBreaksFilePath: approvedBreaksFilePath() }));`,
      ],
      { cwd: callerDir, encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(
        `probe evaluation failed in ${callerDir} (status ${result.status}):\n${result.stderr}`,
      );
    }
    const { approvedBreaksFilePath } = JSON.parse(
      result.stdout.trim().split("\n").pop(),
    );

    assert.equal(
      approvedBreaksFilePath,
      path.join(
        realpathSync(callerDir),
        "scripts/ci/openapi-approved-breaks.json",
      ),
      "must resolve against the CALLER's worktree, not the script's own checkout",
    );
    assert.equal(
      approvedBreaksFilePath.startsWith(realpathSync(scriptDir)),
      false,
      "must not resolve against the script checkout's own path",
    );
  });
});
