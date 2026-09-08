/**
 * GPT-F3 red probes — the unattributable-read baseline is a shrink-only ratchet, and a
 * diff cannot move both sides of that comparison at once.
 *
 * F3 made `env-baseline.json` compare itself against the merge base. F10 added a per-file
 * COUNT so a baselined file could not silently absorb another read. GPT-F3 is the seam
 * between the two: `addedWithinKeys` compares arrays, and this section's values are
 * `{ reason, reads }` objects, so every within-key comparison on it returned nothing —
 * whatever changed. `reads: 1 -> 2` in the same diff as the second read went green.
 *
 * Four scenarios, all against synthetic history, because the baseline is introduced BY
 * this branch and at the real merge base there is nothing to have grown from:
 *
 *   A  add a read, bump the baseline in the SAME diff            -> RED
 *   B  the same, with the pre-fix `reads: <n>` count shape       -> RED
 *   C  swap one read for a different one, count unchanged        -> RED
 *   D  delete a read and shrink the baseline                     -> GREEN
 *
 * D is not decoration: without it, a check that failed on every baseline change would
 * satisfy A, B and C and make the ratchet impossible to ever shrink.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  commit,
  evaluateInRepo,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const S3 = "apps/api/src/storage/s3.ts";
const BASELINE = "scripts/ci/env-baseline.json";

/** The inherited read: an `env(name)` helper over `process.env[name]`. */
const READ_A = 'return process.env[name]?.trim() || "";';
/** A second, differently written computed read. */
const READ_B = 'return process.env[name] ?? "";';

const FINGERPRINT_A = `computed #1: ${READ_A}`;
const FINGERPRINT_B = `computed #1: ${READ_B}`;

function s3With(bodies) {
  return [
    "// Synthetic S3 configuration surface for the GPT-F3 probes.",
    ...bodies.map((body, index) =>
      [
        `function env${index}(name: string): string {`,
        `  ${body}`,
        "}",
        `export const value${index} = env${index}("S3_BUCKET");`,
      ].join("\n"),
    ),
    "",
  ].join("\n");
}

function baselineWith(unattributableReads) {
  return `${JSON.stringify(
    {
      note: "Synthetic baseline for the GPT-F3 probes.",
      unmigratedNames: {},
      unattributableReads,
    },
    null,
    "\t",
  )}\n`;
}

const REASON = "Inherited: the S3 connection variables go through env(name).";

/**
 * A repository whose merge base carries `baseAt`, and whose branch head carries
 * `headAt` — one commit each, so the growth is unambiguously same-diff.
 */
function scenario(
  prefix,
  { baseReads, baseBaseline, headReads, headBaseline },
) {
  const dir = scratchDir(prefix);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, "docs/05-operations/configuration-reference.md");
  write(dir, S3, s3With(baseReads));
  write(dir, BASELINE, baselineWith(baseBaseline));
  const base = commit(dir, "chore: bootstrap the baseline");
  setOriginMain(dir, base);

  write(dir, S3, s3With(headReads));
  write(dir, BASELINE, baselineWith(headBaseline));
  commit(dir, "feat: the scenario under probe");
  return dir;
}

