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

const APPROVED_BREAK_KEYS = [
  "operation",
  "rule",
  "fingerprint",
  "pr",
  "reason",
  "decision",
];

/**
 * The identity of an allowlist entry, or of an oasdiff finding shaped the same way: the
 * (operation, rule, fingerprint) triple. Binding on `fingerprint` too — not just
 * (operation, rule) — is what lets one entry approve exactly one finding: two findings that
 * share an operation and rule (e.g. two different required properties added to the same
 * route in the same PR) get different fingerprints from oasdiff, so each needs its own
 * entry (Opus review F1).
 *
 * @param {{ operation: string, rule: string, fingerprint: string }} record
 */
export function approvedBreakIdentity(record) {
  return `${record.operation}\u0000${record.rule}\u0000${record.fingerprint}`;
}

/**
 * Validate and parse the pre-2.0 approved-breaking-change allowlist.
 *
 * Strict on purpose: this file is in the security-review scope
 * (docs/04-engineering/ci-cd.md), so a malformed entry is a gate that silently passed a
 * finding nobody actually reviewed. Fail closed rather than guess.
 *
 * @param {string} text raw file contents
 * @returns {{ operation: string, rule: string, fingerprint: string, pr: number, reason: string, decision: string }[]}
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
    for (const field of [
      "operation",
      "rule",
      "fingerprint",
      "reason",
      "decision",
    ]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        throw new Error(
          `${approvedBreaksPath}[${index}].${field} must be a non-empty string.`,
        );
      }
    }
    if (!Number.isInteger(entry.pr)) {
      throw new Error(`${approvedBreaksPath}[${index}].pr must be an integer.`);
    }
    const dedupeKey = approvedBreakIdentity(entry);
    if (seen.has(dedupeKey)) {
      throw new Error(
        `${approvedBreaksPath} has a duplicate entry for operation "${entry.operation}", ` +
          `rule "${entry.rule}" and fingerprint "${entry.fingerprint}".`,
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
 * needed to check it against the allowlist (`operation`, `path`, `id`, `fingerprint`) is an
 * error rather than a silently-empty finding list.
 *
 * @param {string} output stdout from `oasdiff breaking --format json`
 * @returns {{ operation: string, rule: string, fingerprint: string, raw: object }[]}
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
      finding.id.trim() === "" ||
      typeof finding?.fingerprint !== "string" ||
      finding.fingerprint.trim() === ""
    ) {
      throw new Error(
        `oasdiff finding ${index} is missing an "operation", "path", "id", or ` +
          '"fingerprint" field; refusing to check it against the allowlist.',
      );
    }
    return {
      operation: `${finding.operation} ${finding.path}`,
      rule: finding.id,
      fingerprint: finding.fingerprint,
      raw: finding,
    };
  });
}

/**
 * Split oasdiff findings into ones a set of NEW allowlist entries exactly covers and the
 * rest, and report which of those new entries matched no finding at all.
 *
 * A match requires the exact (operation, rule, fingerprint) triple, so one entry binds to
 * exactly one finding — a different rule, a different operation, or the same pair on a
 * different underlying change (different fingerprint) all still fail. `approved` must
 * already be filtered to entries that are NEW relative to origin/main (see
 * `readBaseApprovedBreaks`): an entry already on `main` approves nothing, by construction,
 * because it is never passed in here (Opus review F1).
 *
 * @param {{ operation: string, rule: string, fingerprint: string, raw: object }[]} findings
 * @param {{ operation: string, rule: string, fingerprint: string }[]} approved new entries only
 */
export function partitionApprovedBreaks(findings, approved) {
  const approvedKeys = new Set(approved.map(approvedBreakIdentity));
  const usedKeys = new Set();
  const matched = [];
  const unmatched = [];
  for (const finding of findings) {
    const key = approvedBreakIdentity(finding);
    if (approvedKeys.has(key)) {
      matched.push(finding);
      usedKeys.add(key);
    } else {
      unmatched.push(finding);
    }
  }
  const unusedEntries = approved.filter(
    (entry) => !usedKeys.has(approvedBreakIdentity(entry)),
  );
  return { matched, unmatched, unusedEntries };
}

/**
 * Extract tag names from `git ls-remote --tags origin` output, dropping the `^{}` peeled
 * refs a tag object's dereferenced commit produces (those duplicate the tag name and are
 * not a second, different tag).
 *
 * @param {string} output stdout from `git ls-remote --tags origin`
 * @returns {string[]}
 */
