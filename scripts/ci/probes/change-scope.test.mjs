/**
 * Applicability red probes — a pull request cannot classify itself out of scrutiny.
 *
 * Three layers, each attacked separately (ci-cd.md § Applicability):
 *
 *   1. scripts/ci/classify-change.mjs — POLICY only for landed commits that touch nothing but
 *      policy/planning Markdown as plain files. Reverts, merges, renames, symlinks, executable
 *      bits, non-Markdown and CI files all answer FULL.
 *   2. .github/actions/change-scope — runs the classifier from the MERGE BASE and answers
 *      full=true on every doubt: another event, no base, no classifier at the base, a crash,
 *      or a head-side edit of the classifier.
 *   3. lib/workflow-gates.mjs A9 — `needs: scope` counts as execution only in the exact
 *      canonical shape; the fail-open spellings are refused.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cleanUpScratchRepos,
  commit,
  evaluateInRepo,
  git,
  initRepo,
  installCheckers,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const here = path.dirname(fileURLToPath(import.meta.url));
const CLASSIFIER = path.join(here, "..", "classify-change.mjs");
const ACTION = path.join(here, "..", "..", "..", ".github", "actions", "change-scope", "action.yml");

function classify(dir, base, head) {
  const result = spawnSync(process.execPath, [CLASSIFIER, "--repo", dir, "--base", base, "--head", head], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function baseRepo(name) {
  const dir = scratchDir(`scope-${name}`);
  initRepo(dir);
  write(dir, "AGENTS.md", "# Agents\n");
  write(dir, "apps/api/src/a.ts", "export const a = 1;\n");
  write(dir, "docs/07-planning/status.md", "# Status\n");
  const base = commit(dir, "base");
  return { dir, base };
}

describe("classify-change.mjs — landed commits, fail closed", () => {
  it("policy and planning Markdown only → policy", () => {
    const { dir, base } = baseRepo("policy");
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    write(dir, "docs/07-planning/security-reviews/1-note.md", "note\n");
    write(dir, "docs/04-engineering/agent-workflow.md", "# Workflow\n");
    const head = commit(dir, "policy");
    assert.equal(classify(dir, base, head), "policy");
  });

  const fullCases = [
    ["a product file", (dir) => write(dir, "apps/api/src/a.ts", "export const a = 2;\n")],
    ["ci-cd.md (a CI input)", (dir) => write(dir, "docs/04-engineering/ci-cd.md", "# CI\n")],
    [".github", (dir) => write(dir, ".github/workflows/x.yml", "name: x\n")],
    ["the classifier itself", (dir) => write(dir, "scripts/ci/classify-change.mjs", "process.stdout.write('policy\\n');\n")],
    ["a non-Markdown planning file", (dir) => write(dir, "docs/07-planning/evidence/run.json", "{}\n")],
    ["another docs folder", (dir) => write(dir, "docs/02-design/design-tokens.md", "# Tokens\n")],
  ];
  for (const [name, change] of fullCases) {
    it(`${name} → full`, () => {
      const { dir, base } = baseRepo(name.replace(/\W+/g, "-"));
      write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
      change(dir);
      const head = commit(dir, "mixed");
      assert.match(classify(dir, base, head), /^full: /);
    });
  }

  it("a product change that is later reverted still → full (landed commits, not the net tree)", () => {
    const { dir, base } = baseRepo("revert");
    write(dir, "apps/api/src/a.ts", "export const a = 99;\n");
    commit(dir, "unreviewed product change");
    write(dir, "apps/api/src/a.ts", "export const a = 1;\n");
    commit(dir, "revert it");
    write(dir, "AGENTS.md", "# Agents\n\nnote\n");
    const head = commit(dir, "docs");
    assert.equal(git(dir, ["diff", "--name-only", `${base}..${head}`]).trim(), "AGENTS.md");
    assert.match(classify(dir, base, head), /apps\/api\/src\/a\.ts/);
  });

  it("a merge bringing a product change from a side branch → full", () => {
    const { dir, base } = baseRepo("merge");
    git(dir, ["checkout", "-q", "-b", "side"]);
    write(dir, "apps/api/src/a.ts", "export const a = 3;\n");
    commit(dir, "side product");
    git(dir, ["checkout", "-q", "main"]);
    write(dir, "AGENTS.md", "# Agents\n\nmain\n");
    commit(dir, "policy on main");
    git(dir, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    const head = git(dir, ["rev-parse", "HEAD"]).trim();
    assert.match(classify(dir, base, head), /^full: /);
  });

  it("a rename from product code into the policy tree → full (no rename detection)", () => {
    const { dir, base } = baseRepo("rename");
    git(dir, ["mv", "apps/api/src/a.ts", "docs/07-planning/a.md"]);
    const head = commit(dir, "rename");
    assert.match(classify(dir, base, head), /apps\/api\/src\/a\.ts/);
  });

  it("a symlink at a policy path → full", () => {
    const { dir, base } = baseRepo("symlink");
    symlinkSync("../../apps/api/src/a.ts", path.join(dir, "docs/07-planning/link.md"));
    const head = commit(dir, "symlink");
    assert.match(classify(dir, base, head), /mode .*120000/);
  });

  it("an executable bit on a policy file → full", () => {
    const { dir, base } = baseRepo("exec");
    chmodSync(path.join(dir, "AGENTS.md"), 0o755);
    const head = commit(dir, "chmod");
    assert.match(classify(dir, base, head), /mode 100644→100755/);
  });

  it("an empty range → full", () => {
    const { dir, base } = baseRepo("empty");
    assert.match(classify(dir, base, base), /^full: history unreadable/);
  });

  it("an unreadable range → full", () => {
    const { dir } = baseRepo("bad");
    assert.match(classify(dir, "0".repeat(40), "HEAD"), /^full: /);
  });
});

/** The composite action's script, run as GitHub would run it, inside a scratch repo. */
function actionScript() {
  const source = readFileSync(ACTION, "utf8");
  const start = source.indexOf("      run: |\n");
  assert.notEqual(start, -1, "change-scope action has no run block");
  return source
    .slice(start + "      run: |\n".length)
    .split("\n")
    .map((line) => line.replace(/^ {8}/, ""))
    .join("\n");
}

