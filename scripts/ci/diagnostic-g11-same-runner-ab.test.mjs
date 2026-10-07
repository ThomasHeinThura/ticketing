import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  countG11Diagnostics,
  readMetadataValue,
  requireExactlyOneOfEach,
} from "./lib/diagnostic-g11-ab-utils.mjs";

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
const assetCollector = new URL("scripts/ci/lib/capture-build-assets.sh", root);
const assetCollectorSource = await readFile(assetCollector, "utf8");
const commandPreflight = new URL(
  "scripts/ci/lib/diagnostic-g11-preflight.sh",
  root,
);
const commandPreflightSource = await readFile(commandPreflight, "utf8");
const abUtilsSource = await readFile(
  new URL("scripts/ci/lib/diagnostic-g11-ab-utils.mjs", root),
  "utf8",
);
const boardTraceSource = await readFile(
  new URL("scripts/ci/lib/board-trace-evidence.mjs", root),
  "utf8",
);
const boardTraceSpec = await readFile(
  new URL("apps/web/e2e/g11-board-attribution.spec.ts", root),
  "utf8",
);
const boardTraceConfig = await readFile(
  new URL("apps/web/playwright.board-attribution.config.ts", root),
  "utf8",
);

async function createBuildTree() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "taskdesk-build-assets-"));
  for (const entry of ["agent", "portal"]) {
    const assets = path.join(rootDir, "apps/web/dist", entry, "assets");
    await mkdir(assets, { recursive: true });
    await writeFile(path.join(assets, `${entry}.css`), `${entry} css\n`);
    await writeFile(path.join(assets, `${entry}.woff2`), `${entry} font\n`);
    await writeFile(path.join(assets, `${entry}.js`), `${entry} bundle\n`);
  }
  return rootDir;
}

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
  assert.match(
    runner,
    /diagnostic-g11-ab-utils\.mjs" count-tests "\$list_file/,
  );
  assert.match(abUtilsSource, /counts\[key\] !== 1/);
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
  assert.doesNotMatch(runner, /\brg\b/);
  assert.ok(
    runner.indexOf("preflight_required_commands") <
      runner.indexOf('install_source "$WORKTREE_ROOT/accepted-f10"'),
  );
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
  assert.match(runner, /attribution_playwright=.*playwright --version/);
  assert.match(
    runner,
    /accepted_playwright.*current_playwright.*attribution_playwright/,
  );
  assert.match(
    runner,
    /Playwright version differs between source contexts or the attribution CLI/,
  );
  assert.match(runner, /lscpu/);
  assert.match(runner, /fc-list/);
  assert.match(assetCollectorSource, /bundled_css_and_fonts_sha256/);
  assert.match(assetCollectorSource, /asset_directory_manifest_sha256/);
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

