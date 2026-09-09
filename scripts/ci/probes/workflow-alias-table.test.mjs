/**
 * Security review, PR #91 — HIGH 1 + HIGH 2: `WORKFLOW_ALIASES` is not an exemption, and
 * nothing pinned its contents.
 *
 * An earlier version of this branch aliased `pnpm check:events` to the declared gate
 * `pnpm check:vocabulary`. `aliasSources()` folds an aliased command's occurrences into
 * its target's candidate set, and A2 · Direction 2 (`scripts/ci/test-all.mjs`) is
 * satisfied the moment *any* candidate in that set is proven executing. That collapsed
 * two gates into one satisfiable slot:
 *
 *   - `check:events` had NO reverse obligation at all. Direction 2 only ever asks about
 *     DECLARED gates, and `check:events` was not one; Direction 1 only fires on things
 *     that DO execute. Deleting the step, or giving it `continue-on-error: true` / an
 *     `if: false`, left `pnpm test:all` at exit 0.
 *   - Worse, the alias let `check:vocabulary`'s OWN declared, enabled step be deleted or
 *     neutered the same way, because `check:events` covered for it — a net reduction in
 *     coverage of a pre-existing required gate, not merely a missing improvement to a new
 *     one.
 *   - The mechanism is fully general: `grep -rn "WORKFLOW_ALIASES" scripts/ci/probes/*.test.mjs
 *     scripts/ci/lib/*.test.mjs tests/` returned nothing before this file existed, so an
 *     alias could be added, retargeted, or removed without a single test noticing.
 *
 * The fix removes the `check:events` entry from `WORKFLOW_ALIASES` and gives it its own
 * row in `docs/04-engineering/ci-cd.md` and its own manifest entry — the reconciliation
 * mechanism working as designed, at the cost of one documentation row, rather than a
 * mechanism reworked to make an aliased gate non-masking. `WORKFLOW_ALIASES` genuinely
 * needs its five remaining entries (`check:route-policy`, `check:pr-template`,
 * `check:openapi`, `lint:ci`, `install` — see the comment above the map in test-all.mjs),
 * so this file pins those five rather than removing the mechanism wholesale.
 *
 * Two things are asserted:
 *
 *   1. `WORKFLOW_ALIASES`' exact contents, read out of the source text (never imported —
 *      test-all.mjs runs `await main()` at module load) so an addition, a retarget, or a
 *      removal changes this test's failure output rather than passing silently.
 *   2. The five scenarios the review measured as GREEN (bypass) before this fix — deleting
 *      the `check:events` step, deleting the `check:vocabulary` step, and neutering either
 *      with `continue-on-error` or `if: false` — now reconcile RED against the real
 *      `test-all.mjs`, `ci-cd.md` and `ci-fast.yml` in a scratch repository.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { repoRoot } from "../lib/repo.mjs";
import {
  cleanUpScratchRepos,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const TEST_ALL_SOURCE = readFileSync(
  path.join(repoRoot, "scripts/ci/test-all.mjs"),
  "utf8",
);

/**
 * Parse `WORKFLOW_ALIASES`' literal `[executed, declared]` pairs straight out of the
 * source text. Never `import()` the module for this — it self-executes `await main()` at
 * the top level, which would run the real reconciliation as a side effect of a unit test.
 */
function parseWorkflowAliases(source) {
  const block = source.match(
    /const WORKFLOW_ALIASES = new Map\(\[([\s\S]*?)\]\);/,
  );
  if (!block) {
    throw new Error(
      "Could not find `const WORKFLOW_ALIASES = new Map([...]);` in test-all.mjs — has it been renamed or restructured?",
    );
  }
  return [...block[1].matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)].map(
    (m) => [m[1], m[2]],
  );
}

describe("WORKFLOW_ALIASES — pinned exact contents", () => {
  it("has exactly the five entries the alias mechanism still needs, in order", () => {
    const parsed = parseWorkflowAliases(TEST_ALL_SOURCE);
    assert.deepEqual(parsed, [
      ["pnpm check:route-policy", "pnpm test:permissions"],
      ["pnpm check:pr-template", "pr-template check"],
      ["pnpm check:openapi", "pnpm test:contract"],
      ["pnpm lint:ci", "pnpm lint"],
      ["pnpm install", "pnpm install --frozen-lockfile"],
    ]);
  });

  it("does NOT alias check:events to check:vocabulary — the HIGH 1/2 bypass, closed", () => {
    const parsed = parseWorkflowAliases(TEST_ALL_SOURCE);
    const executedSides = parsed.map(([executed]) => executed);
    assert.equal(
      executedSides.includes("pnpm check:events"),
      false,
      "check:events must have its own declared row and manifest entry, not an alias — " +
        "an aliased gate has no reverse obligation under A2 · Direction 2 (review PR #91, HIGH 1/2)",
    );
  });
});

