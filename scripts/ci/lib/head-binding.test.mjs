/**
 * Unit tests for `head-binding.mjs` — the M-1 review-binding check's C-1/C-2/C-3 fixes
 * (PR #81 LOW findings).
 *
 * Each probe is paired with a reproduction of the OLD predicate over the SAME input, so a
 * revert of the fix shows up here rather than only in an end-to-end scratch-repo run.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { headAgreesWithPayload, headParents } from "./head-binding.mjs";
import {
  cleanUpScratchRepos,
  commit,
  git,
  initRepo,
  scratchDir,
  write,
} from "./scratch-repo.mjs";
import { ReviewBindingUnavailableError } from "./security-review-note.mjs";

after(cleanUpScratchRepos);

/**
 * A merge commit shaped exactly like `refs/pull/N/merge`: the base tip first, the branch
 * head second — GitHub's documented order.
 */
function buildMergeRepo() {
  const dir = scratchDir("head-binding-merge");
  initRepo(dir);
  write(dir, "f.txt", "base\n");
  const base = commit(dir, "A: base");
  write(dir, "f.txt", "head\n");
  const head = commit(dir, "B: branch head");
  const tree = git(dir, ["rev-parse", `${head}^{tree}`]).trim();
  const merge = git(dir, [
    "commit-tree",
    tree,
    "-p",
    base,
    "-p",
    head,
    "-m",
    "Merge pull request",
  ]).trim();
  git(dir, ["checkout", "--quiet", merge]);
  return { dir, base, head, merge };
}

/** An ordinary, single-parent HEAD — the shape C-1 hardens even though it never occurs
 * in this repository's own `on: pull_request` CI. */
function buildLinearRepo() {
  const dir = scratchDir("head-binding-linear");
  initRepo(dir);
  write(dir, "f.txt", "1\n");
  const a = commit(dir, "A");
  write(dir, "f.txt", "2\n");
  const b = commit(dir, "B");
  return { dir, a, b };
}

describe("headParents", () => {
  it("reads HEAD's own sha and its parents, base first / head second", () => {
    const { dir, base, head, merge } = buildMergeRepo();
    const info = headParents(dir);
    assert.equal(info.sha, merge);
    assert.deepEqual(info.parents, [base, head]);
  });

  it("C-3: a non-zero git exit THROWS, rather than silently returning an empty parent list", () => {
    // Never git-initialised: `git rev-list` here fails with "not a git repository",
    // exactly the shape of failure the old code conflated with "HEAD is not a merge".
    const dir = scratchDir("head-binding-not-a-repo");
    assert.throws(
      () => headParents(dir),
      ReviewBindingUnavailableError,
      "a git failure must be refused, not read as an empty parent list",
    );

    // Non-vacuity: the OLD implementation was `if (shown.status !== 0) return [];`.
    // Reproducing that exact spawnSync call over the SAME input shows status !== 0 here —
    // precisely the condition the old code silently swallowed.
    const raw = spawnSync("git", ["rev-list", "--parents", "-n", "1", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.notEqual(
      raw.status,
      0,
      "the reproduction has changed: git no longer fails on this input",
    );
  });
});

describe("headAgreesWithPayload", () => {
  it("a payload naming the actual SECOND parent (the real head) agrees", () => {
    const { dir, head } = buildMergeRepo();
    assert.deepEqual(headAgreesWithPayload(dir, head), { agrees: true });
  });

  it("C-2: a payload naming the BASE TIP — a parent, but not the SECOND one — is refused", () => {
    const { dir, base } = buildMergeRepo();
    const result = headAgreesWithPayload(dir, base);
    assert.equal(result.agrees, false);
    assert.match(result.reason, /SECOND parent/);

    // Non-vacuity: the OLD predicate was `parents.includes(prHead)`. The base tip IS a
    // parent (the first one), so the pre-fix check would have ACCEPTED this exact payload
    // — the bug C-2 names: "accepts any parent rather than specifically the second".
    const { parents } = headParents(dir);
    assert.equal(
      parents.includes(base),
      true,
      "the reproduction has changed: the base tip is no longer a parent here",
    );
  });

  it("a payload naming neither parent is refused, and names both parents in the reason", () => {
    const { dir } = buildMergeRepo();
    const bogus = "f".repeat(40);
    const result = headAgreesWithPayload(dir, bogus);
    assert.equal(result.agrees, false);
    assert.match(result.reason, /parents:/);
  });

  it("C-1: a single-parent HEAD only agrees when the payload names HEAD itself — hardened, not reachable in this repo's CI today", () => {
    const { dir, a, b } = buildLinearRepo();
    assert.deepEqual(headAgreesWithPayload(dir, b), { agrees: true });

    const wrong = headAgreesWithPayload(dir, a);
    assert.equal(wrong.agrees, false);
    assert.match(wrong.reason, /not a merge/);

    // Non-vacuity: the OLD code's guard was `parents.length > 1 && !parents.includes(...)`.
    // HEAD here has exactly one parent, so that guard is false for ANY payload, correct or
    // not — the old code never even evaluated this case, trusting it unconditionally.
    const { parents } = headParents(dir);
    assert.equal(
      parents.length > 1 && !parents.includes(a),
      false,
      "the reproduction has changed: HEAD is no longer single-parented here",
    );
  });
});
