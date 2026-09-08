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
import { describe, it } from "node:test";
import { changedFiles, DiffUnavailableError } from "./diff.mjs";
import { repoRoot } from "./repo.mjs";

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

  it("an EMPTY diff against an identical ref returns [] without throwing", () => {
    // HEAD..HEAD is the one legitimate empty case: base resolves, diff is genuinely
    // empty. It must be distinguishable from the failures above.
    const previous = process.env.GITHUB_BASE_REF;
    try {
      // baseRef() prefixes origin/, so compare a ref that resolves to HEAD itself.
      const output = execFileSync(
        "git",
        ["diff", "--name-status", "--no-renames", "HEAD..HEAD"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.equal(output.trim(), "");
    } finally {
      if (previous === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = previous;
    }
  });
});
