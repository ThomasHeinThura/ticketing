import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertGateJobs } from "./assert-integration-shards.mjs";
import { parseWorkflowFile } from "./lib/workflow-gates.mjs";

const range = (prefix, count) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

// Every sharded gate: aggregator job id, required display name, workflow, shard jobs, and the
// exact gate command each shard must run (null: the shards run different gates).
const GATES = [
  {
    label: "integration",
    file: "ci-full.yml",
    job: "integration",
    name: "integration - Postgres 18",
    shards: range("integration", 8),
    command: (i) => `pnpm test:integration -- --shard=${i}/8`,
  },
  {
    label: "e2e",
    file: "ci-full.yml",
    job: "e2e",
    name: "e2e - protected-route redirect",
    shards: [...range("e2e", 8), "e2e-image"],
    command: (i) =>
      i <= 8 ? `pnpm test:e2e --shard=${((i - 1) % 4) + 1}/4` : null,
  },
  {
    label: "unit",
    file: "ci-fast.yml",
    job: "test",
    name: "unit + component",
    shards: range("unit", 3),
    command: (i) => `pnpm test -- --shard=${i}/3`,
  },
  {
    label: "static",
    file: "ci-fast.yml",
    job: "static",
    name: "static",
    shards: ["static-typecheck", "static-tokens", "static-checks"],
    command: () => null,
  },
];

const success = (jobs) =>
  Object.fromEntries(jobs.map((job) => [job, { result: "success" }]));

test("aggregation fails closed on any failed, cancelled, skipped, missing, unknown or extra job", () => {
  for (const { shards, label } of GATES) {
    assert.doesNotThrow(() => assertGateJobs(success(shards), shards, label));
    for (const job of shards) {
      for (const result of [
        "failure",
        "cancelled",
        "skipped",
        "unknown",
        undefined,
      ]) {
        assert.throws(
          () =>
            assertGateJobs({ ...success(shards), [job]: { result } }, shards),
          /did not succeed/,
        );
      }
      const missing = success(shards);
      delete missing[job];
      assert.throws(
        () => assertGateJobs(missing, shards, label),
        /requires exactly the named jobs/,
      );
    }
    assert.throws(
      () =>
        assertGateJobs(
          { ...success(shards), extra: { result: "success" } },
          shards,
        ),
      /requires exactly the named jobs/,
    );
  }
});

test("aggregation fails closed on empty or malformed results and expected lists", () => {
  const expected = ["a-1", "a-2"];
  for (const results of [null, undefined, {}, [], "success"]) {
    assert.throws(() => assertGateJobs(results, expected), /Missing/);
  }
  for (const list of [null, undefined, [], "a-1", [""], ["a-1", "a-1"], [1]]) {
    assert.throws(() => assertGateJobs(success(expected), list), /Missing/);
  }
  assert.throws(() => assertGateJobs({}, []), /Missing/);
});

test("the aggregator command fails closed on an empty needs object and a missing expected list", () => {
  const script = fileURLToPath(
    new URL("./assert-integration-shards.mjs", import.meta.url),
  );
  const run = (env) =>
    spawnSync(process.execPath, [script], {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
    });
  const ok = run({
    GATE_LABEL: "unit",
    GATE_EXPECTED_JOBS: "unit-1,unit-2",
    GATE_JOB_RESULTS: JSON.stringify(success(["unit-1", "unit-2"])),
  });
  assert.equal(ok.status, 0, ok.stderr);
  for (const env of [
    { GATE_EXPECTED_JOBS: "unit-1", GATE_JOB_RESULTS: "{}" },
    { GATE_EXPECTED_JOBS: "unit-1" },
    { GATE_JOB_RESULTS: JSON.stringify(success(["unit-1"])) },
    {
      GATE_EXPECTED_JOBS: "unit-1,unit-2",
      GATE_JOB_RESULTS: JSON.stringify(success(["unit-1"])),
    },
    {
      GATE_EXPECTED_JOBS: "unit-1",
      GATE_JOB_RESULTS: JSON.stringify({ "unit-1": { result: "skipped" } }),
    },
  ]) {
    assert.notEqual(run(env).status, 0, JSON.stringify(env));
  }
});

function workflow(file) {
  const path = `.github/workflows/${file}`;
  const source = readFileSync(
    new URL(`../../${path}`, import.meta.url),
    "utf8",
  );
  return { source, steps: parseWorkflowFile(source, path).steps };
}

