/**
 * Finding 1 red probe (post-#19-freeze review) — `readDeclaredGates()` used to attribute
 * the two `│`-containing fenced blocks in docs/04-engineering/ci-cd.md to the fast and
 * full stages by raw array position (`blocks[0]` -> fast, `blocks[1]` -> full), never
 * checking that a block actually sits under the document's own `**Fast —**` / `**Full
 * —**` heading. Reordering the two blocks, or inserting a third `│`-containing block
 * earlier in the document, silently swapped or corrupted which gates counted as
 * fast-stage versus full-stage — and that feeds `STAGE_AUTHORITY` in test-all.mjs, which
 * binds each stage to one authorized workflow.
 *
 * `oldPositionalAttribution` reproduces the pre-fix logic inline — same per-line parsing
 * (`normaliseGate` duplicated verbatim, unchanged by this fix), differing ONLY in how a
 * block is picked: `blocks[0]`/`blocks[1]` by array position, never a heading. That keeps
 * every comparison below isolated to the one thing this fix changes, and does not depend
 * on a specific commit staying reachable the way a `git show` of the old file would.
 *
 * Case 6 runs both parsers against the REAL, shipped docs/04-engineering/ci-cd.md and
 * asserts they agree — proving this fix does not change which gates are fast-stage vs.
 * full-stage on the tree as shipped. It is fragility being closed, not a live swap.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  evaluateInRepo,
  initRepo,
  installFromRepo,
  scratchDir,
  write,
} from "./scratch-repo.mjs";

after(cleanUpScratchRepos);

const FAST_HEADING =
  "**Fast — required on every push, target under 15 minutes:**";
const FULL_HEADING = "**Full — required before merge:**";

const FAST_BLOCK = ["```", "│ pnpm foo │", "│ pnpm bar │", "```"].join("\n");
const FULL_BLOCK = ["```", "│ pnpm baz │", "│ pnpm qux │", "```"].join("\n");

/** A stray fenced block that happens to contain `│` but names no real gate at all. */
const DECOY_BLOCK = [
  "```",
  "│ col-A                col-B                        │",
  "│ col-C                col-D                        │",
  "```",
].join("\n");

const CI_CD_GATES_FILES = [
  "scripts/ci/lib/repo.mjs",
  "scripts/ci/lib/git-baseline.mjs",
  "scripts/ci/lib/security-paths.mjs",
  "scripts/ci/lib/ci-cd-gates.mjs",
];

function docWithSections(sections) {
  return `${sections.join("\n\n")}\n`;
}

/** A scratch repo carrying only ci-cd-gates.mjs and its own dependency chain. */
function scratchDoc(name, content) {
  const dir = scratchDir(`ci-cd-gates-${name}`);
  initRepo(dir);
  write(dir, "package.json", '{ "name": "root", "version": "0.0.0" }\n');
  write(dir, "docs/04-engineering/ci-cd.md", content);
  for (const relative of CI_CD_GATES_FILES) {
    installFromRepo(dir, relative);
  }
  return dir;
}

/** The current, shipped parser: heading-anchored, fails closed. */
function currentAttribution(dir) {
  return evaluateInRepo(
    dir,
    `import { readDeclaredGates } from "./scripts/ci/lib/ci-cd-gates.mjs";
     try {
       const gates = await readDeclaredGates();
       console.log(JSON.stringify({ ok: true, gates }));
     } catch (error) {
       console.log(JSON.stringify({ ok: false, message: error.message }));
     }`,
  );
}

/**
 * The PRE-FIX predicate: whichever `│`-containing block comes first in the document is
 * "fast", the next one is "full" — no heading is ever consulted, and anything beyond the
 * first two `│`-blocks is silently ignored. Per-line parsing (`normaliseGate` and the
 * cell-extraction rules) is copied verbatim from the shipped module, because this fix
 * changes neither — only block SELECTION changed.
 */
function oldPositionalAttribution(dir) {
  return evaluateInRepo(
    dir,
    `import { readFileSync } from "node:fs";

     function normaliseGate(cell) {
       const pnpm = /^pnpm\\s+(\\S+)(?:\\s+(--\\S+))?/.exec(cell);
       if (pnpm) return pnpm[2] ? \`pnpm \${pnpm[1]} \${pnpm[2]}\` : \`pnpm \${pnpm[1]}\`;
       if (/^helm\\b/.test(cell)) return "helm lint + helm template";
       if (/^pr-template\\b/.test(cell)) return "pr-template check";
       return cell.split(/\\s+/)[0];
     }

     const source = readFileSync("docs/04-engineering/ci-cd.md", "utf8");
     const blocks = (source.match(/\`\`\`[\\s\\S]*?\`\`\`/g) ?? []).filter((b) =>
       b.includes("│"),
     );
     const parse = (block) => {
       if (!block) return null;
       const gates = [];
       for (const line of block.split("\\n")) {
         const trimmed = line.trim();
         if (!trimmed.startsWith("│")) continue;
         const body = trimmed.replace(/^│/, "").replace(/│$/, "");
         const first = body.split(/\\s{2,}/)[0].trim();
         if (first === "" || /^[─│├┌└┤]+$/.test(first)) continue;
         gates.push(normaliseGate(first));
       }
       return gates;
     };
     console.log(JSON.stringify({ fast: parse(blocks[0]), full: parse(blocks[1]) }));`,
  );
}