test("board tracing is separate from canonical metrics and uses each exact pinned source", () => {
  const acceptedMeasurement = runner.indexOf(
    'run_measurement "$WORKTREE_ROOT/accepted-f10"',
  );
  const currentMeasurement = runner.indexOf(
    'run_measurement "$WORKTREE_ROOT/current-10034"',
  );
  const acceptedTrace = runner.indexOf(
    'run_board_attribution "$WORKTREE_ROOT/accepted-f10"',
  );
  const currentTrace = runner.indexOf(
    'run_board_attribution "$WORKTREE_ROOT/current-10034"',
  );
  assert.ok(
    acceptedMeasurement >= 0 && currentMeasurement > acceptedMeasurement,
  );
  assert.ok(acceptedTrace > currentMeasurement && currentTrace > acceptedTrace);
  assert.match(runner, /TASKDESK_G11_SOURCE_SHA=/);
  assert.match(runner, /TASKDESK_G11_SOURCE_ROOT=/);
  assert.match(
    runner,
    /--config "\$REPO\/apps\/web\/playwright\.board-attribution\.config\.ts"/,
  );
  const attributionRunner = runner
    .split("run_board_attribution() {")[1]
    .split(
      "# Run tracing only after both unchanged canonical measurements have completed.",
    )[0];
  assert.match(attributionRunner, /cd "\$REPO\/apps\/web"/);
  assert.match(
    attributionRunner,
    /\.\/node_modules\/\.bin\/playwright test --config/,
  );
  assert.match(attributionRunner, /TASKDESK_G11_SOURCE_ROOT="\$tree"/);
  assert.doesNotMatch(attributionRunner, /cd "\$tree\/apps\/web"/);
  assert.match(runner, /board-attribution-exit-code\.txt/);
  assert.match(boardTraceConfig, /performanceConfig/);
  assert.match(boardTraceConfig, /g11-board-attribution\.spec\.ts/);
  assert.match(boardTraceConfig, /cwd: sourceRoot/);
  assert.match(boardTraceSpec, /installPerformanceApiFixture/);
  assert.match(boardTraceSpec, /installLastItemPaintRecorder/);
  assert.match(boardTraceSpec, /Seeded legacy task 200/);
  assert.match(boardTraceSpec, /withCdpTraceLifecycle/);
  assert.match(boardTraceSource, /Profiler\.start/);
  assert.match(boardTraceSource, /Tracing\.start/);
  assert.match(boardTraceSource, /Profiler\.stop/);
  assert.match(boardTraceSource, /Tracing\.end/);
  assert.match(boardTraceSource, /session\.detach\(\)/);
  assert.match(
    boardTraceSource,
    /Evidence ownership marker does not match this run/,
  );
  assert.match(
    boardTraceSpec,
    /sourceName: process\.env\.TASKDESK_G11_SOURCE_NAME/,
  );
  assert.match(boardTraceSpec, /UpdateLayoutTree/);
  assert.match(boardTraceSpec, /"Layout"/);
  assert.match(
    boardTraceSpec,
    /sourceRoot,[\s\S]*?apps\/web\/dist\/agent\/assets/,
  );
  assert.match(boardTraceSpec, /diagnosticOnly: true/);
  assert.match(boardTraceSpec, /acceptance: false/);
  assert.match(workflow, /board-cpu-profile\.json/);
  assert.match(workflow, /board-trace-events\.json/);
  assert.match(workflow, /source-maps\/\*\.map/);
  assert.doesNotMatch(
    workflow,
    /board-attribution\/\.\.\.|node_modules|\.npmrc|GITHUB_TOKEN/i,
  );
  assert.match(boardTraceSource, /requireCpuParentGraph/);
  assert.match(boardTraceSource, /parentEdgeCount/);
  assert.match(boardTraceSource, /resolveOwnedTraceDirectory/);
  assert.doesNotMatch(
    runner,
    /apps\/web\/e2e\/performance\.bench\.ts.*(?:write|sed|perl)/,
  );
});

