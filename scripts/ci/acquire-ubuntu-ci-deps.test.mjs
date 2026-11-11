import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const script = path.join(root, "scripts/ci/acquire-ubuntu-ci-deps.sh");

function fixture(t, failure = "none") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ci-apt-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  const webBin = path.join(dir, "apps/web/node_modules/.bin");
  const debs = path.join(dir, "debs");
  for (const item of [bin, webBin, debs]) mkdirSync(item, { recursive: true });
  const executable = (file, source) => {
    writeFileSync(file, `#!/bin/bash\nset -eu\n${source}\n`);
    chmodSync(file, 0o755);
  };
  executable(
    path.join(bin, "timeout"),
    `
    [[ "$1" == --kill-after=10s && "$2" == 8m && "$3" == "$EXPECTED_SCRIPT" && "$4" == --bounded ]] || exit 2
    shift 2
    exec "$@"
  `,
  );
  executable(path.join(bin, "sudo"), 'exec "$@"');
  executable(
    path.join(bin, "apt-get"),
    `
    [[ "$1" == -c ]]
    cat "$2" > "$CONFIG_CAPTURE"
    shift 2
    echo "$1" >> "$LOG"
    case "$1:$FAILURE" in
      update:index|download:sustained) exit 100 ;;
      download:transient) echo retry >> "$LOG" ;;
    esac
    if [[ "$1" == download ]]; then touch docker-compose-v2_1.deb docker-buildx_1.deb; fi
  `,
  );
  executable(
    path.join(webBin, "playwright"),
    `
    echo "playwright $*" >> "$LOG"
    if [[ "$1" == install-deps ]]; then apt-get update && apt-get install; fi
  `,
  );
  const log = path.join(dir, "log");
  const capture = path.join(dir, "config");
  const run = (...args) =>
    spawnSync(script, args, {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        LOG: log,
        CONFIG_CAPTURE: capture,
        FAILURE: failure,
        EXPECTED_SCRIPT: script,
      },
      encoding: "utf8",
    });
  return {
    run,
    debs,
    log: () => readFileSync(log, "utf8"),
    config: () => readFileSync(capture, "utf8"),
  };
}

test("DEB acquisition passes fixed retries, transport timeouts and strict update policy to APT", (t) => {
  const f = fixture(t, "transient");
  assert.equal(f.run("debs", f.debs).status, 0);
  assert.equal(f.log(), "update\ndownload\nretry\n");
  assert.match(f.config(), /Acquire::Retries "2";/);
  assert.match(f.config(), /Acquire::http::Timeout "20";/);
  assert.match(f.config(), /Acquire::https::Timeout "20";/);
  assert.match(f.config(), /APT::Update::Error-Mode "any";/);
  assert.doesNotMatch(
    f.config(),
    /AllowInsecure|Verify-Peer|Verify-Host|trusted/i,
  );
});

test("a failed index refresh never falls back to downloaded or stale DEBs", (t) => {
  const f = fixture(t, "index");
  assert.notEqual(f.run("debs", f.debs).status, 0);
  assert.equal(f.log(), "update\n");
});

test("sustained DEB acquisition failure is fatal", (t) => {
  const f = fixture(t, "sustained");
  assert.notEqual(f.run("debs", f.debs).status, 0);
  assert.equal(f.log(), "update\ndownload\n");
});

test("Chromium setup fails closed on an index error before installing or downloading", (t) => {
  const f = fixture(t, "index");
  assert.notEqual(f.run("chromium").status, 0);
  assert.equal(f.log(), "playwright install-deps chromium\nupdate\n");
  assert.match(f.config(), /APT::Update::Error-Mode "any";/);
});

test("Chromium setup uses one dependency install and downloads browser as the runner", (t) => {
  const f = fixture(t);
  assert.equal(f.run("chromium").status, 0);
  assert.equal(
    f.log(),
    "playwright install-deps chromium\nupdate\ninstall\nplaywright install chromium\n",
  );
});

test("e2e acquires packages before browser tests and keeps both deployment proofs", () => {
  const workflow = readFileSync(
    path.join(root, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const job = workflow.slice(
    workflow.indexOf("  e2e:"),
    workflow.indexOf("  a11y:"),
  );
  const acquire = job.indexOf(
    'scripts/ci/acquire-ubuntu-ci-deps.sh debs "$RUNNER_TEMP/taskdesk-ubuntu-debs"',
  );
  const browser = job.indexOf("run: pnpm test:e2e");
  const deploy = job.indexOf(
    'run: scripts/ci/run-deploy-real-docker.sh "$RUNNER_TEMP/taskdesk-ubuntu-debs"',
  );
  const shipping = job.indexOf(
    `run: scripts/ci/run-shipping-image-smoke.sh --candidate-sha "\${{ github.event.pull_request.head.sha || github.sha }}"`,
  );
  assert.ok(
    acquire >= 0 && acquire < browser && browser < deploy && deploy < shipping,
  );
  assert.match(
    job,
    /if: \$\{\{ always\(\) && steps\.scope\.outputs\.full != 'false' \}\}\n {8}run: scripts\/ci\/run-deploy-real-docker\.sh/,
  );
  assert.match(
    job,
    /if: \$\{\{ steps\.scope\.outputs\.full != 'false' \}\}\n {8}run: scripts\/ci\/run-shipping-image-smoke\.sh/,
  );
  const runner = readFileSync(
    path.join(root, "scripts/ci/run-deploy-real-docker.sh"),
    "utf8",
  );
  assert.match(runner, /run_suite "runner toolchain"/);
  assert.match(
    runner,
    /run_suite "Ubuntu docker-compose-v2 and docker-buildx"/,
  );
  assert.match(runner, /want_compose=.*deb_version docker-compose-v2/);
  assert.match(runner, /want_buildx=.*deb_version docker-buildx/);
  assert.doesNotMatch(runner, /apt-get/);
});

test("G8 image and locked Playwright version match", () => {
  const workflow = readFileSync(
    path.join(root, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const job = workflow.slice(
    workflow.indexOf("  visual:"),
    workflow.indexOf("  performance:"),
  );
  assert.match(
    job,
    /mcr\.microsoft\.com\/playwright:v1\.63\.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27/,
  );
  const lock = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  assert.match(
    lock,
    /'@playwright\/test':\n\s+specifier: [^\n]+\n\s+version: 1\.63\.0\n/,
  );
  assert.doesNotMatch(
    job,
    /normalize-ubuntu-apt-mirror|acquire-ubuntu-ci-deps|playwright install/,
  );
  assert.match(job, /run: pnpm test:visual/);
});

test("the acquisition deadline is fixed and its failure propagates", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ci-apt-deadline-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "timeout-args");
  const timeout = path.join(dir, "timeout");
  writeFileSync(
    timeout,
    '#!/bin/bash\nprintf "%s\\n" "$@" > "$LOG"\nexit 124\n',
  );
  chmodSync(timeout, 0o755);
  const result = spawnSync(script, ["chromium"], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LOG: log },
    encoding: "utf8",
  });
  assert.equal(result.status, 124);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
    "--kill-after=10s",
    "8m",
    script,
    "--bounded",
    "chromium",
  ]);
});

test("a nonempty DEB directory is rejected before APT runs", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.debs, "stale.deb"), "stale");
  assert.notEqual(f.run("debs", f.debs).status, 0);
  assert.throws(() => f.log(), { code: "ENOENT" });
});
