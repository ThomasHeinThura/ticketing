// Verdicts of scripts/lib/deploy-checks.sh against a scripted `docker`.
//
// The stub answers with the exact outputs the whole-path diagnosis recorded from real
// Docker CE 29.9 / Compose v5.6.0 / buildx 0.38.0 and from Ubuntu docker.io 29.1.3 /
// Compose 2.40.3 / buildx 0.30.1. scripts/ci/deploy-real-docker.test.mjs runs the same
// helpers against a real engine; this file pins the verdicts on every recorded output,
// including the ones a real engine cannot be made to produce on demand.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const helper = path.join(root, "scripts/lib/deploy-checks.sh");

const FAKE_DOCKER = `#!/usr/bin/env bash
if [[ "$1" == inspect ]]; then
  id="\${@: -1}"
  f="$FAKE_DIR/inspect-$id"
  [[ -f "$f" ]] || { printf 'Error: No such container: %s\\n' "$id" >&2; exit 1; }
  cat "$f"; exit 0
fi
if [[ "$1" == buildx && "$2" == version ]]; then
  [[ "\${FAKE_BUILDX:-present}" == present ]] || { printf 'docker: unknown command: docker buildx\\n' >&2; exit 1; }
  printf 'github.com/docker/buildx v0.30.1\\n'; exit 0
fi
if [[ "$1" == buildx && "$2" == imagetools && "$3" == inspect ]]; then
  # Ubuntu buildx 0.30.1 ignores --format and prints human text with rc 0; so must we, to
  # prove the resolver never depends on it.
  if [[ "$4" != --raw ]]; then
    printf 'Name:      %s\\nMediaType: application/vnd.oci.image.index.v1+json\\nDigest:    sha256:%s\\n' "$4" "$(printf 'x%.0s' {1..64})"
    exit 0
  fi
  case "\${FAKE_RAW_MODE:-bytes}" in
    bytes) printf '%s' "$FAKE_RAW"; exit 0 ;;
    empty) exit 0 ;;
    notfound) printf 'ERROR: %s: not found\\n' "$5" >&2; exit 1 ;;
  esac
fi
exit 3
`;

async function sandbox(t, inspectById = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deploy-checks-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "bin"));
  await writeFile(path.join(dir, "bin/docker"), FAKE_DOCKER);
  await chmod(path.join(dir, "bin/docker"), 0o755);
  for (const [id, line] of Object.entries(inspectById)) {
    await writeFile(path.join(dir, `inspect-${id}`), `${line}\n`);
  }
  return dir;
}