test("board attribution CLI registers the test from a separate source cwd", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "taskdesk-playwright-cwd-"));
  try {
    const result = spawnSync(
      path.join(
        new URL("apps/web/node_modules/.bin/playwright", root).pathname,
      ),
      [
        "test",
        "--config",
        new URL("apps/web/playwright.board-attribution.config.ts", root)
          .pathname,
        "--list",
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          TASKDESK_G11_SOURCE_ROOT: cwd,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Total: 1 test in 1 file/);
    assert.match(
      result.stdout,
      /diagnostic: attribute board render through the 200th card paint/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("asset collector fingerprints the actual agent and portal Vite output trees", async () => {
  const tree = await createBuildTree();
  const output = path.join(tree, "evidence", "asset-fingerprint.txt");
  await mkdir(path.dirname(output));
  try {
    const result = spawnSync("bash", [assetCollector.pathname, tree, output], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const fingerprint = await readFile(output, "utf8");
    assert.match(fingerprint, /bundled_css_and_fonts_sha256/);
    assert.match(fingerprint, /asset_directory_manifest_sha256/);
    for (const entry of ["agent", "portal"]) {
      for (const extension of ["css", "woff2", "js"]) {
        const contents = `${entry} ${extension === "css" ? "css" : extension === "woff2" ? "font" : "bundle"}\n`;
        const hash = createHash("sha256").update(contents).digest("hex");
        assert.ok(
          fingerprint.includes(hash),
          `missing hash for ${entry}.${extension}`,
        );
        assert.ok(fingerprint.includes(`${entry}.${extension}`));
      }
    }
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

test("asset collector fails closed when either built entry is missing", async () => {
  const tree = await createBuildTree();
  const output = path.join(tree, "evidence.txt");
  await rm(path.join(tree, "apps/web/dist/portal"), {
    recursive: true,
    force: true,
  });
  try {
    const result = spawnSync("bash", [assetCollector.pathname, tree, output], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Missing or unsafe portal build asset directory/,
    );
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

test("asset collector rejects an entry directory that escapes through a symlink", async () => {
  const tree = await createBuildTree();
  const outside = await mkdtemp(
    path.join(tmpdir(), "taskdesk-outside-assets-"),
  );
  const output = path.join(tree, "evidence.txt");
  const portal = path.join(tree, "apps/web/dist/portal");
  await mkdir(path.join(outside, "assets"));
  await rm(portal, { recursive: true, force: true });
  await symlink(outside, portal, "dir");
  try {
    const result = spawnSync("bash", [assetCollector.pathname, tree, output], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Missing or unsafe portal build asset directory/,
    );
  } finally {
    await rm(tree, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("portable parser accepts exactly one selected case each and rejects missing or duplicate cases", () => {
  const listed = [
    "Listing tests:",
    "  [chromium] › e2e/performance.bench.ts:100:3 › G11: work-list LCP",
    "  [chromium] › e2e/performance.bench.ts:140:3 › G11: board render, 200 tasks",
    "Total: 2 tests in 1 file",
  ].join("\n");
  const counts = countG11Diagnostics(listed);
  assert.deepEqual(counts, { lcp: 1, board: 1 });
  assert.doesNotThrow(() => requireExactlyOneOfEach(counts));
  assert.throws(
    () =>
      requireExactlyOneOfEach(
        countG11Diagnostics(`${listed}\nG11: work-list LCP`),
      ),
    /G11: work-list LCP: expected 1, got 2/,
  );
  assert.throws(
    () => requireExactlyOneOfEach(countG11Diagnostics("Listing tests:\n")),
    /expected 1, got 0/,
  );
});

test("command preflight passes without ripgrep and fails before setup for a missing required tool", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "taskdesk-command-path-"));
  const bin = path.join(fixture, "bin");
  await mkdir(bin);
  try {
    const requiredText = /required=\(([\s\S]*?)\)/.exec(
      commandPreflightSource,
    )?.[1];
    assert.ok(requiredText);
    const required = requiredText.trim().split(/\s+/);
    assert.ok(!required.includes("rg"));
    const symlinkTargets = new Map();
    for (const commandName of required) {
      const found = spawnSync(
        "/bin/bash",
        ["-c", 'command -v "$1"', "command-probe", commandName],
        { encoding: "utf8" },
      );
      const target = found.status === 0 ? found.stdout.trim() : "/bin/echo";
      symlinkTargets.set(commandName, target);
      await symlink(target, path.join(bin, commandName));
    }
    const preflight = `source "${commandPreflight.pathname}"; preflight_required_commands || exit; if command -v rg >/dev/null 2>&1; then exit 7; fi; printf 'preflight-ok\\n'`;
    const noRg = spawnSync("/bin/bash", ["-c", preflight], {
      encoding: "utf8",
      env: { ...process.env, PATH: bin },
    });
    assert.equal(noRg.status, 0, noRg.stderr);
    assert.match(noRg.stdout, /preflight-ok/);
    for (const commandName of required) {
      await rm(path.join(bin, commandName));
      const missing = spawnSync("/bin/bash", ["-c", preflight], {
        encoding: "utf8",
        env: { ...process.env, PATH: bin },
      });
      assert.notEqual(missing.status, 0, `${commandName} should be required`);
      assert.match(
        missing.stderr,
        new RegExp(
          `Missing required diagnostic commands before setup: .*\\b${commandName}\\b`,
        ),
      );
      await symlink(
        symlinkTargets.get(commandName),
        path.join(bin, commandName),
      );
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("metadata parser requires a single populated exact key", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "taskdesk-metadata-"));
  const file = path.join(fixture, "environment.txt");
  try {
    await writeFile(
      file,
      "chromium_path=/opt/browser/chrome\nchromium_sha256=abc123\n",
    );
    assert.equal(await readMetadataValue(file, "chromium_sha256"), "abc123");
    await writeFile(file, "chromium_sha256=abc123\nchromium_sha256=def456\n");
    await assert.rejects(
      readMetadataValue(file, "chromium_sha256"),
      /exactly one/,
    );
    await writeFile(file, "chromium_sha256=\n");
    await assert.rejects(
      readMetadataValue(file, "chromium_sha256"),
      /non-empty/,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
