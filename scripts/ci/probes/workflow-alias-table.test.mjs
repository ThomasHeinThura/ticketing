/**
 * Security review, PR #91 — HIGH 1 + HIGH 2: `WORKFLOW_ALIASES` is not an exemption, and
 * nothing pinned its contents.
 *
 * An earlier version of this branch aliased `pnpm check:events` to the declared gate
 * `pnpm check:vocabulary`. `aliasSources()` folds an aliased command's occurrences into
 * its target's candidate set, and A2 · Direction 2 (`scripts/ci/test-all.mjs`) is
 * satisfied the moment *any* candidate in that set is proven executing. That collapsed
 * two gates into one satisfiable slot: `check:events` had no reverse obligation at all,
 * and the alias let `check:vocabulary`'s own step be removed the same way. The fix:
 * `check:events` has its own row in `docs/04-engineering/ci-cd.md` and its own manifest
 * entry, and `WORKFLOW_ALIASES` keeps only the five aliases it genuinely needs (see the
 * comment on the map in `scripts/ci/lib/workflow-aliases.mjs` for what each one is).
 *
 * **Pinning history (rounds 2–4), why this file now asserts four things, not one:**
 * round 2 found a regex reading `test-all.mjs`'s SOURCE TEXT could be fooled by a
 * `.set()` after the literal or a comment inside an entry — fixed by importing the Map
 * and asserting its runtime spread. Round 3 found a `Proxy` could lie on `.entries()`
 * alone — fixed by asserting the `Symbol.iterator` spread instead. Round 4 found the
 * spread only pins ONE of the two channels `test-all.mjs` actually reads (`for...of` at
 * `aliasSources()`, `.get()` at `reconcile()`) — a `Map` with an own `get` override
 * passed every prior version of this file 10/10 while answering a smuggled key. This
 * version closes that the same way `scripts/ci/lib/workflow-aliases.mjs` now does at
 * runtime: the Map cannot be mutated or extended after load, so there is no `.get()` (or
 * anything else) left to override — direct assertions below prove it throws, and the
 * whole-body source assertion proves nothing was added to make it lie some other way.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cleanUpScratchRepos,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";
import { stripCodeComments } from "../lib/strip-code-comments.mjs";
import { WORKFLOW_ALIASES } from "../lib/workflow-aliases.mjs";

after(cleanUpScratchRepos);

const PINNED_ENTRIES = [
  ["pnpm check:route-policy", "pnpm test:permissions"],
  ["pnpm check:pr-template", "pr-template check"],
  ["pnpm check:openapi", "pnpm test:contract"],
  ["pnpm lint:ci", "pnpm lint"],
  ["pnpm install", "pnpm install --frozen-lockfile"],
];

/** Strips comments, then drops blank/whitespace-only lines so a comment edit (which
 * shifts line positions but not code) can never make this assertion fail spuriously. */
function normalizedBody(source) {
  return stripCodeComments(source)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

const EXPECTED_BODY = [
  "const sealed = new Map([",
  '["pnpm check:route-policy", "pnpm test:permissions"],',
  '["pnpm check:pr-template", "pr-template check"],',
  '["pnpm check:openapi", "pnpm test:contract"],',
  '["pnpm lint:ci", "pnpm lint"],',
  '["pnpm install", "pnpm install --frozen-lockfile"],',
  "]);",
  'for (const method of ["set", "delete", "clear"]) {',
  "Object.defineProperty(sealed, method, {",
  "value: () => {",
  "throw new Error(",
  // Split around "${" so this data string (source text, not an actual placeholder) does
  // not trip biome's noTemplateCurlyInString heuristic.
  "`WORKFLOW_ALIASES.$" +
    "{method}() — this Map is pinned; edit the literal in scripts/ci/lib/workflow-aliases.mjs instead.`,",
  ");",
  "},",
  "});",
  "}",
  "Object.preventExtensions(sealed);",
  "export const WORKFLOW_ALIASES = sealed;",
].join("\n");

describe("WORKFLOW_ALIASES — pinned exact runtime contents (imported, not regexed from source text)", () => {
  it("has exactly the five entries the alias mechanism still needs, in order", () => {
    assert.deepEqual([...WORKFLOW_ALIASES], PINNED_ENTRIES);
  });

  it("`.get()` — the channel test-all.mjs's reconcile() reads at line ~443 — answers only for the five pinned keys (review PR #91 round 4 FINDING 1)", () => {
    for (const [executed, declared] of PINNED_ENTRIES) {
      assert.equal(WORKFLOW_ALIASES.get(executed), declared);
    }
    assert.equal(
      WORKFLOW_ALIASES.get("pnpm check:smuggled"),
      undefined,
      "a key outside the pin must not resolve through .get() to anything",
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

  it("is sealed against every mutation and extension attempt (review PR #91 round 4 FINDING 2, Gap B)", () => {
    assert.throws(() =>
      WORKFLOW_ALIASES.set("pnpm check:smuggled", "pnpm lint"),
    );
    assert.throws(() => WORKFLOW_ALIASES.delete("pnpm install"));
    assert.throws(() => WORKFLOW_ALIASES.clear());
    assert.throws(() => {
      WORKFLOW_ALIASES.get = () => "pnpm lint";
    }, "a consumer overriding .get() on the live object (not editing this file) must throw too — the B5 shape from outside");
    assert.throws(
      () => Object.setPrototypeOf(WORKFLOW_ALIASES, { get: () => "pnpm lint" }),
      "swapping the prototype to fake .get() must throw as well",
    );
  });

  it("a `.set()` on a throwaway COPY does not touch the pinned original — the seal is on the export, not on `new Map()` itself", () => {
    const copy = new Map(WORKFLOW_ALIASES);
    copy.set("pnpm check:smuggled", "pnpm check:vocabulary");
    assert.notDeepEqual([...copy], [...WORKFLOW_ALIASES]);
  });

  it("workflow-aliases.mjs's comment-stripped body is exactly this literal — any other code, however written, changes it (review PR #91 round 4 FINDING 2, Gap A)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.join(here, "../lib/workflow-aliases.mjs"),
      "utf8",
    );
    assert.equal(normalizedBody(source), normalizedBody(EXPECTED_BODY));
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
