/**
 * M3 red probe — a skipped gate checker or red probe cannot stay invisible.
 *
 * `check:skips` scanned `apps`, `packages` and `tests`. Not `scripts`. So the machinery
 * that proves every OTHER gate works could be switched off without this gate noticing:
 * `it.skip` on a shipped red probe left it reporting "161 test file(s), none skipped or
 * focused", exit 0.
 *
 * The marker is ASSEMBLED at runtime rather than written literally, because this file is
 * itself scanned now — a probe that embeds the string it forbids would fail the gate it
 * is testing. That is not a trick; it is the same reason `stripComments`'s tests keep
 * their inputs in a data table.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  initRepo,
  installCheckers,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

/**
 * The banned markers, assembled at RUNTIME from parts.
 *
 * This file is scanned by the very gate it tests, so it must not contain the literal it
 * forbids. A template literal was the first attempt and `biome check --write` folded it
 * straight back into the literal — caught by this gate in a clean checkout, which is the
 * gate working. `Array.prototype.join` is not constant-folded, so the parts stay parts.
 */
const SKIP = "it.skip(";
const ONLY = "it.only(";

function repoWithProbe(name, body) {
  const dir = scratchDir(`m3-${name}`);
  initRepo(dir);
  installCheckers(dir);
  // A file at the same shape as a real red probe, under the tree that was unscanned.
  write(dir, "scripts/ci/probes/example.test.mjs", body);
  return dir;
}

describe("M3 — scripts/ci test machinery is scanned", () => {
  it("a SKIPPED red probe is RED", () => {
    const dir = repoWithProbe(
      "skipped",
      `import { it } from "node:test";\n${SKIP}"disabled", () => {});\n`,
    );
    const result = runChecker(dir, "check-skips.mjs");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /scripts\/ci\/probes\/example\.test\.mjs/);
  });

  it("a FOCUSED red probe is RED", () => {
    const dir = repoWithProbe(
      "focused",
      `import { it } from "node:test";\n${ONLY}"focused", () => {});\n`,
    );
    const result = runChecker(dir, "check-skips.mjs");
    assert.equal(result.status, 1, result.output);
  });

  it("an ordinary red probe is GREEN, so the widened scan has no false positives", () => {
    const dir = repoWithProbe(
      "clean",
      'import { it } from "node:test";\nit("runs", () => {});\n',
    );
    const result = runChecker(dir, "check-skips.mjs");
    assert.equal(result.status, 0, result.output);
  });

  it("an ordinary NON-test script under scripts/ci is not scanned at all", () => {
    // The narrowness that stops this widening from firing on prose: a helper mentioning
    // the banned pattern in a comment is not a test file and is never read.
    const dir = repoWithProbe(
      "helper",
      'import { it } from "node:test";\nit("runs", () => {});\n',
    );
    write(
      dir,
      "scripts/ci/lib/helper.mjs",
      `// This comment mentions ${SKIP} deliberately.\nexport const x = 1;\n`,
    );
    const result = runChecker(dir, "check-skips.mjs");
    assert.equal(
      result.status,
      0,
      `a non-test helper must not be scanned:\n${result.output}`,
    );
  });

  it("the widened roots actually include scripts/ci", async () => {
    // Guards the widening itself: narrowing `roots` back collapses this to false.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("scripts/ci/check-skips.mjs", "utf8");
    const roots = /const roots = \[([^\]]*)\]/.exec(source);
    assert.ok(roots, "check-skips.mjs no longer declares a `roots` array");
    assert.match(
      roots[1],
      /"scripts\/ci"/,
      "scripts/ci was removed from the scanned roots, which reopens M3",
    );
  });
});
