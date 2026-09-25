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
const approvedBreaksPath = "scripts/ci/openapi-approved-breaks.json";
const packageJsonPath = "package.json";

const APPROVED_BREAK_KEYS = ["operation", "rule", "pr", "reason", "decision"];

/**
 * Validate and parse the pre-2.0 approved-breaking-change allowlist.
 *
 * Strict on purpose: this file is in the security-review scope
 * (docs/04-engineering/ci-cd.md), so a malformed entry is a gate that silently passed a
 * finding nobody actually reviewed. Fail closed rather than guess.
 *
 * @param {string} text raw file contents
 * @returns {{ operation: string, rule: string, pr: number, reason: string, decision: string }[]}
 */
export function parseApprovedBreaks(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${approvedBreaksPath} is not valid JSON: ${error.message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${approvedBreaksPath} must be a JSON array.`);
  }

  const seen = new Set();
  parsed.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `${approvedBreaksPath}[${index}] must be an object with exactly the keys ${APPROVED_BREAK_KEYS.join(", ")}.`,
      );
    }
    const keys = Object.keys(entry).sort();
    const expected = [...APPROVED_BREAK_KEYS].sort();
    if (
      keys.length !== expected.length ||
      keys.some((k, i) => k !== expected[i])
    ) {
      throw new Error(
        `${approvedBreaksPath}[${index}] has keys [${keys.join(", ")}]; expected exactly [${expected.join(", ")}].`,
      );
    }
    for (const field of ["operation", "rule", "reason", "decision"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        throw new Error(
          `${approvedBreaksPath}[${index}].${field} must be a non-empty string.`,
        );
      }
    }
    if (!Number.isInteger(entry.pr)) {
      throw new Error(`${approvedBreaksPath}[${index}].pr must be an integer.`);
    }
    const dedupeKey = `${entry.operation}\u0000${entry.rule}`;
    if (seen.has(dedupeKey)) {
      throw new Error(
        `${approvedBreaksPath} has a duplicate entry for operation "${entry.operation}" and rule "${entry.rule}".`,
      );
    }
    seen.add(dedupeKey);
  });

  return parsed;
}

/**
 * Parse oasdiff's `--format json` breaking-change output into normalized findings.
 *
 * Fails closed: unparseable output, a non-array result, or a finding missing the fields
 * needed to check it against the allowlist (`operation`, `path`, `id`) is an error rather
 * than a silently-empty finding list.
 *
 * @param {string} output stdout from `oasdiff breaking --format json`
 * @returns {{ operation: string, rule: string, raw: object }[]}
 */
export function parseOasdiffBreakingJson(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`could not parse oasdiff JSON output: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("oasdiff JSON output must be an array of findings.");
  }

  return parsed.map((finding, index) => {
    if (
      typeof finding?.operation !== "string" ||
      finding.operation.trim() === "" ||
      typeof finding?.path !== "string" ||
      finding.path.trim() === "" ||
      typeof finding?.id !== "string" ||
      finding.id.trim() === ""
    ) {
      throw new Error(
        `oasdiff finding ${index} is missing an "operation", "path", or "id" field; refusing to check it against the allowlist.`,
      );
    }
    return {
      operation: `${finding.operation} ${finding.path}`,
      rule: finding.id,
      raw: finding,
    };
  });
}

/**
 * Split oasdiff findings into ones the allowlist exactly covers and the rest.
 *
 * A match requires the exact (operation, rule) pair; anything else — same operation with a
 * different rule, same rule on a different operation, or no entry at all — still fails.
 *
 * @param {{ operation: string, rule: string, raw: object }[]} findings
 * @param {{ operation: string, rule: string }[]} approved
 */
export function partitionApprovedBreaks(findings, approved) {
  const approvedKeys = new Set(
    approved.map((entry) => `${entry.operation}\u0000${entry.rule}`),
  );
  const matched = [];
  const unmatched = [];
  for (const finding of findings) {
    const key = `${finding.operation}\u0000${finding.rule}`;
    if (approvedKeys.has(key)) matched.push(finding);
    else unmatched.push(finding);
  }
  return { matched, unmatched };
}

/**
 * True once the root package.json version is 2.0.0 or later — the point at which
 * api-design.md's Versioning section requires the allowlist to be empty.
 *
 * @param {string} versionString e.g. "2.22.0"
 */
export function isAtLeastV2(versionString) {
  const [major] = versionString
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return Number.isFinite(major) && major >= 2;
}

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

  let approvedBreaks;
  try {
    const approvedBreaksText = await fs.readFile(
      path.join(root, approvedBreaksPath),
      "utf8",
    );
    approvedBreaks = parseApprovedBreaks(approvedBreaksText);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (approvedBreaks.length > 0) {
    let packageVersion;
    try {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(root, packageJsonPath), "utf8"),
      );
      packageVersion = packageJson.version;
    } catch (error) {
      process.stderr.write(
        `Could not read ${packageJsonPath} to check the API version: ${error.message}\n`,
      );
      process.exitCode = 1;
      return;
    }
    if (isAtLeastV2(packageVersion)) {
      process.stderr.write(
        `${approvedBreaksPath} has ${approvedBreaks.length} entry(ies) but ${packageJsonPath} ` +
          `is at version ${packageVersion} (>= 2.0.0). docs/01-architecture/api-design.md's ` +
          "Versioning section requires a new path segment for a breaking change from 2.0.0 " +
          "on, not an allowlist entry — empty the file and version the breaking route " +
          "instead.\n",
      );
      process.exitCode = 1;
      return;
    }
  }

  const { binary, tempDir } = await getOasdiff();
  try {
    const breaking = run(binary, [
      "breaking",
      "--fail-on",
      "WARN",
      "--format",
      "json",
      `origin/main:${contract}`,
      contract,
    ]);

    let findings;
    try {
      findings = parseOasdiffBreakingJson(breaking.stdout);
    } catch (error) {
      process.stderr.write(
        `oasdiff breaking-change check failed closed: ${error.message}\n`,
      );
      if (breaking.stderr) process.stderr.write(breaking.stderr);
      process.exitCode = 1;
      return;
    }

    const { matched, unmatched } = partitionApprovedBreaks(
      findings,
      approvedBreaks,
    );
    for (const finding of matched) {
      process.stdout.write(
        `approved break: ${finding.rule} ${finding.operation}\n`,
      );
    }

    if (unmatched.length > 0) {
      process.stderr.write(
        `oasdiff found ${unmatched.length} breaking change(s) not covered by ` +
          `${approvedBreaksPath}:\n`,
      );
      for (const finding of unmatched) {
        process.stderr.write(
          `- ${finding.rule} ${finding.operation}: ${finding.raw.text ?? ""}\n`,
        );
      }
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      `oasdiff: no unapproved breaking API changes against origin/main (${matched.length} ` +
        "approved).\n",
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
