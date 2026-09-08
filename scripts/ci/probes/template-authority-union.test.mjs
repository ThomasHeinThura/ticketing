/**
 * H1 red probe — a pull request may not rewrite the template to erase a requirement that
 * applied at the merge base.
 *
 * The scenario the finding names, built end to end:
 *
 *   main    .github/pull_request_template.md declares the full fixed-section list,
 *           including `## Security review`; ci-cd.md carries the F15 path list
 *   branch  ONE commit that
 *             - removes `## Security review` from the pull-request BODY,
 *             - removes the same section from the TEMPLATE, and
 *             - edits `scripts/ci/**` (a security-review path),
 *           with the author-visible independent-review checkbox ticked
 *
 * Before the fix the required-section list was derived from the template in the WORKING
 * TREE — the template that same commit had just written. The section stopped being
 * required because the diff stopped requiring it, and `if (requiresReview &&
 * securityReview)` then skipped the Opus-model assertion and the committed-note
 * requirement because the section was absent. Exit 0: no model, no note, no binding.
 *
 * Every assertion is paired with the OLD predicate evaluated in the SAME scratch repo, so
 * the probe cannot go quietly vacuous: `headOnlyRequired` is the pre-fix derivation, and
 * each case asserts it omitted the section while the checker as shipped exits 1.
 *
 * `lib/template-scope.mjs`'s own unit tests are NOT the control here. They assert what the
 * template declares today, and the template is as editable in a pull request as ci-cd.md
 * is. This probe asserts a property of the CHECKER against constructed history, which a
 * body edit and a template edit cannot reach.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  bodyFile,
  cleanUpScratchRepos,
  commit,
  completeBody,
  evaluateInRepo,
  initRepo,
  installCheckers,
  installFromRepo,
  remove,
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

/** Drop one `## ` section from a markdown body, heading and content together. */
function readIn(dir, relative) {
  return readFileSync(path.join(dir, relative), "utf8");
}

function withoutSection(body, heading) {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return body;
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

/**
 * A scratch repository whose `main` carries the real template and ci-cd.md, and whose
 * branch applies `mutate` in one commit.
 */
function scenario(name, mutate) {
  const dir = scratchDir(`h1-${name}`);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, ".github/pull_request_template.md");
  installFromRepo(dir, "docs/04-engineering/ci-cd.md");
  installFromRepo(dir, "docs/07-planning/decision-log.md");
  write(dir, "scripts/ci/placeholder.mjs", "// base\n");
  const base = commit(dir, "base");
  setOriginMain(dir, base);
  mutate(dir);
  commit(dir, "branch");
  return dir;
}

/** The PRE-FIX derivation: required sections read from the working-tree template only. */
const HEAD_ONLY_REQUIRED = `
  const { readFileSync } = await import("node:fs");
  const { sections } = await import("./scripts/ci/lib/pr-body.mjs");
  let headings = [];
  try {
    const source = readFileSync(".github/pull_request_template.md", "utf8");
    headings = [...sections(source).values()].map((section) => section.heading);
  } catch {
    headings = [];
  }
  console.log(JSON.stringify({ headings }));
`;

function headOnlyRequired(dir) {
  return evaluateInRepo(dir, HEAD_ONLY_REQUIRED).headings;
}

describe("H1 — template authority cannot delete a merge-base requirement", () => {
  it("1. body-only deletion of `## Security review` is RED", () => {
    const dir = scenario("body-only", (repo) => {
      write(repo, "scripts/ci/placeholder.mjs", "// touched by the branch\n");
      write(repo, "body.md", withoutSection(completeBody(), "Security review"));
    });
    const result = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      "body.md",
    ]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /## Security review/);
    // The template is untouched here, so even the old derivation required the section —
    // this case was already caught, and it is included so the set is complete.
    assert.ok(headOnlyRequired(dir).includes("Security review"));
  });

  it("2. body + template deletion in the SAME diff is RED, and the old predicate was GREEN", () => {
    const dir = scenario("body-and-template", (repo) => {
      write(repo, "scripts/ci/placeholder.mjs", "// touched by the branch\n");
      write(
        repo,
        ".github/pull_request_template.md",
        withoutSection(
          readIn(repo, ".github/pull_request_template.md"),
          "Security review",
        ),
      );
      write(repo, "body.md", withoutSection(completeBody(), "Security review"));
    });

    // NON-VACUITY: the pre-fix derivation no longer lists the section at all, so the old
    // checker had nothing to require and nothing to check.
    const oldList = headOnlyRequired(dir);
    assert.ok(
      !oldList.includes("Security review"),
      `the old HEAD-only derivation still lists the section (${oldList.join(", ")}), so ` +
        "this scenario no longer reproduces the bypass and the probe would be vacuous",
    );

    const result = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      "body.md",
    ]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /REMOVES 1 required section|## Security review/,
    );
  });

  it("3. an emptied/narrowed template in the same diff is RED", () => {
    const dir = scenario("emptied-template", (repo) => {
      write(repo, "scripts/ci/placeholder.mjs", "// touched by the branch\n");
      write(
        repo,
        ".github/pull_request_template.md",
        "<!-- no sections at all -->\n",
      );
      write(repo, "body.md", "## Task\n\nnothing else.\n");
    });
    assert.deepEqual(headOnlyRequired(dir), []);
    const result = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      "body.md",
    ]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /declares no|required section/i);
  });

  it("4. the same shape WITH a security-path change and a ticked review box is still RED", () => {
    const dir = scenario("ticked-box", (repo) => {
      write(
        repo,
        "scripts/ci/check-pr-template.mjs",
        `${readIn(repo, "scripts/ci/check-pr-template.mjs")}\n// touched by the branch\n`,
      );
      write(
        repo,
        ".github/pull_request_template.md",
        withoutSection(
          readIn(repo, ".github/pull_request_template.md"),
          "Security review",
        ),
      );
      const ticked = withoutSection(completeBody(), "Security review").replace(
        /- \[ \] \*\*Independent security review[^\n]*/,
        "- [x] **Independent security review — done.**",
      );
      write(repo, "body.md", ticked);
    });
    const result = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      "body.md",
    ]);
    assert.equal(
      result.status,
      1,
      `ticking the box and deleting the section must not go green:\n${result.output}`,
    );
    assert.match(result.output, /## Security review/);
  });

  it("5. an unresolvable base fails CLOSED, naming the checkout", () => {
    const dir = scenario("no-base", (repo) => {
      write(repo, "body.md", completeBody());
    });
    const result = runChecker(
      dir,
      "check-pr-template.mjs",
      ["--body", "body.md"],
      { GITHUB_BASE_REF: "a-ref-that-does-not-exist" },
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /could not|checkout|merge base/i);
  });

  it("6. an ordinary legitimate body against the real template is GREEN", () => {
    const dir = scenario("legitimate", (repo) => {
      write(repo, "docs/harmless.md", "no security path touched\n");
      write(repo, "body.md", completeBody());
    });
    const result = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      "body.md",
    ]);
    assert.equal(
      result.status,
      0,
      `a legitimate pull request must not be caught by the H1 fix:\n${result.output}`,
    );
  });
});
