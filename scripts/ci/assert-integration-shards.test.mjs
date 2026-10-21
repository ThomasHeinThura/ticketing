import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertIntegrationShards,
  INTEGRATION_SHARDS,
} from "./assert-integration-shards.mjs";
import { parseWorkflowFile } from "./lib/workflow-gates.mjs";

const success = () =>
  Object.fromEntries(
    INTEGRATION_SHARDS.map((shard) => [shard, { result: "success" }]),
  );

test("integration aggregation fails on any failed, cancelled, skipped, missing or unknown shard", () => {
  assert.doesNotThrow(() => assertIntegrationShards(success()));
  for (const shard of INTEGRATION_SHARDS) {
    for (const result of [
      "failure",
      "cancelled",
      "skipped",
      "unknown",
      undefined,
    ]) {
      assert.throws(
        () => assertIntegrationShards({ ...success(), [shard]: { result } }),
        /did not succeed/,
      );
    }
    const missing = success();
    delete missing[shard];
    assert.throws(() => assertIntegrationShards(missing), /all four/);
  }
  assert.throws(
    () =>
      assertIntegrationShards({ ...success(), extra: { result: "success" } }),
    /all four/,
  );
  for (const results of [null, undefined, [], "success"]) {
    assert.throws(() => assertIntegrationShards(results), /Missing/);
  }
});

test("the real workflow executes each partition and always propagates all four outcomes", () => {
  const source = readFileSync(
    new URL("../../.github/workflows/ci-full.yml", import.meta.url),
    "utf8",
  );
  const { steps } = parseWorkflowFile(source, ".github/workflows/ci-full.yml");
  const shards = steps.filter((step) =>
    step.keys.run?.startsWith("pnpm test:integration"),
  );
  assert.equal(shards.length, 4);
  for (const [index, id] of INTEGRATION_SHARDS.entries()) {
    const step = shards.find((entry) => entry.job === id);
    assert.ok(step, `Missing ${id}`);
    assert.equal(
      step.keys.run,
      `pnpm test:integration -- --shard=${index + 1}/4`,
    );
    assert.equal(step.jobKeys.has("needs"), false);
    assert.equal(step.jobKeys.has("strategy"), false);
    assert.equal(step.jobContinue, null);
    assert.equal(step.stepContinue, null);
  }
  const aggregate = steps.find(
    (step) => step.job === "integration" && step.keys.run,
  );
  assert.equal(aggregate.jobName, "integration - Postgres 18");
  assert.equal(aggregate.jobIf, "${{ always() }}");
  assert.equal(
    aggregate.jobKeys.get("needs"),
    "[integration-1, integration-2, integration-3, integration-4]",
  );
  assert.equal(
    aggregate.keys.run,
    "node scripts/ci/assert-integration-shards.mjs",
  );
  assert.equal(aggregate.jobContinue, null);
  assert.equal(aggregate.stepContinue, null);
  assert.match(
    source,
    /INTEGRATION_SHARD_RESULTS: \$\{\{ toJSON\(needs\) \}\}/,
  );
});
