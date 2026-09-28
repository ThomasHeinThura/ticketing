/**
 * #154 — `check:reviews`' `**Spec:**`-field extraction must stay roughly linear in the
 * field's own length, not quadratic.
 *
 * Found during the Opus review of #148: the `MD_TOKEN` regex (`/[a-z0-9-]+\.md/gi`) is a
 * greedy character-class run immediately followed by a literal (`.md`) the class itself
 * excludes. On a long run of allowed characters with no trailing `.md`, a backtracking
 * engine can't know that shrinking the run one character at a time will never let the
 * literal match either (none of those shorter cut points is a `.`, since `.` was never
 * part of what the class consumed) — so it retries every shorter length anyway, at every
 * start position. That is O(n) wasted work per start position over O(n) start positions:
 * O(n^2) total. #148's own repro: a constructed ~60,000-character field took the
 * extraction step from ~2.4s to ~4.1s once a real correctness fix (checking every `.md`
 * mention, not just the first) required scanning the WHOLE field with `matchAll` instead
 * of stopping at the first `exec`.
 *
 * Filed as #154 for tracking, not as a live defect: both numbers were small in absolute
 * terms, and GitHub's own PR-body size cap bounds how large a real field can get. This
 * probe exists so a future change can't silently reintroduce the quadratic shape (e.g. by
 * inlining a fresh backtracking regex at a new call site) without a failing test noticing.
 *
 * Two separate things are asserted, deliberately not conflated:
 *   1. TIMED — a ~120,000-character adversarial field (a long run with no `.md` at all,
 *      the exact shape that made the old regex retry every shorter prefix at every start
 *      position) is processed well under a strict budget. A regression to O(n^2) at this
 *      length would blow the budget by a wide margin: #148 measured ~4.1s at n=60,000 for
 *      the OLD full-scan regex, so n=120,000 would cost roughly 4x that quadratic
 *      component alone — comfortably over the few-second budget used here, while a truly
 *      linear scan finishes in milliseconds.
 *   2. CORRECT — the real filenames named before AND after the adversarial filler are
 *      still both extracted, so a cheap "fix" that merely truncates or caps the field
 *      before parsing (silently dropping the back half) would fail this probe even though
 *      it might also pass the timing budget.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  bodyFile,
  cleanUpScratchRepos,
  commit,
  completeBody,
  initRepo,
  installCheckers,
  runChecker,
  scratchDir,
  setOriginMain,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const TIME_BUDGET_MS = 4000;

function scenario() {
  const dir = scratchDir("md-token-perf");
  initRepo(dir);
  installCheckers(dir);
  // No docs/07-planning/reviews/2026-09-05/ tree at all -- `walk()` treats a missing
  // directory as "no review files" (repo.mjs), so this scenario only exercises
  // extraction, never review-section matching.
  const base = commit(dir, "chore: bootstrap");
  setOriginMain(dir, base);
  return dir;
}

describe("check:reviews — MD_TOKEN extraction stays linear (#154)", () => {
  it("extracts every real .md mention around a huge adversarial filler, in bounded time", () => {
    const dir = scenario();

    // No dot anywhere in the filler -- the pathological shape: a long
    // `[a-z0-9-]+` run with nothing for the trailing literal `.md` to ever
    // match, at any prefix length.
    const filler = "a".repeat(120_000);
    const declared =
      `See \`workflows.md\` for the plan. Context: ${filler} ` +
      "Also check `ci-cd.md` before merging.";

    const marker = "**Spec:** n/a — CI infrastructure probe";
    const base = completeBody({});
    assert.ok(
      base.includes(marker),
      "completeBody()'s default Spec line moved",
    );
    const body = bodyFile(base.replace(marker, `**Spec:** ${declared}`));

    const startedAt = process.hrtime.bigint();
    const result = runChecker(dir, "check-reviews.mjs", ["--body", body]);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    assert.equal(
      result.status,
      0,
      `expected a clean run (no review sections exist to violate); got:\n${result.output}`,
    );

    assert.ok(
      elapsedMs < TIME_BUDGET_MS,
      `check-reviews.mjs took ${elapsedMs.toFixed(1)}ms on a 120,000-character adversarial ` +
        `Spec field -- expected under ${TIME_BUDGET_MS}ms. A regression here almost always ` +
        "means a backtracking regex crept back into the extraction path (#154).",
    );

    // Both real mentions -- one before the filler, one after -- must survive.
    // A "fix" that only sped things up by capping/truncating the field would
    // pass the timing assertion above but fail here.
    assert.match(result.stdout, /workflows\.md/);
    assert.match(result.stdout, /ci-cd\.md/);

    // And nothing spurious was pulled out of the filler itself (it contains
    // no `.md`-shaped substring anywhere).
    assert.doesNotMatch(result.stdout, /aaa+\.md/);
  });
});
