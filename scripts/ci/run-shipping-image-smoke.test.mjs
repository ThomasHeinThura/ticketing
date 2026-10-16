import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "run-shipping-image-smoke.sh",
);

const dockerStub = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const stateFile = process.env.FAKE_DOCKER_STATE;
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const out = (value) => process.stdout.write(String(value));
const stop = (code = 1) => process.exit(code);
const format = args.includes("--format") ? args[args.indexOf("--format") + 1] : "";

if (args[0] === "info") { out("x86_64"); stop(0); }
if (args[0] === "build") {
  if (process.env.FAKE_BUILD_FAIL === "1") stop(17);
  const context = args.at(-1);
  state.contextHasCandidate = fs.existsSync(path.join(context, "candidate-tree"));
  state.contextHasMergeOnly = fs.existsSync(path.join(context, "merge-only-tree"));
  const label = args.find((arg) => arg.startsWith("org.taskdesk.ci-run="));
  state.imageLabel = label?.split("=").at(-1);
  state.image = true;
  save();
  stop(0);
}
if (args[0] === "network") {
  const name = args.at(-1);
  if (args[1] === "inspect") {
    if (state.network || process.env.FAKE_FOREIGN_NETWORK === "1") {
      if (format) out(state.networkLabel || "foreign");
      stop(0);
    }
    stop(1);
  }
  if (args[1] === "create") {
    state.network = name;
    state.networkLabel = args.find((arg) => arg.startsWith("org.taskdesk.ci-run="))?.split("=").at(-1);
    save();
    stop(0);
  }
  if (args[1] === "rm") {
    if (process.env.FAKE_NETWORK_RM_FAIL === "1") stop(1);
    state.network = null;
    state.networkRemoved = true;
    save();
    stop(0);
  }
}
if (args[0] === "image" && args[1] === "inspect") {
  const ref = args.at(-1);
  if (!state.image && process.env.FAKE_FOREIGN_IMAGE !== "1") stop(1);
  if (format.includes(".Id")) out(state.image ? "sha256:built" : "sha256:foreign");
  else if (format.includes(".Os")) out("linux");
  else if (format.includes(".Architecture")) out("amd64");
  else if (format.includes(".Config.User")) out("10001:10001");
  else if (format.includes(".Config.Labels")) out(state.imageLabel || "foreign");
  stop(0);
}
if (args[0] === "image" && args[1] === "rm") {
  state.image = false;
  state.imageRemoved = true;
  save();
  stop(0);
}
if (args[0] === "compose") {
  const action = args.find((arg) => ["up", "down", "ps", "exec"].includes(arg));
  if (action === "up") {
    if (process.env.FAKE_BOOT_FAIL === "1") stop(19);
    state.projectStarted = true;
    save();
    stop(0);
  }
  if (action === "down") {
    state.projectDown = true;
    save();
    const proof = process.env.FAKE_PROOF_FILE;
    if (process.env.FAKE_PROOF_MISSING === "1") fs.rmSync(proof, { force: true });
    if (process.env.FAKE_PROOF_UNWRITABLE === "1") {
      fs.rmSync(proof, { force: true });
      fs.mkdirSync(proof);
    }
    if (process.env.FAKE_PROOF_INCOMPLETE === "1") fs.writeFileSync(proof, "{}" + String.fromCharCode(10));
    stop(0);
  }
  if (action === "ps") {
    out(args.includes("migrate") ? "migrate-container" : "taskdesk-container");
    stop(0);
  }
  if (action === "exec") {
    if (args.includes("postgres")) {
      const sql = args.join(" ");
      out(sql.includes("drizzle") ? (process.env.FAKE_MIGRATIONS || "2") : "0");
      stop(0);
    }
    if (args.includes("id")) { out(process.env.FAKE_UID || "10001"); stop(0); }
    if (args.includes("node")) {
      const route = args.at(-1);
      const status = route.endsWith("ready") ? (process.env.FAKE_READY_STATUS || "200") : (process.env.FAKE_LIVE_STATUS || "200");
      out(status);
      stop(status === "200" ? 0 : 1);
    }
  }
}
if (args[0] === "inspect") {
  if (format.includes(".State.ExitCode")) out("0");
  else if (format.includes(".Image")) out(process.env.FAKE_WRONG_RUNNING_IMAGE === "1" ? "sha256:foreign" : "sha256:built");
  else if (format.includes(".HostConfig.PortBindings")) out(process.env.FAKE_PORT_BINDINGS || "null");
  else if (format.includes(".HostConfig.PublishAllPorts")) out("false");
  else if (format.includes(".State.Health.Status")) out(process.env.FAKE_HEALTH || "healthy");
  stop(0);
}
stop(99);`;

async function makeFixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "taskdesk-image-smoke-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const runnerTemp = join(root, "runner-temp");
  const bin = join(root, "bin");
  await mkdir(join(repo, "apps/api/drizzle/meta"), { recursive: true });
  await mkdir(runnerTemp);
  await mkdir(bin);
  await execFileAsync("git", ["init", "-q", repo]);
  await execFileAsync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "test@example.invalid",
  ]);
  await execFileAsync("git", [
    "-C",
    repo,
    "config",
    "user.name",
    "CI smoke fixture",
  ]);
  await writeFile(join(repo, "Dockerfile"), "FROM scratch\n");
  await writeFile(join(repo, "compose.yml"), "services: {}\n");
  await writeFile(
    join(repo, "apps/api/drizzle/meta/_journal.json"),
    JSON.stringify({ entries: [{ tag: "m1" }, { tag: "m2" }] }),
  );
  await writeFile(join(repo, "candidate-tree"), "actual PR head tree\n");
  await execFileAsync("git", ["-C", repo, "add", "."]);
  await execFileAsync("git", ["-C", repo, "commit", "-qm", "candidate head"]);
  const candidateSha = (
    await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])
  ).stdout.trim();
  await writeFile(join(repo, "merge-only-tree"), "synthetic merge-only file\n");
  await execFileAsync("git", ["-C", repo, "add", "."]);
  await execFileAsync("git", [
    "-C",
    repo,
    "commit",
    "-qm",
    "synthetic merge checkout",
  ]);
  const checkoutSha = (
    await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])
  ).stdout.trim();
  assert.notEqual(candidateSha, checkoutSha);

  const dockerPath = join(bin, "docker");
  await writeFile(dockerPath, dockerStub);
  await chmod(dockerPath, 0o755);
  const sleepPath = join(bin, "sleep");
  await writeFile(sleepPath, "#!/bin/sh\nexit 0\n");
  await chmod(sleepPath, 0o755);
  const env = {
    ...process.env,
    GITHUB_SHA: candidateSha,
    RUNNER_TEMP: runnerTemp,
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "2",
    FAKE_DOCKER_STATE: join(root, "docker-state.json"),
    FAKE_PROOF_FILE: join(runnerTemp, "taskdesk-image-proof-12345-2.json"),
    PATH: `${bin}:${process.env.PATH}`,
    ...overrides,
  };
  const proofPathPrefix = join(runnerTemp, "taskdesk-image-proof-12345-2-");
  return {
    root,
    repo,
    runnerTemp,
    candidateSha,
    checkoutSha,
    env,
    proofPathPrefix,
  };
}

async function runSmoke(fixture) {
  try {
    const result = await execFileAsync(
      script,
      ["--candidate-sha", fixture.candidateSha],
      { cwd: fixture.repo, env: fixture.env },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function readProof(fixture) {
  const { readdir } = await import("node:fs/promises");
  const name = (await readdir(fixture.runnerTemp)).find((item) =>
    item.startsWith("taskdesk-image-proof-"),
  );
  assert.ok(name, "proof artifact should be written even when the smoke fails");
  return JSON.parse(await readFile(join(fixture.runnerTemp, name), "utf8"));
}

async function readState(fixture) {
  try {
    return JSON.parse(await readFile(fixture.env.FAKE_DOCKER_STATE, "utf8"));
  } catch {
    return {};
  }
}

test("archives the explicit PR head, binds running services to built image, and records isolated proof", async (t) => {
  const fixture = await makeFixture(t);
  const result = await runSmoke(fixture);
  assert.equal(result.code, 0, result.stderr);
  const proof = await readProof(fixture);
  const state = await readState(fixture);
  assert.equal(proof.candidateSha, fixture.candidateSha);
  assert.equal(proof.checkoutSha, fixture.checkoutSha);
  assert.equal(state.contextHasCandidate, true);
  assert.equal(state.contextHasMergeOnly, false);
  assert.equal(proof.imageId, "sha256:built");
  assert.equal(proof.migrateImageId, "sha256:built");
  assert.equal(proof.taskdeskImageId, "sha256:built");
  assert.equal(proof.migrationJournalEntries, 2);
  assert.equal(proof.appliedMigrations, 2);
  assert.ok(
    (await readFile(script, "utf8")).includes(
      '\\"drizzle\\".\\"__drizzle_migrations\\"',
    ),
  );
  assert.equal(proof.runtimeUid, 10001);
  assert.equal(proof.liveStatus, 200);
  assert.equal(proof.readyStatus, 200);
  assert.deepEqual(proof.hostPortBindings, null);
  assert.equal(proof.cleanup.status, "complete");
  assert.equal(proof.finalVerdict, "passed");
  assert.equal(state.networkRemoved, true);
  assert.equal(state.imageRemoved, true);
  assert.equal(state.projectDown, true);
  const workflow = await readFile(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../.github/workflows/ci-full.yml",
    ),
    "utf8",
  );
  assert.ok(workflow.includes("run-shipping-image-smoke.sh --candidate-sha"));
  assert.ok(
    workflow.includes("github.event.pull_request.head.sha || github.sha"),
  );
});

for (const [name, overrides] of [
  ["build failure", { FAKE_BUILD_FAIL: "1" }],
  ["boot failure", { FAKE_BOOT_FAIL: "1" }],
  ["migration ledger mismatch", { FAKE_MIGRATIONS: "1" }],
  ["wrong running image", { FAKE_WRONG_RUNNING_IMAGE: "1" }],
  ["root runtime UID", { FAKE_UID: "0" }],
  ["unhealthy image", { FAKE_HEALTH: "unhealthy" }],
  ["redirect response", { FAKE_READY_STATUS: "302" }],
  [
    "host port binding",
    {
      FAKE_PORT_BINDINGS:
        '{"5173/tcp":[{"HostIp":"0.0.0.0","HostPort":"5173"}]}',
    },
  ],
]) {
  test(`fails closed on ${name} and cleans only run-owned resources`, async (t) => {
    const fixture = await makeFixture(t, overrides);
    const result = await runSmoke(fixture);
    assert.notEqual(result.code, 0, `${name} unexpectedly passed`);
    const proof = await readProof(fixture);
    const state = await readState(fixture);
    assert.equal(proof.cleanup.status, "complete");
    assert.equal(state.networkRemoved, true);
    if (state.image) assert.equal(state.imageRemoved, true);
  });
}

for (const resource of ["network", "image"]) {
  test(`preserves a pre-existing foreign ${resource} with the generated resource name`, async (t) => {
    const fixture = await makeFixture(t, {
      [resource === "network" ? "FAKE_FOREIGN_NETWORK" : "FAKE_FOREIGN_IMAGE"]:
        "1",
    });
    const result = await runSmoke(fixture);
    assert.notEqual(result.code, 0);
    const state = await readState(fixture);
    assert.equal(state.networkRemoved, undefined);
    assert.equal(state.imageRemoved, undefined);
  });
}

test("cleanup failure fails the smoke and is recorded", async (t) => {
  const fixture = await makeFixture(t, { FAKE_NETWORK_RM_FAIL: "1" });
  const result = await runSmoke(fixture);
  assert.notEqual(result.code, 0);
  const proof = await readProof(fixture);
  assert.equal(proof.cleanup.status, "failed");
  assert.equal(proof.cleanup.networkRemoval, 1);
});

for (const [name, override] of [
  ["missing", { FAKE_PROOF_MISSING: "1" }],
  ["unwritable", { FAKE_PROOF_UNWRITABLE: "1" }],
  ["incomplete", { FAKE_PROOF_INCOMPLETE: "1" }],
]) {
  test(`proof ${name} after cleanup fails an otherwise passing smoke`, async (t) => {
    const fixture = await makeFixture(t, override);
    const result = await runSmoke(fixture);
    assert.notEqual(result.code, 0, `proof ${name} unexpectedly passed`);
    if (name === "missing") {
      const { readdir } = await import("node:fs/promises");
      assert.equal(
        (await readdir(fixture.runnerTemp)).some((item) =>
          item.startsWith("taskdesk-image-proof-"),
        ),
        false,
      );
    } else if (name === "unwritable") {
      const { stat } = await import("node:fs/promises");
      assert.equal(
        (await stat(fixture.env.FAKE_PROOF_FILE)).isDirectory(),
        true,
      );
    } else {
      assert.equal((await readProof(fixture)).finalVerdict, "failed");
    }
  });
}
