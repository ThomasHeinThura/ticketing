/**
 * M2 red probe — ci-cd.md, the local manifest, and what CI ACTUALLY runs must not
 * silently disagree.
 *
 * "CI matches ci-cd.md" reconciled two documents against each other. Neither is a
 * workflow, so a gate could execute in CI while appearing in neither, or appear in both
 * while executing as something else. Both were true at the reviewed head:
 *
 *   pnpm check:overrides     executed by ci-fast.yml, declared nowhere
 *   pnpm check:route-policy  executed by ci-fast.yml, declared nowhere
 *   pnpm test:permissions    named by the manifest while CI ran the stricter wrapper
 *
 * The three-way reconciliation is asserted here against constructed workflows, so a
 * document edit cannot reach it. Each case pairs its assertion with the PRE-FIX
 * comparison evaluated in the same repository, so the probe cannot go vacuous:
 * `documentsOnlyAgree` is the two-document predicate M2 replaced, and `flatScanSaw` is the
 * flat `run:` text scan A2 replaced.
 *
 * **A2 — reading the workflows was not enough in three ways**, and the second describe
 * block below covers all three:
 *
 *   ONE DIRECTION ONLY  the reconciliation asked "is this executed gate declared?" and
 *                       never "is this declared, enabled gate executed?". Deleting a step
 *                       while leaving `enabled` in the manifest and the row in ci-cd.md
 *                       left two documents agreeing and a gate silently not running.
 *   SHAPE IGNORED       `if: false`, `continue-on-error: true`, a label-gated job and a
 *                       workflow that does not trigger on `pull_request` all counted as
 *                       execution. GitHub treats a skipped required check as satisfied.
 *   FILE LIST HARDCODED two paths in an array, so a third workflow was unreadable by
 *                       construction — and `uses: ./.github/actions/setup`, which is
 *                       where `pnpm install --frozen-lockfile` actually runs, was never
 *                       followed.
 *
 * One case in the M2 block used to assert `status === 0 || status === 1` — an assertion
 * that accepts either outcome and therefore proves nothing. It is replaced below with the
 * verdict A2 makes that scenario produce.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  evaluateInRepo,
  initRepo,
  installCheckers,
  installFromRepo,
  remove,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

function readWorkflow(dir) {
  return readFileSync(path.join(dir, ".github/workflows/ci-fast.yml"), "utf8");
}

/** A scratch repo carrying the real checkers, ci-cd.md and both workflows. */
function repoWithWorkflows(name, mutate = () => {}) {
  const dir = scratchDir(`m2-${name}`);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, "docs/04-engineering/ci-cd.md");
  installFromRepo(dir, ".github/workflows/ci-fast.yml");
  installFromRepo(dir, ".github/workflows/ci-full.yml");
  // The workflows reference `uses: ./.github/actions/setup`, and the scanner follows local
  // composite actions rather than shrugging at them — `pnpm install --frozen-lockfile`
  // executes in there and nowhere else. A harness missing it would be testing a repository
  // that could not run.
  installFromRepo(dir, ".github/actions/setup/action.yml");
  mutate(dir);
  return dir;
}

/**
 * The PRE-A2 scanner: a flat text scan for `run: pnpm …` with no notion of which job a
 * step belongs to, whether that job runs, or whether the step can fail the build.
 */
function flatScanSaw(dir, gate) {
  return evaluateInRepo(
    dir,
    `import { readFileSync, readdirSync } from "node:fs";
     const gates = new Set();
     const record = (command) => {
       const m = /^pnpm\\s+(--filter\\s+\\S+\\s+)?([a-z][a-z0-9:-]*)/.exec(command.trim());
       if (m) gates.add("pnpm " + m[2]);
     };
     // The hardcoded pair, exactly as it was.
     for (const relative of [
       ".github/workflows/ci-fast.yml",
       ".github/workflows/ci-full.yml",
     ]) {
       let source;
       try { source = readFileSync(relative, "utf8"); } catch { continue; }
       const lines = source.split("\\n");
       let blockIndent = null;
       for (const line of lines) {
         if (blockIndent !== null) {
           const indent = line.length - line.trimStart().length;
           if (line.trim() === "") continue;
           if (indent > blockIndent) { for (const part of line.split("&&")) record(part); continue; }
           blockIndent = null;
         }
         const inline = /^(\\s*)-?\\s*run:\\s*(.*)$/.exec(line);
         if (!inline) continue;
         if (inline[2].trim() === "|" || inline[2].trim() === ">") { blockIndent = inline[1].length; continue; }
         for (const part of inline[2].split("&&")) record(part);
       }
     }
     console.log(JSON.stringify({ saw: gates.has(${JSON.stringify(gate)}) }));`,
  ).saw;
}

