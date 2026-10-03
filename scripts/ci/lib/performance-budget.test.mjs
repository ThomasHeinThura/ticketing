import assert from "node:assert/strict";
import test from "node:test";
import { median, medianOfThreeWithRetry } from "./performance-budget.mjs";

test("G11 measurement retries once after a failing three-sample median", async () => {
  const samples = [240, 210, 220, 180, 170, 160];
  let calls = 0;
  const measured = await medianOfThreeWithRetry(
    async () => samples[calls++],
    200,
  );
  assert.equal(calls, 6);
  assert.equal(measured.retried, true);
  assert.equal(measured.result, 170);
  assert.deepEqual(measured.values, [180, 170, 160]);
});

test("G11 measurement does not retry a passing median", async () => {
  let calls = 0;
  const measured = await medianOfThreeWithRetry(
    async () => [190, 120, 150][calls++],
    200,
  );
  assert.equal(calls, 3);
  assert.equal(measured.retried, false);
  assert.equal(measured.result, 150);
});

test("G11 uses the middle sample and rejects malformed sample sets", () => {
  assert.equal(median([10, 2, 6]), 6);
  assert.throws(() => median([1, 2]), /exactly three finite/);
  assert.throws(() => median([1, Number.NaN, 3]), /exactly three finite/);
});