/** A scratch repo carrying the real checkers, ci-cd.md and both workflows. */
function repoWithWorkflows(name, mutate = () => {}) {
  const dir = scratchDir(`alias-table-${name}`);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, "docs/04-engineering/ci-cd.md");
  installFromRepo(dir, ".github/workflows/ci-fast.yml");
  installFromRepo(dir, ".github/workflows/ci-full.yml");
  installFromRepo(dir, ".github/actions/setup/action.yml");
  mutate(dir);
  return dir;
}

const WORKFLOW = ".github/workflows/ci-fast.yml";

function readWorkflow(dir) {
  return readFileSync(path.join(dir, WORKFLOW), "utf8");
}

/** Remove the whole `- name: pnpm <script>` step block (name line, comments, run line). */
function dropStep(source, script) {
  const lines = source.split("\n");
  const start = lines.findIndex(
    (line) => line.trim() === `- name: pnpm ${script}`,
  );
  if (start === -1) {
    throw new Error(
      `step "pnpm ${script}" not found — the probe would test nothing`,
    );
  }
  const indent = lines[start].length - lines[start].trimStart().length;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") {
      end += 1;
      continue;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= indent && line.trim().startsWith("-")) break;
    if (lineIndent < indent) break;
    end += 1;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

function neuter(source, script, guard) {
  const needle = `        run: pnpm ${script}`;
  const replaced = source.replace(needle, `        ${guard}\n${needle}`);
  if (replaced === source) {
    throw new Error(
      `"run: pnpm ${script}" not found — the probe would test nothing`,
    );
  }
  return replaced;
}

describe("HIGH 1/2 regression — the bypass cases the review measured GREEN are now RED", () => {
  it("the shipped tree reconciles GREEN (non-vacuity: the harness itself is sound)", () => {
    const dir = repoWithWorkflows("shipped");
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(
      result.status,
      0,
      `shipped tree must reconcile cleanly:\n${result.output}`,
    );
  });

  it("review case A — deleting the check:events step is RED (was GREEN under the alias)", () => {
    const dir = repoWithWorkflows("case-a", (repo) => {
      write(repo, WORKFLOW, dropStep(readWorkflow(repo), "check:events"));
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /"pnpm check:events" ENABLED and NO workflow executes it/,
    );
  });

  it("review case B — deleting the check:vocabulary step is RED (was GREEN under the alias, because check:events covered for it)", () => {
    const dir = repoWithWorkflows("case-b", (repo) => {
      write(repo, WORKFLOW, dropStep(readWorkflow(repo), "check:vocabulary"));
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /"pnpm check:vocabulary" ENABLED and NO workflow executes it/,
    );
  });

  it("review case D — check:events given continue-on-error is RED", () => {
    const dir = repoWithWorkflows("case-d", (repo) => {
      write(
        repo,
        WORKFLOW,
        neuter(readWorkflow(repo), "check:events", "continue-on-error: true"),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /"pnpm check:events" ENABLED and every workflow occurrence of it CANNOT FAIL/,
    );
  });

  it("review case E — check:events given if: false is RED", () => {
    const dir = repoWithWorkflows("case-e", (repo) => {
      write(
        repo,
        WORKFLOW,
        neuter(readWorkflow(repo), "check:events", "if: false"),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /"pnpm check:events" ENABLED and every workflow occurrence of it CANNOT FAIL/,
    );
  });

  it("review case F — check:vocabulary given continue-on-error, check:events intact, is RED", () => {
    const dir = repoWithWorkflows("case-f", (repo) => {
      write(
        repo,
        WORKFLOW,
        neuter(
          readWorkflow(repo),
          "check:vocabulary",
          "continue-on-error: true",
        ),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /"pnpm check:vocabulary" ENABLED and every workflow occurrence of it CANNOT FAIL/,
    );
  });

  it("non-vacuity — the dropStep/neuter probe machinery actually finds the real steps", () => {
    // Cases A/B/D/E/F above are only meaningful if dropStep/neuter located and mutated the
    // REAL step; a probe that silently no-ops (script renamed, indentation changed) would
    // report the shipped tree's own GREEN and look identical to a caught regression. Assert
    // the mutation actually changed the workflow text for every script these cases touch.
    const dir = repoWithWorkflows("mutation-sanity");
    const original = readWorkflow(dir);
    for (const script of ["check:events", "check:vocabulary"]) {
      assert.notEqual(
        dropStep(original, script),
        original,
        `dropStep did not find "pnpm ${script}" — the review's case would test nothing`,
      );
      assert.notEqual(
        neuter(original, script, "if: false"),
        original,
        `neuter did not find "pnpm ${script}" — the review's case would test nothing`,
      );
    }
  });
});