/** The PRE-FIX predicate: do the two DOCUMENTS agree, ignoring the workflows entirely? */
function documentsOnlyAgree(dir) {
  return evaluateInRepo(
    dir,
    `import { readDeclaredGates } from "./scripts/ci/lib/ci-cd-gates.mjs";
     const d = await readDeclaredGates();
     const declared = new Set([...d.fast, ...d.full]);
     const source = await import("node:fs").then((fs) =>
       fs.readFileSync("scripts/ci/test-all.mjs", "utf8"));
     const manifest = new Set(
       [...source.matchAll(/gate: "([^"]+)"/g)].map((m) => m[1]));
     const onlyDeclared = [...declared].filter((g) => !manifest.has(g));
     const onlyManifest = [...manifest].filter((g) => !declared.has(g));
     console.log(JSON.stringify({ agree: onlyDeclared.length === 0 && onlyManifest.length === 0 }));`,
  ).agree;
}

describe("M2 — three-way gate reconciliation", () => {
  it("an ADDED workflow gate with no declaration is RED, while the documents still agree", () => {
    const dir = repoWithWorkflows("added", (repo) => {
      const workflow = `${readWorkflow(repo)}\n      - name: undeclared gate\n        run: pnpm check:smuggled\n`;
      write(repo, ".github/workflows/ci-fast.yml", workflow);
    });

    // NON-VACUITY: the two documents are untouched, so the old comparison passes.
    assert.equal(
      documentsOnlyAgree(dir),
      true,
      "the documents must still agree, or this scenario is not testing the third party",
    );

    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /CI EXECUTES "pnpm check:smuggled"/);
  });

  it('a REMOVED workflow step for an enabled gate is RED — not "either outcome"', () => {
    // This case used to assert `status === 0 || status === 1`, which passes whatever the
    // reconciliation decides and so proved nothing. A2 makes the verdict definite.
    const dir = repoWithWorkflows("removed", (repo) => {
      const stripped = readWorkflow(repo)
        .split("\n")
        .filter((line) => !line.includes("check:overrides"))
        .join("\n");
      write(repo, ".github/workflows/ci-fast.yml", stripped);
    });

    // NON-VACUITY, both halves. The documents still agree with each other, and the flat
    // scan no longer sees the gate — so the forward-only loop, which iterated over what
    // the workflows execute, had no iteration in which to notice anything at all.
    assert.equal(documentsOnlyAgree(dir), true);
    assert.equal(
      flatScanSaw(dir, "pnpm check:overrides"),
      false,
      "the probe failed to remove the step, so nothing is being tested",
    );

    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /marks "pnpm check:overrides" ENABLED and NO workflow/,
    );
  });

  it("the route-policy wrapper is represented, not papered over", () => {
    const dir = repoWithWorkflows("wrapper");
    const executed = evaluateInRepo(
      dir,
      `import { readWorkflowGates } from "./scripts/ci/lib/workflow-gates.mjs";
       const w = await readWorkflowGates();
       console.log(JSON.stringify({
         wrapper: w.gates.includes("pnpm check:route-policy"),
         underlying: w.gates.includes("pnpm test:permissions"),
       }));`,
    );
    // CI runs the WRAPPER and not the underlying gate — the exact asymmetry M2 named.
    assert.equal(executed.wrapper, true);
    assert.equal(executed.underlying, false);
    // And the reconciliation is nonetheless green, because the alias is declared.
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 0, result.output);
  });

  it("an unreadable workflow set fails CLOSED", () => {
    const dir = repoWithWorkflows("no-workflows", (repo) => {
      write(repo, ".github/workflows/ci-fast.yml", "# no run steps at all\n");
      write(repo, ".github/workflows/ci-full.yml", "# no run steps at all\n");
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /declares no|hard failure|no workflow/i);
  });

  it("the repository as shipped reconciles GREEN", () => {
    const dir = repoWithWorkflows("shipped");
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(
      result.status,
      0,
      `the shipped tree must reconcile cleanly:\n${result.output}`,
    );
  });
});

