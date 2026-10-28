/** Removed historical Spec parsing cannot return through an unbounded phase report parser. */
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
const TIME_BUDGET_MS = 4000;
function scenario(raw) {
  const dir = scratchDir("phase-report-bounds");
  initRepo(dir);
  installCheckers(dir);
  write(dir, "docs/evidence/P1-review.json", raw);
  return runChecker(dir, "check-reviews.mjs", [
    "--phase",
    "P1",
    "--report",
    "docs/evidence/P1-review.json",
  ]);
}
describe("phase review parsing remains bounded and fail-closed", () => {
  it("rejects oversized data before parsing instead of truncating it into a pass", () => {
    const start = performance.now();
    const result = scenario("a".repeat(1024 * 1024 + 1));
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /exceeds the 1 MiB/);
    assert.ok(performance.now() - start < TIME_BUDGET_MS);
  });
  it("rejects malformed JSON around 120k adversarial text in bounded time", () => {
    const start = performance.now();
    const result = scenario(
      `{"phase":"P1","context":"${"a".repeat(120000)}","findings":[`,
    );
    assert.notEqual(result.status, 0, result.output);
    assert.doesNotMatch(
      result.output,
      /consolidated review evidence validated/,
    );
    assert.ok(performance.now() - start < TIME_BUDGET_MS);
  });
});