export function parseLsRemoteTags(output) {
  const tags = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = trimmed.match(/refs\/tags\/(.+)$/);
    if (!match) continue;
    const ref = match[1];
    if (ref.endsWith("^{}")) continue;
    tags.push(ref);
  }
  return tags;
}

/**
 * True once at least one tag is a STABLE release `major.minor.patch` (no pre-release or
 * build suffix, an optional leading `v`) with major >= 2 — "the first stable 2.0.0 (or
 * later) release" from release-plan.md and api-design.md's Versioning section. A
 * pre-release tag like `v2.0.0-alpha.1` or `v2.0.0-rc.2` does not count: release-plan.md's
 * whole pre-release ladder runs under a `2.x` version before the stage that api-design.md
 * means by "2.0.0 ships".
 *
 * @param {string[]} tagNames
 */
export function hasStableV2Tag(tagNames) {
  return tagNames.some((name) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(name);
    if (!match) return false;
    return Number.parseInt(match[1], 10) >= 2;
  });
}

/**
 * Whether a stable v2.0.0+ release tag exists on `origin`, looked up live rather than from
 * any local file — `package.json`'s version tracks `semantic-release`/kaneo history, not
 * this milestone, and after #331 a release is a git tag the manual Release workflow
 * creates, not a version-bump commit.
 *
 * Fails closed: a lookup that cannot run (no network, no `origin` remote, a non-zero exit)
 * throws rather than being treated as "no stable v2.0.0 tag exists yet", because "the
 * lookup failed" and "we checked and it's pre-2.0" are not the same fact.
 *
 * @param {(command: string, args: string[]) => { status: number|null, stdout: string, stderr: string }} runner
 */
export async function stableV2ReleaseExists(runner) {
  let result;
  try {
    result = runner("git", ["ls-remote", "--tags", "origin"]);
  } catch (error) {
    throw new Error(
      `could not run "git ls-remote --tags origin" to check for a stable v2.0.0+ release ` +
        `tag: ${error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `"git ls-remote --tags origin" failed (exit ${result.status ?? "unknown"}); refusing ` +
        "to guess whether a stable v2.0.0+ release tag exists. Check network access and " +
        "the 'origin' remote, then retry.\n" +
        `${result.stderr ?? ""}`,
    );
  }
  return hasStableV2Tag(parseLsRemoteTags(result.stdout));
}

/**
 * True when `stderr` from `git show <ref>:<path>` says the path does not exist at that
 * revision, as opposed to some other failure (bad ref, no network, corrupt object). Git
 * phrases this two ways depending on whether the path exists in the worktree: "does not
 * exist in '<ref>'" when it is absent everywhere nearby, and "exists on disk, but not in
 * '<ref>'" when the current checkout happens to have it (exactly the case here — this
 * script's own worktree has the file the PR is adding). Only these two mean "no entries
 * yet" — anything else fails closed.
 *
 * @param {string} stderr
 */
export function isMissingBaseFileError(stderr) {
  return /does not exist in|exists on disk, but not in/i.test(stderr ?? "");
}

/**
 * The allowlist entries `origin/main` already has — i.e. entries some earlier PR added and
 * merged. An entry present in this list approves nothing on the current PR (Opus review
 * F1): only entries NEW relative to this copy can approve a finding.
 *
 * A missing file at `origin/main` (the allowlist has never existed there — e.g. the PR that
 * introduces it) is treated as `[]`. Any other read failure — network, an unresolvable
 * `origin/main`, a corrupt object, or a base copy that fails the same strict validation
 * `parseApprovedBreaks` applies — throws rather than silently treating the base as empty,
 * because an empty base is the MOST permissive answer (every current entry looks "new") and
 * getting it wrong on a read failure would open, not close, the gate.
 *
 * @param {(command: string, args: string[]) => { status: number|null, stdout: string, stderr: string }} runner
 * @returns {Promise<{ operation: string, rule: string, fingerprint: string, pr: number, reason: string, decision: string }[]>}
 */
export async function readBaseApprovedBreaks(runner) {
  let result;
  try {
    result = runner("git", ["show", `origin/main:${approvedBreaksPath}`]);
  } catch (error) {
    throw new Error(
      `could not read origin/main's copy of ${approvedBreaksPath} to find out which ` +
        `entries are already merged: ${error.message}`,
    );
  }

  if (result.status === 0) {
    try {
      return parseApprovedBreaks(result.stdout);
    } catch (error) {
      throw new Error(
        `origin/main's copy of ${approvedBreaksPath} is malformed, so which entries are ` +
          `already merged cannot be computed: ${error.message}`,
      );
    }
  }

  if (isMissingBaseFileError(result.stderr)) {
    return [];
  }

  throw new Error(
    `could not read origin/main's copy of ${approvedBreaksPath} (git show exited ` +
      `${result.status ?? "unknown"}); refusing to guess which entries are already ` +
      `merged.\n${result.stderr ?? ""}`,
  );
}