describe("A2 — a gate that cannot fail a pull request is not an executed gate", () => {
  /** Wrap the job that runs `gate` in a condition, by inserting a job-level key. */
  function withJobKey(source, gateLine, key) {
    const lines = source.split("\n");
    const step = lines.findIndex((line) => line.includes(gateLine));
    assert.notEqual(step, -1, `the harness could not find "${gateLine}"`);
    // Walk back to the job header: the nearest two-space `id:` line above the step.
    let job = step;
    while (job >= 0 && !/^ {2}[a-z0-9_-]+:\s*$/.test(lines[job])) job -= 1;
    assert.ok(job >= 0, "no job header above the step");
    return [
      ...lines.slice(0, job + 1),
      `    ${key}`,
      ...lines.slice(job + 1),
    ].join("\n");
  }

  it("1. `if: false` on the job is RED, and the flat scan called it executed", () => {
    const dir = repoWithWorkflows("if-false", (repo) => {
      write(
        repo,
        ".github/workflows/ci-fast.yml",
        withJobKey(
          readWorkflow(repo),
          "run: pnpm check:overrides",
          "if: false",
        ),
      );
    });

    // NON-VACUITY: the pre-A2 scan had no notion of a job condition, so it recorded the
    // gate as running. A step that never runs counted exactly like one that does.
    assert.equal(
      flatScanSaw(dir, "pnpm check:overrides"),
      true,
      "the old flat scan must still see the gate, or this is not the shape being tested",
    );

    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /CANNOT FAIL A PULL REQUEST/);
    assert.match(result.output, /never runs/);
  });

  it("2. `continue-on-error: true` on the job is RED", () => {
    const dir = repoWithWorkflows("advisory", (repo) => {
      write(
        repo,
        ".github/workflows/ci-fast.yml",
        withJobKey(
          readWorkflow(repo),
          "run: pnpm check:overrides",
          "continue-on-error: true",
        ),
      );
    });
    assert.equal(flatScanSaw(dir, "pnpm check:overrides"), true);
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /cannot fail the build/i);
  });

  it("3. a LABEL-gated job is RED — a skipped required check reads as satisfied", () => {
    const dir = repoWithWorkflows("label-gated", (repo) => {
      write(
        repo,
        ".github/workflows/ci-fast.yml",
        withJobKey(
          readWorkflow(repo),
          "run: pnpm check:overrides",
          "if: contains(github.event.pull_request.labels.*.name, 'ready-for-review')",
        ),
      );
    });
    assert.equal(flatScanSaw(dir, "pnpm check:overrides"), true);
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /LABEL/);
  });

  it("4. a gate that only runs in a workflow with no `pull_request` trigger is RED", () => {
    const dir = repoWithWorkflows("off-pull-request", (repo) => {
      // Remove the step from the pull-request workflow and put it in a push-only one.
      write(
        repo,
        ".github/workflows/ci-fast.yml",
        readWorkflow(repo)
          .split("\n")
          .filter((line) => !line.includes("check:overrides"))
          .join("\n"),
      );
      write(
        repo,
        ".github/workflows/nightly.yml",
        [
          "name: nightly",
          "on:",
          "  push:",
          "    branches: [main]",
          "jobs:",
          "  registers:",
          "    name: registers",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: ./.github/actions/setup",
          "      - name: pnpm check:overrides",
          "        run: pnpm check:overrides",
          "",
        ].join("\n"),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /not on `pull_request`|CANNOT FAIL A PULL REQUEST/,
    );
  });

  it("5. a THIRD workflow file is read — the hardcoded pair could not see it", () => {
    const dir = repoWithWorkflows("third-file", (repo) => {
      write(
        repo,
        ".github/workflows/extra.yml",
        [
          "name: extra",
          "on:",
          "  pull_request:",
          "jobs:",
          "  smuggle:",
          "    name: smuggle",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: undeclared gate",
          "        run: pnpm check:smuggled",
          "",
        ].join("\n"),
      );
    });

    // NON-VACUITY: the old scanner's file list was two hardcoded paths, so a gate in any
    // other workflow was unreadable by construction — the flat scan reports nothing.
    assert.equal(
      flatScanSaw(dir, "pnpm check:smuggled"),
      false,
      "the old hardcoded pair must miss it, or this is not the defect being tested",
    );
    assert.equal(documentsOnlyAgree(dir), true);

    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /CI EXECUTES "pnpm check:smuggled"/);
  });

  it("6. a gate smuggled into the composite ACTION is read", () => {
    const dir = repoWithWorkflows("composite", (repo) => {
      write(
        repo,
        ".github/actions/setup/action.yml",
        `${readFileSync(path.join(repo, ".github/actions/setup/action.yml"), "utf8")}
    - name: smuggled
      shell: bash
      run: pnpm check:smuggled
`,
      );
    });

    // NON-VACUITY: `uses: ./.github/actions/setup` was never followed, so a gate placed
    // in the composite action was invisible — including `pnpm install --frozen-lockfile`,
    // which is where it genuinely lives.
    assert.equal(
      flatScanSaw(dir, "pnpm check:smuggled"),
      false,
      "the old scan must miss a gate inside the composite action",
    );

    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /CI EXECUTES "pnpm check:smuggled"/);
  });

  it("7. a referenced local action that cannot be read fails CLOSED", () => {
    const dir = repoWithWorkflows("missing-action", (repo) => {
      remove(repo, ".github/actions/setup/action.yml");
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /local action|could not be read/i);
  });

  it("8. a YAML anchor fails CLOSED rather than being walked past", () => {
    const dir = repoWithWorkflows("anchor", (repo) => {
      write(
        repo,
        ".github/workflows/anchored.yml",
        [
          "name: anchored",
          "on:",
          "  pull_request:",
          "x-common: &common",
          "  runs-on: ubuntu-latest",
          "jobs:",
          "  one:",
          "    <<: *common",
          "    steps:",
          "      - run: pnpm check:overrides",
          "",
        ].join("\n"),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /anchor or alias/i);
  });

  it("9. the repository as shipped still reconciles GREEN in both directions", () => {
    const dir = repoWithWorkflows("a2-shipped");
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(
      result.status,
      0,
      `both directions must be clean on the shipped tree:\n${result.output}`,
    );
  });
});