describe("Finding 1 -- stage attribution follows the nearest heading, not document position", () => {
  it("1. blocks in the normal order attribute correctly", () => {
    const dir = scratchDoc(
      "normal",
      docWithSections([FAST_HEADING, FAST_BLOCK, FULL_HEADING, FULL_BLOCK]),
    );

    const current = currentAttribution(dir);
    assert.equal(current.ok, true, JSON.stringify(current));
    assert.deepEqual(current.gates.fast, ["pnpm foo", "pnpm bar"]);
    assert.deepEqual(current.gates.full, ["pnpm baz", "pnpm qux"]);
  });

  it("2. the two SECTIONS reordered (Full section before Fast section) still attribute correctly", () => {
    const dir = scratchDoc(
      "reordered",
      docWithSections([FULL_HEADING, FULL_BLOCK, FAST_HEADING, FAST_BLOCK]),
    );

    // NON-VACUITY: the old, position-based parser calls whichever block comes first in
    // the document "fast" -- which is now the Full section's block -- swapping the two.
    const old = oldPositionalAttribution(dir);
    assert.deepEqual(
      old.fast,
      ["pnpm baz", "pnpm qux"],
      `the old parser did not actually swap here (${JSON.stringify(old)}), so this is not the defect`,
    );
    assert.deepEqual(old.full, ["pnpm foo", "pnpm bar"]);

    const current = currentAttribution(dir);
    assert.equal(current.ok, true, JSON.stringify(current));
    assert.deepEqual(current.gates.fast, ["pnpm foo", "pnpm bar"]);
    assert.deepEqual(current.gates.full, ["pnpm baz", "pnpm qux"]);
  });

  it("3. a decoy │-block inserted BEFORE the Fast heading corrupts BOTH stages under the old parser, and fails CLOSED under the new one", () => {
    const dir = scratchDoc(
      "decoy-before",
      docWithSections([
        DECOY_BLOCK,
        FAST_HEADING,
        FAST_BLOCK,
        FULL_HEADING,
        FULL_BLOCK,
      ]),
    );

    // NON-VACUITY: the decoy becomes "fast", and the real fast-stage block becomes
    // "full" -- exactly the silent corruption the finding describes.
    const old = oldPositionalAttribution(dir);
    assert.deepEqual(
      old.fast,
      ["col-A", "col-C"],
      `the old parser did not actually misattribute here (${JSON.stringify(old)})`,
    );
    assert.deepEqual(old.full, ["pnpm foo", "pnpm bar"]);

    const current = currentAttribution(dir);
    assert.equal(current.ok, false, JSON.stringify(current));
    assert.match(current.message, /before any stage heading/);
  });

  it("4. a decoy │-block inserted AFTER the Full heading fails CLOSED (ambiguous stage), even though the old parser silently ignored it", () => {
    const dir = scratchDoc(
      "decoy-after",
      docWithSections([
        FAST_HEADING,
        FAST_BLOCK,
        FULL_HEADING,
        FULL_BLOCK,
        DECOY_BLOCK,
      ]),
    );

    // The old parser only ever reads blocks[0]/blocks[1], so a third block trailing the
    // document was silently invisible to it -- not corrupted, just unchecked.
    const old = oldPositionalAttribution(dir);
    assert.deepEqual(old.fast, ["pnpm foo", "pnpm bar"]);
    assert.deepEqual(old.full, ["pnpm baz", "pnpm qux"]);

    const current = currentAttribution(dir);
    assert.equal(current.ok, false, JSON.stringify(current));
    assert.match(current.message, /both sit nearest the "full" heading/);
  });

  it('5. a missing "fast" heading fails CLOSED rather than guessing by position', () => {
    const dir = scratchDoc(
      "no-heading",
      docWithSections([FAST_BLOCK, FULL_HEADING, FULL_BLOCK]),
    );

    const current = currentAttribution(dir);
    assert.equal(current.ok, false, JSON.stringify(current));
    assert.match(current.message, /Could not find a "fast" stage heading/);
  });

  it("6. the REAL shipped ci-cd.md attributes identically under both parsers", () => {
    const dir = scratchDir("ci-cd-gates-shipped");
    initRepo(dir);
    write(dir, "package.json", '{ "name": "root", "version": "0.0.0" }\n');
    for (const relative of [
      ...CI_CD_GATES_FILES,
      "docs/04-engineering/ci-cd.md",
    ]) {
      installFromRepo(dir, relative);
    }

    const current = currentAttribution(dir);
    assert.equal(current.ok, true, JSON.stringify(current));

    const old = oldPositionalAttribution(dir);
    assert.deepEqual(
      current.gates,
      old,
      "the fix changed which gates are fast-stage or full-stage on the SHIPPED tree -- " +
        "that is a live misclassification, not fragility, and must be reported immediately",
    );
  });
});
