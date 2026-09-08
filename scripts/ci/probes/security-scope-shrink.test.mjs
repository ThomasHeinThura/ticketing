/**
 * GPT-F1 red probe — a diff that shrinks the security-review list must not thereby
 * escape it.
 *
 * The scenario is the one the finding names, built end to end:
 *
 *   main    ci-cd.md carries the full F15 list, `scripts/ci/**` and
 *           `docs/04-engineering/ci-cd.md` among its globs
 *   branch  ONE commit that
 *             - removes `scripts/ci/**`, `.github/**` and
 *               `docs/04-engineering/ci-cd.md` from that list, and
 *             - edits `scripts/ci/check-overrides.mjs`
 *
 * Before the fix, `check-pr-template` parsed the list out of the working tree — the list
 * that same commit had just written — so nothing in the diff matched, and it printed
 * "no security-review path touched". The files performing the reduction stopped matching
 * the scope *because of* the reduction.
 *
 * Every assertion below is paired with the OLD predicate evaluated in the SAME scratch
 * repository, so the probe cannot go quietly vacuous if someone later widens the globs
 * and the scenario stops reproducing: `matchesCurrent` is the HEAD-only predicate, and
 * the probe asserts it says "not in scope" while the shipped checker exits 1.
 *
 * `lib/security-paths.test.mjs` is NOT the control here. That file asserts what ci-cd.md
 * declares today, and it is as editable in a pull request as ci-cd.md is — a diff that
 * shrinks the list can shrink its assertions in the same breath. This probe asserts a
 * property of the CHECKER against constructed history, which a body and a document edit
 * cannot reach.
 */

import assert from "node:assert/strict";
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
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

/** The globs a narrowing diff would remove first: the ones that cover the gate itself. */
const NARROWED_AWAY = [
  "scripts/ci/**",
  ".github/**",
  "docs/04-engineering/ci-cd.md",
];

/**
 * A ci-cd.md whose security block holds exactly `globs`. Only the block matters to the
 * parser, and it is found by `packages/permissions/**`, so that glob stays in both
 * versions — a shrink that dropped it would fail the parser outright and never reach the
 * interesting case.
 */
function ciCdWith(globs) {
  return [
    "# CI/CD",
    "",
    "## Pull request pipeline",
    "",
    "```",
    "┌─ Setup ──────────────────────────────────────────┐",
    "│ pnpm install --frozen-lockfile                   │",
    "└──────────────────────────────────────────────────┘",
    "```",
    "",
    "```",
    "├─ Integration ────────────────────────────────────┤",
    "│ pnpm test:integration    Testcontainers Postgres,│",
    "└──────────────────────────────────────────────────┘",
    "```",
    "",
    "CI checks it non-empty, naming Opus, whenever the diff touches **any** of:",
    "",
    "```",
    ...globs,
    "```",
    "",
  ].join("\n");
}

const FULL_LIST = [
  "apps/api/src/**/policy.ts",
  "apps/api/src/middleware/**",
  "apps/api/src/plugins/**",
  "apps/api/src/auth*",
  "apps/api/src/webhooks/**",
  "packages/permissions/**",
  "packages/plugins-contracts/**",
  "apps/api/src/scim/**",
  "apps/api/src/storage/**",
  ".github/**",
  "scripts/ci/**",
  "turbo.json",
  "docs/04-engineering/ci-cd.md",
  "package.json",
  "**/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".pnpmfile.cjs",
];

const SHRUNK_LIST = FULL_LIST.filter((glob) => !NARROWED_AWAY.includes(glob));

/** Build the two-commit scenario and return the scratch repo. */
function shrinkScenario() {
  const dir = scratchDir("scope-shrink");
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, ".github/pull_request_template.md");
  write(dir, "docs/04-engineering/ci-cd.md", ciCdWith(FULL_LIST));
  write(dir, "docs/07-planning/decision-log.md", "# Decision log\n");
  const base = commit(dir, "chore: bootstrap the gate with the full F15 list");
  setOriginMain(dir, base);

  // One commit does both halves, which is the whole point: the narrowing and the change
  // it is meant to hide arrive together.
  write(dir, "docs/04-engineering/ci-cd.md", ciCdWith(SHRUNK_LIST));
  write(
    dir,
    "scripts/ci/check-overrides.mjs",
    "// probe: this file was edited in the same commit that narrowed the list\n",
  );
  const head = commit(dir, "chore: narrow the review scope and edit the gate");

  return { dir, base, head };
}

