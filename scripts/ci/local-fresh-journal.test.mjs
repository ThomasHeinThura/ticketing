import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  openFreshJournal,
  readFreshJournal,
} from "../../deploy/local-fresh-journal.mjs";

test("journal persists completed and failed operations and refuses blind retries", (t) => {
  const dir = mkdtempSync(join(os.tmpdir(), "fresh-journal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "journal.json");
  const journal = openFreshJournal(file, { reference: "ref" });
  journal.step("remove-container:a", () => {});
  assert.throws(() =>
    journal.step("remove-volume:b", () => {
      throw new Error("failed");
    }),
  );
  assert.deepEqual(readFreshJournal(file).steps, [
    { name: "remove-container:a", state: "done" },
    { name: "remove-volume:b", state: "failed" },
  ]);
  assert.throws(() => journal.step("start", () => {}), /reconciliation/);
  assert.throws(() => openFreshJournal(file, {}), /journal/);
});
test("unknown journal formats fail closed", (t) => {
  const dir = mkdtempSync(join(os.tmpdir(), "fresh-journal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "journal.json");
  writeFileSync(
    file,
    JSON.stringify({ version: 1, steps: [{ name: "x", state: "unexpected" }] }),
  );
  assert.throws(() => readFreshJournal(file));
});

test("reconciliation refuses unknown or contradictory Docker state", async () => {
  const { reconcileFreshJournal } = await import(
    "../../deploy/local-fresh-journal.mjs"
  );
  const value = {
    steps: [
      { name: "remove-container:a", state: "done" },
      { name: "remove-volume:b", state: "failed" },
    ],
  };
  assert.deepEqual(
    reconcileFreshJournal(value, (name) =>
      name.includes("container") ? "applied" : "not-applied",
    ),
    ["remove-volume:b"],
  );
  assert.throws(() => reconcileFreshJournal(value, () => "unknown"));
  assert.throws(() => reconcileFreshJournal(value, () => "not-applied"));
});

test("resumeFreshJournal promotes applied failed steps, retries pending steps, and find/clear enforce single unfinished invariant", async (t) => {
  const {
    clearFreshJournalAfterRestore,
    findUnfinishedFreshJournal,
    markFreshJournalRestoreStarted,
    resumeFreshJournal,
  } = await import("../../deploy/local-fresh-journal.mjs");
  const { existsSync, mkdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(os.tmpdir(), "fresh-journal-resume-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ref = "2026-11-12T08-00-00-000Z";
  const backup = join(dir, "fresh-backups", ref);
  mkdirSync(backup, { recursive: true });
  const file = join(backup, "journal.json");
  const journal = openFreshJournal(file, { reference: ref });
  journal.step("stop-container:a", () => {});
  assert.throws(() =>
    journal.step("remove-container:a", () => {
      throw new Error("daemon closed");
    }),
  );

  // Daemon actually removed container 'a' before client failed -> promoted to done
  const resumed = resumeFreshJournal(file, () => "applied");
  assert.equal(resumed.pending.length, 0);
  let called = false;
  resumed.step("remove-container:a", () => {
    called = true;
  });
  assert.equal(called, false);

  const found = findUnfinishedFreshJournal(dir);
  assert.equal(found.reference, ref);
  assert.throws(() => findUnfinishedFreshJournal(dir, "../escape"), /Invalid/);

  markFreshJournalRestoreStarted(file);
  assert.throws(
    () => resumeFreshJournal(file, () => "applied"),
    /already in progress/,
  );
  clearFreshJournalAfterRestore(file, "2026-11-12T08:05:00.000Z");
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(join(backup, "journal.restored.json")), true);
  assert.throws(() => findUnfinishedFreshJournal(dir), /No unfinished/);
});
