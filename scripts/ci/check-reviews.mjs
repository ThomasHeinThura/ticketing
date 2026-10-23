#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
/** One consolidated independent phase review. Ordinary integration is not submission. */
import { createReadStream, realpathSync } from "node:fs";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAncestor, resolveCommit } from "./lib/git-baseline.mjs";
import { headAgreesWithPayload } from "./lib/head-binding.mjs";
import { finish, repoRoot, violation } from "./lib/repo.mjs";

const NAME = "check:reviews";
const MAX_REPORT_BYTES = 1024 * 1024;
function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
const phase = argument("--phase");
const report = argument("--report");
const fail = (message) => {
  throw new Error(message);
};
const text = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 512 &&
  !Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return (
      code < 32 ||
      code === 127 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
const reportPathAllowed = (value) =>
  /^docs\/evidence\/P[0-9]-review\.json$/.test(value ?? "");
async function hashFile(absolute) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolute)) hash.update(chunk);
  return hash.digest("hex");
}
async function evidenceFile(relative) {
  if (
    !text(relative) ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((part) => part === ".." || part === ".") ||
    relative.startsWith("archive/")
  )
    fail(
      "Evidence must name readable repository-relative files outside the ignored archive",
    );
  const absolute = await realpath(path.join(repoRoot, relative));
  if (
    absolute.startsWith(
      path.join(await realpath(repoRoot), "archive") + path.sep,
    )
  )
    fail("Evidence cannot resolve into the ignored archive");
  if (
    !absolute.startsWith(`${await realpath(repoRoot)}${path.sep}`) ||
    !(await lstat(absolute)).isFile()
  )
    fail(`Evidence escapes the repository or is not a file: ${relative}`);
  // Existence/reachability is checked without reading arbitrary evidence sizes.
}
async function sourceDigest(reportPath) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const hash = createHash("sha256");
  for (const relative of [...new Set(files)].sort()) {
    // Only this exact non-normative report artifact is outside the reviewed source.
    // Requirements, technical contracts, evidence and all other files remain bound.
    if (relative === reportPath) continue;
    const absolute = path.join(repoRoot, relative);
    let stat;
    try {
      stat = await lstat(absolute);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isFile() && !stat.isSymbolicLink())
      fail(`Source snapshot contains unsupported non-file: ${relative}`);
    let content;
    if (stat.isSymbolicLink()) {
      const target = await realpath(absolute);
      const root = await realpath(repoRoot);
      if (
        !target.startsWith(`${root}${path.sep}`) ||
        target.startsWith(path.join(root, "archive") + path.sep) ||
        !(await lstat(target)).isFile()
      )
        fail(
          `Source symlink must resolve to a repository file outside the ignored archive: ${relative}`,
        );
      content = `symlink:${await readlink(absolute)}\0target:${await hashFile(target)}`;
    } else content = await readFile(absolute);
    hash.update(relative);
    hash.update("\0");
    hash.update(stat.mode & 0o111 ? "executable:" : "plain:");
    hash.update(createHash("sha256").update(content).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}
export async function validatePhaseReview({
  phase,
  report,
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: this uncached CI command reads GitHub event metadata, not product configuration.
  eventPath = process.env.GITHUB_EVENT_PATH,
}) {
  if (
    !/^P[0-9]$/.test(phase ?? "") ||
    !reportPathAllowed(report) ||
    report !== `docs/evidence/${phase}-review.json`
  )
    fail(
      "Explicit phase submission requires --phase P0..P9 and --report <repository-relative JSON>",
    );
  await evidenceFile(report);
  if ((await lstat(path.join(repoRoot, report))).size > MAX_REPORT_BYTES)
    fail("Phase review report exceeds the 1 MiB parsing limit");
  const raw = await readFile(path.join(repoRoot, report));
  if (raw.byteLength > MAX_REPORT_BYTES)
    fail("Phase review report exceeds the 1 MiB parsing limit");
  const data = JSON.parse(raw.toString("utf8"));
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.phase !== phase
  )
    fail("Report phase does not match the submitted phase");
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: CI event kind must fail closed when the PR payload is missing.
  const fromPullRequest = process.env.GITHUB_EVENT_NAME === "pull_request";
  let head = resolveCommit("HEAD");
  if (!head) fail("Cannot verify the current source HEAD");
  if (eventPath) {
    const payload = JSON.parse(await readFile(eventPath, "utf8"));
    if (payload && Object.hasOwn(payload, "pull_request")) {
      const claimed = payload.pull_request?.head?.sha;
      if (!/^[a-f0-9]{40}$/.test(claimed ?? ""))
        fail("Pull-request payload has no verifiable source head");
      const agreement = headAgreesWithPayload(repoRoot, claimed);
      if (!agreement.agrees)
        fail(`Pull-request source head is not verified: ${agreement.reason}`);
      head = claimed;
    } else if (fromPullRequest)
      fail("Pull-request source payload is unavailable");
  } else if (fromPullRequest)
    fail("Pull-request source payload is unavailable");
  if (
    !/^[a-f0-9]{40}$/.test(data.sourceSha ?? "") ||
    resolveCommit(data.sourceSha) !== data.sourceSha ||
    !isAncestor(data.sourceSha, head)
  )
    fail(
      "Report sourceSha is not a verified ancestor of the current source head",
    );
  if (data.sourceDigest !== (await sourceDigest(report)))
    fail(
      "Report sourceDigest does not match the current nonignored source snapshot",
    );
  if (
    !text(data.reviewer) ||
    !Array.isArray(data.implementers) ||
    !data.implementers.length ||
    !data.implementers.every(text)
  )
    fail("Report must identify the independent reviewer and implementers");
  if (
    data.implementers.some(
      (person) =>
        person.trim().toLowerCase() === data.reviewer.trim().toLowerCase(),
    )
  )
    fail("The phase implementer cannot independently review their own phase");
  if (
    !Array.isArray(data.coverage) ||
    !["design", "integration", "security"].every((area) =>
      data.coverage.includes(area),
    )
  )
    fail("One consolidated report must cover design, integration and security");
  for (const kind of ["requirements", "diff", "tests", "browser", "security"]) {
    const entries = data.evidence?.[kind];
    if (!Array.isArray(entries) || !entries.length || entries.length > 1000)
      fail(`Missing or invalid ${kind} evidence`);
    for (const entry of entries) await evidenceFile(entry);
  }
  if (!Array.isArray(data.findings) || data.findings.length > 10000)
    fail("Report findings must be an explicit bounded array");
  const ids = new Set();
  for (const finding of data.findings) {
    if (
      !text(finding?.id) ||
      ids.has(finding.id) ||
      finding.status !== "resolved" ||
      !Array.isArray(finding.evidence) ||
      !finding.evidence.length ||
      finding.evidence.length > 1000
    )
      fail(
        "Every finding needs a unique ID, resolved disposition and repair evidence; open/deferred findings do not pass",
      );
    ids.add(finding.id);
    for (const entry of finding.evidence) await evidenceFile(entry);
  }
  const referenced = new Set(Object.values(data.evidence).flat());
  for (const finding of data.findings)
    for (const entry of finding.evidence) referenced.add(entry);
  if (
    !data.evidenceSha256 ||
    typeof data.evidenceSha256 !== "object" ||
    Array.isArray(data.evidenceSha256) ||
    Object.keys(data.evidenceSha256).length !== referenced.size
  )
    fail(
      "Every referenced evidence file must have exactly one SHA-256 binding",
    );
  for (const entry of referenced) {
    await evidenceFile(entry);
    if (entry === report) fail("A report cannot use itself as evidence");
    const expected = data.evidenceSha256[entry];
    if (
      !/^[a-f0-9]{64}$/.test(expected ?? "") ||
      expected !== (await hashFile(path.join(repoRoot, entry)))
    )
      fail(`Evidence SHA-256 does not match: ${entry}`);
  }
}