function sh(dir, script, env = {}) {
  return spawnSync(
    "bash",
    ["-c", `set -Eeuo pipefail; . "${helper}"; ${script}`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}/bin:${process.env.PATH}`,
        FAKE_DIR: dir,
        ...env,
      },
    },
  );
}

// template output: NetworkMode|PublishAllPorts|configured ports|live ports
// Real unpublished answer on both toolchains (`NetworkSettings.Ports` is {"5173/tcp":null}).
const UNPUBLISHED = "taskdesk_default|false||";

for (const [label, line, ok] of [
  ["created, unpublished", UNPUBLISHED, true],
  [
    "running, exposed but unpublished (compose port printed :0, rc 0)",
    UNPUBLISHED,
    true,
  ],
  ["stopped, unpublished", UNPUBLISHED, true],
  [
    "created, published (configured binding only)",
    "taskdesk_default|false|5173/tcp |",
    false,
  ],
  ["running, published", "taskdesk_default|false|5173/tcp |5173/tcp ", false],
  [
    "running, published on loopback only",
    "taskdesk_default|false|5173/tcp |5173/tcp ",
    false,
  ],
  [
    "stopped, published (configuration still decides)",
    "taskdesk_default|false|5173/tcp |",
    false,
  ],
  [
    "published on another container port",
    "taskdesk_default|false|8080/tcp |8080/tcp ",
    false,
  ],
  ["ephemeral host port (PublishAllPorts)", "taskdesk_default|true||", false],
  ["network_mode host", "host|false||", false],
  [
    "a shared network stack (network_mode: service:<name> inspects as container:<id>)",
    "container:0123456789abcdef|false||",
    false,
  ],
  [
    "a live port mapping with no configured binding",
    "taskdesk_default|false||5173/tcp ",
    false,
  ],
  [
    "a user network that merely contains the word container",
    "container-net|false||",
    true,
  ],
  ["unparsable answer", "garbage", false],
  ["empty answer", "", false],
]) {
  test(`assert_containers_unpublished: ${label} -> ${ok ? "pass" : "fail"}`, async (t) => {
    const dir = await sandbox(t, { c1: line });
    const r = sh(dir, "assert_containers_unpublished c1");
    assert.equal(r.status === 0, ok, `${r.stdout}${r.stderr}`);
  });
}

test("assert_containers_unpublished: no container id fails closed", async (t) => {
  const dir = await sandbox(t);
  assert.notEqual(sh(dir, "assert_containers_unpublished").status, 0);
  assert.notEqual(sh(dir, 'assert_containers_unpublished ""').status, 0);
});

test("assert_containers_unpublished: an inspect error (unknown id) fails closed", async (t) => {
  const dir = await sandbox(t, { c1: UNPUBLISHED });
  const r = sh(dir, "assert_containers_unpublished c1 missing");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot inspect container missing/);
});

test("assert_containers_unpublished: every replica is checked, not only the first", async (t) => {
  const dir = await sandbox(t, {
    r1: UNPUBLISHED,
    r2: UNPUBLISHED,
    r3: "taskdesk_default|false|5173/tcp |5173/tcp ",
  });
  assert.equal(sh(dir, "assert_containers_unpublished r1 r2").status, 0);
  assert.notEqual(sh(dir, "assert_containers_unpublished r1 r2 r3").status, 0);
});

test("the port verdict never consults `docker compose port`, whatever it prints", async (t) => {
  // Real outputs, rc 0 unless noted: v5.6.0 and 2.40.3 print ":0"; v5.5.1 printed
  // "invalid IP:0"; a port that is not exposed errors with rc 1. The helper is
  // independent of all of them because it never calls compose.
  const dir = await sandbox(t, { c1: UNPUBLISHED });
  assert.equal(sh(dir, "assert_containers_unpublished c1").status, 0);
});

test("container_binds_host_port matches the configured binding only", async (t) => {
  const dir = await sandbox(t, { t1: "8080 " });
  assert.equal(sh(dir, "container_binds_host_port t1 80 8080").status, 0);
  assert.equal(sh(dir, "container_binds_host_port t1 80 08080").status, 0);
  assert.notEqual(sh(dir, "container_binds_host_port t1 80 80").status, 0);
  assert.notEqual(sh(dir, "container_binds_host_port gone 80 8080").status, 0);
  assert.notEqual(sh(dir, 'container_binds_host_port "" 80 8080').status, 0);
});

const RAW =
  '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[]}';
const RAW_DIGEST = `sha256:${createHash("sha256").update(RAW).digest("hex")}`;
const EMPTY_SHA =
  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("resolve_image_digest hashes the raw bytes and ignores --format-less human text", async (t) => {
  const dir = await sandbox(t);
  const r = sh(dir, "resolve_image_digest ghcr.io/x/y:v1", { FAKE_RAW: RAW });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), RAW_DIGEST);
});

for (const [label, env, message] of [
  ["empty output with rc 0", { FAKE_RAW_MODE: "empty" }, /no manifest bytes/],
  [
    "a missing tag (rc 1, error text)",
    { FAKE_RAW_MODE: "notfound" },
    /could not read/,
  ],
  [
    "a missing buildx plugin",
    { FAKE_BUILDX: "absent", FAKE_RAW: RAW },
    /buildx is not installed/,
  ],
]) {
  test(`resolve_image_digest fails closed on ${label}`, async (t) => {
    const dir = await sandbox(t);
    const r = sh(dir, "resolve_image_digest ghcr.io/x/y:v1", env);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, message);
    assert.equal(r.stdout, "");
    assert.notEqual(r.stdout.trim(), EMPTY_SHA);
  });
}
