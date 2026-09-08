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

  /**
   * Guards the widening itself — BEHAVIOURALLY.
   *
   * This test used to read `check-skips.mjs`'s source and regex out its `const roots =
   * [...]` literal. It was an instance of the very class this pull request keeps
   * closing: an assertion about the checker's TEXT standing in for an assertion about
   * what the checker DOES. When A5 replaced the literal with membership derived from
   * pnpm-workspace.yaml, the regex found nothing and the test failed — while the gate it
   * guards had got strictly stronger. A text assertion cannot tell those two apart.
   *
   * So it places a real skipped test in the tree and checks the gate catches it. That
   * holds however the roots are computed, and it fails if the coverage is ever narrowed.
   */
  it("a skipped test anywhere under scripts/ is caught, however roots are computed", () => {
    const dir = scratchDir("m3-scripts-root");
    initRepo(dir);
    installCheckers(dir);
    // scripts/i18n, NOT scripts/ci: outside the old literal `"scripts/ci"` entirely, so
    // this case also pins A5's widening from `scripts/ci` to `scripts`.
    write(
      dir,
      "scripts/i18n/extract.test.mjs",
      `import { it } from "node:test";\n${SKIP}"disabled", () => {});\n`,
    );
    const result = runChecker(dir, "check-skips.mjs");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /scripts\/i18n\/extract\.test\.mjs/);
  });

  it("and scripts/ci itself is still covered — M3's original tree", () => {
    const dir = repoWithProbe(
      "scripts-ci-still",
      `import { it } from "node:test";\n${SKIP}"disabled", () => {});\n`,
    );
    const result = runChecker(dir, "check-skips.mjs");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /scripts\/ci\/probes\/example\.test\.mjs/);
  });
});