describe("GPT-F3 — unattributable-read growth cannot be laundered in the same diff", () => {
  it("A: a second read plus a matching baseline entry, one diff — RED", () => {
    const dir = scenario("env-growth-a", {
      baseReads: [READ_A],
      baseBaseline: { [S3]: { reason: REASON, occurrences: [FINGERPRINT_A] } },
      headReads: [READ_A, READ_B],
      headBaseline: {
        [S3]: { reason: REASON, occurrences: [FINGERPRINT_A, FINGERPRINT_B] },
      },
    });

    // ── non-vacuity: the OLD comparison sees nothing at all ───────────────────────
    const old = evaluateInRepo(
      dir,
      `import { addedWithinKeys, readBaselineAtMergeBase } from "./scripts/ci/lib/git-baseline.mjs";
       import { readText, repoRoot } from "./scripts/ci/lib/repo.mjs";
       import path from "node:path";
       const now = JSON.parse(await readText(path.join(repoRoot, ${JSON.stringify(BASELINE)})));
       const { previous } = readBaselineAtMergeBase(${JSON.stringify(BASELINE)});
       console.log(JSON.stringify({
         unnormalised: addedWithinKeys(now.unattributableReads, previous.unattributableReads),
       }));`,
    );
    assert.deepEqual(
      old.unnormalised,
      [],
      "the probe is vacuous: the pre-fix comparison already reports this growth, so the " +
        "failure below is not attributable to the fix.",
    );

    const run = runChecker(dir, "check-env.mjs");
    assert.equal(
      run.status,
      1,
      "check:env must reject a read added alongside its own baseline entry. Exited " +
        `${run.status}:\n${run.output}`,
    );
    assert.match(run.output, /relative to the merge base/);
    assert.ok(
      run.output.includes(READ_B),
      `the failure must name the read that was added:\n${run.output}`,
    );
  });

  it("B: the exact pre-fix shape — base reads:1, head reads:2 plus a second read — RED", () => {
    // GPT-F3's literal probe. The entry carries a count and no identities, which is the
    // shape that was invisible to the merge-base comparison in both directions.
    const dir = scenario("env-growth-b", {
      baseReads: [READ_A],
      baseBaseline: { [S3]: { reason: REASON, reads: 1 } },
      headReads: [READ_A, READ_B],
      headBaseline: { [S3]: { reason: REASON, reads: 2 } },
    });

    const old = evaluateInRepo(
      dir,
      `import { addedWithinKeys, readBaselineAtMergeBase } from "./scripts/ci/lib/git-baseline.mjs";
       import { readText, repoRoot } from "./scripts/ci/lib/repo.mjs";
       import path from "node:path";
       const now = JSON.parse(await readText(path.join(repoRoot, ${JSON.stringify(BASELINE)})));
       const { previous } = readBaselineAtMergeBase(${JSON.stringify(BASELINE)});
       console.log(JSON.stringify({
         unnormalised: addedWithinKeys(now.unattributableReads, previous.unattributableReads),
         countWouldPass:
           now.unattributableReads[${JSON.stringify(S3)}].reads >= 2,
       }));`,
    );
    assert.deepEqual(
      old.unnormalised,
      [],
      "vacuous: the old comparison now fires.",
    );
    assert.equal(
      old.countWouldPass,
      true,
      "vacuous: the old count check would already have failed this scenario.",
    );

    const run = runChecker(dir, "check-env.mjs");
    assert.equal(run.status, 1, `exited ${run.status}:\n${run.output}`);
    assert.match(run.output, /records no `occurrences` list/);
  });

  it("C: one read swapped for another at the same count — RED", () => {
    const dir = scenario("env-growth-c", {
      baseReads: [READ_A],
      baseBaseline: { [S3]: { reason: REASON, occurrences: [FINGERPRINT_A] } },
      headReads: [READ_B],
      headBaseline: { [S3]: { reason: REASON, occurrences: [FINGERPRINT_B] } },
    });

    const old = evaluateInRepo(
      dir,
      `import { readText, repoRoot } from "./scripts/ci/lib/repo.mjs";
       import { readBaselineAtMergeBase } from "./scripts/ci/lib/git-baseline.mjs";
       import path from "node:path";
       const now = JSON.parse(await readText(path.join(repoRoot, ${JSON.stringify(BASELINE)})));
       const { previous } = readBaselineAtMergeBase(${JSON.stringify(BASELINE)});
       console.log(JSON.stringify({
         countUnchanged:
           now.unattributableReads[${JSON.stringify(S3)}].occurrences.length ===
           previous.unattributableReads[${JSON.stringify(S3)}].occurrences.length,
       }));`,
    );
    assert.equal(
      old.countUnchanged,
      true,
      "the probe is vacuous: the counts differ, so a count-based check would also have " +
        "caught this and the assertion proves nothing about fingerprints.",
    );

    const run = runChecker(dir, "check-env.mjs");
    assert.equal(
      run.status,
      1,
      "a replacement at an unchanged count must still be reported as changed debt. " +
        `Exited ${run.status}:\n${run.output}`,
    );
    assert.match(run.output, /relative to the merge base/);
    assert.ok(run.output.includes(READ_B), run.output);
  });

  it("D: deleting a read and shrinking the baseline — GREEN", () => {
    const dir = scenario("env-shrink-d", {
      baseReads: [READ_A, READ_B],
      baseBaseline: {
        [S3]: { reason: REASON, occurrences: [FINGERPRINT_A, FINGERPRINT_B] },
      },
      headReads: [READ_A],
      headBaseline: { [S3]: { reason: REASON, occurrences: [FINGERPRINT_A] } },
    });

    const run = runChecker(dir, "check-env.mjs");
    assert.equal(
      run.status,
      0,
      "a genuine shrink must PASS — a ratchet that refuses every change to itself can " +
        `never be paid down. Exited ${run.status}:\n${run.output}`,
    );
  });

  it("D2: removing the file's debt entirely — GREEN", () => {
    const dir = scenario("env-shrink-d2", {
      baseReads: [READ_A],
      baseBaseline: { [S3]: { reason: REASON, occurrences: [FINGERPRINT_A] } },
      headReads: [],
      headBaseline: {},
    });

    const run = runChecker(dir, "check-env.mjs");
    assert.equal(run.status, 0, `exited ${run.status}:\n${run.output}`);
  });

  it("warns when a baselined occurrence is no longer read, so the slot is not kept", () => {
    // A vacated slot used to be invisible: at `reads: 2` a file with one read simply
    // passed and the entry kept licensing the empty half.
    const dir = scenario("env-stale-slot", {
      baseReads: [READ_A, READ_B],
      baseBaseline: {
        [S3]: { reason: REASON, occurrences: [FINGERPRINT_A, FINGERPRINT_B] },
      },
      headReads: [READ_A],
      headBaseline: {
        [S3]: { reason: REASON, occurrences: [FINGERPRINT_A, FINGERPRINT_B] },
      },
    });

    const run = runChecker(dir, "check-env.mjs");
    assert.equal(run.status, 0, `exited ${run.status}:\n${run.output}`);
    assert.match(
      run.output,
      /baselined read occurrence\(s\) are no longer read/,
    );
    assert.match(run.output, /Vacated slots/);
  });
});
