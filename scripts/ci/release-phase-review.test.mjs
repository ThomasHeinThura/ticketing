/** Execute only the real release phase-validation step in disposable local Git repos.
 * No build, registry login, publication or workflow dispatch occurs. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { repoRoot } from "./lib/repo.mjs";
import {
  cleanUpScratchRepos,
  commit,
  git,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "./lib/scratch-repo.mjs";

after(cleanUpScratchRepos);
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/release.yml"),
  "utf8",
);
const name =
  "      - name: Verify consolidated phase review before a versioned release";
const section = workflow
  .slice(workflow.indexOf(name))
  .split("\n      - name:")[0];
const run = section
  .split("        run: |\n")[1]
  ?.split("\n")
  .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
  .join("\n");
function fixture() {
  const dir = scratchDir("release-phase");
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, ".github/workflows/release.yml");
  write(dir, ".gitignore", "node_modules\n");
  write(dir, "app-source.ts", "export const source = 'reviewed';\n");
  const evidence = {};
  const evidenceSha256 = {};
  for (const kind of ["requirements", "diff", "tests", "browser", "security"]) {
    const file = `docs/evidence/${kind}.txt`;
    const content = `Synthetic ${kind} fixture; not real acceptance.\n`;
    write(dir, file, content);
    evidence[kind] = [file];
    evidenceSha256[file] = createHash("sha256").update(content).digest("hex");
  }
  const sourceSha = commit(dir, "synthetic reviewed release source");
  const report = "docs/evidence/P1-review.json";
  const digest = runChecker(dir, "check-reviews.mjs", [
    "--print-source-digest",
    "--report",
    report,
  ]);
  assert.equal(digest.status, 0, digest.output);
  const body = {
    phase: "P1",
    sourceSha,
    sourceDigest: digest.stdout.trim(),
    reviewer: "fresh reviewer",
    implementers: ["implementer"],
    coverage: ["design", "integration", "security"],
    evidence,
    evidenceSha256,
    findings: [],
  };
  write(dir, report, JSON.stringify(body));
  const policy = commit(dir, "record the consolidated review");
  return { dir, report, body, policy };
}
function check(f, envOverrides = {}) {
  const env = {
    ...process.env,
    INPUT_PHASE: "P1",
    INPUT_PHASE_REPORT: f.report,
    POLICY_SOURCE_SHA: f.policy,
    RUNNER_TEMP: scratchDir("phase-gate-runtime"),
    GITHUB_EVENT_NAME: "workflow_dispatch",
    ...envOverrides,
  };
  delete env.GITHUB_EVENT_PATH;
  return spawnSync("bash", ["-c", run], {
    cwd: f.dir,
    env,
    encoding: "utf8",
    timeout: 10000,
  });
}
function output(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}
describe("versioned release requires the consolidated phase report before build/publication", () => {
  it("keeps main Edge publication separate from phase acceptance and requires explicit dispatch inputs", () => {
    assert.ok(workflow.includes(name));
    assert.match(section, /if: github\.event_name == 'workflow_dispatch'/);
    assert.match(section, /POLICY_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
    for (const input of ["phase", "phase_report"])
      assert.match(
        workflow,
        new RegExp(`      ${input}:\\n[\\s\\S]*?        required: true`),
      );
    assert.ok(
      workflow.indexOf(name) < workflow.indexOf("      - name: Set up QEMU"),
    );
    assert.ok(
      workflow.indexOf(name) <
        workflow.indexOf("uses: docker/build-push-action"),
    );
  });
  it("validates unchanged reviewed source after the report-only commit", () => {
    const result = check(fixture());
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /Thomas acceptance is recorded separately/);
  });
  it("fails closed when the phase/report is omitted", () => {
    const result = check(fixture(), {
      INPUT_PHASE: "",
      INPUT_PHASE_REPORT: "",
    });
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /requires phase/);
  });
  it("fails closed when the referenced report is absent", () => {
    const f = fixture();
    git(f.dir, ["rm", f.report]);
    const result = check(f);
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /ENOENT/);
  });
  it("fails closed on stale source content", () => {
    const f = fixture();
    write(
      f.dir,
      "app-source.ts",
      "export const source = 'changed after review';\n",
    );
    const result = check(f);
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /sourceDigest does not match/);
  });
  it("fails closed on an unverified reviewed-source commit", () => {
    const f = fixture();
    f.body.sourceSha = "0".repeat(40);
    write(f.dir, f.report, JSON.stringify(f.body));
    const result = check(f);
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /verified ancestor/);
  });
  for (const area of ["design", "integration", "security"])
    it(`fails closed when consolidated ${area} coverage is absent`, () => {
      const f = fixture();
      f.body.coverage = f.body.coverage.filter((value) => value !== area);
      write(f.dir, f.report, JSON.stringify(f.body));
      const result = check(f);
      assert.notEqual(result.status, 0, output(result));
      assert.match(output(result), /cover design, integration and security/);
    });
  it("uses the workflow's gate authority even if the selected candidate checker is permissive", () => {
    const f = fixture();
    write(f.dir, "scripts/ci/check-reviews.mjs", "process.exit(0);\n");
    const result = check(f);
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /sourceDigest does not match/);
  });
  it("refuses an unavailable gate-authority commit", () => {
    const result = check(fixture(), { POLICY_SOURCE_SHA: "0".repeat(40) });
    assert.notEqual(result.status, 0, output(result));
  });
});
