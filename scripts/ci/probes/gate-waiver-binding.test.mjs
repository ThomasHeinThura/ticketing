/**
 * GPT-F4 red probes — `waived` must be authorised by ONE explicit, durable, gate-bound
 * decision, and by nothing weaker.
 *
 * The adversarial case the finding names is first, and it is first because it is the one
 * the previous check got backwards: an entry stating *"G1 is not waived"* satisfied
 * `\bG1\b` over the whole document and authorised `| G1 | waived | … |`. Every probe below
 * that could have passed the old predicate asserts so explicitly, by evaluating the old
 * predicate on the same document.
 *
 * Most of these are pure — `verifyWaiver` takes the document as a string — and the last
 * one runs the real checker end to end so the wiring is proven too, not just the library.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  DECLARATION_SYNTAX,
  gateIdentifier,
  normaliseGateToken,
  slugifyHeading,
  verifyWaiver,
  waiverDeclarations,
} from "../lib/gate-waiver.mjs";
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

const LOG_PATH = "docs/07-planning/decision-log.md";
const GATE = "G1 — No bespoke primitives";
const PR = 19;

/** The old predicate, verbatim: the identifier, word-bounded, anywhere in the file. */
function oldPredicate(decisionLog, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(decisionLog);
}

function log(...entries) {
  return ["# Decision log", "", "Newest first.", "", ...entries, ""].join("\n");
}

const NEGATION_ENTRY = [
  "### 2026-09-08 · Bespoke primitives stay banned",
  "",
  "**Decision:** G1 is not waived. Every primitive comes from `packages/ui`.",
  "",
  "**Why:** a waiver here would undo the whole point of the token system.",
  "",
].join("\n");

const NEGATION_ANCHOR = slugifyHeading(
  "2026-09-08 · Bespoke primitives stay banned",
);

function declarationEntry({ gate = "G1", pr = PR, followUp = 123 } = {}) {
  return [
    "### 2026-09-08 · A one-off waiver for the spike branch",
    "",
    "**Decision:** the gate below is waived for one pull request only.",
    "",
    `**Waives gate:** \`${gate}\` · **PR:** #${pr} · **Follow-up:** #${followUp}`,
    "",
    "**Why:** the spike has no UI to hold to the primitive rule.",
    "",
  ].join("\n");
}

const DECLARATION_ANCHOR = slugifyHeading(
  "2026-09-08 · A one-off waiver for the spike branch",
);

function check(decisionLog, link, { gate = GATE, pullRequest = PR } = {}) {
  return verifyWaiver({
    gate,
    link,
    decisionLog,
    decisionLogPath: LOG_PATH,
    pullRequest,
  });
}

