// The deploy helpers against a REAL Docker engine and the real Compose/buildx plugins.
//
// Why this exists: both installer proof failures (Compose `port` printing `:0` with exit 0,
// buildx printing padded text) were assumptions about tool output that the stub-only tests
// encoded rather than checked. Verdicts here come from real tools.
//
// It runs only when TASKDESK_REAL_DOCKER=1 (ci-full's e2e job sets it). Unset, every test is
// reported as SKIPPED with a reason; set, nothing is skipped and an unreachable engine FAILS.
// TASKDESK_DOCKER_CONFIG (optional) points DOCKER_CONFIG at a directory whose cli-plugins/
// holds a second Compose/buildx toolchain, so one engine is exercised with both.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const helper = path.join(root, "scripts/lib/deploy-checks.sh");
const enabled = process.env.TASKDESK_REAL_DOCKER === "1";
const skip = enabled
  ? false
  : "set TASKDESK_REAL_DOCKER=1 to run against a real Docker engine";
const IMAGE = process.env.TASKDESK_REAL_DOCKER_IMAGE ?? "alpine:3.20";
// A public, signed, immutable release image (sha-<commit> tags are never moved).
const SIGNED_REF =
  process.env.TASKDESK_REAL_SIGNED_REF ??
  "ghcr.io/thomasheinthura/taskdesk:sha-8ddb9de8d4d242a0832f6f91e12872300480a905";
const SIGNED_DIGEST =
  process.env.TASKDESK_REAL_SIGNED_DIGEST ??
  "sha256:3df21d9f8473167fca94aed2c3ab582586c504658c8727164aa8467fff7bced6";
const run_id = `tdreal${process.pid}${Date.now().toString(36)}`;

const env = { ...process.env };
if (process.env.TASKDESK_DOCKER_CONFIG)
  env.DOCKER_CONFIG = process.env.TASKDESK_DOCKER_CONFIG;