async function main() {
  if (process.argv.includes("--print-source-digest")) {
    if (!reportPathAllowed(report))
      fail(
        "Digest generation requires --report docs/evidence/P0..P9-review.json",
      );
    console.log(await sourceDigest(report));
    return;
  }
  if (process.argv.includes("--print-evidence-digests")) {
    if (!reportPathAllowed(report))
      fail("Evidence digest generation requires an exact phase report path");
    await evidenceFile(report);
    const raw = await readFile(path.join(repoRoot, report));
    if (raw.byteLength > MAX_REPORT_BYTES)
      fail("Phase review report exceeds the 1 MiB parsing limit");
    const data = JSON.parse(raw.toString("utf8"));
    const paths = new Set(Object.values(data.evidence ?? {}).flat());
    for (const finding of data.findings ?? [])
      for (const entry of finding.evidence ?? []) paths.add(entry);
    const digests = {};
    for (const entry of paths) {
      await evidenceFile(entry);
      if (entry === report) fail("A report cannot use itself as evidence");
      digests[entry] = await hashFile(path.join(repoRoot, entry));
    }
    console.log(JSON.stringify(digests, null, 2));
    return;
  }
  if (!process.argv.includes("--phase") && !process.argv.includes("--report")) {
    finish({
      name: NAME,
      failures: [],
      ok: "phase not submitted; no independent review or phase acceptance inferred",
    });
    return;
  }
  const failures = [];
  try {
    if (
      ["--phase", "--report"].some(
        (flag) => process.argv.filter((value) => value === flag).length > 1,
      )
    )
      fail("Explicit phase flags must not repeat");
    await validatePhaseReview({ phase, report });
  } catch (error) {
    failures.push(violation(report ?? "phase submission", error.message));
  }
  finish({
    name: NAME,
    failures,
    ok: `${phase}: consolidated review evidence validated; Thomas acceptance is recorded separately`,
  });
}
const invokedDirectly = (() => {
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (invokedDirectly) await main();
