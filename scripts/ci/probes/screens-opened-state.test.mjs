/**
 * F9 residual — `## Screens opened` declares a state; prose that mentions `n/a` does not.
 *
 * F9 replaced "strip `n/a` and see what's left" (which passed `n/a — no UI change`,
 * because the reason kept the section non-empty) with "does the token `n/a` appear
 * anywhere in this section". That closed the loophole and opened a worse one: it read a
 * **negation as an assertion**. Lane C wrote, honestly,
 *
 *   "I am not marking this n/a — that would misrepresent a real gap"
 *
 * and was rejected for it. The one author who refused to claim the exemption was treated
 * as though they had claimed it, and the way to pass was to stop explaining.
 *
 * The fix is structural and deliberately **not** linguistic — no sentiment analysis, no
 * negation detection, both of which are new false-positive classes wearing cleverer hats.
 * The state comes from the **first meaningful line**, the way a status field is read.
 *
 * Every probe runs the real checker against a diff that touches `apps/web/**`, because
 * that is the only condition under which the rule applies at all.
 *
 * **`BLOCKED` being accepted is not readiness.** The parser stops calling an honest gap a
 * false `n/a`; it does not say the screens were opened. The probe asserts the accepting
 * run still prints that caveat.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { declaredState } from "../lib/pr-body.mjs";
import {
  bodyFile,
  cleanUpScratchRepos,
  commit,
  completeBody,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const CI_CD = [
  "# CI/CD",
  "",
  "```",
  "│ pnpm install --frozen-lockfile                   │",
  "```",
  "",
  "```",
  "│ pnpm test:integration                            │",
  "```",
  "",
  "CI checks it non-empty, naming Opus, whenever the diff touches **any** of:",
  "",
  "```",
  "apps/api/src/auth*                   packages/permissions/**",
  "apps/api/src/middleware/**           packages/plugins-contracts/**",
  "apps/api/src/plugins/**              apps/api/src/scim/**",
  "apps/api/src/webhooks/**             apps/api/src/storage/**",
  "scripts/ci/**                        docs/04-engineering/ci-cd.md",
  "```",
  "",
].join("\n");

/**
 * A repository whose branch changes `apps/web/**` and nothing security-sensitive, so the
 * only thing the checker can complain about is the section under probe.
 */
function webChangeScenario() {
  const dir = scratchDir("screens-opened");
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, ".github/pull_request_template.md");
  write(dir, "docs/04-engineering/ci-cd.md", CI_CD);
  write(
    dir,
    "apps/web/src/routes/board.tsx",
    "export const Board = () => null;\n",
  );
  const base = commit(dir, "chore: bootstrap");
  setOriginMain(dir, base);

  write(
    dir,
    "apps/web/src/routes/board.tsx",
    "export const Board = () => <div>board</div>;\n",
  );
  commit(dir, "feat: change a screen");
  return dir;
}

/** Run the checker with `## Screens opened` set to `screens`. */
function check(dir, screens) {
  const body = completeBody().replace(
    "n/a — the probe touches no apps/web path.",
    screens,
  );
  assert.ok(
    body.includes(screens),
    "the body fixture did not take the section text",
  );
  return runChecker(dir, "check-pr-template.mjs", [
    "--body",
    bodyFile(body),
    "--pr",
    "19",
  ]);
}

const SCREENS_FAILURE = /## Screens opened/;

