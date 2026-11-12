import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  clearFreshStaleLock,
  inspectFreshLock,
} from "../../deploy/local-fresh-lock.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(os.tmpdir(), "fresh-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "compose.env");
  writeFileSync(file, "");
  mkdirSync(`${file}.lock`);
  writeFileSync(join(`${file}.lock`, "owner"), `12345 ${"a".repeat(64)}\n`);
  return {
    env: { SIT_COMPOSE_ENV: file, SIT_PRIVATE_DIR: dir },
    lock: `${file}.lock`,
  };
}
const dead = () => {
  const error = new Error("missing");
  error.code = "ESRCH";
  throw error;
};

test("stale lock without a journal is reported and cleared only explicitly", (t) => {
  const f = fixture(t);
  const state = inspectFreshLock(f.env, { signal: dead });
  assert.equal(state.state, "stale");
  assert.equal(state.pid, 12345);
  assert.equal(state.hasJournal, false);
  assert.equal(existsSync(f.lock), true);
  clearFreshStaleLock(f.env, { signal: dead });
  assert.equal(existsSync(f.lock), false);
});
test("live owners, permission errors and unfinished journals cannot be cleared", (t) => {
  const f = fixture(t);
  assert.throws(() => clearFreshStaleLock(f.env, { signal: () => {} }));
  assert.throws(() =>
    clearFreshStaleLock(f.env, {
      signal: () => {
        const error = new Error("denied");
        error.code = "EPERM";
        throw error;
      },
    }),
  );
  const backup = join(f.env.SIT_PRIVATE_DIR, "fresh-backups", "a");
  mkdirSync(backup, { recursive: true });
  writeFileSync(
    join(backup, "journal.json"),
    JSON.stringify({ version: 1, steps: [{ name: "rm", state: "started" }] }),
  );
  assert.equal(inspectFreshLock(f.env, { signal: dead }).hasJournal, true);
  assert.throws(() => clearFreshStaleLock(f.env, { signal: dead }));
  assert.equal(existsSync(f.lock), true);
});
test("unexpected lock contents are not removed", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.lock, "unknown"), "keep");
  assert.throws(
    () => clearFreshStaleLock(f.env, { signal: dead }),
    /Unexpected/,
  );
  assert.equal(existsSync(join(f.lock, "unknown")), true);
});

test("incomplete journal writes and untrusted backup symlinks block stale lock clearing", (t) => {
  const f = fixture(t);
  const backup = join(f.env.SIT_PRIVATE_DIR, "fresh-backups", "a");
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, "journal.json.next"), "partial");
  assert.equal(inspectFreshLock(f.env, { signal: dead }).hasJournal, true);
  assert.throws(() => clearFreshStaleLock(f.env, { signal: dead }));
  unlinkSync(join(backup, "journal.json.next"));
  symlinkSync(backup, join(f.env.SIT_PRIVATE_DIR, "fresh-backups", "link"));
  assert.throws(
    () => clearFreshStaleLock(f.env, { signal: dead }),
    /symbolic link/,
  );
});

test("malformed owner refuses to inspect or remove the lock", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.lock, "owner"), "12345 invalid\n");
  assert.throws(() => inspectFreshLock(f.env, { signal: dead }), /invalid/);
  assert.throws(() => clearFreshStaleLock(f.env, { signal: dead }));
  assert.equal(existsSync(f.lock), true);
});

test("uncertain proof cleanup prevents stale-lock clearance", (t) => {
  const f = fixture(t);
  const backup = join(f.env.SIT_PRIVATE_DIR, "fresh-backups", "a");
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, "proof-uncertain"), "inspect proof\n");
  assert.equal(inspectFreshLock(f.env, { signal: dead }).hasJournal, true);
  assert.throws(() => clearFreshStaleLock(f.env, { signal: dead }));
});

test("unfinished recovery remains visible when the lock is absent", (t) => {
  const f = fixture(t);
  unlinkSync(join(f.lock, "owner"));
  rmSync(f.lock, { recursive: true });
  const backup = join(f.env.SIT_PRIVATE_DIR, "fresh-backups", "a");
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, "proof-uncertain"), "pending");
  const state = inspectFreshLock(f.env, { signal: dead });
  assert.equal(state.state, "absent");
  assert.equal(state.hasJournal, true);
});

test("claimFreshRecoveryLock atomically takes over stale lock only when unfinished journal exists and releases cleanly", async (t) => {
  const { claimFreshRecoveryLock } = await import(
    "../../deploy/local-fresh-lock.mjs"
  );
  const f = fixture(t);
  // Refuses without unfinished journal
  assert.throws(
    () => claimFreshRecoveryLock(f.env, { lock: () => () => {}, signal: dead }),
    /No unfinished/,
  );
  const backup = join(f.env.SIT_PRIVATE_DIR, "fresh-backups", "ref-1");
  mkdirSync(backup, { recursive: true });
  writeFileSync(
    join(backup, "journal.json"),
    JSON.stringify({
      version: 1,
      reference: "ref-1",
      steps: [{ name: "stop", state: "failed" }],
    }),
  );
  // Refuses live owner
  assert.throws(
    () =>
      claimFreshRecoveryLock(f.env, { lock: () => () => {}, signal: () => {} }),
    /still running/,
  );
  // Claims stale lock and releases on completion
  const release = claimFreshRecoveryLock(f.env, {
    lock: () => () => {},
    signal: dead,
  });
  assert.equal(existsSync(f.lock), true);
  release();
  assert.equal(existsSync(f.lock), false);
});