function cmd(file, args, options = {}) {
  return spawnSync(file, args, { encoding: "utf8", env, ...options });
}
function docker(...args) {
  return cmd("docker", args);
}
function helperCall(script) {
  return cmd("bash", ["-c", `set -Eeuo pipefail; . "${helper}"; ${script}`]);
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const created = [];
function makeContainer(name, flags, { start = true } = {}) {
  const full = `${run_id}-${name}`;
  const args = [
    start ? "run" : "create",
    ...(start ? ["-d"] : []),
    "--name",
    full,
    ...flags,
    IMAGE,
    "sleep",
    "300",
  ];
  const r = docker(...args);
  assert.equal(r.status, 0, `docker ${args.join(" ")}: ${r.stderr}`);
  created.push(full);
  return r.stdout.trim().split("\n").pop();
}

test.after(() => {
  for (const name of created) docker("rm", "-f", name);
});

test("a real engine, Compose and buildx are reachable", { skip }, () => {
  for (const args of [
    ["info"],
    ["compose", "version"],
    ["buildx", "version"],
  ]) {
    const r = docker(...args);
    assert.equal(r.status, 0, `docker ${args.join(" ")}: ${r.stderr}`);
  }
  // Recorded in the log so a toolchain drift is visible in the run output.
  console.log(
    `compose: ${docker("compose", "version", "--short").stdout.trim()}`,
  );
  console.log(`buildx: ${docker("buildx", "version").stdout.trim()}`);
  const pull = docker("pull", "--quiet", IMAGE);
  assert.equal(pull.status, 0, pull.stderr);
});

const unpublished = [
  ["exposed, not published, running", ["--expose", "5173"], true],
  [
    "exposed, not published, created (never started)",
    ["--expose", "5173"],
    false,
  ],
  ["no ports at all", [], true],
];
for (const [label, flags, start] of unpublished) {
  test(`real engine: ${label} -> pass`, { skip }, () => {
    const id = makeContainer(`u${created.length}`, flags, { start });
    const r = helperCall(`assert_containers_unpublished ${id}`);
    assert.equal(r.status, 0, r.stderr);
  });
}

test("real engine: an exposed, unpublished container then stopped -> pass (configuration decides)", {
  skip,
}, () => {
  const id = makeContainer("stopped", ["--expose", "5173"]);
  assert.equal(docker("stop", "-t", "0", id).status, 0);
  assert.equal(helperCall(`assert_containers_unpublished ${id}`).status, 0);
});

const published = [
  ["published on loopback", ["-p", "127.0.0.1::5173"], true],
  ["published on all interfaces, ephemeral", ["-p", "5173"], true],
  [
    "published on another container port",
    ["-p", "127.0.0.1::8080", "--expose", "5173"],
    true,
  ],
  ["PublishAllPorts", ["--expose", "5173", "-P"], true],
  ["published, created (never started)", ["-p", "127.0.0.1::5173"], false],
  [
    "PublishAllPorts, created (never started)",
    ["--expose", "5173", "-P"],
    false,
  ],
  ["host networking", ["--network", "host"], true],
];
for (const [label, flags, start] of published) {
  test(`real engine: ${label} -> fail`, { skip }, () => {
    const id = makeContainer(`p${created.length}`, flags, { start });
    const r = helperCall(`assert_containers_unpublished ${id}`);
    assert.notEqual(r.status, 0, `expected a refusal for ${label}`);
    assert.match(r.stderr, /publishes|host networking/);
  });
}

test("real engine: no container, an unknown id and a mixed replica set -> fail", {
  skip,
}, () => {
  assert.notEqual(helperCall("assert_containers_unpublished").status, 0);
  assert.notEqual(
    helperCall("assert_containers_unpublished 0000000000000000deadbeef").status,
    0,
  );
  const ok = makeContainer("replica-ok", ["--expose", "5173"]);
  const bad = makeContainer("replica-bad", ["-p", "127.0.0.1::5173"]);
  assert.equal(helperCall(`assert_containers_unpublished ${ok}`).status, 0);
  assert.notEqual(
    helperCall(`assert_containers_unpublished ${ok} ${bad}`).status,
    0,
  );
});

test("real engine: container_binds_host_port reads the configured binding", {
  skip,
}, async () => {
  const host = await freePort();
  const id = makeContainer("binds", ["-p", `127.0.0.1:${host}:80`]);
  assert.equal(
    helperCall(`container_binds_host_port ${id} 80 ${host}`).status,
    0,
  );
  assert.notEqual(
    helperCall(`container_binds_host_port ${id} 80 ${host + 1}`).status,
    0,
  );
  assert.notEqual(
    helperCall(`container_binds_host_port ${id} 443 ${host}`).status,
    0,
  );
});

for (const [label, ports, expectPass] of [
  ["exposed, unpublished service", null, true],
  ["published service", '"127.0.0.1::5173"', false],
]) {
  test(`real Compose project: ${label} -> ${expectPass ? "pass" : "fail"}`, {
    skip,
  }, async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "taskdesk-real-compose-"));
    const project = `${run_id}c${expectPass ? "u" : "p"}`;
    t.after(async () => {
      cmd("docker", [
        "compose",
        "-p",
        project,
        "-f",
        path.join(dir, "compose.yml"),
        "down",
        "-v",
        "-t",
        "0",
      ]);
      await rm(dir, { recursive: true, force: true });
    });
    await writeFile(
      path.join(dir, "compose.yml"),
      [
        "services:",
        "  taskdesk:",
        `    image: ${IMAGE}`,
        "    command: [sleep, '300']",
        '    expose: ["5173"]',
        ...(ports ? [`    ports: [${ports}]`] : []),
        "",
      ].join("\n"),
    );
    const compose = (...a) =>
      cmd("docker", [
        "compose",
        "-p",
        project,
        "-f",
        path.join(dir, "compose.yml"),
        ...a,
      ]);
    // created, never started: the pre-start check deploy.sh runs after `up --no-start`.
    assert.equal(compose("up", "--no-start").status, 0);
    let ids = compose("ps", "-a", "-q", "taskdesk")
      .stdout.trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(ids.length, 1, "compose must list the created container");
    assert.equal(
      helperCall(`assert_containers_unpublished ${ids.join(" ")}`).status === 0,
      expectPass,
    );
    // running
    assert.equal(compose("up", "-d", "--wait").status, 0);
    ids = compose("ps", "-a", "-q", "taskdesk")
      .stdout.trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(
      helperCall(`assert_containers_unpublished ${ids.join(" ")}`).status === 0,
      expectPass,
    );
    // What the old check consumed. Printed, never asserted: its output and exit code are
    // exactly what differs between Compose versions, which is why it is not used.
    const port = compose("port", "taskdesk", "5173");
    console.log(
      `compose port (${label}): rc=${port.status} stdout=${JSON.stringify(port.stdout.trim())} stderr=${JSON.stringify(port.stderr.trim())}`,
    );
  });
}

test("real registry: resolve_image_digest returns the signed image's index digest", {
  skip,
}, () => {
  const r = helperCall(`resolve_image_digest '${SIGNED_REF}'`);
  assert.equal(r.status, 0, r.stderr);
  const digest = r.stdout.trim();
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(digest, SIGNED_DIGEST);
  // Independent oracles: the bytes hashed here in Node, and the human text layout.
  const raw = cmd(
    "docker",
    ["buildx", "imagetools", "inspect", "--raw", SIGNED_REF],
    { encoding: "buffer" },
  );
  assert.equal(raw.status, 0);
  assert.equal(
    `sha256:${createHash("sha256").update(raw.stdout).digest("hex")}`,
    digest,
  );
  const human = docker("buildx", "imagetools", "inspect", SIGNED_REF).stdout;
  assert.equal(
    /^Digest:\s+(sha256:[0-9a-f]{64})\s*$/m.exec(human)?.[1],
    digest,
  );
});

test("real registry: a missing tag fails closed", { skip }, () => {
  const r = helperCall(
    `resolve_image_digest '${SIGNED_REF.replace(/:[^:]+$/, "")}:no-such-tag-${run_id}'`,
  );
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});