function runAction(dir, env) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "scope-action-"));
  const output = path.join(temp, "output");
  const result = spawnSync("bash", ["-c", actionScript()], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, RUNNER_TEMP: temp, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "", ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return { full: readFileSync(output, "utf8").trim(), log: result.stdout };
}

function actionRepo(name, { withClassifier = true, classifierSource = null } = {}) {
  const dir = scratchDir(`scope-action-${name}`);
  initRepo(dir);
  if (withClassifier) installCheckers(dir);
  if (classifierSource !== null) write(dir, "scripts/ci/classify-change.mjs", classifierSource);
  write(dir, "AGENTS.md", "# Agents\n");
  write(dir, "apps/api/src/a.ts", "export const a = 1;\n");
  const base = commit(dir, "base");
  setOriginMain(dir, base);
  return { dir, base };
}

describe(".github/actions/change-scope — merge-base classifier, full on any doubt", () => {
  it("policy-only pull request with a classifier at the base → full=false", () => {
    const { dir } = actionRepo("policy");
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full } = runAction(dir, { EVENT_NAME: "pull_request", BASE_REF: "main", HEAD_SHA: head });
    assert.equal(full, "full=false");
  });

  it("a head that rewrites the classifier to say `policy` is still judged by the base copy → full=true", () => {
    const { dir } = actionRepo("tamper");
    write(dir, "scripts/ci/classify-change.mjs", "process.stdout.write('policy\\n');\n");
    write(dir, "apps/api/src/a.ts", "export const a = 2;\n");
    const head = commit(dir, "self-classify");
    const { full, log } = runAction(dir, { EVENT_NAME: "pull_request", BASE_REF: "main", HEAD_SHA: head });
    assert.equal(full, "full=true");
    assert.match(log, /classifier at/);
  });

  it("no classifier at the merge base (bootstrap) → full=true", () => {
    const { dir } = actionRepo("bootstrap", { withClassifier: false });
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full, log } = runAction(dir, { EVENT_NAME: "pull_request", BASE_REF: "main", HEAD_SHA: head });
    assert.equal(full, "full=true");
    assert.match(log, /no classifier at merge base/);
  });

  it("a classifier that crashes at the base → full=true", () => {
    const { dir } = actionRepo("crash", { withClassifier: false, classifierSource: "throw new Error('boom');\n" });
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full } = runAction(dir, { EVENT_NAME: "pull_request", BASE_REF: "main", HEAD_SHA: head });
    assert.equal(full, "full=true");
  });

  it("a classifier answering anything but exactly `policy` → full=true", () => {
    const { dir } = actionRepo("noisy", {
      withClassifier: false,
      classifierSource: "process.stdout.write('policy\\nextra\\n');\n",
    });
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full } = runAction(dir, { EVENT_NAME: "pull_request", BASE_REF: "main", HEAD_SHA: head });
    assert.equal(full, "full=true");
  });

  for (const event of ["push", "merge_group", "workflow_dispatch"]) {
    it(`${event} → full=true`, () => {
      const { dir, base } = actionRepo(`event-${event}`);
      const { full } = runAction(dir, { EVENT_NAME: event, BASE_REF: "", HEAD_SHA: base });
      assert.equal(full, "full=true");
    });
  }

  it("an unresolvable merge base → full=true", () => {
    const { dir, base } = actionRepo("nobase");
    const { full } = runAction(dir, { EVENT_NAME: "pull_request", BASE_REF: "does-not-exist", HEAD_SHA: base });
    assert.equal(full, "full=true");
  });
});

