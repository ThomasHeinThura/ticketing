#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const contract = "tests/api-contract/openapi.json";
const version = "1.32.1";
const redoclyConfig = "scripts/ci/redocly.yaml";
const archiveName = `oasdiff_${version}_linux_amd64.tar.gz`;
const archiveSha256 =
  "7c8939fc49b75ee11fec66a5b83b37a2fca6aee109fed85013b1ba2ac2a1ee7f";

export function diagnosticKey(problem) {
  return JSON.stringify([
    problem.severity,
    problem.ruleId,
    problem.location?.[0]?.pointer ?? "",
    problem.message ?? "",
  ]);
}

export function unapprovedProblems(problems, baselineProblems) {
  const available = new Map();
  for (const problem of baselineProblems) {
    const key = diagnosticKey(problem);
    available.set(key, (available.get(key) ?? 0) + 1);
  }

  const unexpected = [];
  for (const problem of problems) {
    const key = diagnosticKey(problem);
    const remaining = available.get(key) ?? 0;
    if (remaining === 0) {
      unexpected.push(problem);
    } else {
      available.set(key, remaining - 1);
    }
  }
  return unexpected;
}

export function parseRedoclyReport(output) {
  const start = output.indexOf('{\n  "totals"');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(output.slice(start, index + 1));
    }
  }
  throw new Error("Redocly JSON report is incomplete");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function reportFailure(label, result) {
  process.stderr.write(
    `${label} failed (${result.status ?? "no exit code"}).\n`,
  );
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = 1;
}

function isPinnedOasdiff(result) {
  return (
    result.status === 0 &&
    new RegExp(
      `^oasdiff version ${version.replaceAll(".", "\\.")}\\s*$`,
      "m",
    ).test(`${result.stdout}${result.stderr}`)
  );
}

function redoclyReport(specPath, label) {
  const result = run("pnpm", [
    "exec",
    "redocly",
    "lint",
    "--config",
    redoclyConfig,
    "--format=json",
    specPath,
  ]);
  try {
    const report = parseRedoclyReport(result.stdout);
    if (report) return report;
    reportFailure(`${label} did not produce a Redocly JSON report`, result);
  } catch (error) {
    reportFailure(
      `${label} produced invalid Redocly JSON: ${error.message}`,
      result,
    );
    return null;
  }
  return null;
}

async function redoclyLint(baseSpec) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "taskdesk-openapi-base-"),
  );
  const basePath = path.join(tempDir, "openapi.json");
  await fs.writeFile(basePath, baseSpec);

  let baseline;
  let current;
  try {
    baseline = redoclyReport(basePath, "Base-branch Redocly lint");
    current = redoclyReport(contract, "Candidate Redocly lint");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  if (!baseline || !current) return false;

  const unexpected = unapprovedProblems(
    current.problems ?? [],
    baseline.problems ?? [],
  );
  if (unexpected.length > 0) {
    process.stderr.write(
      `Redocly lint found ${unexpected.length} new finding(s) beyond the shrink-only baseline:\n`,
    );
    for (const problem of unexpected) {
      process.stderr.write(
        `- ${problem.severity} ${problem.ruleId} ${problem.location?.[0]?.pointer ?? ""}: ${problem.message}\n`,
      );
    }
    process.exitCode = 1;
    return false;
  }

  const remaining = current.problems?.length ?? 0;
  const previous = baseline.problems?.length ?? 0;
  process.stdout.write(
    `Redocly lint: ${remaining} finding(s) remain from origin/main's ${previous}; the baseline is derived from origin/main and can only shrink.\n`,
  );
  return true;
}

async function getOasdiff() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      `the verified oasdiff ${version} installer supports Linux x64; install the pinned release manually on this platform: https://github.com/oasdiff/oasdiff/releases/tag/v${version}`,
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskdesk-oasdiff-"));
  const binary = path.join(tempDir, "oasdiff");
  try {
    const archive = path.join(tempDir, archiveName);
    const response = await fetch(
      `https://github.com/oasdiff/oasdiff/releases/download/v${version}/${archiveName}`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!response.ok)
      throw new Error(`oasdiff download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== archiveSha256) {
      throw new Error(`oasdiff archive SHA-256 mismatch: got ${digest}`);
    }
    await fs.writeFile(archive, bytes);

    const extracted = run("tar", ["-xzf", archive, "-C", tempDir, "oasdiff"]);
    if (extracted.status !== 0) {
      reportFailure("Extracting verified oasdiff archive", extracted);
      throw new Error("oasdiff archive extraction failed");
    }
    await fs.chmod(binary, 0o755);
    const installedVersion = run(binary, ["--version"]);
    if (!isPinnedOasdiff(installedVersion)) {
      reportFailure(
        "Verified oasdiff binary reported an unexpected version",
        installedVersion,
      );
      throw new Error("oasdiff version verification failed");
    }
    process.stdout.write(
      `Downloaded and verified oasdiff ${version} for this run.\n`,
    );
    return { binary, tempDir };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const drift = run("pnpm", ["check:openapi"]);
  if (drift.status !== 0) {
    reportFailure("OpenAPI drift check", drift);
    return;
  }

  const base = run("git", ["rev-parse", "--verify", "origin/main"]);
  if (base.status !== 0) {
    reportFailure(
      "OpenAPI breaking-change base is unavailable; fetch origin/main before running this check",
      base,
    );
    return;
  }

  const baseSpec = run("git", ["show", `origin/main:${contract}`]);
  if (baseSpec.status !== 0) {
    reportFailure(
      "Could not read the OpenAPI contract from origin/main",
      baseSpec,
    );
    return;
  }
  if (!(await redoclyLint(baseSpec.stdout))) return;

  const { binary, tempDir } = await getOasdiff();
  try {
    const breaking = run(binary, [
      "breaking",
      "--fail-on",
      "WARN",
      `origin/main:${contract}`,
      contract,
    ]);
    if (breaking.status !== 0)
      reportFailure("oasdiff breaking-change check", breaking);
    else
      process.stdout.write(
        "oasdiff: no breaking API changes against origin/main.\n",
      );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`test:contract failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