/**
 * F2 (Opus review, low): oasdiff's exit status was no longer checked once matching moved
 * to parsing stdout directly. Defence in depth: `breaking --fail-on WARN` should only ever
 * exit 0 (clean) or 1 (something at or above WARN was found); anything else means the run
 * itself is suspect and the JSON on stdout should not be trusted. Exit 1 with zero findings
 * is the same kind of contradiction the other way — that combination should not happen, so
 * treat it as a reason to fail closed rather than a clean run.
 *
 * @param {number|null} status
 * @param {number} findingsCount
 * @returns {string|null} an error message, or null if the exit status is unremarkable
 */
export function oasdiffExitError(status, findingsCount) {
  if (status !== 0 && status !== 1) {
    return (
      `oasdiff breaking-change check exited ${status ?? "unknown"}; expected 0 (clean) or ` +
      "1 (findings at or above --fail-on). Failing closed rather than trusting its stdout."
    );
  }
  if (status === 1 && findingsCount === 0) {
    return (
      "oasdiff exited 1, as if it found something at or above --fail-on, but its JSON " +
      "output lists zero findings. Failing closed rather than treating this as a clean run."
    );
  }
  return null;
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
    let stableV2Released;
    try {
      stableV2Released = await stableV2ReleaseExists(run);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (stableV2Released) {
      process.stderr.write(
        `${approvedBreaksPath} has ${approvedBreaks.length} entry(ies) but a stable v2.0.0+ ` +
          "release tag already exists on origin. docs/01-architecture/api-design.md's " +
          "Versioning section requires a new path segment for a breaking change from the " +
          "first stable v2.0.0 (or later) release tag on, not an allowlist entry — empty " +
          "the file and version the breaking route instead.\n",
      );
      process.exitCode = 1;
      return;
    }
  }

  let baseApprovedBreaks;
  try {
    baseApprovedBreaks = await readBaseApprovedBreaks(run);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const baseIdentities = new Set(baseApprovedBreaks.map(approvedBreakIdentity));
  const newEntries = approvedBreaks.filter(
    (entry) => !baseIdentities.has(approvedBreakIdentity(entry)),
  );
  const staleEntries = approvedBreaks.filter((entry) =>
    baseIdentities.has(approvedBreakIdentity(entry)),
  );
  for (const entry of staleEntries) {
    process.stdout.write(
      "stale allowlist entry (already on origin/main, approves nothing here — delete it): " +
        `${entry.rule} ${entry.operation} (PR #${entry.pr})\n`,
    );
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

    const exitError = oasdiffExitError(breaking.status, findings.length);
    if (exitError) {
      process.stderr.write(`${exitError}\n`);
      if (breaking.stderr) process.stderr.write(breaking.stderr);
      process.exitCode = 1;
      return;
    }

    const { matched, unmatched, unusedEntries } = partitionApprovedBreaks(
      findings,
      newEntries,
    );
    for (const finding of matched) {
      process.stdout.write(
        `approved break: ${finding.rule} ${finding.operation}\n`,
      );
    }

    if (unmatched.length > 0) {
      process.stderr.write(
        `oasdiff found ${unmatched.length} breaking change(s) not covered by a NEW entry in ` +
          `${approvedBreaksPath} (an entry already on origin/main approves nothing):\n`,
      );
      for (const finding of unmatched) {
        process.stderr.write(
          `- ${finding.rule} ${finding.operation}: ${finding.raw.text ?? ""}\n`,
        );
      }
      process.exitCode = 1;
      return;
    }

    if (unusedEntries.length > 0) {
      process.stderr.write(
        `${unusedEntries.length} new entry(ies) in ${approvedBreaksPath} matched no ` +
          "breaking finding — a stale or typo'd entry:\n",
      );
      for (const entry of unusedEntries) {
        process.stderr.write(
          `- ${entry.rule} ${entry.operation} (fingerprint ${entry.fingerprint}, PR #${entry.pr})\n`,
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