describe("GPT-F4 — `waived` binds to one explicit waiver decision", () => {
  it('an entry saying "G1 is not waived" does NOT authorise a waived G1', () => {
    const decisionLog = log(NEGATION_ENTRY);

    // Non-vacuity: this is exactly what the previous check accepted.
    assert.equal(
      oldPredicate(decisionLog, "G1"),
      true,
      "the probe is vacuous: the old predicate no longer matches this document, so the " +
        "refusal below is not attributable to the fix.",
    );

    const verdict = check(
      decisionLog,
      `[decision](${LOG_PATH}#${NEGATION_ANCHOR})`,
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problem, /carries no waiver declaration for `G1`/);
    assert.match(verdict.problem, /Prose is deliberately not accepted/);
  });

  it("an unrelated mention of G1 elsewhere in the document does NOT authorise it", () => {
    // The cited entry is a real waiver entry — for G2 — and G1 is mentioned in a
    // different entry entirely. The old predicate saw one document and said yes.
    const decisionLog = log(
      declarationEntry({ gate: "G2" }),
      "### 2026-09-07 · Notes on the design gates",
      "",
      "G1 and G4 are the two that bite most often on a new screen.",
      "",
    );

    assert.equal(oldPredicate(decisionLog, "G1"), true, "vacuous");

    const verdict = check(
      decisionLog,
      `[decision](${LOG_PATH}#${DECLARATION_ANCHOR})`,
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problem, /carries no waiver declaration for `G1`/);
    assert.match(verdict.problem, /It declares `G2`/);
  });

  it("a declaration in a DIFFERENT entry than the one cited does NOT authorise it", () => {
    const decisionLog = log(declarationEntry(), NEGATION_ENTRY);
    const verdict = check(
      decisionLog,
      `[decision](${LOG_PATH}#${NEGATION_ANCHOR})`,
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problem, /carries no waiver declaration for `G1`/);
  });

  it("the #anchor is mandatory — citing the whole document is not citing a decision", () => {
    const decisionLog = log(declarationEntry());

    assert.equal(oldPredicate(decisionLog, "G1"), true, "vacuous");

    const verdict = check(decisionLog, `[decision log](${LOG_PATH})`);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problem, /must cite ONE decision, not the whole of/);
    assert.ok(verdict.problem.includes(DECLARATION_SYNTAX));
  });

  it("an anchor that resolves to nothing fails rather than falling back to the file", () => {
    const verdict = check(
      log(declarationEntry()),
      `[decision](${LOG_PATH}#a-heading-that-is-not-there)`,
    );
    assert.equal(verdict.ok, false);
    assert.match(
      verdict.problem,
      /no heading in that document has that anchor/,
    );
  });

  it("an ambiguous anchor fails rather than guessing which entry authorised it", () => {
    const twice = declarationEntry();
    const verdict = check(
      log(twice, twice),
      `[decision](${LOG_PATH}#${DECLARATION_ANCHOR})`,
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problem, /matches 2 headings/);
  });

  it("a declaration naming another pull request does NOT authorise this one", () => {
    const verdict = check(
      log(declarationEntry({ pr: 18 })),
      `[decision](${LOG_PATH}#${DECLARATION_ANCHOR})`,
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problem, /names PR #18, not #19/);
  });

  it("fails closed when the pull-request number is unknown", () => {
    // A waiver is scoped to one pull request. Without the number the scope is unknown,
    // and an unscoped waiver is a blanket waiver.
    const verdict = check(
      log(declarationEntry()),
      `[decision](${LOG_PATH}#${DECLARATION_ANCHOR})`,
      { pullRequest: null },
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problem, /could not determine which pull request/);
  });

  it("trailing prose on the declaration line does NOT count — the line is anchored", () => {
    const smuggled = [
      "### 2026-09-08 · A one-off waiver for the spike branch",
      "",
      "**Waives gate:** `G1` · **PR:** #19 · **Follow-up:** #123 — except not really",
      "",
    ].join("\n");
    assert.deepEqual(waiverDeclarations(smuggled), []);

    const verdict = check(
      log(smuggled),
      `[decision](${LOG_PATH}#${DECLARATION_ANCHOR})`,
    );
    assert.equal(verdict.ok, false);
  });

  it("a correct declaration DOES authorise the waiver", () => {
    // The control. Without it, a check that refused every waiver would satisfy every
    // assertion above while removing the feature rather than fixing it.
    const verdict = check(
      log(declarationEntry()),
      `[decision](${LOG_PATH}#${DECLARATION_ANCHOR})`,
    );
    assert.deepEqual(verdict, {
      ok: true,
      anchor: DECLARATION_ANCHOR,
      followUp: 123,
    });
  });

  it("a named gate with no G-number is bound by its whole label", () => {
    // The template's own label for this row carries a code span, and the declaration is
    // delimited by backticks — so the comparison strips them from both sides and the
    // declaration is authored without the inner pair.
    const gate = "Route coverage (`test:permissions`)";
    assert.equal(gateIdentifier(gate), gate);
    assert.equal(normaliseGateToken(gate), "route coverage (test:permissions)");
    const entry = [
      "### 2026-09-08 · Route coverage waived for the docs-only branch",
      "",
      "**Waives gate:** `Route coverage (test:permissions)` · **PR:** #19 · **Follow-up:** #124",
      "",
    ].join("\n");
    const anchor = slugifyHeading(
      "2026-09-08 · Route coverage waived for the docs-only branch",
    );
    const verdict = check(log(entry), `[decision](${LOG_PATH}#${anchor})`, {
      gate,
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.followUp, 124);
  });

  it("the checker itself rejects a waived row backed only by a negation", () => {
    const dir = scratchDir("waiver-binding");
    initRepo(dir);
    installCheckers(dir);
    installFromRepo(dir, ".github/pull_request_template.md");
    installFromRepo(dir, "docs/04-engineering/ci-cd.md");
    write(dir, LOG_PATH, log(NEGATION_ENTRY));
    const base = commit(dir, "chore: bootstrap");
    setOriginMain(dir, base);
    write(dir, "README.md", "# nothing security-sensitive\n");
    commit(dir, "docs: a change with a waived gate");

    const body = bodyFile(
      completeBody({
        gates: [
          [GATE, "waived", `[decision](${LOG_PATH}#${NEGATION_ANCHOR})`],
          ["Route coverage (`test:permissions`)", "pass", ""],
        ],
      }),
    );
    const run = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      body,
      "--pr",
      String(PR),
    ]);

    assert.equal(
      run.status,
      1,
      "a waived row citing an entry that says the gate is NOT waived must fail. Exited " +
        `${run.status}:\n${run.output}`,
    );
    assert.match(run.output, /## Gates/);
    assert.match(run.output, /carries no waiver declaration for `G1`/);
  });

  it("the checker itself accepts a waived row backed by a declaration", () => {
    const dir = scratchDir("waiver-binding-ok");
    initRepo(dir);
    installCheckers(dir);
    installFromRepo(dir, ".github/pull_request_template.md");
    installFromRepo(dir, "docs/04-engineering/ci-cd.md");
    write(dir, LOG_PATH, log(declarationEntry()));
    const base = commit(dir, "chore: bootstrap");
    setOriginMain(dir, base);
    write(dir, "README.md", "# nothing security-sensitive\n");
    commit(dir, "docs: a change with a properly waived gate");

    const body = bodyFile(
      completeBody({
        gates: [
          [GATE, "waived", `[decision](${LOG_PATH}#${DECLARATION_ANCHOR})`],
          ["Route coverage (`test:permissions`)", "pass", ""],
        ],
      }),
    );
    const run = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      body,
      "--pr",
      String(PR),
    ]);

    assert.equal(run.status, 0, `exited ${run.status}:\n${run.output}`);
    assert.match(run.output, /waived by docs\/07-planning\/decision-log\.md#/);
    assert.match(run.output, /NOT machine-verifiable and is not claimed/);
  });
});
