import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  acquireDaemonProjectLock,
  assertSameDockerDaemon,
  daemonProjectLockPath,
  readDockerDaemonIdentity,
} from "../../deploy/local-fresh-lock.mjs";

const project = "taskdesk-codex-testing";
function fixture(t) {
  const dir = mkdtempSync(join(os.tmpdir(), "daemon-lock-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { daemonId: "daemon-1234", project, lockRoot: join(dir, "locks") };
}
test("lock excludes concurrent users and releases only its own lock", (t) => {
  const opts = fixture(t);
  const release = acquireDaemonProjectLock(opts);
  const path = daemonProjectLockPath(opts);
  assert.throws(() => acquireDaemonProjectLock(opts), /already held/);
  assert.ok(existsSync(path));
  release();
  assert.equal(existsSync(path), false);
});
test("changed lock owner is left untouched for manual inspection", (t) => {
  const opts = fixture(t);
  const release = acquireDaemonProjectLock(opts);
  const path = daemonProjectLockPath(opts);
  const original = readFileSync(join(path, "owner"), "utf8");
  writeFileSync(join(path, "owner"), `1 ${"a".repeat(64)}\n`);
  release();
  assert.ok(existsSync(path));
  assert.notEqual(readFileSync(join(path, "owner"), "utf8"), original);
});
test("lock keys distinguish daemons and reject malformed identifiers", (t) => {
  const opts = fixture(t);
  const first = acquireDaemonProjectLock(opts);
  const second = acquireDaemonProjectLock({ ...opts, daemonId: "daemon-5678" });
  assert.throws(
    () => daemonProjectLockPath({ ...opts, project: "../foreign" }),
    /invalid/,
  );
  first();
  second();
});
test("identity checks daemon, context and socket", () => {
  let daemon = "daemon-1234";
  let endpoint = "unix:///var/run/docker.sock";
  const run = (_bin, args) => ({
    status: 0,
    stdout:
      args[0] === "info"
        ? daemon
        : args[1] === "show"
          ? "default"
          : JSON.stringify([{ Endpoints: { docker: { Host: endpoint } } }]),
  });
  const opts = { env: {}, run };
  const identity = readDockerDaemonIdentity(opts);
  assert.doesNotThrow(() => assertSameDockerDaemon(identity, opts));
  daemon = "daemon-5678";
  assert.throws(() => assertSameDockerDaemon(identity, opts), /changed/);
  daemon = "daemon-1234";
  endpoint = "tcp://example.com:2375";
  assert.throws(
    () => assertSameDockerDaemon(identity, opts),
    /local Unix socket/,
  );
});

test("untrusted lock roots and malformed owners never clear a held lock", (t) => {
  const opts = fixture(t);
  const release = acquireDaemonProjectLock(opts);
  const path = daemonProjectLockPath(opts);
  writeFileSync(join(path, "owner"), "malformed\n");
  release();
  assert.ok(existsSync(path));
  assert.throws(() => acquireDaemonProjectLock(opts), /already held/);
  const link = `${opts.lockRoot}-link`;
  symlinkSync(opts.lockRoot, link);
  assert.throws(
    () => daemonProjectLockPath({ ...opts, lockRoot: link }),
    /trusted directory/,
  );
});
