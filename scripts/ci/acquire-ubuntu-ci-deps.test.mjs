import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
  const repoCi = path.join(dir, "scripts/ci");
  for (const item of [bin, webBin, debs, repoCi])
    mkdirSync(item, { recursive: true });
  const copied = path.join(repoCi, "acquire-ubuntu-ci-deps.sh");
  writeFileSync(copied, readFileSync(script));
  chmodSync(copied, 0o755);
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
    spawnSync(copied, args, {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        LOG: log,
        CONFIG_CAPTURE: capture,
        FAILURE: failure,
        EXPECTED_SCRIPT: copied,
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

function bundleFixture(t, { verifier = "ok", realVerifier = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ci-apt-bundle-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  const webBin = path.join(dir, "repo/apps/web/node_modules/.bin");
  const debs = path.join(dir, "debs");
  const repoCi = path.join(dir, "repo/scripts/ci");
  for (const item of [bin, webBin, debs, repoCi])
    mkdirSync(item, { recursive: true });
  const copied = path.join(repoCi, "acquire-ubuntu-ci-deps.sh");
  writeFileSync(copied, readFileSync(script));
  chmodSync(copied, 0o755);
  if (realVerifier) {
    for (const name of [
      "verify-ubuntu-ci-bundle.mjs",
      "ubuntu-ci-bundle.manifest.json",
    ])
      writeFileSync(
        path.join(repoCi, name),
        readFileSync(path.join(root, "scripts/ci", name)),
      );
  } else {
    writeFileSync(path.join(repoCi, "ubuntu-ci-bundle.manifest.json"), "{}\n");
    writeFileSync(
      path.join(repoCi, "verify-ubuntu-ci-bundle.mjs"),
      `import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
const [a, archive, m, manifest, d, parent] = process.argv.slice(2);
appendFileSync(process.env.LOG, \`verify \${a} \${path.basename(archive)} \${path.basename(manifest)}\\n\`);
if (process.env.VERIFIER === "fail") { process.stderr.write("Ubuntu CI bundle: archive checksum mismatch\\n"); process.exit(1); }
const out = mkdtempSync(path.join(parent, "ubuntu-ci-bundle-"));
for (const d of ["debs", "docker-debs", "apt-repo"]) mkdirSync(path.join(out, d));
for (const n of ["docker-compose-v2_2_amd64.deb", "docker-buildx_1_amd64.deb"]) writeFileSync(path.join(out, "docker-debs", n), n);
if (process.env.EXTRA_DOCKER) writeFileSync(path.join(out, "docker-debs", "docker-compose-v2_3_amd64.deb"), "x");
const roots = [];
for (let i = 0; i < Number(process.env.ROOT_COUNT ?? 33); i++) roots.push(\`root\${String(i).padStart(2, "0")}\`);
writeFileSync(path.join(out, "playwright-roots.txt"), roots.join("\\n") + "\\n");
writeFileSync(path.join(out, "apt-repo", "Packages"), "");
process.stdout.write(out + "\\n");
`,
    );
  }
  const executable = (file, source) => {
    writeFileSync(file, `#!/bin/bash\nset -eu\n${source}\n`);
    chmodSync(file, 0o755);
  };
  executable(
    path.join(bin, "timeout"),
    `[[ "$1" == --kill-after=10s && "$2" == 8m && "$3" == "$EXPECTED_SCRIPT" && "$4" == --bounded ]] || exit 2
shift 2
exec "$@"`,
  );
  executable(path.join(bin, "sudo"), 'echo "sudo" >> "$LOG"; exec "$@"');
  executable(
    path.join(bin, "apt-get"),
    `[[ "$1" == -c ]]
conf="$2"
shift 2
echo "apt-get $*" >> "$LOG"
echo "$DEBIAN_FRONTEND" > "$LOG.frontend.$1"
cp "$conf" "$LOG.conf.$1"
sed -n 's/^Dir::Etc::sourcelist "\\(.*\\)";$/\\1/p' "$conf" | while read -r list; do cp "$list" "$LOG.sources.$1"; ls "$(dirname "$list")" > "$LOG.work.$1"; done`,
  );
  executable(path.join(webBin, "playwright"), 'echo "playwright $*" >> "$LOG"');
  const log = path.join(dir, "log");
  writeFileSync(log, "");
  const archive = path.join(dir, "bundle.tar");
  writeFileSync(archive, "archive");
  const run = (...args) =>
    spawnSync(copied, args, {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        LOG: log,
        VERIFIER: verifier === "fail" ? "fail" : "ok",
        EXPECTED_SCRIPT: copied,
        ...(verifier === "short" ? { ROOT_COUNT: "32" } : {}),
        ...(verifier === "dockerextra" ? { EXTRA_DOCKER: "1" } : {}),
      },
      encoding: "utf8",
    });
  return {
    run,
    debs,
    archive,
    dir,
    logPath: log,
    log: () => readFileSync(log, "utf8"),
  };
}

test("bundle debs mode copies exactly the two Docker DEBs with no APT call", (t) => {
  const f = bundleFixture(t);
  const result = f.run("--bundle-archive", f.archive, "debs", f.debs);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(f.debs).sort(), [
    "docker-buildx_1_amd64.deb",
    "docker-compose-v2_2_amd64.deb",
  ]);
  assert.equal(
    f.log(),
    "verify --archive bundle.tar ubuntu-ci-bundle.manifest.json\n",
  );
});

test("bundle chromium mode installs only the 33 roots from an isolated verified local repository", (t) => {
  const f = bundleFixture(t);
  const result = f.run("--bundle-archive", f.archive, "chromium");
  assert.equal(result.status, 0, result.stderr);
  const lines = f.log().trim().split("\n");
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^verify /);
  assert.equal(lines[1], "sudo");
  assert.equal(lines[2], "apt-get update -qq");
  assert.equal(lines[3], "sudo");
  const roots = Array.from(
    { length: 33 },
    (_, i) => `root${String(i).padStart(2, "0")}`,
  );
  assert.equal(
    lines[4],
    `apt-get install -y --no-upgrade --no-install-recommends ${roots.join(" ")}`,
  );
  assert.equal(lines[5], "playwright install chromium");
  assert.doesNotMatch(
    f.log(),
    /install-deps|apt-get download|\.deb|--no-download/,
  );
  for (const step of ["update", "install"])
    assert.equal(
      readFileSync(`${f.logPath}.frontend.${step}`, "utf8"),
      "noninteractive\n",
    );
  const config = readFileSync(`${f.logPath}.conf.update`, "utf8");
  for (const line of [
    'APT::Sandbox::User "root";',
    'APT::Get::Allow-Downgrades "false";',
    'APT::Get::Remove "false";',
    'APT::Get::Upgrade "false";',
    'APT::Install-Recommends "false";',
    'APT::Install-Suggests "false";',
  ])
    assert.ok(config.includes(`${line}\n`), line);
  assert.match(config, /^Dir::Etc::sourcelist ".+\/sources\.list";$/m);
  assert.match(config, /^Dir::Etc::sourceparts ".+\/sources\.list\.d";$/m);
  assert.match(config, /^Dir::State::lists ".+\/lists";$/m);
  assert.match(config, /^Dir::Cache::archives ".+\/archives";$/m);
  assert.match(config, /^Dir::Bin::methods ".+\/apt-methods";$/m);
  assert.doesNotMatch(config, /Acquire::|http/);
  assert.equal(readFileSync(`${f.logPath}.conf.install`, "utf8"), config);
  const sources = readFileSync(`${f.logPath}.sources.update`, "utf8");
  assert.match(
    sources,
    /^deb \[trusted=yes\] file:\/.+\/ubuntu-ci-bundle-[^/]+\/apt-repo \.\/\n$/,
  );
  assert.equal(sources.trim().split("\n").length, 1);
});

