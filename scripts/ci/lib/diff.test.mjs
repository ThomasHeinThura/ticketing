/**
 * F4 — `changedFiles()` must not fail open.
 *
 * It used to catch a `git merge-base` failure and return `[]`. Every caller reads an
 * empty change set as "nothing sensitive was touched", so a shallow clone, a trimmed
 * `fetch-depth`, or a renamed default branch turned the mandatory security-review
 * requirement into a green no-op whose output read like a success:
 *
 *   GITHUB_BASE_REF=refs-that-do-not-exist  =>  "no security-review path touched"
 *
 * "the gate did not run" and "the gate ran and found nothing" are different facts.
 * These tests pin that distinction. Only the genuine empty diff returns an empty list.
 *
 * Run: `pnpm test:ci-scripts`.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { changedFiles, DiffUnavailableError } from "./diff.mjs";
import { repoRoot } from "./repo.mjs";
import {
  cleanUpScratchRepos,
  commit,
  evaluateInRepo,
  initRepo,
  installCheckers,
  scratchDir,
  setOriginMain,
  write,
} from "./scratch-repo.mjs";

/** Run `fn` with GITHUB_BASE_REF set, restoring it afterwards. */
function withBaseRef(value, fn) {
  const had = Object.hasOwn(process.env, "GITHUB_BASE_REF");
  const previous = process.env.GITHUB_BASE_REF;
  if (value === undefined) delete process.env.GITHUB_BASE_REF;
  else process.env.GITHUB_BASE_REF = value;
  try {
    return fn();
  } finally {
    if (had) process.env.GITHUB_BASE_REF = previous;
    else delete process.env.GITHUB_BASE_REF;
  }
}

after(cleanUpScratchRepos);

describe("changedFiles — fails closed, never open", () => {
  it("THROWS when the base ref does not resolve", () => {
    withBaseRef("refs-that-do-not-exist-anywhere", () => {
      assert.throws(() => changedFiles(), DiffUnavailableError);
    });
  });

  it("names the failure as a checkout problem, not an empty diff", () => {
    withBaseRef("refs-that-do-not-exist-anywhere", () => {
      try {
        changedFiles();
        assert.fail("expected a throw");
      } catch (error) {
        assert.ok(error instanceof DiffUnavailableError);
        assert.match(error.message, /CHECKOUT problem, not a clean diff/);
        assert.match(error.message, /fetch-depth/);
      }
    });
  });

  it("THROWS when git itself cannot run", () => {
    // An unreadable cwd makes execFileSync fail before git parses anything.
    withBaseRef("main", () => {
      const original = process.cwd();
      try {
        process.chdir(repoRoot);
        // A ref name git rejects outright exercises the command-failure path.
        withBaseRef("--not-a-ref", () => {
          assert.throws(() => changedFiles(), DiffUnavailableError);
        });
      } finally {
        process.chdir(original);
      }
    });
  });

  it("returns a real list for a resolvable base — the genuine case", () => {
    // origin/main exists in this checkout; the diff may be empty or not, but it must
    // be an array and must NOT throw.
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    assert.match(head, /^[0-9a-f]{40}$/);
    withBaseRef("main", () => {
      const changes = changedFiles();
      assert.ok(Array.isArray(changes));
      for (const change of changes) {
        assert.equal(typeof change.status, "string");
        assert.equal(typeof change.file, "string");
      }
    });
  });

  /**
   * D1 — this test used to prove nothing.
   *
   * It shelled `git diff --name-status HEAD..HEAD` and asserted git's output was empty,
   * which is a tautology about git. `changedFiles()` — the function under test, and the
   * one whose empty return is the whole subject of this file — was never called. It saved
   * and restored `GITHUB_BASE_REF` around a block that never set it. The test passed
   * whether or not `changedFiles` worked, and it would have passed if `changedFiles` had
   * been deleted.
   *
   * Found by an independent read of the probe suite for exactly the property named in the
   * remediation brief: an assertion that cannot fail. It now calls the function, in a
   * scratch repository where the merge base genuinely equals HEAD, and pairs the empty
   * case with a NON-empty one — because "returns []" only means something if the same
   * code path can also return something else.
   */
  it("an EMPTY diff returns [] from changedFiles() itself, without throwing", () => {
    const dir = scratchDir("diff-empty");
    initRepo(dir);
    write(dir, "a.txt", "one\n");
    const base = commit(dir, "base");
    setOriginMain(dir, base);
    installCheckers(dir);

    const result = evaluateInRepo(
      dir,
      `import { changedFiles, DiffUnavailableError } from "./scripts/ci/lib/diff.mjs";
       let files = null;
       let threw = null;
       try { files = changedFiles(); } catch (error) {
         threw = error instanceof DiffUnavailableError ? "DiffUnavailableError" : String(error);
       }
       console.log(JSON.stringify({ files, threw }));`,
    );

    assert.equal(
      result.threw,
      null,
      `a resolvable base with no changes must not throw: ${result.threw}`,
    );
    assert.deepEqual(
      result.files,
      [],
      `expected the genuine empty case, got ${JSON.stringify(result.files)}`,
    );
  });

  it("and the same code path returns the change when there IS one", () => {
    // The control for the test above. Without it, `[]` is indistinguishable from a
    // `changedFiles()` that returns `[]` for everything.
    const dir = scratchDir("diff-nonempty");
    initRepo(dir);
    write(dir, "a.txt", "one\n");
    const base = commit(dir, "base");
    setOriginMain(dir, base);
    write(dir, "b.txt", "two\n");
    commit(dir, "branch");
    installCheckers(dir);

    const result = evaluateInRepo(
      dir,
      `import { changedFiles } from "./scripts/ci/lib/diff.mjs";
       console.log(JSON.stringify({ files: changedFiles() }));`,
    );

    assert.ok(
      result.files.some((change) => change.file === "b.txt"),
      `expected b.txt in the change set, got ${JSON.stringify(result.files)}`,
    );
  });
});
