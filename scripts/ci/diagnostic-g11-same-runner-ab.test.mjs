import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const workflow = await readFile(
  new URL(".github/workflows/diagnostic-g11-ab.yml", root),
  "utf8",
);
const runner = await readFile(
  new URL("scripts/ci/diagnostic-g11-same-runner-ab.sh", root),
  "utf8",
);
const requiredWorkflow = await readFile(
  new URL(".github/workflows/ci-full.yml", root),
  "utf8",
);
const setupAction = await readFile(
  new URL(".github/actions/setup/action.yml", root),
  "utf8",
);
const perfConfig = await readFile(
  new URL("apps/web/playwright.perf.config.ts", root),
  "utf8",
);

test("diagnostic is triggered only by the dedicated run ref with read-only access", () => {
  assert.match(
    workflow,
    /on:\n {2}push:\n {4}branches:\n {6}- codex\/p0-hosted-ab-run\n/,
  );
  assert.doesNotMatch(
    workflow,
    /^ {2}(pull_request|merge_group|workflow_dispatch):/m,
  );
  assert.match(workflow, /permissions:\n {2}contents: read\n/);
  assert.doesNotMatch(workflow, /\b(contents|actions|checks):\s*write\b/);
  assert.match(
    workflow,
    /actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/,
  );
  assert.match(
    workflow,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/,
  );
  assert.match(runner, /RUN_BRANCH="codex\/p0-hosted-ab-run"/);
  assert.match(runner, /GITHUB_REF.*RUN_REF/);
  assert.match(runner, /rev-parse HEAD.*RUN_SHA/);
});

test("source pair and canonical benchmark files are exact and preflighted", () => {
  assert.match(
    runner,
    /ACCEPTED_SHA="f10f9a8fd383044926136cb0c233888e087d2ef9"/,
  );
  assert.match(
    runner,
    /CURRENT_SHA="10034a893b83ef0eba1d801b77d6e81f1e5a0e2e"/,
  );
  for (const file of [
    "apps/web/e2e/performance.bench.ts",
    "apps/web/playwright.perf.config.ts",
    "apps/web/e2e/helpers/g11-performance-fixture.ts",
  ]) {
    assert.ok(runner.includes(file), `missing canonical file check: ${file}`);
  }
  assert.match(runner, /accepted_hash.*current_hash/);
  assert.match(runner, /Canonical benchmark\/config\/fixture differs/);
  assert.match(runner, /SOURCE_FILE_SHA256/);
  assert.match(runner, /rev-parse 'HEAD\^\{tree\}'/);
  assert.match(runner, /--grep.*TEST_GREP/);
  assert.match(runner, /G11: work-list LCP/);
  assert.match(runner, /G11: board render, 200 tasks/);
  assert.match(runner, /lcp_count.*"1".*board_count.*"1"/s);
});

test("diagnostic preserves red results and does not change the required G11 gate", () => {
  assert.match(perfConfig, /retries:\s*0/);
  assert.match(perfConfig, /reuseExistingServer:\s*false/);
  assert.match(
    runner,
    /playwright test --config playwright\.perf\.config\.ts --grep/,
  );
  assert.match(runner, /status=\$\?/);
  assert.match(runner, /exit-code\.txt/);
  assert.match(runner, /exit "\$failed"/);
  assert.ok(
    runner.indexOf('run_measurement "$WORKTREE_ROOT/accepted-f10"') <
      runner.indexOf('run_measurement "$WORKTREE_ROOT/current-10034"'),
  );
  assert.match(requiredWorkflow, /name: performance - budgets \(G11\)/);
  assert.match(requiredWorkflow, /run: pnpm test:perf/);
  assert.doesNotMatch(requiredWorkflow, /diagnostic-g11-same-runner-ab/);
  assert.doesNotMatch(requiredWorkflow, /diagnostic-g11-ab\.yml/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.doesNotMatch(runner, /--retries|--timeout|--workers/);
});

test("setup follows the repository action and artifact paths exclude worktrees and credentials", () => {
  assert.match(workflow, /uses: \.\/\.github\/actions\/setup/);
  assert.ok(
    setupAction.indexOf("corepack enable") <
      setupAction.indexOf("actions/setup-node"),
  );
  assert.match(setupAction, /pnpm install --frozen-lockfile/);
  assert.match(runner, /VITE_API_URL='' pnpm build/);
  assert.match(runner, /playwright install --with-deps chromium/);
  assert.match(runner, /chromium_path=/);
  assert.match(runner, /chromium_version=/);
  assert.match(runner, /chromium_sha256=/);
  assert.match(runner, /selected Chromium executable differs/);
  assert.match(runner, /lscpu/);
  assert.match(runner, /fc-list/);
  assert.match(runner, /bundled_css_and_fonts_sha256/);
  assert.match(runner, /asset_directory_manifest_sha256/);
  assert.match(workflow, /retention-days: 14/);
  assert.doesNotMatch(
    workflow,
    /\.worktrees|(?:^|\/)node_modules(?:\/|$)|(?:^|\/)\.git(?:\/|$)|npmrc|secrets\./i,
  );
  assert.doesNotMatch(runner, /GITHUB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|\.npmrc/);
  assert.doesNotMatch(runner, /git .*worktree prune|rm -rf/);
  assert.match(runner, /worktree remove --force "\$path"/);
  assert.match(runner, /listed_head.*expected/);
  assert.match(runner, /cleanup-receipt\.txt/);
  assert.match(runner, /realpath.*path/);
  assert.match(runner, /taskdesk-owned-run/);
  assert.match(runner, /root_entries.*OWNER_MARKER/);
  assert.match(runner, /127\.0\.0\.1.*4178/);
  assert.match(runner, /Port 4178 is already accepting connections/);
});