test("each real workflow runs every shard and always propagates all outcomes through its aggregator", () => {
  for (const gate of GATES) {
    const { source, steps } = workflow(gate.file);
    for (const [index, id] of gate.shards.entries()) {
      const command = gate.command(index + 1);
      // Every shard is an independent job: no `needs`, no `strategy`, nothing that continues on error.
      const jobSteps = steps.filter((step) => step.job === id);
      assert.ok(jobSteps.length > 0, `Missing job ${id}`);
      for (const step of jobSteps) {
        assert.equal(step.jobKeys.has("needs"), false);
        assert.equal(step.jobKeys.has("strategy"), false);
        assert.equal(step.jobContinue, null);
        assert.equal(step.stepContinue, null);
      }
      if (command)
        assert.ok(
          jobSteps.some((step) => step.keys.run === command),
          `${id} must run \`${command}\``,
        );
    }
    const aggregate = steps.find(
      (step) => step.job === gate.job && step.keys.run,
    );
    assert.ok(aggregate, `Missing aggregator ${gate.job}`);
    assert.equal(aggregate.jobName, gate.name);
    assert.equal(aggregate.jobIf, "${{ always() }}");
    assert.equal(aggregate.jobKeys.get("needs"), `[${gate.shards.join(", ")}]`);
    assert.equal(
      aggregate.keys.run,
      "node scripts/ci/assert-integration-shards.mjs",
    );
    assert.equal(aggregate.jobContinue, null);
    assert.equal(aggregate.stepContinue, null);
    assert.ok(source.includes(`GATE_LABEL: ${gate.label}\n`));
    assert.ok(
      source.includes(`GATE_EXPECTED_JOBS: ${gate.shards.join(",")}\n`),
    );
    assert.ok(source.includes("GATE_JOB_RESULTS: ${{ toJSON(needs) }}"));
  }
});

test("the e2e shards cover every shard index once and the shipping-image checks stay in e2e-image", () => {
  const { steps } = workflow("ci-full.yml");
  const browser = steps.filter((step) =>
    step.keys.run?.startsWith("pnpm test:e2e"),
  );
  // Jobs 1-4 shard the smoke set, jobs 5-8 the persisted set: every (set, index) pair runs once.
  const { source } = workflow("ci-full.yml");
  for (const index of range("e2e", 8).keys()) {
    const start = source.indexOf(`\n  e2e-${index + 1}:\n`);
    const job = source.slice(start, source.indexOf("\n  e2e-", start + 1));
    const set = index < 4 ? "smoke" : "persisted";
    assert.ok(
      job.includes(`E2E_SET: ${set}\n`),
      `e2e-${index + 1} sets ${set}`,
    );
    assert.ok(
      job.includes(`run: pnpm test:e2e --shard=${(index % 4) + 1}/4\n`),
      `e2e-${index + 1} shard`,
    );
    assert.ok(job.includes(`name: playwright-${set}-${(index % 4) + 1}\n`));
  }
  assert.equal(browser.length, 8);
  const image = steps.filter((step) => step.job === "e2e-image");
  assert.ok(
    image.some(
      (step) => step.keys.run === "scripts/ci/run-deploy-real-docker.sh",
    ),
  );
  assert.ok(
    image.some((step) =>
      step.keys.run?.startsWith("scripts/ci/run-shipping-image-smoke.sh"),
    ),
  );
  for (const step of steps.filter((entry) => entry.job !== "e2e-image"))
    assert.doesNotMatch(step.keys.run ?? "", /docker|shipping-image/);
});

test("the sharded commands run exactly once per shard index, nowhere else", () => {
  for (const [file, prefix, count] of [
    ["ci-full.yml", "pnpm test:integration", 8],
    ["ci-fast.yml", "pnpm test -- --shard=", 3],
  ]) {
    const runs = workflow(file)
      .steps.map((step) => step.keys.run)
      .filter((run) => run?.startsWith(prefix));
    assert.equal(runs.length, count, `${file} runs ${prefix} ${count} times`);
    assert.equal(new Set(runs).size, count);
  }
});

test("the static jobs together keep every pre-split static step", () => {
  const { steps } = workflow("ci-fast.yml");
  const ran = steps
    .filter((step) => step.job.startsWith("static-"))
    .map((step) => step.keys.run);
  for (const command of [
    "pnpm lint:ci",
    "pnpm typecheck",
    "pnpm check:tokens",
    "pnpm check:i18n",
    "pnpm check:deps",
    "pnpm check:queries",
  ])
    assert.equal(
      ran.filter((run) => run === command).length,
      1,
      `${command} must run exactly once`,
    );
});