test("bundle mode fails closed without any network fallback", (t) => {
  for (const mode of [["debs"], ["chromium"]]) {
    const f = bundleFixture(t, { verifier: "fail" });
    const result = f.run(
      "--bundle-archive",
      f.archive,
      ...mode,
      ...(mode[0] === "debs" ? [f.debs] : []),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /archive checksum mismatch/);
    assert.equal(
      f.log(),
      "verify --archive bundle.tar ubuntu-ci-bundle.manifest.json\n",
    );
    assert.deepEqual(readdirSync(f.debs), []);
  }
});

test("bundle mode rejects missing, symlinked or malformed archives and wrong package counts", (t) => {
  const f = bundleFixture(t);
  const link = path.join(f.dir, "link.tar");
  symlinkSync(f.archive, link);
  for (const args of [
    ["--bundle-archive"],
    ["--bundle-archive", path.join(f.dir, "absent.tar"), "chromium"],
    ["--bundle-archive", link, "chromium"],
    ["--bundle-archive", f.dir, "chromium"],
  ])
    assert.notEqual(f.run(...args).status, 0);
  assert.equal(f.log(), "");
  for (const verifier of ["short", "dockerextra"]) {
    const bad = bundleFixture(t, { verifier });
    const mode = verifier === "short" ? ["chromium"] : ["debs", bad.debs];
    assert.equal(bad.run("--bundle-archive", bad.archive, ...mode).status, 1);
    assert.doesNotMatch(bad.log(), /apt-get|playwright/);
    assert.deepEqual(readdirSync(bad.debs), []);
  }
});

test("arguments are validated before bundle verification or any acquisition", (t) => {
  const f = bundleFixture(t);
  for (const args of [
    ["--bundle-archive", f.archive, "chromium", "extra"],
    ["--bundle-archive", f.archive, "debs"],
    ["--bundle-archive", f.archive, "debs", path.join(f.dir, "absent")],
    ["--bundle-archive", f.archive, "other"],
    ["--bundle-archive", f.archive],
  ])
    assert.equal(f.run(...args).status, 2);
  writeFileSync(path.join(f.debs, "stale.deb"), "x");
  assert.equal(f.run("--bundle-archive", f.archive, "debs", f.debs).status, 2);
  assert.equal(f.log(), "");
});

test("bundle mode with the real verifier rejects a bad archive before any APT call", (t) => {
  const f = bundleFixture(t, { realVerifier: true });
  const result = f.run("--bundle-archive", f.archive, "chromium");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Ubuntu CI bundle: /);
  assert.equal(f.log(), "");
});

test("workflows still use the existing APT path until the bundle is approved", () => {
  for (const file of ["ci-fast.yml", "ci-full.yml"])
    assert.doesNotMatch(
      readFileSync(path.join(root, ".github/workflows", file), "utf8"),
      /--bundle-archive/,
    );
});
