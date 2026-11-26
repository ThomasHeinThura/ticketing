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

// Serves fixture JSON and applies the step's own --jq filter, as the real gh does.
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
args=("$@"); jq_expr=""; path_arg=""
for ((i=0;i<\${#args[@]};i++)); do
  [[ "\${args[$i]}" == "--jq" ]] && jq_expr="\${args[$((i+1))]}"
  [[ "\${args[$i]}" == repos/* ]] && path_arg="\${args[$i]}"
done
case "$path_arg" in
  */rules/branches/main) file="$FAKE_DIR/rules.json" ;;
  */commits/*/check-runs*) sha="\${path_arg#*/commits/}"; file="$FAKE_DIR/runs-\${sha%%/*}.json" ;;
  *) echo "unexpected $path_arg" >&2; exit 1 ;;
esac
[[ -f "$file" ]] || { echo "HTTP 404" >&2; exit 1; }
jq -rc "$jq_expr" "$file"
`;

function fixture(required = ["static", "build"]) {
  const dir = scratchDir("release-checks");
  initRepo(dir);
  write(dir, "a.txt", "a\n");
  const base = commit(dir, "base");
  git(dir, ["checkout", "-q", "-b", "pr"]);
  write(dir, "b.txt", "b\n");
  const head = commit(dir, "pr head");
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--no-ff", "-m", "merge", "pr"]);
  const merge = git(dir, ["rev-parse", "HEAD"]).trim();
  const fake = scratchDir("fake-gh");
  write(fake, "bin/gh", FAKE_GH);
  chmodSync(path.join(fake, "bin/gh"), 0o755);
  const f = { dir, base, head, merge, fake };
  setRules(f, required);
  return f;
}
function setRules(f, required) {
  const parameters = {
    required_status_checks: required.map((context) => ({ context })),
  };
  write(
    f.fake,
    "rules.json",
    JSON.stringify([
      { type: "deletion" },
      ...(required.length
        ? [{ type: "required_status_checks", parameters }]
        : []),
    ]),
  );
}
function setRuns(f, sha, runs) {
  write(
    f.fake,
    `runs-${sha}.json`,
    JSON.stringify({
      check_runs: runs.map(([n, conclusion], id) => ({
        name: n,
        id,
        conclusion,
        status: conclusion ? "completed" : "in_progress",
      })),
    }),
  );
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
  it("accepts PR-only checks that succeeded on the merged branch head", () => {
    const f = fixture();
    setRuns(f, f.merge, [["static", "success"]]);
    setRuns(f, f.head, [["build", "success"]]);
    const r = check(f);
    assert.equal(r.status, 0, output(r));
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