describe("F9 residual — Screens opened state, not token matching", () => {
  it('1. "n/a — no UI" is RED', () => {
    const dir = webChangeScenario();
    const run = check(dir, "n/a — no UI");
    assert.equal(run.status, 1, `exited ${run.status}\n${run.output}`);
    assert.match(run.output, SCREENS_FAILURE);
    assert.match(run.output, /may not be\s+n\/a/);
    assert.equal(declaredState("n/a — no UI").state, "not-applicable");
  });

  it('2. "not applicable because …" is RED', () => {
    const dir = webChangeScenario();
    const run = check(
      dir,
      "not applicable because this change is behind a feature flag nobody has turned on",
    );
    assert.equal(run.status, 1, `exited ${run.status}\n${run.output}`);
    assert.match(run.output, SCREENS_FAILURE);
  });

  it("3. an explained BLOCKED is accepted by the parser", () => {
    const dir = webChangeScenario();
    const blocked =
      "BLOCKED — browser unavailable in this sandbox; no headless Chromium is installed. " +
      "The two screens this change touches and did NOT open are /app/board and " +
      "/app/board/:id at 1440x900.";
    const run = check(dir, blocked);
    assert.equal(
      run.status,
      0,
      `an explained BLOCKED must not be rejected as a false n/a. Exited ${run.status}:\n${run.output}`,
    );
    assert.equal(declaredState(blocked).state, "blocked");
    // Accepted, and said out loud so nobody reads acceptance as readiness.
    assert.match(run.output, /declares BLOCKED with an explanation/);
    assert.match(run.output, /NOT a readiness signal/);
    assert.match(run.output, /do-not 18 is not\s+satisfied/);
  });

  it('4. "I am not marking this n/a …" inside a BLOCKED explanation does NOT trigger the predicate', () => {
    // The exact residual finding. Under the token predicate this was REJECTED.
    const dir = webChangeScenario();
    const honest =
      "BLOCKED — the sandbox has no browser, so nothing was opened. I am not marking " +
      "this n/a — that would misrepresent a real gap. The unopened screens are " +
      "/app/board and /app/board/:id.";

    // Non-vacuity: the superseded predicate was "the token n/a appears anywhere".
    assert.match(
      honest,
      /\bn\/a\b/,
      "the probe is vacuous: the sentence no longer contains the token the old " +
        "predicate matched, so passing below proves nothing about the residual fix.",
    );
    assert.equal(declaredState(honest).state, "blocked");

    const run = check(dir, honest);
    assert.equal(
      run.status,
      0,
      "an honest refusal to claim the exemption must not be read as claiming it. " +
        `Exited ${run.status}:\n${run.output}`,
    );
    assert.doesNotMatch(run.output, /may not be\s+n\/a/);
  });

  it("5. empty, and zero-width-only, are still RED", () => {
    const dir = webChangeScenario();

    const blank = check(dir, "<!-- nothing here -->");
    assert.equal(blank.status, 1, `exited ${blank.status}\n${blank.output}`);

    const invisible = check(dir, "​⁠﻿");
    assert.equal(
      invisible.status,
      1,
      "a section made of invisibles renders BLANK on GitHub and must stay RED (F13). " +
        `Exited ${invisible.status}:\n${invisible.output}`,
    );
    assert.equal(declaredState("​⁠﻿").state, "empty");
  });

  it("6. a real screen-evidence section is GREEN", () => {
    const dir = webChangeScenario();
    const run = check(
      dir,
      "/app/board — 1440x900 — clicked New item, dragged it to Done — screenshot attached",
    );
    assert.equal(run.status, 0, `exited ${run.status}\n${run.output}`);
    assert.doesNotMatch(run.output, SCREENS_FAILURE);
  });

  it("a bare BLOCKED marker with no substance is RED", () => {
    // Otherwise the word BLOCKED simply becomes the new `n/a`.
    const dir = webChangeScenario();
    const run = check(dir, "BLOCKED");
    assert.equal(run.status, 1, `exited ${run.status}\n${run.output}`);
    assert.match(run.output, /a bare n\/a wearing a different word/);
    assert.equal(declaredState("BLOCKED").state, "blocked-bare");
  });

  it("only the FIRST meaningful line sets the state", () => {
    // The mechanism, asserted directly: identical prose, different opening line.
    const tail =
      " Later in this section I explain why n/a would be wrong and not applicable either.";
    assert.equal(declaredState(`n/a —${tail}`).state, "not-applicable");
    assert.equal(
      declaredState(`/app/board — 1440x900 — clicked New item.${tail}`).state,
      "provided",
    );
    assert.equal(
      declaredState(`BLOCKED — no browser in this sandbox at all.${tail}`)
        .state,
      "blocked",
    );
    // Template scaffolding and comments never become the first line.
    assert.equal(
      declaredState("<!-- instructions -->\n**Note:**\n---\nn/a — no UI").state,
      "not-applicable",
    );
  });

  it("does not apply when apps/web/** was not touched", () => {
    // The rule is conditional, and an n/a is legitimate on a branch with no UI change.
    const dir = scratchDir("screens-no-web");
    initRepo(dir);
    installCheckers(dir);
    installFromRepo(dir, ".github/pull_request_template.md");
    write(dir, "docs/04-engineering/ci-cd.md", CI_CD);
    const base = commit(dir, "chore: bootstrap");
    setOriginMain(dir, base);
    write(dir, "README.md", "# no UI here\n");
    commit(dir, "docs: nothing visual");

    const run = check(dir, "n/a — no UI in this change");
    assert.equal(run.status, 0, `exited ${run.status}\n${run.output}`);
  });
});
