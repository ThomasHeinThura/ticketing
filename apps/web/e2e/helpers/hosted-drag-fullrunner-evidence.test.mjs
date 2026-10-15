import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isPrivateFullrunnerProject,
  PRIVATE_FULLRUNNER_PROJECT_NAME,
  persistPrivateBoardDragIntervals,
  sanitizeFullRunnerSummary,
  writeSanitizedFullRunnerSummary,
} from "./hosted-drag-fullrunner-evidence.mjs";
import HostedDragFullrunnerReporter from "./hosted-drag-fullrunner-reporter.mjs";

const summaryInput = {
  diagnosticOnly: true,
  commandExitCode: 17,
  plannedTests: 0,
  outcomes: [],
  samples: [],
  source: {},
  runtime: { nodeVersion: "v26.1.0", playwrightVersion: "1.63.0" },
};

test("private observation activates only for the named diagnostic project", async () => {
  assert.equal(
    isPrivateFullrunnerProject(PRIVATE_FULLRUNNER_PROJECT_NAME),
    true,
  );
  assert.equal(isPrivateFullrunnerProject(""), false);
  assert.equal(isPrivateFullrunnerProject("chromium"), false);
  assert.equal(isPrivateFullrunnerProject(undefined), false);

  const canonicalConfig = await readFile(
    new URL("../../playwright.perf.config.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    canonicalConfig.includes(PRIVATE_FULLRUNNER_PROJECT_NAME),
    false,
  );
  assert.equal(canonicalConfig.includes("projects:"), false);
});

test("raw intervals stay private and canonical project names create no files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hosted-drag-fullrunner-"));
  try {
    const directory = path.join(root, "raw-intervals");
    assert.equal(
      await persistPrivateBoardDragIntervals({
        directory,
        projectName: "chromium",
        sampleOrdinal: 1,
        intervalsMs: [16.7, 16.8],
      }),
      false,
    );
    await assert.rejects(stat(directory), { code: "ENOENT" });

    assert.equal(
      await persistPrivateBoardDragIntervals({
        directory,
        projectName: PRIVATE_FULLRUNNER_PROJECT_NAME,
        sampleOrdinal: 1,
        intervalsMs: [16.7, 33.4, 17.1],
      }),
      true,
    );
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    const rawFile = path.join(directory, "sample-01.json");
    assert.equal((await stat(rawFile)).mode & 0o777, 0o600);
    assert.deepEqual(
      JSON.parse(await readFile(rawFile, "utf8")).intervalsMs,
      [16.7, 33.4, 17.1],
    );
    await assert.rejects(
      persistPrivateBoardDragIntervals({
        directory,
        projectName: PRIVATE_FULLRUNNER_PROJECT_NAME,
        sampleOrdinal: 7,
        intervalsMs: [16.7],
      }),
      RangeError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed original command still produces only a bounded sanitized receipt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hosted-drag-summary-"));
  try {
    const filename = path.join(root, "receipt", "summary.json");
    const summary = await writeSanitizedFullRunnerSummary(
      filename,
      summaryInput,
    );
    assert.equal(summary.commandExitCode, 17);
    assert.equal(summary.commandStatus, "failed");
    assert.equal(summary.status, "command-not-started-or-runner-unavailable");
    assert.equal(summary.runner.outcomes.length, 0);
    assert.equal((await stat(path.dirname(filename))).mode & 0o777, 0o700);
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    const serialized = await readFile(filename, "utf8");
    assert.equal(serialized.includes("intervalsMs"), false);
    assert.equal(serialized.includes("/Users/"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitizer rejects untrusted paths and URLs instead of forwarding them", () => {
  assert.throws(
    () =>
      sanitizeFullRunnerSummary({
        ...summaryInput,
        outcomes: [
          {
            ordinal: 1,
            title: "G11: /Users/person/private-file",
            status: "failed",
            expectedStatus: "passed",
            retry: 0,
            workerIndex: 0,
            parallelIndex: 0,
            durationMs: 1,
          },
        ],
      }),
    /Sanitized summary contains a forbidden sensitive string/,
  );
  assert.throws(
    () =>
      sanitizeFullRunnerSummary({
        ...summaryInput,
        runtime: { nodeVersion: "https://example.invalid/path" },
      }),
    /Invalid bounded string field: Node version/,
  );
});

test("full-suite summary binds 22 outcomes, calibrations, and bounded RAF statistics", () => {
  const outcomes = Array.from({ length: 22 }, (_, index) => ({
    ordinal: index + 1,
    title: `G11: bounded test ${index + 1}`,
    status: "passed",
    expectedStatus: "passed",
    retry: 0,
    workerIndex: 0,
    parallelIndex: 0,
    durationMs: 100,
  }));
  outcomes[19].title = "G11: board drag p95 frame time";
  const summary = sanitizeFullRunnerSummary({
    ...summaryInput,
    commandExitCode: 0,
    plannedTests: 22,
    outcomes,
    calibration: {
      batches: Array.from({ length: 6 }, (_, index) => ({
        batch: (index % 3) + 1,
        state: index < 3 ? "unthrottled" : "throttled",
        runs: [100, 101],
        medianMs: 100.5,
        spread: 0.01,
      })),
      factors: ["unthrottled", "throttled"].map((state) => ({
        state,
        mode: "calibrated",
        medianOfBatchMediansMs: 100.5,
        maxSpread: 0.01,
        referenceMs: 100,
        factor: 1.005,
      })),
    },
    samples: [{ sampleOrdinal: 1, intervalsMs: [16.7, 21, 33.4, 16.8] }],
    source: {
      commitSha: "a".repeat(40),
      sourceTreeSha256: "b".repeat(64),
      webSourceSha256: "c".repeat(64),
      buildManifestSha256: "d".repeat(64),
      fixtureSha256: "e".repeat(64),
      bindingStable: true,
    },
    runner: {
      jobName: "hosted-board-drag-diagnostic",
      jobId: "12345",
      runAttempt: 1,
    },
    runtime: {
      nodeVersion: "v26.1.0",
      playwrightVersion: "1.63.0",
      chromiumVersion: "144.0.1.0",
      operatingSystem: "6.11.0-1018-azure",
      architecture: "x64",
      cpuModel: "AMD EPYC 9V45",
      logicalCpuCount: 8,
      availableParallelism: 4,
    },
  });
  assert.equal(summary.status, "complete");
  assert.equal(summary.runner.outcomes.length, 22);
  assert.equal(summary.calibration.factors[0].factor, 1.005);
  assert.equal(summary.boardDrag.samples[0].p95Ms, 33.4);
  assert.equal(summary.boardDrag.samples[0].above20Ms, 2);
  assert.equal(summary.boardDrag.samples[0].above33Ms, 1);
  assert.equal(summary.boardDrag.samples[0].maxGapRelativeMs, 37.7);
  assert.equal(summary.boardDrag.sets[0].complete, false);
  assert.equal(JSON.stringify(summary).includes("intervalsMs"), false);
});

test("private reporter extracts only numeric calibration and runtime fields", () => {
  const reporter = new HostedDragFullrunnerReporter();
  const testCase = {
    id: "board",
    title: "G11: board drag p95 frame time",
    expectedStatus: "passed",
  };
  reporter.onBegin({}, { allTests: () => [testCase] });
  reporter.onStdOut(
    Buffer.from(
      `${[
        "G11 host: cpu model AMD EPYC 9V45; nproc 8",
        "G11 private fullrunner Chromium: 144.0.1.0",
        "G11 calibration job batch 1 [unthrottled]: runs (100.00, 101.00); median 100.50; spread 0.010",
        "G11 calibration job [unthrottled]: mode calibrated; median of batch medians 100.50; max spread 0.010; R0 100.00; factor 1.005",
      ].join("\n")}\n`,
    ),
  );
  reporter.onTestEnd(testCase, {
    status: "passed",
    retry: 0,
    workerIndex: 0,
    parallelIndex: 0,
    duration: 12,
  });
  assert.equal(reporter.runtime.cpuModel, "AMD EPYC 9V45");
  assert.equal(reporter.runtime.chromiumVersion, "144.0.1.0");
  assert.deepEqual(reporter.calibration.batches[0].runs, [100, 101]);
  assert.equal(reporter.calibration.factors[0].factor, 1.005);
  assert.equal(reporter.outcomes[0].ordinal, 1);
});
