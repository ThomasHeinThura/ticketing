import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRIVATE_FULLRUNNER_PROJECT_NAME =
  "hosted-board-drag-fullrunner-private";
export const FULLRUNNER_RESULT_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test-results/hosted-drag-fullrunner",
);

const MAX_INTERVALS = 1_000;
const EXPECTED_TEST_COUNT = 22;
const TEST_STATUS = new Set([
  "passed",
  "failed",
  "skipped",
  "timedOut",
  "interrupted",
]);

export function isPrivateFullrunnerProject(projectName) {
  return projectName === PRIVATE_FULLRUNNER_PROJECT_NAME;
}

export async function persistPrivateBoardDragIntervals({
  directory,
  projectName,
  sampleOrdinal,
  intervalsMs,
}) {
  if (!isPrivateFullrunnerProject(projectName)) return false;
  if (
    !Number.isInteger(sampleOrdinal) ||
    sampleOrdinal < 1 ||
    sampleOrdinal > 6
  )
    throw new RangeError(
      "Private board-drag sample ordinal is outside the six-sample retry bound.",
    );
  if (
    !Array.isArray(intervalsMs) ||
    intervalsMs.length < 1 ||
    intervalsMs.length > MAX_INTERVALS ||
    !intervalsMs.every(
      (value) => Number.isFinite(value) && value > 0 && value <= 10_000,
    )
  )
    throw new TypeError(
      "Private board-drag intervals must be a bounded numeric array.",
    );

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const destination = path.join(
    directory,
    `sample-${String(sampleOrdinal).padStart(2, "0")}.json`,
  );
  await writeFile(
    destination,
    `${JSON.stringify({ schemaVersion: 1, diagnosticOnly: true, sampleOrdinal, intervalsMs })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return true;
}

function finiteNumber(value, label, { min = 0, max = 1_000_000 } = {}) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new TypeError(`Invalid bounded numeric field: ${label}.`);
  return value;
}

function boundedString(value, label, pattern, maxLength = 128) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    !pattern.test(value)
  )
    throw new TypeError(`Invalid bounded string field: ${label}.`);
  return value;
}

function hashOrNull(value, label, length) {
  if (value === null || value === undefined) return null;
  return boundedString(
    value,
    label,
    new RegExp(`^[a-f0-9]{${length}}$`),
    length,
  );
}

function summarizeIntervals(sample) {
  if (
    !Number.isInteger(sample.sampleOrdinal) ||
    sample.sampleOrdinal < 1 ||
    sample.sampleOrdinal > 6 ||
    !Array.isArray(sample.intervalsMs) ||
    sample.intervalsMs.length < 1 ||
    sample.intervalsMs.length > MAX_INTERVALS
  )
    throw new TypeError(
      "Raw board-drag sample metadata is outside the fixed bounds.",
    );
  const intervals = sample.intervalsMs.map((value) =>
    finiteNumber(value, "RAF interval", { min: Number.MIN_VALUE, max: 10_000 }),
  );
  const ordered = [...intervals].sort((left, right) => left - right);
  const maxGapMs = Math.max(...intervals);
  const maxGapIndex = intervals.indexOf(maxGapMs);
  const maxGapRelativeMs = intervals
    .slice(0, maxGapIndex)
    .reduce((total, value) => total + value, 0);
  return {
    sampleOrdinal: sample.sampleOrdinal,
    set: sample.sampleOrdinal <= 3 ? "initial" : "retry",
    sampleInSet: ((sample.sampleOrdinal - 1) % 3) + 1,
    intervalCount: intervals.length,
    p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
    above20Ms: intervals.filter((value) => value > 20).length,
    above33Ms: intervals.filter((value) => value > 33).length,
    maxGapMs,
    maxGapRelativeMs,
  };
}

function summarizeSet(name, samples) {
  const p95Values = samples
    .map(({ p95Ms }) => p95Ms)
    .sort((left, right) => left - right);
  return {
    name,
    sampleCount: samples.length,
    complete: samples.length === 3,
    sampleP95Ms: samples.map(({ sampleOrdinal, p95Ms }) => ({
      sampleOrdinal,
      p95Ms,
    })),
    medianP95Ms: p95Values.length === 3 ? p95Values[1] : null,
  };
}

function sanitizeOutcomes(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length > EXPECTED_TEST_COUNT)
    throw new TypeError(
      "Runner test outcomes are missing or exceed the full-suite bound.",
    );
  return outcomes.map((outcome, index) => {
    if (!Number.isInteger(outcome.ordinal) || outcome.ordinal !== index + 1)
      throw new TypeError(
        "Runner test outcomes must retain their ordered test indices.",
      );
    const title = boundedString(
      outcome.title,
      "test title",
      /^[A-Za-z0-9 :,.()%/-]+$/,
      128,
    );
    if (!title.startsWith("G11:") && !title.startsWith("G13"))
      throw new TypeError(
        "Unexpected test title in the full performance suite.",
      );
    if (!TEST_STATUS.has(outcome.status))
      throw new TypeError(
        "Runner test status is outside the known Playwright status set.",
      );
    return {
      ordinal: outcome.ordinal,
      title,
      status: outcome.status,
      expectedStatus: TEST_STATUS.has(outcome.expectedStatus)
        ? outcome.expectedStatus
        : "unknown",
      retry: finiteNumber(outcome.retry, "test retry", { max: 10 }),
      workerIndex: finiteNumber(outcome.workerIndex, "worker index", {
        max: 1_000,
      }),
      parallelIndex: finiteNumber(outcome.parallelIndex, "parallel index", {
        max: 1_000,
      }),
      durationMs: finiteNumber(outcome.durationMs, "test duration", {
        max: 3_600_000,
      }),
    };
  });
}

function sanitizeCalibration(calibration) {
  if (!calibration || typeof calibration !== "object")
    return { batches: [], factors: [] };
  const batches = Array.isArray(calibration.batches) ? calibration.batches : [];
  const factors = Array.isArray(calibration.factors) ? calibration.factors : [];
  if (batches.length > 12 || factors.length > 2)
    throw new TypeError(
      "Calibration evidence exceeds the fixed G11 batch bounds.",
    );
  return {
    batches: batches.map((batch) => {
      if (!Number.isInteger(batch.batch) || batch.batch < 1 || batch.batch > 6)
        throw new TypeError("Calibration batch index is invalid.");
      if (batch.state !== "unthrottled" && batch.state !== "throttled")
        throw new TypeError("Calibration state is invalid.");
      if (!Array.isArray(batch.runs) || batch.runs.length > 100)
        throw new TypeError("Calibration run vector exceeds its fixed bound.");
      return {
        batch: batch.batch,
        state: batch.state,
        runsMs: batch.runs.map((value) =>
          finiteNumber(value, "calibration run", { max: 60_000 }),
        ),
        medianMs: finiteNumber(batch.medianMs, "calibration median", {
          max: 60_000,
        }),
        spread: finiteNumber(batch.spread, "calibration spread", { max: 10 }),
      };
    }),
    factors: factors.map((factor) => {
      if (factor.state !== "unthrottled" && factor.state !== "throttled")
        throw new TypeError("Calibration factor state is invalid.");
      if (factor.mode !== "calibrated" && factor.mode !== "raw")
        throw new TypeError("Calibration mode is invalid.");
      return {
        state: factor.state,
        mode: factor.mode,
        medianOfBatchMediansMs: finiteNumber(
          factor.medianOfBatchMediansMs,
          "calibration median-of-medians",
          { max: 60_000 },
        ),
        maxSpread: finiteNumber(factor.maxSpread, "calibration max spread", {
          max: 10,
        }),
        referenceMs:
          factor.referenceMs === null
            ? null
            : finiteNumber(factor.referenceMs, "calibration reference", {
                max: 60_000,
              }),
        factor: finiteNumber(factor.factor, "calibration factor", { max: 10 }),
      };
    }),
  };
}

function assertNoSensitiveStrings(value) {
  if (typeof value === "string") {
    if (
      /https?:\/\//i.test(value) ||
      /(?:^|\s)(?:\/Users\/|\/home\/|\/tmp\/|[A-Z]:\\)/.test(value) ||
      /cookie|authorization|bearer|token|trace|profile|attachment|network|raw[- ]?(?:array|capture|interval)/i.test(
        value,
      )
    )
      throw new TypeError(
        "Sanitized summary contains a forbidden sensitive string.",
      );
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertNoSensitiveStrings(entry);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) assertNoSensitiveStrings(entry);
  }
}

export function sanitizeFullRunnerSummary(input) {
  if (input?.diagnosticOnly !== true)
    throw new TypeError("Private diagnostic marker is required.");
  const commandExitCode = input.commandExitCode;
  if (
    commandExitCode !== null &&
    (!Number.isInteger(commandExitCode) ||
      commandExitCode < 0 ||
      commandExitCode > 255)
  )
    throw new TypeError(
      "The original Playwright command exit code is invalid.",
    );
  const outcomes = sanitizeOutcomes(input.outcomes ?? []);
  const samples = (input.samples ?? [])
    .map(summarizeIntervals)
    .sort((a, b) => a.sampleOrdinal - b.sampleOrdinal);
  if (
    samples.length > 6 ||
    new Set(samples.map(({ sampleOrdinal }) => sampleOrdinal)).size !==
      samples.length
  )
    throw new TypeError(
      "Raw RAF summary contains duplicate or excess sample ordinals.",
    );
  const dragTest = outcomes.find(
    ({ title }) => title === "G11: board drag p95 frame time",
  );
  const sets = [
    summarizeSet(
      "initial",
      samples.filter(({ set }) => set === "initial"),
    ),
    summarizeSet(
      "retry",
      samples.filter(({ set }) => set === "retry"),
    ),
  ];
  const plannedTests = finiteNumber(
    input.plannedTests ?? 0,
    "planned test count",
    { max: EXPECTED_TEST_COUNT },
  );
  const commandStatus =
    commandExitCode === null
      ? "not-recorded"
      : commandExitCode === 0
        ? "passed"
        : "failed";
  const source = {
    commitSha: hashOrNull(input.source?.commitSha, "source commit", 40),
    sourceTreeSha256: hashOrNull(
      input.source?.sourceTreeSha256,
      "source tree",
      64,
    ),
    webSourceSha256: hashOrNull(
      input.source?.webSourceSha256,
      "web source",
      64,
    ),
    buildManifestSha256: hashOrNull(
      input.source?.buildManifestSha256,
      "build manifest",
      64,
    ),
    fixtureSha256: hashOrNull(input.source?.fixtureSha256, "fixture", 64),
    bindingStable: input.source?.bindingStable === true,
  };
  const cpuModel =
    input.runtime?.cpuModel == null
      ? null
      : boundedString(
          input.runtime.cpuModel,
          "CPU model",
          /^[A-Za-z0-9 .,()_+/@-]+$/,
          100,
        );
  const runtime = {
    nodeVersion: boundedString(
      input.runtime?.nodeVersion ?? "unknown",
      "Node version",
      /^[A-Za-z0-9.v+-]+$/,
      64,
    ),
    playwrightVersion: boundedString(
      input.runtime?.playwrightVersion ?? "unknown",
      "Playwright version",
      /^[A-Za-z0-9.v+-]+$/,
      64,
    ),
    chromiumVersion:
      input.runtime?.chromiumVersion == null
        ? null
        : boundedString(
            input.runtime.chromiumVersion,
            "Chromium version",
            /^[A-Za-z0-9.v+-]+$/,
            64,
          ),
    operatingSystem: boundedString(
      input.runtime?.operatingSystem ?? "unknown",
      "OS release",
      /^[A-Za-z0-9._+() -]+$/,
      64,
    ),
    architecture: boundedString(
      input.runtime?.architecture ?? "unknown",
      "architecture",
      /^[A-Za-z0-9._+-]+$/,
      32,
    ),
    cpuModel,
    logicalCpuCount:
      input.runtime?.logicalCpuCount == null
        ? null
        : finiteNumber(input.runtime.logicalCpuCount, "logical CPU count", {
            max: 1024,
          }),
    availableParallelism:
      input.runtime?.availableParallelism == null
        ? null
        : finiteNumber(
            input.runtime.availableParallelism,
            "available parallelism",
            { max: 1024 },
          ),
  };
  const calibrationSummary = sanitizeCalibration(input.calibration);
  const complete =
    commandExitCode === 0 &&
    plannedTests === EXPECTED_TEST_COUNT &&
    outcomes.length === EXPECTED_TEST_COUNT &&
    outcomes.every(({ status, expectedStatus }) => status === expectedStatus) &&
    Object.values(source).every((value) => value !== null) &&
    source.bindingStable &&
    runtime.chromiumVersion !== null &&
    runtime.cpuModel !== null &&
    runtime.logicalCpuCount !== null &&
    runtime.availableParallelism !== null &&
    typeof input.runner?.jobName === "string" &&
    /^[A-Za-z0-9._-]{1,80}$/.test(input.runner.jobName) &&
    typeof input.runner?.jobId === "string" &&
    /^[0-9]{1,20}$/.test(input.runner.jobId) &&
    Number.isInteger(input.runner?.runAttempt) &&
    calibrationSummary.batches.length === 6 &&
    calibrationSummary.factors.length === 2;
  const result = {
    schemaVersion: 1,
    diagnosticOnly: true,
    privateProjectName: PRIVATE_FULLRUNNER_PROJECT_NAME,
    status: complete
      ? "complete"
      : plannedTests === 0 && outcomes.length === 0
        ? "command-not-started-or-runner-unavailable"
        : "incomplete-or-failed",
    commandExitCode,
    commandStatus,
    source,
    runtime,
    runner: {
      jobName:
        input.runner?.jobName == null
          ? null
          : boundedString(
              String(input.runner.jobName),
              "job name",
              /^[A-Za-z0-9._-]{1,80}$/,
              80,
            ),
      jobId:
        input.runner?.jobId == null
          ? null
          : boundedString(
              String(input.runner.jobId),
              "job id",
              /^[0-9]{1,20}$/,
              20,
            ),
      runAttempt:
        input.runner?.runAttempt == null
          ? null
          : finiteNumber(input.runner.runAttempt, "run attempt", {
              min: 1,
              max: 100,
            }),
      matrixJobIndex: null,
      projectName: PRIVATE_FULLRUNNER_PROJECT_NAME,
      captureSettings: {
        mode: "retain-on-failure",
        snapshots: false,
        screenshots: true,
        sources: true,
        attachments: true,
      },
      plannedTests,
      outcomes,
    },
    calibration: calibrationSummary,
    boardDrag: {
      testOrdinal: dragTest?.ordinal ?? null,
      workerIndex: dragTest?.workerIndex ?? null,
      parallelIndex: dragTest?.parallelIndex ?? null,
      testRetry: dragTest?.retry ?? null,
      samples,
      sets,
    },
  };
  assertNoSensitiveStrings(result);
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > 64 * 1024)
    throw new RangeError(
      "Sanitized result summary exceeds the 64 KiB upload bound.",
    );
  return result;
}

export async function readPrivateRawIntervalSamples(directory) {
  let filenames;
  try {
    filenames = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (((await stat(directory)).mode & 0o777) !== 0o700)
    throw new Error("Private raw interval directory permissions are not 0700.");
  const names = filenames
    .filter((name) => /^sample-[0-9]{2}\.json$/.test(name))
    .sort();
  if (names.length > 6)
    throw new RangeError(
      "Private raw interval directory contains too many sample files.",
    );
  const samples = [];
  for (const name of names) {
    const filePath = path.join(directory, name);
    const fileStats = await stat(filePath);
    if ((fileStats.mode & 0o777) !== 0o600)
      throw new Error("Private raw interval file permissions are not 0600.");
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed.schemaVersion !== 1 || parsed.diagnosticOnly !== true)
      throw new TypeError("Private raw interval sample marker is invalid.");
    const expectedOrdinal = Number(
      name.slice("sample-".length, -".json".length),
    );
    if (parsed.sampleOrdinal !== expectedOrdinal)
      throw new TypeError(
        "Private raw interval filename and sample ordinal differ.",
      );
    samples.push({
      sampleOrdinal: parsed.sampleOrdinal,
      intervalsMs: parsed.intervalsMs,
    });
  }
  return samples;
}

export async function writeSanitizedFullRunnerSummary(filename, summary) {
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const sanitized = sanitizeFullRunnerSummary(summary);
  await writeFile(filename, `${JSON.stringify(sanitized, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
    mode: 0o600,
  });
  await chmod(filename, 0o600);
  return sanitized;
}
