/** Execute only the real release required-checks step against a fake `gh` and a local
 * Git repo. No build, registry login, publication or workflow dispatch occurs. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { repoRoot } from "./lib/repo.mjs";
import {
  cleanUpScratchRepos,
  commit,
  git,
  initRepo,
  scratchDir,
  write,
} from "./lib/scratch-repo.mjs";

after(cleanUpScratchRepos);
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/release.yml"),
  "utf8",
);
const name =
  "      - name: Verify every required check passed on the source commit before a versioned release";
const section = workflow
  .slice(workflow.indexOf(name))
  .split("\n      - name:")[0];
const run = section
  .split("        run: |\n")[1]
  ?.split("\n")
  .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
  .join("\n");

// Serves slurped fixture pages (a JSON array of pages), as `gh api --paginate --slurp`.
// A `.fail` marker next to a fixture makes the call print the pages and then fail.
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
path_arg=""
for a in "$@"; do [[ "$a" == repos/* ]] && path_arg="$a"; done
case "$path_arg" in
  */rules/branches/main) file="$FAKE_DIR/rules.json" ;;
  */commits/*/check-runs*) sha="\${path_arg#*/commits/}"; file="$FAKE_DIR/runs-\${sha%%/*}.json" ;;
  *) echo "unexpected $path_arg" >&2; exit 1 ;;
esac
[[ -f "$file" ]] || { echo "HTTP 404" >&2; exit 1; }
cat "$file"
[[ ! -f "$file.fail" ]] || { echo "HTTP 502" >&2; exit 1; }
`;

function fixture(required = ["static", "build"], { divergent = false } = {}) {
  const dir = scratchDir("release-checks");
  initRepo(dir);
  write(dir, "a.txt", "a\n");
  commit(dir, "base");
  git(dir, ["checkout", "-q", "-b", "pr"]);
  write(dir, "b.txt", "b\n");
  const head = commit(dir, "pr head");
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--no-ff", "--no-commit", "pr"]);
  if (divergent) write(dir, "extra.txt", "code the branch never had\n");
  const merge = commit(dir, "merge");
  const fake = scratchDir("fake-gh");
  write(fake, "bin/gh", FAKE_GH);
  chmodSync(path.join(fake, "bin/gh"), 0o755);
  const f = { dir, head, merge, fake };
  setRules(f, required);
  setRuns(f, head, []);
  return f;
}
// `required` entries are a context string or {context, integration_id}; `pages` splits them.
function setRules(f, required, pages = 1) {
  const rule = (entry) => ({
    type: "required_status_checks",
    parameters: {
      required_status_checks: [
        typeof entry === "string" ? { context: entry } : entry,
      ],
    },
  });
  const out = Array.from({ length: pages }, () => [{ type: "deletion" }]);
  required.forEach((entry, i) => {
    out[i % pages].push(rule(entry));
  });
  write(f.fake, "rules.json", JSON.stringify(out));
}
// A run is [name, conclusion, extra]; extra may set completed_at or app.
function setRuns(f, sha, runs, pages = 1) {
  const out = Array.from({ length: pages }, () => ({ check_runs: [] }));
  runs.forEach(([runName, conclusion, extra = {}], id) => {
    out[id % pages].check_runs.push({
      name: runName,
      id,
      conclusion,
      completed_at: conclusion ? "2026-11-26T00:00:00Z" : null,
      app: { id: 15368 },
      ...extra,
    });
  });
  write(f.fake, `runs-${sha}.json`, JSON.stringify(out));
}
function check(f, sha = f.merge) {
  return spawnSync("bash", ["-c", run], {
    cwd: f.dir,
    env: {
      ...process.env,
      PATH: `${path.join(f.fake, "bin")}:${process.env.PATH}`,
      FAKE_DIR: f.fake,
      GITHUB_REPOSITORY: "owner/repo",
      SOURCE_SHA: sha,
    },
    encoding: "utf8",
    timeout: 10000,
  });
}
const output = (r) => `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
const at = (s) => ({ completed_at: `2026-11-26T00:00:0${s}Z` });

describe("versioned release requires every required check before build/publication", () => {
  it("drops the phase review and gates dispatch before the build", () => {
    assert.ok(workflow.includes(name));
    assert.doesNotMatch(workflow, /phase/i);
    assert.match(section, /if: github\.event_name == 'workflow_dispatch'/);
    assert.match(section, /rules\/branches\/main/);
    assert.match(
      section,
      /SOURCE_SHA: \$\{\{ steps\.release\.outputs\.source_sha \}\}/,
    );
    assert.match(workflow, /\n {6}checks: read\n/);
    assert.ok(
      workflow.indexOf(name) < workflow.indexOf("      - name: Set up QEMU"),
    );
    assert.ok(
      workflow.indexOf(name) <
        workflow.indexOf("uses: docker/build-push-action"),
    );
  });
  it("passes when every required check succeeded on the commit", () => {
    const f = fixture();
    setRuns(f, f.merge, [
      ["static", "success"],
      ["build", "success"],
    ]);
    const r = check(f);
    assert.equal(r.status, 0, output(r));
  });
  it("accepts a check missing on the source when the equal-tree parent succeeded", () => {
    const f = fixture();
    setRuns(f, f.merge, [["static", "success"]]);
    setRuns(f, f.head, [["build", "success"]]);
    const r = check(f);
    assert.equal(r.status, 0, output(r));
  });
  it("rejects parent evidence when the trees differ", () => {
    const f = fixture(["static", "build"], { divergent: true });
    setRuns(f, f.merge, [["static", "success"]]);
    setRuns(f, f.head, [["build", "success"]]);
    const r = check(f);
    assert.notEqual(r.status, 0, output(r));
    assert.match(output(r), /::error::Required check 'build'/);
  });
  for (const [label, conclusion] of [
    ["failed", "failure"],
    ["skipped", "skipped"],
    ["pending", null],
    ["cancelled", "cancelled"],
  ])
    it(`fails closed when a required check is ${label}`, () => {
      const f = fixture();
      setRuns(f, f.merge, [
        ["static", "success"],
        ["build", conclusion],
      ]);
      const r = check(f);
      assert.notEqual(r.status, 0, output(r));
      assert.match(output(r), /::error::Required check 'build'/);
    });
  for (const [label, conclusion] of [
    ["failed", "failure"],
    ["pending", null],
  ])
    it(`does not let a parent success override a ${label} source check`, () => {
      const f = fixture();
      setRuns(f, f.merge, [
        ["static", "success"],
        ["build", conclusion],
      ]);
      setRuns(f, f.head, [["build", "success"]]);
      const r = check(f);
      assert.notEqual(r.status, 0, output(r));
      assert.match(output(r), /::error::Required check 'build'/);
    });
  it("uses the latest run: a passing rerun beats an older failure, not the reverse", () => {
    const f = fixture();
    setRuns(f, f.merge, [
      ["static", "success"],
      ["build", "failure", at(1)],
      ["build", "success", at(2)],
    ]);
    assert.equal(check(f).status, 0);
    setRuns(f, f.merge, [
      ["static", "success"],
      ["build", "success", at(1)],
      ["build", "failure", at(2)],
    ]);
    assert.notEqual(check(f).status, 0);
  });
  it("fails closed when a required check has no run at all", () => {
    const f = fixture();
    setRuns(f, f.merge, [["static", "success"]]);
    const r = check(f);
    assert.notEqual(r.status, 0, output(r));
    assert.match(output(r), /::error::Required check 'build'/);
  });
  it("fails closed when the required list is empty or unreadable", () => {
    const f = fixture([]);
    setRuns(f, f.merge, [["static", "success"]]);
    let r = check(f);
    assert.notEqual(r.status, 0, output(r));
    assert.match(output(r), /Could not read any required status check/);
    write(f.fake, "rules.json", "not json");
    r = check(f);
    assert.notEqual(r.status, 0, output(r));
  });
  it("fails closed when the check-runs call fails", () => {
    const f = fixture(["static"]);
    const r = check(f);
    assert.notEqual(r.status, 0, output(r));
    assert.match(output(r), /HTTP 404/);
  });
  it("fails closed when a later check-runs page fails", () => {
    const f = fixture(["static"]);
    setRuns(f, f.merge, [["static", "success"]]);
    write(f.fake, `runs-${f.merge}.json.fail`, "");
    const r = check(f);
    assert.notEqual(r.status, 0, output(r));
    assert.match(output(r), /HTTP 502/);
  });
  it("only counts runs from the app the ruleset pins", () => {
    const f = fixture([{ context: "static", integration_id: 15368 }]);
    setRuns(f, f.merge, [["static", "success", { app: { id: 999 } }]]);
    let r = check(f);
    assert.notEqual(r.status, 0, output(r));
    setRuns(f, f.merge, [["static", "success"]]);
    r = check(f);
    assert.equal(r.status, 0, output(r));
  });
  it("enforces a required check that appears only on page 2 of the rules", () => {
    const f = fixture();
    setRules(f, ["static", "build"], 2);
    setRuns(f, f.merge, [["static", "success"]]);
    const r = check(f);
    assert.notEqual(r.status, 0, output(r));
    assert.match(output(r), /::error::Required check 'build'/);
  });
  it("reads check runs across pages", () => {
    const f = fixture();
    setRuns(
      f,
      f.merge,
      [
        ["static", "success"],
        ["build", "success"],
      ],
      2,
    );
    const r = check(f);
    assert.equal(r.status, 0, output(r));
  });
  it("does not require checks outside the ruleset", () => {
    const f = fixture(["static"]);
    setRuns(f, f.merge, [
      ["static", "success"],
      ["performance - budgets (G11)", "failure"],
    ]);
    const r = check(f);
    assert.equal(r.status, 0, output(r));
  });
});