describe("GPT-F1 — security-review scope is the union of merge base and HEAD", () => {
  it("still requires the review when the same diff removes the globs that cover it", () => {
    const { dir } = shrinkScenario();

    // ── non-vacuity: the OLD, HEAD-only predicate says "nothing in scope" ──────────
    const scope = evaluateInRepo(
      dir,
      `import { readSecurityReviewScope } from "./scripts/ci/lib/security-paths.mjs";
       const s = await readSecurityReviewScope();
       console.log(JSON.stringify({
         headOnly: {
           ciCd: s.matchesCurrent("docs/04-engineering/ci-cd.md"),
           script: s.matchesCurrent("scripts/ci/check-overrides.mjs"),
         },
         union: {
           ciCd: s.matches("docs/04-engineering/ci-cd.md"),
           script: s.matches("scripts/ci/check-overrides.mjs"),
         },
         removed: s.removed,
         counts: { previous: s.previous.length, current: s.current.length },
       }));`,
    );

    assert.deepEqual(
      scope.headOnly,
      { ciCd: false, script: false },
      "the probe is vacuous: the HEAD-only predicate still matches these paths, so the " +
        "scenario no longer reproduces the bypass and the assertions below prove nothing.",
    );
    assert.deepEqual(
      scope.union,
      { ciCd: true, script: true },
      "the union scope failed to keep the narrowed-away paths in scope, which is GPT-F1 " +
        "reopened.",
    );
    assert.deepEqual(scope.removed.sort(), [...NARROWED_AWAY].sort());
    assert.equal(scope.counts.previous, FULL_LIST.length);
    assert.equal(scope.counts.current, SHRUNK_LIST.length);

    // ── the checker itself, end to end ────────────────────────────────────────────
    const body = bodyFile(completeBody({ securityModel: "Sonnet 5" }));
    const run = runChecker(dir, "check-pr-template.mjs", ["--body", body]);

    assert.equal(
      run.status,
      1,
      `check-pr-template exited ${run.status}; it must reject a narrowing diff that ` +
        `names no Opus reviewer.\n${run.output}`,
    );
    assert.match(run.output, /## Security review/);
    assert.match(run.output, /\*\*Model:\*\* must name Opus/);
    assert.doesNotMatch(
      run.output,
      /no security-review path touched/,
      "the checker reported the F15 blind spot's exact symptom on a diff that narrowed " +
        "the list.",
    );
  });

  it("names the removed globs, so a narrowing is visible rather than inferred", () => {
    const { dir } = shrinkScenario();
    const body = bodyFile(
      completeBody({
        securityModel: "Opus 5",
        securityNote: "docs/07-planning/security-reviews/19-probe.md",
      }),
    );
    const run = runChecker(dir, "check-pr-template.mjs", ["--body", body]);

    assert.match(run.output, /security-review glob\(s\) REMOVED/);
    for (const glob of NARROWED_AWAY) {
      assert.ok(
        run.output.includes(glob),
        `the report does not name the removed glob ${glob}:\n${run.output}`,
      );
    }
  });

  it("requires the review on a narrowing diff even when nothing else matches either list", () => {
    // The globs are removed and NOTHING in the diff matches the union — only possible if
    // the list itself lives outside its own protection, which is where a future refactor
    // could put it. `scope.removed` is what keeps the requirement firing then.
    const dir = scratchDir("scope-shrink-only");
    initRepo(dir);
    installCheckers(dir);
    installFromRepo(dir, ".github/pull_request_template.md");
    const unprotected = FULL_LIST.filter(
      (glob) => glob !== "docs/04-engineering/ci-cd.md",
    );
    write(dir, "docs/04-engineering/ci-cd.md", ciCdWith(unprotected));
    const base = commit(
      dir,
      "chore: a list that does not protect its own document",
    );
    setOriginMain(dir, base);

    write(
      dir,
      "docs/04-engineering/ci-cd.md",
      ciCdWith(
        unprotected.filter((glob) => glob !== "apps/api/src/storage/**"),
      ),
    );
    commit(dir, "chore: drop the storage glob and nothing else");

    const body = bodyFile(completeBody({ securityModel: "Sonnet 5" }));
    const run = runChecker(dir, "check-pr-template.mjs", ["--body", body]);

    assert.equal(
      run.status,
      1,
      "a diff whose ONLY security-relevant act is narrowing the list exited " +
        `${run.status}.\n${run.output}`,
    );
    assert.match(
      run.output,
      /removes 1 glob\(s\) from the security-review list/,
    );
    assert.match(run.output, /apps\/api\/src\/storage\/\*\*/);
  });

  it("fails closed when the merge base cannot be resolved", () => {
    // Half the union is unreachable, so the scope is unknown. "Could not compute the
    // scope" and "nothing sensitive was touched" are different facts — the same argument
    // lib/diff.mjs makes for F4, one level up.
    const dir = scratchDir("scope-no-base");
    initRepo(dir);
    installCheckers(dir);
    installFromRepo(dir, ".github/pull_request_template.md");
    write(dir, "docs/04-engineering/ci-cd.md", ciCdWith(FULL_LIST));
    commit(dir, "chore: a branch with no base ref at all");

    const body = bodyFile(completeBody());
    const run = runChecker(dir, "check-pr-template.mjs", ["--body", body], {
      GITHUB_BASE_REF: "a-ref-that-does-not-exist",
    });

    assert.equal(run.status, 1, `exited ${run.status}\n${run.output}`);
    assert.match(run.output, /changed-file detection|security-review scope/);
    assert.doesNotMatch(run.output, /no security-review path touched/);
  });
});
