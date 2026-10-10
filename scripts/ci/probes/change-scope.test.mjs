/**
 * Applicability red probes — a pull request cannot classify itself out of scrutiny.
 *
 * Three layers, each attacked separately (ci-cd.md § Applicability):
 *
 *   1. scripts/ci/classify-change.mjs — POLICY only for landed commits that touch nothing but
 *      policy/planning Markdown as plain files. Reverts, merges, renames, symlinks, executable
 *      bits, non-Markdown and CI files all answer FULL.
 *   2. .github/actions/change-scope — runs the classifier from the MERGE BASE with the default
 *      branch and answers full=true on every doubt: another event, another target branch, no
 *      base, no classifier at the base, a crash, or a head-side edit of the classifier. Its
 *      echo is fenced against workflow-command injection.
 *   3. lib/workflow-gates.mjs A9 — a gate step conditioned on the scope step counts as
 *      execution only in the exact canonical step-level shape, with the action pinned by hash,
 *      outside the always-run jobs, and with no environment that could redirect it.
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
  installFromRepo,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const here = path.dirname(fileURLToPath(import.meta.url));
const CLASSIFIER = path.join(here, "..", "classify-change.mjs");
const ACTION = path.join(
  here,
  "..",
  "..",
  "..",
  ".github",
  "actions",
  "change-scope",
  "action.yml",
);

function classify(dir, base, head) {
  const result = spawnSync(
    process.execPath,
    [CLASSIFIER, "--repo", dir, "--base", base, "--head", head],
    {
      encoding: "utf8",
    },
  );
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
    [
      "a product file",
      (dir) => write(dir, "apps/api/src/a.ts", "export const a = 2;\n"),
    ],
    [
      "ci-cd.md (a CI input)",
      (dir) => write(dir, "docs/04-engineering/ci-cd.md", "# CI\n"),
    ],
    [".github", (dir) => write(dir, ".github/workflows/x.yml", "name: x\n")],
    [
      "the classifier itself",
      (dir) =>
        write(
          dir,
          "scripts/ci/classify-change.mjs",
          "process.stdout.write('policy\\n');\n",
        ),
    ],
    [
      "a non-Markdown planning file",
      (dir) => write(dir, "docs/07-planning/evidence/run.json", "{}\n"),
    ],
    [
      "another docs folder",
      (dir) => write(dir, "docs/02-design/design-tokens.md", "# Tokens\n"),
    ],
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
    assert.equal(
      git(dir, ["diff", "--name-only", `${base}..${head}`]).trim(),
      "AGENTS.md",
    );
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
    symlinkSync(
      "../../apps/api/src/a.ts",
      path.join(dir, "docs/07-planning/link.md"),
    );
    const head = commit(dir, "symlink");
    assert.match(classify(dir, base, head), /mode .*120000/);
  });

  it("an executable bit on a policy file → full", () => {
    const { dir, base } = baseRepo("exec");
    chmodSync(path.join(dir, "AGENTS.md"), 0o755);
    const head = commit(dir, "chmod");
    assert.match(classify(dir, base, head), /mode 100644→100755/);
  });

  it("a file name carrying a newline cannot forge an output line", () => {
    const { dir, base } = baseRepo("inject");
    write(
      dir,
      "apps/x\n::set-output name=full::false\npolicy.ts",
      "export {};\n",
    );
    const head = commit(dir, "crafted name");
    const verdict = classify(dir, base, head);
    assert.equal(verdict.split("\n").length, 1, verdict);
    assert.match(verdict, /^full: "apps\/x\\n::set-output/);
  });

  it("a root commit inside the range → full", () => {
    const { dir, base } = baseRepo("root");
    git(dir, ["checkout", "-q", "--orphan", "orphan"]);
    git(dir, ["rm", "-rq", "--cached", "."]);
    write(dir, "AGENTS.md", "# orphan\n");
    git(dir, ["add", "AGENTS.md"]);
    git(dir, ["commit", "-q", "-m", "orphan root"]);
    git(dir, ["checkout", "-q", "-f", "main"]);
    git(dir, [
      "merge",
      "-q",
      "--allow-unrelated-histories",
      "-X",
      "theirs",
      "-m",
      "join",
      "orphan",
    ]);
    const head = git(dir, ["rev-parse", "HEAD"]).trim();
    assert.match(classify(dir, base, head), /^full: /);
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
    env: {
      ...process.env,
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: "",
      DEFAULT_BRANCH: "main",
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return { full: readFileSync(output, "utf8").trim(), log: result.stdout };
}

function actionRepo(
  name,
  { withClassifier = true, classifierSource = null } = {},
) {
  const dir = scratchDir(`scope-action-${name}`);
  initRepo(dir);
  if (withClassifier) installCheckers(dir);
  if (classifierSource !== null)
    write(dir, "scripts/ci/classify-change.mjs", classifierSource);
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
    const { full } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "main",
      HEAD_SHA: head,
    });
    assert.equal(full, "full=false");
  });

  it("a head that rewrites the classifier to say `policy` is still judged by the base copy → full=true", () => {
    const { dir } = actionRepo("tamper");
    write(
      dir,
      "scripts/ci/classify-change.mjs",
      "process.stdout.write('policy\\n');\n",
    );
    write(dir, "apps/api/src/a.ts", "export const a = 2;\n");
    const head = commit(dir, "self-classify");
    const { full, log } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "main",
      HEAD_SHA: head,
    });
    assert.equal(full, "full=true");
    assert.match(log, /classifier at/);
  });

  it("no classifier at the merge base (bootstrap) → full=true", () => {
    const { dir } = actionRepo("bootstrap", { withClassifier: false });
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full, log } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "main",
      HEAD_SHA: head,
    });
    assert.equal(full, "full=true");
    assert.match(log, /no classifier at merge base/);
  });

  it("a classifier that crashes at the base → full=true", () => {
    const { dir } = actionRepo("crash", {
      withClassifier: false,
      classifierSource: "throw new Error('boom');\n",
    });
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "main",
      HEAD_SHA: head,
    });
    assert.equal(full, "full=true");
  });

  it("a classifier that prints `policy` but exits non-zero → full=true", () => {
    const { dir } = actionRepo("exit", {
      withClassifier: false,
      classifierSource: "process.stdout.write('policy');\nprocess.exit(3);\n",
    });
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "main",
      HEAD_SHA: head,
    });
    assert.equal(full, "full=true");
  });

  it("a classifier answering anything but exactly `policy` → full=true", () => {
    const { dir } = actionRepo("noisy", {
      withClassifier: false,
      classifierSource: "process.stdout.write('policy\\nextra\\n');\n",
    });
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "main",
      HEAD_SHA: head,
    });
    assert.equal(full, "full=true");
  });

  for (const event of ["push", "merge_group", "workflow_dispatch"]) {
    it(`${event} → full=true`, () => {
      const { dir, base } = actionRepo(`event-${event}`);
      const { full } = runAction(dir, {
        EVENT_NAME: event,
        BASE_REF: "",
        HEAD_SHA: base,
      });
      assert.equal(full, "full=true");
    });
  }

  it("a pull request into any branch but the default one → full=true", () => {
    const { dir } = actionRepo("retarget");
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    git(dir, ["update-ref", "refs/remotes/origin/side", head]);
    const { full, log } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "side",
      HEAD_SHA: head,
    });
    assert.equal(full, "full=true");
    assert.match(log, /is not the default branch/);
  });

  it("an unknown default branch → full=true", () => {
    const { dir } = actionRepo("nodefault");
    write(dir, "AGENTS.md", "# Agents\n\nchanged\n");
    const head = commit(dir, "policy");
    const { full } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "main",
      HEAD_SHA: head,
      DEFAULT_BRANCH: "",
    });
    assert.equal(full, "full=true");
  });

  it("its log line is fenced with ::stop-commands:: so a crafted reason cannot run a command", () => {
    const { dir } = actionRepo("fence");
    write(dir, "apps/api/src/a.ts", "export const a = 5;\n");
    const head = commit(dir, "product");
    const { log } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "main",
      HEAD_SHA: head,
    });
    const lines = log.trim().split("\n");
    const open = lines.findIndex((line) =>
      line.startsWith("::stop-commands::scope-"),
    );
    assert.notEqual(open, -1, log);
    const token = lines[open].slice("::stop-commands::".length);
    assert.ok(token.length > 20, token);
    assert.match(lines[open + 1], /^change scope: full=true/);
    assert.equal(lines[open + 2], `::${token}::`);
  });

  it("an unresolvable merge base → full=true", () => {
    const { dir, base } = actionRepo("nobase");
    const { full } = runAction(dir, {
      EVENT_NAME: "pull_request",
      BASE_REF: "does-not-exist",
      HEAD_SHA: base,
    });
    assert.equal(full, "full=true");
  });
});

const PINNED_ACTION = readFileSync(ACTION, "utf8");

const CHECKOUT_SHA = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const CHECKOUT = [
  `      - uses: actions/checkout@${CHECKOUT_SHA} # v5.1.0`,
  "        with:",
  "          fetch-depth: 0",
];
const SCOPE_STEP = [
  "      - id: scope",
  "        uses: ./.github/actions/change-scope",
];
const SAFE_DIRECTORY = [
  "      - name: Trust the checked-out repository inside the Playwright container",
  '        run: git config --global --add safe.directory "$GITHUB_WORKSPACE"',
];
const GATE_STEP = [
  "      - name: pnpm build",
  "        if: ${{ steps.scope.outputs.full != 'false' }}",
  "        run: pnpm build",
];

function workflow({
  job = "build",
  jobLines = [],
  steps = [...CHECKOUT, ...SCOPE_STEP, ...GATE_STEP],
  env = ['  TURBO_TELEMETRY_DISABLED: "1"', '  DO_NOT_TRACK: "1"'],
  envRaw = "env:",
} = {}) {
  return [
    "name: CI - fast",
    "on:",
    "  pull_request:",
    ...(env.length > 0 || envRaw !== "env:" ? [envRaw, ...env] : []),
    "jobs:",
    `  ${job}:`,
    `    name: ${job}`,
    ...jobLines,
    "    runs-on: ubuntu-latest",
    "    steps:",
    ...steps,
    "",
  ].join("\n");
}

function kindOfBuild(source, action = PINNED_ACTION) {
  const dir = scratchDir("scope-a9");
  initRepo(dir);
  installCheckers(dir);
  write(dir, ".github/workflows/ci-fast.yml", source);
  installFromRepo(dir, ".github/actions/setup/action.yml");
  if (action !== null)
    write(dir, ".github/actions/change-scope/action.yml", action);
  return evaluateInRepo(
    dir,
    `const m = await import("./scripts/ci/lib/workflow-gates.mjs");
     const r = await m.readWorkflowGates();
     const occ = r.occurrences.get("pnpm build") ?? [];
     console.log(JSON.stringify({ kinds: occ.map((o) => o.kind), reasons: occ.map((o) => o.reason), executed: r.executed.includes("pnpm build") }));`,
  );
}

const replaceGateIf = (condition) => [
  ...CHECKOUT,
  ...SCOPE_STEP,
  GATE_STEP[0],
  `        if: ${condition}`,
  GATE_STEP[2],
];

describe("workflow-gates A9 — the step-level change-scope shape only", () => {
  it("canonical scope step and condition → scope-gated, counted as executed", () => {
    const result = kindOfBuild(workflow());
    assert.deepEqual(result.kinds, ["scope-gated"], JSON.stringify(result));
    assert.equal(result.executed, true);
  });

  it("the pinned Playwright container with its exact safe.directory step → scope-gated", () => {
    const result = kindOfBuild(
      workflow({
        jobLines: [
          "    container:",
          "      image: mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27",
          "      options: --ipc=host",
        ],
        steps: [...CHECKOUT, ...SAFE_DIRECTORY, ...SCOPE_STEP, ...GATE_STEP],
      }),
    );
    assert.deepEqual(result.kinds, ["scope-gated"], JSON.stringify(result));
  });

  const refused = [
    [
      "the fail-open `== 'true'` spelling",
      { steps: replaceGateIf("${{ steps.scope.outputs.full == 'true' }}") },
    ],
    [
      "an extra atom beside the scope condition",
      {
        steps: replaceGateIf(
          "${{ steps.scope.outputs.full != 'false' && github.actor == 'x' }}",
        ),
      },
    ],
    [
      "a disjunction",
      {
        steps: replaceGateIf(
          "${{ steps.scope.outputs.full != 'false' || github.actor == 'x' }}",
        ),
      },
    ],
    [
      "an unproven step condition in a scope-gated job (W8 mutant)",
      { steps: replaceGateIf("${{ github.event_name == 'push' }}") },
    ],
    ["no scope step", { steps: [...CHECKOUT, ...GATE_STEP] }],
    [
      "a scope step after the gate",
      { steps: [...CHECKOUT, ...GATE_STEP, ...SCOPE_STEP] },
    ],
    [
      "two scope steps",
      { steps: [...CHECKOUT, ...SCOPE_STEP, ...SCOPE_STEP, ...GATE_STEP] },
    ],
    [
      "a conditional scope step",
      {
        steps: [
          ...CHECKOUT,
          ...SCOPE_STEP,
          "        if: github.event_name == 'pull_request'",
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a scope step with env (PATH redirection)",
      {
        steps: [
          ...CHECKOUT,
          ...SCOPE_STEP,
          "        env:",
          "          PATH: ./bin",
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a scope step with continue-on-error",
      {
        steps: [
          ...CHECKOUT,
          ...SCOPE_STEP,
          "        continue-on-error: true",
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a scope step using another action",
      {
        steps: [
          ...CHECKOUT,
          "      - id: scope",
          "        uses: ./.github/actions/setup",
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a scope step running inline shell",
      {
        steps: [
          ...CHECKOUT,
          "      - id: scope",
          "        run: echo full=false >> $GITHUB_OUTPUT",
          ...GATE_STEP,
        ],
      },
    ],
    ["an always-run job", { job: "registers" }],
    ["the pull-request job", { job: "pull-request" }],
    ["a job-level env", { jobLines: ["    env:", "      PATH: ./bin"] }],
    [
      "a workflow env beyond the inert pair",
      { env: ['  TURBO_TELEMETRY_DISABLED: "1"', "  PATH: ./bin"] },
    ],
    ["a job that needs another job", { jobLines: ["    needs: scope"] }],
    [
      "an unproven job condition on a scope-gated job (mutant: exempting every level)",
      { jobLines: ["    if: ${{ github.actor == 'x' }}"] },
    ],
    [
      "a step before the scope step that writes $GITHUB_ENV",
      {
        steps: [
          ...CHECKOUT,
          "      - run: echo NODE_OPTIONS=--require ./x.cjs >> $GITHUB_ENV",
          ...SCOPE_STEP,
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a step before the scope step that writes $GITHUB_PATH",
      {
        steps: [
          ...CHECKOUT,
          "      - run: echo ./bin >> $GITHUB_PATH",
          ...SCOPE_STEP,
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a local action before the scope step",
      {
        steps: [
          ...CHECKOUT,
          "      - uses: ./.github/actions/setup",
          ...SCOPE_STEP,
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a checkout of another ref",
      {
        steps: [
          CHECKOUT[0],
          "        with:",
          "          fetch-depth: 0",
          "          ref: other",
          ...SCOPE_STEP,
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a checkout without fetch-depth 0",
      { steps: [CHECKOUT[0], ...SCOPE_STEP, ...GATE_STEP] },
    ],
    [
      "an unpinned checkout",
      {
        steps: [
          "      - uses: actions/checkout@v5",
          "        with:",
          "          fetch-depth: 0",
          ...SCOPE_STEP,
          ...GATE_STEP,
        ],
      },
    ],
    [
      "no checkout before the scope step",
      { steps: [...SCOPE_STEP, ...GATE_STEP] },
    ],
    [
      "an arbitrary job container",
      { jobLines: ["    container:", "      image: evil/image:latest"] },
    ],
    [
      "the pinned container with its own env",
      {
        jobLines: [
          ...[
            "    container:",
            "      image: mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27",
            "      options: --ipc=host",
          ],
          "      env:",
          "        PATH: ./bin",
        ],
      },
    ],
    [
      "the safe.directory step without the pinned container",
      { steps: [...CHECKOUT, ...SAFE_DIRECTORY, ...SCOPE_STEP, ...GATE_STEP] },
    ],
    [
      "a workflow env written as a flow mapping",
      {
        env: [],
        envRaw:
          "env: { TURBO_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--require ./x.cjs' }",
      },
    ],
    [
      "a workflow env with a comment on its key line",
      {
        env: [
          '  TURBO_TELEMETRY_DISABLED: "1"',
          '  NODE_OPTIONS: "--require ./x.cjs"',
        ],
        envRaw: "env: # inert",
      },
    ],
    [
      "a checkout pinned to any other commit (fork-resolvable SHA)",
      {
        steps: [
          `      - uses: actions/checkout@${"a".repeat(40)} # pinned`,
          ...CHECKOUT.slice(1),
          ...SCOPE_STEP,
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a job-level services block",
      {
        jobLines: ["    services:", "      cache:", "        image: redis:7"],
      },
    ],
    [
      "a pinned-container job whose second step is not the exact safe.directory text",
      {
        jobLines: [
          "    container:",
          "      image: mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27",
          "      options: --ipc=host",
        ],
        steps: [
          ...CHECKOUT,
          SAFE_DIRECTORY[0],
          '        run: git config --global --add safe.directory "$GITHUB_WORKSPACE" && echo NODE_OPTIONS=--require ./x.cjs >> $GITHUB_ENV',
          ...SCOPE_STEP,
          ...GATE_STEP,
        ],
      },
    ],
    [
      "a workflow env key written `env :` (space before the colon)",
      {
        env: [
          '  TURBO_TELEMETRY_DISABLED: "1"',
          '  NODE_OPTIONS: "--require ./x.cjs"',
        ],
        envRaw: "env :",
      },
    ],
    [
      "a workflow env line the inert-entry pattern cannot parse",
      { env: ['  TURBO_TELEMETRY_DISABLED: "1"', "  NODE_OPTIONS : x"] },
    ],
    [
      "a renamed always-run job (gate keyed, not id keyed)",
      {
        job: "regs",
        steps: [
          ...CHECKOUT,
          ...SCOPE_STEP,
          "      - name: pnpm check:policy",
          "        if: ${{ steps.scope.outputs.full != 'false' }}",
          "        run: pnpm check:policy",
          ...GATE_STEP,
        ],
      },
    ],
  ];
  for (const [name, options] of refused) {
    it(`refuses ${name}`, () => {
      const result = kindOfBuild(workflow(options));
      assert.ok(!result.kinds.includes("scope-gated"), JSON.stringify(result));
      assert.equal(result.executed, false, JSON.stringify(result));
    });
  }

  it("refuses a tampered composite action (digest pin)", () => {
    const result = kindOfBuild(
      workflow(),
      PINNED_ACTION.replace("full=true\n", "full=false\n"),
    );
    assert.equal(result.executed, false, JSON.stringify(result));
    assert.match(result.reasons.join(" "), /differs from the reviewed version/);
  });

  it("refuses a missing composite action", () => {
    assert.throws(
      () => kindOfBuild(workflow(), null),
      /change-scope\/action\.yaml could be read/,
    );
  });

  it("refuses a duplicate step `if` outright", () => {
    const steps = [
      ...CHECKOUT,
      ...SCOPE_STEP,
      GATE_STEP[0],
      "        if: false",
      ...GATE_STEP.slice(1),
    ];
    assert.throws(
      () => kindOfBuild(workflow({ steps })),
      /repeats the step key `if`/,
    );
  });

  it("refuses a duplicate job `if` outright", () => {
    const source = workflow({
      jobLines: [
        "    if: false",
        "    if: github.event_name == 'pull_request'",
      ],
    });
    assert.throws(() => kindOfBuild(source), /repeats the job key `if`/);
  });
});