const CANONICAL_SCOPE = [
  "  scope:",
  "    name: change scope",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    outputs:",
  "      full: ${{ steps.classify.outputs.full }}",
  "    steps:",
  `      - uses: actions/checkout@${"a".repeat(40)} # pinned`,
  "        with:",
  "          fetch-depth: 0",
  "      - id: classify",
  "        uses: ./.github/actions/change-scope",
  "",
];

function workflow({ scope = CANONICAL_SCOPE, needs = "scope", condition = "${{ !cancelled() && needs.scope.outputs.full != 'false' }}" } = {}) {
  return [
    "name: CI - fast",
    "on:",
    "  pull_request:",
    "jobs:",
    ...scope,
    "  build:",
    "    name: build",
    ...(needs === null ? [] : [`    needs: ${needs}`]),
    ...(condition === null ? [] : [`    if: ${condition}`]),
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: pnpm build",
    "",
  ].join("\n");
}

function kindOfBuild(source) {
  const dir = scratchDir("scope-a9");
  initRepo(dir);
  installCheckers(dir);
  write(dir, ".github/workflows/ci-fast.yml", source);
  write(dir, ".github/actions/change-scope/action.yml", readFileSync(ACTION, "utf8"));
  return evaluateInRepo(
    dir,
    `const m = await import("./scripts/ci/lib/workflow-gates.mjs");
     const r = await m.readWorkflowGates();
     const occ = r.occurrences.get("pnpm build") ?? [];
     console.log(JSON.stringify({ kinds: occ.map((o) => o.kind), reasons: occ.map((o) => o.reason), executed: r.executed.includes("pnpm build") }));`,
  );
}

describe("workflow-gates A9 — `needs: scope` only in the canonical shape", () => {
  it("canonical scope job and condition → scope-gated, counted as executed", () => {
    const result = kindOfBuild(workflow());
    assert.deepEqual(result.kinds, ["scope-gated"]);
    assert.equal(result.executed, true);
  });

  const refused = [
    ["the fail-open `== 'true'` spelling", { condition: "${{ needs.scope.outputs.full == 'true' }}" }],
    ["no !cancelled() (a failed scope would skip the gate)", { condition: "${{ needs.scope.outputs.full != 'false' }}" }],
    ["a disjunction", { condition: "${{ !cancelled() && needs.scope.outputs.full != 'false' || github.actor == 'x' }}" }],
    ["needs without the condition", { condition: null }],
    ["needs on another job", { needs: "lint" }],
    ["needs on a list", { needs: "[scope, lint]" }],
    ["no scope job", { scope: [] }],
    ["a conditional scope job", { scope: [...CANONICAL_SCOPE.slice(0, 2), "    if: github.event_name == 'pull_request'", ...CANONICAL_SCOPE.slice(2)] }],
    ["a scope job with needs", { scope: [...CANONICAL_SCOPE.slice(0, 2), "    needs: build", ...CANONICAL_SCOPE.slice(2)] }],
    ["a scope job with continue-on-error", { scope: [...CANONICAL_SCOPE.slice(0, 2), "    continue-on-error: true", ...CANONICAL_SCOPE.slice(2)] }],
    ["a scope job whose output is hardcoded", { scope: CANONICAL_SCOPE.map((line) => line.replace("${{ steps.classify.outputs.full }}", "'false'")) }],
    ["a scope job running inline shell instead of the action", { scope: CANONICAL_SCOPE.map((line) => line.replace("uses: ./.github/actions/change-scope", "run: echo full=false >> $GITHUB_OUTPUT")) }],
    ["an unpinned checkout in the scope job", { scope: CANONICAL_SCOPE.map((line) => line.replace(`@${"a".repeat(40)} # pinned`, "@v5")) }],
  ];
  it("refuses a duplicate job `if` outright (first and last would be read differently)", () => {
    const source = workflow().replace("    name: build\n", "    name: build\n    if: false\n");
    assert.throws(() => kindOfBuild(source), /repeats the job key `if`/);
  });

  for (const [name, options] of refused) {
    it(`refuses ${name}`, () => {
      const result = kindOfBuild(workflow(options));
      assert.ok(!result.kinds.includes("scope-gated"), JSON.stringify(result));
      assert.equal(result.executed, false, JSON.stringify(result));
    });
  }
});
