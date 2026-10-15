import { readFile, stat } from "node:fs/promises";
import { arch, availableParallelism, cpus, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FULLRUNNER_RESULT_DIRECTORY,
  readPrivateRawIntervalSamples,
  writeSanitizedFullRunnerSummary,
} from "./hosted-drag-fullrunner-evidence.mjs";
import { collectHostedDragSourceBinding } from "./hosted-drag-fullrunner-source.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const REPORT_PATH = path.join(
  FULLRUNNER_RESULT_DIRECTORY,
  "runner-evidence.json",
);
const SOURCE_BINDING_PATH = path.join(
  FULLRUNNER_RESULT_DIRECTORY,
  "source-build-binding.json",
);
const RAW_DIRECTORY = path.join(FULLRUNNER_RESULT_DIRECTORY, "raw-intervals");
const SUMMARY_PATH = path.join(
  FULLRUNNER_RESULT_DIRECTORY,
  "hosted-board-drag-summary.json",
);

async function readRunnerReport() {
  try {
    const mode = (await stat(REPORT_PATH)).mode & 0o777;
    if (mode !== 0o600)
      throw new Error("Private runner evidence permissions are not 0600.");
    return JSON.parse(await readFile(REPORT_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readSourceBinding() {
  try {
    const mode = (await stat(SOURCE_BINDING_PATH)).mode & 0o777;
    if (mode !== 0o600)
      throw new Error(
        "Pre-measurement source binding permissions are not 0600.",
      );
    const binding = JSON.parse(await readFile(SOURCE_BINDING_PATH, "utf8"));
    if (binding.schemaVersion !== 1 || binding.diagnosticOnly !== true)
      throw new TypeError("Pre-measurement source binding marker is invalid.");
    return binding;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readPlaywrightVersion() {
  const packagePath = new URL(
    "../../node_modules/@playwright/test/package.json",
    import.meta.url,
  );
  try {
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function parseExitCode(value) {
  if (value === undefined || value === "") return null;
  if (!/^(?:0|[1-9][0-9]{0,2})$/.test(value))
    throw new TypeError(
      "The captured Playwright command exit code is malformed.",
    );
  const parsed = Number(value);
  if (parsed > 255)
    throw new RangeError(
      "The captured Playwright command exit code is outside the process range.",
    );
  return parsed;
}

const commandExitCode = parseExitCode(process.argv[2]);
const report = await readRunnerReport();
const sourceBinding = await readSourceBinding();
const postRunSource = await collectHostedDragSourceBinding(ROOT);
const sourceBindingFields = [
  "commitSha",
  "sourceTreeSha256",
  "webSourceSha256",
  "buildManifestSha256",
  "fixtureSha256",
];
const sourceBindingStable = Boolean(
  sourceBinding &&
    sourceBindingFields.every(
      (field) =>
        typeof sourceBinding[field] === "string" &&
        sourceBinding[field] === postRunSource[field],
    ),
);
const cpuList = cpus();
const summary = {
  diagnosticOnly: true,
  commandExitCode,
  plannedTests: report?.plannedTests ?? 0,
  outcomes: report?.outcomes ?? [],
  calibration: report?.calibration,
  samples: await readPrivateRawIntervalSamples(RAW_DIRECTORY),
  source: {
    ...(sourceBinding ?? postRunSource),
    bindingStable: sourceBindingStable,
  },
  runtime: {
    nodeVersion: process.version,
    playwrightVersion: await readPlaywrightVersion(),
    chromiumVersion: report?.runtime?.chromiumVersion ?? null,
    operatingSystem: release(),
    architecture: arch(),
    cpuModel: report?.runtime?.cpuModel ?? cpuList[0]?.model ?? "unknown",
    logicalCpuCount: report?.runtime?.logicalCpuCount ?? cpuList.length,
    availableParallelism: availableParallelism(),
  },
  runner: {
    jobName: process.env.GITHUB_JOB ?? null,
    jobId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT
      ? Number(process.env.GITHUB_RUN_ATTEMPT)
      : null,
  },
};

const sanitized = await writeSanitizedFullRunnerSummary(SUMMARY_PATH, summary);
process.stdout.write(
  `Wrote bounded private fullrunner summary: status=${sanitized.status}; commandExitCode=${sanitized.commandExitCode ?? "not-recorded"}; tests=${sanitized.runner.outcomes.length}/${sanitized.runner.plannedTests}; samples=${sanitized.boardDrag.samples.length}\n`,
);
