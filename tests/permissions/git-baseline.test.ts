import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffBaselineEntries,
  REPO_ROOT,
  readJsonAtMergeBase,
  resolveMergeBase,
} from "./git-baseline";

/**
 * The git plumbing behind baseline monotonicity, proven against:
 *
 *  (a) the real repository this suite runs in — the exact commands genuinely resolve here;
 *  (b) throwaway scratch repositories built fresh per test — so "does the baseline growth
 *      check actually fire" does not depend on this repository's own, ever-changing history
 *      (right now, the two real baseline files predate `main` entirely — this is the branch
 *      that introduces them — so a test asserting real growth-detection against the real repo
 *      would prove nothing; a scratch repo lets every required scenario be constructed).
 *
 * No test here uses `git checkout` / `git switch` / `git stash` / `git rebase` on any repo —
 * scratch branches are created with `git branch <name>` (which only creates a ref; it never
 * moves the working tree) precisely so nothing resembling a mutating checkout is needed, on
 * this repository or the scratch ones either.
 */

const scratchDirs: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function sh(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd} (status ${result.status}): ${result.stderr}`,
    );
  }
  return result.stdout;
}

function initRepo(dir: string, initialBranch: string): void {
  sh(dir, ["init", "-q", "-b", initialBranch]);
  sh(dir, ["config", "user.email", "route-coverage-tests@example.invalid"]);
  sh(dir, ["config", "user.name", "route-coverage tests"]);
  sh(dir, ["config", "commit.gpgsign", "false"]);
}

function writeAndCommit(
  dir: string,
  relPath: string,
  content: string,
  message: string,
): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  sh(dir, ["add", relPath]);
  sh(dir, ["commit", "-q", "-m", message]);
  return sh(dir, ["rev-parse", "HEAD"]).trim();
}

describe("resolveMergeBase / readJsonAtMergeBase — proven against the real repository", () => {
  it("resolves a real merge base with main here, right now", () => {
    // The exact command this exercises: `git merge-base HEAD <origin/main|main>`, run with
    // cwd = the real repository root. This is the proof the design calls for: not a claim
    // that it would work, but that it runs, here, today.
    const resolution = resolveMergeBase(REPO_ROOT);
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind === "resolved") {
      expect(["origin/main", "main"]).toContain(resolution.ref);
      expect(resolution.sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("reads the inherited-uncovered baseline's previous state without throwing", () => {
    // Two valid outcomes, both proven safe:
    //  - null: this branch bootstraps the file and main does not have it yet (true today);
    //  - an object with a `uncovered` array: main already carries the file (true once this
    //    branch has merged, and every PR after it).
    // Never a throw, and never anything else shaped.
    const previous = readJsonAtMergeBase(
      REPO_ROOT,
      "tests/permissions/inherited-uncovered.json",
    );
    if (previous !== null) {
      expect(
        Array.isArray((previous as { uncovered?: unknown }).uncovered),
      ).toBe(true);
    }
  });

  it("reads the better-auth pending-removal baseline's previous state without throwing", () => {
    const previous = readJsonAtMergeBase(
      REPO_ROOT,
      "tests/permissions/better-auth-plugins-pending-removal.json",
    );
    if (previous !== null) {
      expect(
        Array.isArray(
          (previous as { pendingRemoval?: unknown }).pendingRemoval,
        ),
      ).toBe(true);
    }
  });
});

describe("diffBaselineEntries — pure, no git involved", () => {
  it("flags an appended key as growth", () => {
    const drift = diffBaselineEntries(
      ["GET /a", "GET /b"],
      ["GET /a", "GET /b", "GET /new-route"],
    );
    expect(drift.added).toEqual(["GET /new-route"]);
    expect(drift.removed).toEqual([]);
  });

  it("allows a removed key as a shrink", () => {
    const drift = diffBaselineEntries(["GET /a", "GET /b"], ["GET /a"]);
    expect(drift.added).toEqual([]);
    expect(drift.removed).toEqual(["GET /b"]);
  });

  it("is a no-op when nothing changed", () => {
    expect(diffBaselineEntries(["GET /a"], ["GET /a"])).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe("the four required proofs, against a scratch git repository", () => {
  it("2: a new route's key appended to the baseline is detected as growth, not silently accepted", () => {
    // The exact proven consequence from the security review: add a new route with no policy,
    // append its key to the baseline in the same diff. Growth must be caught even though the
    // file, taken alone, looks internally consistent.
    const dir = scratchDir("route-coverage-baseline-growth-");
    initRepo(dir, "trunk");
    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a", "GET /b"] }),
      "chore: bootstrap baseline",
    );
    const mainSha = sh(dir, ["rev-parse", "HEAD"]).trim();
    sh(dir, ["branch", "main"]); // names the bootstrap commit; HEAD/trunk is untouched

    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a", "GET /b", "GET /new-route"] }),
      "feat: add a new route and hide it in the baseline",
    );

    const resolution = resolveMergeBase(dir);
    expect(resolution).toEqual({ kind: "resolved", ref: "main", sha: mainSha });

    const previous = readJsonAtMergeBase(dir, "baseline.json") as {
      uncovered: string[];
    };
    const current = { uncovered: ["GET /a", "GET /b", "GET /new-route"] };
    const drift = diffBaselineEntries(previous.uncovered, current.uncovered);

    expect(drift.added).toEqual(["GET /new-route"]); // FAIL — the baseline grew
  });

  it("3: a genuinely removed inherited route deleted from the baseline is an allowed shrink", () => {
    const dir = scratchDir("route-coverage-baseline-shrink-");
    initRepo(dir, "trunk");
    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a", "GET /b"] }),
      "chore: bootstrap baseline",
    );
    sh(dir, ["branch", "main"]);

    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a"] }),
      "feat: GET /b now has a policy — delete the line",
    );

    const previous = readJsonAtMergeBase(dir, "baseline.json") as {
      uncovered: string[];
    };
    const current = { uncovered: ["GET /a"] };
    const drift = diffBaselineEntries(previous.uncovered, current.uncovered);

    expect(drift.added).toEqual([]); // PASS — nothing new
    expect(drift.removed).toEqual(["GET /b"]);
  });

  it("prefers origin/main over main when both are present (the CI-like path)", () => {
    const dir = scratchDir("route-coverage-baseline-origin-preferred-");
    initRepo(dir, "trunk");
    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a"] }),
      "chore: bootstrap",
    );
    const originMainSha = sh(dir, ["rev-parse", "HEAD"]).trim();
    // Fakes a fetched remote-tracking ref without a real network remote — the same plumbing
    // `git fetch` itself would leave behind.
    sh(dir, ["update-ref", "refs/remotes/origin/main", originMainSha]);
    sh(dir, ["branch", "main"]); // a possibly-stale local main, same commit here

    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a", "GET /c"] }),
      "feat: work",
    );

    const resolution = resolveMergeBase(dir);
    expect(resolution).toEqual({
      kind: "resolved",
      ref: "origin/main",
      sha: originMainSha,
    });
  });

  it("is a no-op on main itself — there is nothing to diff against but itself", () => {
    const dir = scratchDir("route-coverage-baseline-on-main-");
    initRepo(dir, "main");
    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a"] }),
      "chore: bootstrap",
    );

    const resolution = resolveMergeBase(dir);
    expect(resolution.kind).toBe("resolved");

    const previous = readJsonAtMergeBase(dir, "baseline.json") as {
      uncovered: string[];
    };
    const drift = diffBaselineEntries(previous.uncovered, ["GET /a"]);
    expect(drift).toEqual({ added: [], removed: [] });
  });

  it("treats a brand-new baseline file as bootstrap — nothing to have grown from yet", () => {
    const dir = scratchDir("route-coverage-baseline-bootstrap-");
    initRepo(dir, "trunk");
    writeAndCommit(dir, "README.md", "placeholder", "chore: init");
    sh(dir, ["branch", "main"]); // main has no baseline.json at all

    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a", "GET /b"] }),
      "feat: bootstrap the baseline (#7)",
    );

    const previous = readJsonAtMergeBase(dir, "baseline.json");
    expect(previous).toBeNull();
  });

  it("throws rather than silently passing when no merge base can be resolved at all", () => {
    // What a shallow, single-ref checkout with no main/origin-main fetched looks like: no
    // "main" branch exists locally, and no "origin/main" remote-tracking ref was ever
    // created, because nothing besides this one ref was ever fetched.
    const dir = scratchDir("route-coverage-baseline-unresolved-");
    initRepo(dir, "trunk");
    writeAndCommit(
      dir,
      "baseline.json",
      JSON.stringify({ uncovered: [] }),
      "chore: init",
    );

    const resolution = resolveMergeBase(dir);
    expect(resolution).toEqual({
      kind: "unresolved",
      triedRefs: ["origin/main", "main"],
    });
    expect(() => readJsonAtMergeBase(dir, "baseline.json")).toThrow(
      /could not resolve a merge base/,
    );
  });

  it("4: throws (until fixed) on the same shallow-checkout shape a real `git clone --single-branch --depth 1` produces", () => {
    // The realistic version of the case above: an origin with a "main" and a "feature"
    // branch, cloned the way a default CI checkout of a PR branch behaves — a single ref,
    // depth 1. Neither "main" nor "origin/main" exists afterward; proven by actually cloning,
    // not by asserting what a clone "should" do.
    const origin = scratchDir("route-coverage-baseline-shallow-origin-");
    initRepo(origin, "main");
    writeAndCommit(
      origin,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a"] }),
      "chore: bootstrap",
    );
    sh(origin, ["branch", "feature"]);

    const cloneParent = mkdtempSync(
      join(tmpdir(), "route-coverage-baseline-shallow-clone-parent-"),
    );
    scratchDirs.push(cloneParent);
    const clonePath = join(cloneParent, "clone");
    sh(cloneParent, [
      "clone",
      "-q",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      "feature",
      `file://${origin}`,
      clonePath,
    ]);
    writeAndCommit(
      clonePath,
      "baseline.json",
      JSON.stringify({ uncovered: ["GET /a", "GET /new-route"] }),
      "feat: a PR commit, checked out the way CI checks it out",
    );

    expect(refResolvesIn(clonePath, "main")).toBe(false);
    expect(refResolvesIn(clonePath, "origin/main")).toBe(false);
    expect(() => readJsonAtMergeBase(clonePath, "baseline.json")).toThrow(
      /could not resolve a merge base/,
    );

    function refResolvesIn(cwd: string, ref: string): boolean {
      return (
        spawnSync(
          "git",
          ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
          { cwd },
        ).status === 0
      );
    }
  });
});
