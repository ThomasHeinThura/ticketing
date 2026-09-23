#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const contract = "tests/api-contract/openapi.json";
const baselinePath = path.join(
  root,
  contract.replace("openapi.json", "redocly-baseline.json"),
);
const version = "1.32.1";
const archiveName = `oasdiff_${version}_linux_amd64.tar.gz`;
const archiveSha256 =
  "7c8939fc49b75ee11fec66a5b83b37a2fca6aee109fed85013b1ba2ac2a1ee7f";

export function diagnosticKey(problem) {
  return JSON.stringify([
    problem.severity,
    problem.ruleId,
    problem.location?.[0]?.pointer ?? "",
  ]);
}

export function unapprovedProblems(problems, baselineProblems) {
  const available = new Map();
  for (const tuple of baselineProblems) {
    const key = JSON.stringify(tuple);
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

async function redoclyLint() {
  const result = run("pnpm", [
    "exec",
    "redocly",
    "lint",
    "--format=json",
    contract,
  ]);
  const start = result.stdout.indexOf('{\n  "totals"');
  if (start < 0) {
    reportFailure("Redocly lint did not produce its JSON report", result);
    return false;
  }

  let report;
  try {
    report = JSON.parse(result.stdout.slice(start));
  } catch {
    reportFailure("Redocly lint produced invalid JSON", result);
    return false;
  }

  const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  const unexpected = unapprovedProblems(
    report.problems ?? [],
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

  const remaining = report.problems?.length ?? 0;
  process.stdout.write(
    `Redocly lint: ${remaining} existing finding(s), all covered by the shrink-only baseline; ${baseline.problems.length - remaining} baseline finding(s) cleared.\n`,
  );
  return true;
}

async function getOasdiff() {
  try {
    const fromPath = run("oasdiff", ["--version"]);
    if (isPinnedOasdiff(fromPath)) return "oasdiff";
  } catch {
    // Install the pinned release below when no executable is available on PATH.
  }

  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      `oasdiff ${version} is not on PATH and the verified auto-installer supports Linux x64; install the pinned release manually: https://github.com/oasdiff/oasdiff/releases/tag/v${version}`,
    );
  }

  const cache = path.join(root, "node_modules", ".cache", `oasdiff-${version}`);
  const binary = path.join(cache, "oasdiff");
  try {
    await fs.access(binary);
    const cachedVersion = run(binary, ["--version"]);
    if (isPinnedOasdiff(cachedVersion)) return binary;
  } catch {
    // Download below and verify the release archive against the pinned upstream digest.
  }

  await fs.mkdir(cache, { recursive: true });
  const archive = path.join(cache, archiveName);
  const response = await fetch(
    `https://github.com/oasdiff/oasdiff/releases/download/v${version}/${archiveName}`,
  );
  if (!response.ok)
    throw new Error(`oasdiff download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== archiveSha256) {
    throw new Error(`oasdiff archive SHA-256 mismatch: got ${digest}`);
  }
  await fs.writeFile(archive, bytes);

  const extracted = run("tar", ["-xzf", archive, "-C", cache, "oasdiff"]);
  if (extracted.status !== 0) {
    reportFailure("Extracting verified oasdiff archive", extracted);
    throw new Error("oasdiff archive extraction failed");
  }
  await fs.chmod(binary, 0o755);
  process.stdout.write(
    `Installed verified oasdiff ${version} in the local dependency cache.\n`,
  );
  return binary;
}

async function main() {
  const drift = run("pnpm", ["check:openapi"]);
  if (drift.status !== 0) {
    reportFailure("OpenAPI drift check", drift);
    return;
  }

  if (!(await redoclyLint())) return;

  const base = run("git", ["rev-parse", "--verify", "origin/main"]);
  if (base.status !== 0) {
    reportFailure(
      "OpenAPI breaking-change base is unavailable; fetch origin/main before running this check",
      base,
    );
    return;
  }

  const oasdiff = await getOasdiff();
  const breaking = run(oasdiff, [
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
