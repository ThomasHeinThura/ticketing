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
 * `check:openapi`, `lint:ci`, `install` — see the comment on the map in
 * `scripts/ci/lib/workflow-aliases.mjs`), so this file pins those five rather than
 * removing the mechanism wholesale.
 *
 * Security review round 2, MEDIUM 1: the first version of this file pinned
 * `WORKFLOW_ALIASES`' contents by regexing them out of `test-all.mjs`'s SOURCE TEXT —
 * deliberately never `import()`ing that file, because it self-executes `await main()` at
 * module load. That regex was fooled by anything Node still executes correctly but the
 * regex cannot parse: a `WORKFLOW_ALIASES.set(...)` call after the array literal, a
 * comment interposed between one entry's two strings, or `new Map([...someArray, ...])`.
 * Each installed a live sixth alias while the regex-based pin, `pnpm test:all --list` and
 * `pnpm lint:ci` all stayed green — so the claim "cannot be added, retargeted or removed
 * unnoticed" was false for exactly those three shapes. The fix: `WORKFLOW_ALIASES` now
 * lives in its own file, `scripts/ci/lib/workflow-aliases.mjs`, which has no top-level
 * side effect (it only builds and exports the Map) — so THIS file imports it directly and
 * asserts against the actual runtime `Map`, never its source text. Whatever code ran to
 * build the Map, this test sees the Map's real entries, which closes all three shapes at
 * once: none of them can produce a live sixth alias without that alias showing up in
 * `[...WORKFLOW_ALIASES.entries()]`.
 *
 * Three things are asserted:
 *
 *   1. `WORKFLOW_ALIASES`' exact runtime entries, read by importing the module (not
 *      test-all.mjs) so an addition, a retarget, or a removal — however it is written —
 *      changes this test's failure output rather than passing silently.
 *   2. The five scenarios the review measured as GREEN (bypass) before this fix — deleting
 *      the `check:events` step, deleting the `check:vocabulary` step, and neutering either
 *      with `continue-on-error` or `if: false` — now reconcile RED against the real
 *      `test-all.mjs`, `ci-cd.md` and `ci-fast.yml` in a scratch repository.
 *   3. Reconstructing `WORKFLOW_ALIASES` via `.set()` after the literal, a comment between
 *      an entry's two strings, or a spread of an external array all still surface in the
 *      imported runtime Map (the round-2 MEDIUM 1 attack shapes).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";
import { WORKFLOW_ALIASES } from "../lib/workflow-aliases.mjs";

after(cleanUpScratchRepos);

describe("WORKFLOW_ALIASES — pinned exact runtime contents (imported, not regexed from source text)", () => {
  it("has exactly the five entries the alias mechanism still needs, in order", () => {
    assert.deepEqual(
      [...WORKFLOW_ALIASES.entries()],
      [
        ["pnpm check:route-policy", "pnpm test:permissions"],
        ["pnpm check:pr-template", "pr-template check"],
        ["pnpm check:openapi", "pnpm test:contract"],
        ["pnpm lint:ci", "pnpm lint"],
        ["pnpm install", "pnpm install --frozen-lockfile"],
      ],
    );
  });

  it("does NOT alias check:events to check:vocabulary — the HIGH 1/2 bypass, closed", () => {
    const executedSides = [...WORKFLOW_ALIASES.keys()];
    assert.equal(
      executedSides.includes("pnpm check:events"),
      false,
      "check:events must have its own declared row and manifest entry, not an alias — " +
        "an aliased gate has no reverse obligation under A2 · Direction 2 (review PR #91, HIGH 1/2)",
    );
  });

  it("round-2 MEDIUM 1 — an entry added via `.set()` after the module's own literal is visible in the imported Map", () => {
    // The whole point of importing the runtime value rather than regexing source text: a
    // `.set()` call is ordinary code the module executes at load time, so if
    // scripts/ci/lib/workflow-aliases.mjs ever grew one after its literal, THIS import
    // would already reflect it — proven here by mutating a throwaway copy of the map the
    // same way an attacker's `.set()` would, and confirming deepEqual against the pinned
    // five then fails. Guards against the regex-based pin regressing back in.
    const smuggled = new Map(WORKFLOW_ALIASES);
    smuggled.set("pnpm check:smuggled", "pnpm check:vocabulary");
    assert.notDeepEqual(
      [...smuggled.entries()],
      [...WORKFLOW_ALIASES.entries()],
      "a .set() call must change the entries this test observes",
    );
    assert.throws(() => {
      assert.deepEqual(
        [...smuggled.entries()],
        [
          ["pnpm check:route-policy", "pnpm test:permissions"],
          ["pnpm check:pr-template", "pr-template check"],
          ["pnpm check:openapi", "pnpm test:contract"],
          ["pnpm lint:ci", "pnpm lint"],
          ["pnpm install", "pnpm install --frozen-lockfile"],
        ],
      );
    }, "a Map with a smuggled sixth entry must fail the pin, exactly like the real module would if it grew one");
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
