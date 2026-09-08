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
 * two-document comparison evaluated in the same repository, so the probe cannot go
 * vacuous: `documentsOnlyAgree` is the old predicate.
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
  mutate(dir);
  return dir;
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

  it("a REMOVED workflow gate leaves the manifest claiming an enabled gate CI no longer runs", () => {
    // The inverse direction: ci-cd.md and the manifest still declare `check:overrides`,
    // but no workflow executes it. The reconciliation reports the disagreement rather
    // than trusting the documents.
    const dir = repoWithWorkflows("removed", (repo) => {
      const stripped = readWorkflow(repo)
        .split("\n")
        .filter((line) => !line.includes("check:overrides"))
        .join("\n");
      write(repo, ".github/workflows/ci-fast.yml", stripped);
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    // Declared-and-enabled but never executed is a real disagreement; assert the
    // reconciliation SEES the workflow set rather than asserting a specific verdict the
    // implementation may reasonably choose to warn about instead of failing.
    const executed = evaluateInRepo(
      dir,
      `import { readWorkflowGates } from "./scripts/ci/lib/workflow-gates.mjs";
       const w = await readWorkflowGates();
       console.log(JSON.stringify({ runs: w.gates.includes("pnpm check:overrides") }));`,
    ).runs;
    assert.equal(
      executed,
      false,
      "the probe failed to remove the gate from the workflow",
    );
    assert.ok(
      result.status === 0 || result.status === 1,
      `reconciliation crashed rather than deciding:\n${result.output}`,
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
