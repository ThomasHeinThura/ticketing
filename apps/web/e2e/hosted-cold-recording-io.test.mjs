import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createOwnedFile,
  createOwnedTempDirectory,
  finalizeParentOutcome,
  outputTargetIsAbsent,
  readChildFailureReceipt,
  removeOwnedDirectory,
  removeOwnedFile,
  runParentCleanup,
  writeChildFailureReceipt,
} from "./hosted-cold-recording-io.mjs";
import {
  COLD_FAILURE_RECEIPT_PREFIX,
  parseColdFailureReceipt,
  unknownColdFailureReceipt,
} from "./hosted-cold-recording-validation.mjs";

async function privateRoot(t) {
  const path = await mkdtemp(join(tmpdir(), "taskdesk-cold-io-test-"));
  await chmod(path, 0o700);
  t.after(async () => rm(path, { recursive: true, force: true }));
  return path;
}

function knownChildEvidence() {
  const unknown = unknownColdFailureReceipt();
  return {
    counts: {
      ...unknown.counts,
      clockSamples: 3,
      trackedRequests: 2,
      incompleteTrackedRequests: 1,
    },
    flags: {
      ...unknown.flags,
      journeyAssertionsComplete: false,
      traceOverflow: false,
      networkOverflow: false,
      traceDataLoss: false,
      reportPrivacyPassed: false,
    },
  };
}

test("production cleanup preserves a child primary and independently records each real filesystem operation", async (t) => {
  const root = await privateRoot(t);
  const scratch = await createOwnedTempDirectory("taskdesk-cold-child-");
  assert.ok(scratch?.owned && scratch.identity);
  const scratchStat = await lstat(scratch.path);
  assert.equal(scratchStat.mode & 0o777, 0o700);

  const childReportPath = join(scratch.path, "child-report.json");
  const childReport = await createOwnedFile(
    childReportPath,
    "private report bytes",
  );
  assert.equal(childReport.complete, true);
  assert.equal((await lstat(childReportPath)).mode & 0o777, 0o600);
  await rm(childReportPath);
  await mkdir(childReportPath);
  const receiptPath = join(scratch.path, "child-receipt.json");
  const evidence = knownChildEvidence();
  const childWrite = await writeChildFailureReceipt({
    path: receiptPath,
    childReportOwned: childReport.owned,
    primary: { code: "network-clock", stage: "network" },
    ...evidence,
  });
  assert.equal(childWrite.persisted, true);
  assert.equal(childWrite.receipt.cleanup.childReport, "failed");
  assert.equal((await lstat(receiptPath)).mode & 0o777, 0o600);
  const relayed = await readChildFailureReceipt(receiptPath);
  assert.equal(relayed.primary.code, "network-clock");
  assert.equal(relayed.primary.stage, "network");
  assert.equal(relayed.counts.trackedRequests, 2);
  assert.equal(relayed.cleanup.childReport, "failed");

  const generatedSpec = await createOwnedFile(
    join(root, "generated.spec"),
    "spec",
  );
  const generatedConfigPath = join(root, "generated.config");
  const generatedConfig = await createOwnedFile(generatedConfigPath, "config");
  assert.equal(generatedSpec.complete, true);
  assert.equal(generatedConfig.complete, true);
  await rm(generatedConfigPath);
  await mkdir(generatedConfigPath);
  const outputPath = join(root, "report.json");
  const parentReport = await createOwnedFile(outputPath, "validated report");
  assert.equal(parentReport.complete, true);
  const lines = [];
  const result = await finalizeParentOutcome({
    childOutcome: "failed",
    primary: relayed.primary,
    counts: relayed.counts,
    flags: relayed.flags,
    childReport: relayed.cleanup.childReport,
    parentReport: parentReport.owned,
    generatedSpec: generatedSpec.owned,
    generatedConfig: generatedConfig.owned,
    scratch,
    emitLine: async (line) => lines.push(line),
  });

  assert.equal(result.succeeded, false);
  assert.equal(result.receipt.primary.code, "network-clock");
  assert.deepEqual(result.cleanup, {
    childReport: "failed",
    parentReport: "ok",
    generatedSpec: "ok",
    generatedConfig: "failed",
    scratch: "ok",
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].startsWith(COLD_FAILURE_RECEIPT_PREFIX), true);
  const parsed = parseColdFailureReceipt(
    Buffer.from(lines[0].slice(COLD_FAILURE_RECEIPT_PREFIX.length).trim()),
  );
  assert.equal(parsed.primary.code, "network-clock");
  assert.equal(JSON.stringify(parsed).includes(root), false);
  assert.equal(JSON.stringify(parsed).includes("private report"), false);
  await assert.rejects(lstat(receiptPath), { code: "ENOENT" });
  await assert.rejects(lstat(outputPath), { code: "ENOENT" });
  await assert.rejects(lstat(join(root, "generated.spec")), { code: "ENOENT" });
  assert.equal((await lstat(generatedConfigPath)).isDirectory(), true);
  assert.deepEqual(await readdir(generatedConfigPath), []);
  assert.equal(await removeOwnedDirectory(scratch), "ok");
});

test("a successful child followed by cleanup failure removes the owned report and stays nonzero", async (t) => {
  const root = await privateRoot(t);
  const scratch = await createOwnedTempDirectory("taskdesk-cold-success-");
  const specPath = join(root, "spec");
  const spec = await createOwnedFile(specPath, "generated");
  const configPath = join(root, "config");
  const config = await createOwnedFile(configPath, "generated");
  await rm(configPath);
  await mkdir(configPath);
  const reportPath = join(root, "report.json");
  const report = await createOwnedFile(reportPath, "validated report bytes");
  const evidence = knownChildEvidence();
  const flags = {
    ...evidence.flags,
    journeyAssertionsComplete: true,
    reportPrivacyPassed: true,
  };
  const lines = [];
  const result = await finalizeParentOutcome({
    childOutcome: "passed",
    primary: null,
    counts: evidence.counts,
    flags,
    childReport: "not-attempted",
    parentReport: report.owned,
    generatedSpec: spec.owned,
    generatedConfig: config.owned,
    scratch,
    emitLine: async (line) => lines.push(line),
  });
  assert.equal(result.succeeded, false);
  assert.equal(result.receipt.childOutcome, "passed");
  assert.equal(result.receipt.primary, null);
  assert.equal(result.receipt.flags.journeyAssertionsComplete, true);
  assert.equal(result.receipt.flags.reportPrivacyPassed, true);
  assert.equal(result.cleanup.generatedConfig, "failed");
  assert.equal(result.cleanup.parentReport, "ok");
  assert.equal(lines.length, 1);
  await assert.rejects(lstat(reportPath), { code: "ENOENT" });
  assert.equal((await lstat(configPath)).isDirectory(), true);
  await removeOwnedDirectory(scratch);
});

test("clean success preserves the exact owned report and emits no failure receipt", async (t) => {
  const root = await privateRoot(t);
  const scratch = await createOwnedTempDirectory(
    "taskdesk-cold-clean-success-",
  );
  const evidence = knownChildEvidence();
  const reportPath = join(root, "report.json");
  const report = await createOwnedFile(reportPath, "validated report bytes");
  const generatedSpec = await createOwnedFile(
    join(root, "generated.spec"),
    "spec",
  );
  const generatedConfig = await createOwnedFile(
    join(root, "generated.config"),
    "config",
  );
  const lines = [];

  const result = await finalizeParentOutcome({
    childOutcome: "passed",
    primary: null,
    counts: evidence.counts,
    flags: {
      ...evidence.flags,
      journeyAssertionsComplete: true,
      reportPrivacyPassed: true,
    },
    childReport: "not-attempted",
    parentReport: report.owned,
    generatedSpec: generatedSpec.owned,
    generatedConfig: generatedConfig.owned,
    scratch,
    emitLine: async (line) => lines.push(line),
  });

  assert.equal(result.succeeded, true);
  assert.equal(result.receipt, null);
  assert.deepEqual(result.cleanup, {
    childReport: "not-attempted",
    parentReport: "not-attempted",
    generatedSpec: "ok",
    generatedConfig: "ok",
    scratch: "ok",
  });
  assert.deepEqual(lines, []);
  assert.equal(await readFile(reportPath, "utf8"), "validated report bytes");
  assert.equal((await lstat(reportPath)).mode & 0o777, 0o600);
});

test("a real Node child writes one bounded receipt; parent attempts every cleanup and never deletes an unowned directory", async (t) => {
  const root = await privateRoot(t);
  const childSource = `
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createOwnedFile, createOwnedTempDirectory, finalizeParentOutcome, writeChildFailureReceipt } from ${JSON.stringify(new URL("./hosted-cold-recording-io.mjs", import.meta.url).href)};
import { unknownColdFailureReceipt } from ${JSON.stringify(new URL("./hosted-cold-recording-validation.mjs", import.meta.url).href)};
const root = process.argv[1];
const scratch = await createOwnedTempDirectory("taskdesk-cold-subprocess-");
const report = await createOwnedFile(join(scratch.path, "report"), "sensitive");
await rm(report.owned.path);
await mkdir(report.owned.path);
const empty = unknownColdFailureReceipt();
const child = await writeChildFailureReceipt({ path: join(scratch.path, "receipt"), childReportOwned: report.owned, primary: { code: "clock-alignment", stage: "clock" }, counts: { ...empty.counts, clockSamples: 3 }, flags: { ...empty.flags, journeyAssertionsComplete: false } });
const spec = await createOwnedFile(join(root, "spec"), "spec");
const configPath = join(root, "config");
const config = await createOwnedFile(configPath, "config");
await rm(configPath);
await mkdir(configPath);
const parentReport = await createOwnedFile(join(root, "out.json"), "report");
const result = await finalizeParentOutcome({ childOutcome: "failed", primary: child.receipt.primary, counts: child.receipt.counts, flags: child.receipt.flags, childReport: child.receipt.cleanup.childReport, parentReport: parentReport.owned, generatedSpec: spec.owned, generatedConfig: config.owned, scratch, emitLine: (line) => process.stdout.write(line) });
if (result.succeeded) process.exitCode = 0;
else process.exitCode = 1;
`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", childSource, root],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(child.status, 1);
  assert.equal(child.stderr, "");
  assert.equal(child.stdout.split("\n").filter(Boolean).length, 1);
  assert.equal(child.stdout.startsWith(COLD_FAILURE_RECEIPT_PREFIX), true);
  assert.equal(child.stdout.includes(root), false);
  assert.equal(child.stdout.includes("sensitive"), false);
  const receipt = parseColdFailureReceipt(
    Buffer.from(child.stdout.slice(COLD_FAILURE_RECEIPT_PREFIX.length).trim()),
  );
  assert.equal(receipt.primary.code, "clock-alignment");
  assert.deepEqual(receipt.cleanup, {
    childReport: "failed",
    parentReport: "ok",
    generatedSpec: "ok",
    generatedConfig: "failed",
    scratch: "ok",
  });
  await assert.rejects(lstat(join(root, "out.json")), { code: "ENOENT" });
  await assert.rejects(lstat(join(root, "spec")), { code: "ENOENT" });
  assert.equal((await lstat(join(root, "config"))).isDirectory(), true);
});

test("output target and owned-file cleanup fail closed for preexisting files, symlinks, and directories", async (t) => {
  const root = await privateRoot(t);
  const existing = join(root, "existing.json");
  await writeFile(existing, "keep me", { mode: 0o600 });
  assert.equal(await outputTargetIsAbsent(existing), false);
  const notOwned = await createOwnedFile(existing, "replacement");
  assert.equal(notOwned.owned, null);
  assert.equal(await removeOwnedFile(notOwned.owned), "not-attempted");
  assert.equal(await readFile(existing, "utf8"), "keep me");

  const targetDir = join(root, "target-dir");
  await mkdir(targetDir);
  assert.equal(await outputTargetIsAbsent(targetDir), false);
  const linkPath = join(root, "link");
  await symlink(existing, linkPath);
  assert.equal(await outputTargetIsAbsent(linkPath), false);
  assert.equal(await readFile(existing, "utf8"), "keep me");

  const ownedPath = join(root, "owned");
  const owned = await createOwnedFile(ownedPath, "owned");
  await rm(ownedPath);
  await mkdir(ownedPath);
  assert.equal(await removeOwnedFile(owned.owned), "failed");
  assert.equal((await lstat(ownedPath)).isDirectory(), true);
  assert.deepEqual(await readdir(ownedPath), []);
});

test("parent report cleanup never recursively deletes a replaced directory", async (t) => {
  const root = await privateRoot(t);
  const reportPath = join(root, "report.json");
  const report = await createOwnedFile(reportPath, "validated report");
  assert.equal(report.complete, true);
  await rm(reportPath);
  await mkdir(reportPath);
  await writeFile(join(reportPath, "unowned.txt"), "preserve");

  const scratch = await createOwnedTempDirectory(
    "taskdesk-cold-parent-report-",
  );
  const lines = [];
  const result = await finalizeParentOutcome({
    childOutcome: "passed",
    primary: null,
    counts: knownChildEvidence().counts,
    flags: {
      ...knownChildEvidence().flags,
      journeyAssertionsComplete: true,
      reportPrivacyPassed: true,
    },
    childReport: "not-attempted",
    parentReport: report.owned,
    generatedSpec: null,
    generatedConfig: null,
    scratch,
    emitLine: async (line) => lines.push(line),
  });
  assert.equal(result.succeeded, false);
  assert.equal(result.receipt.primary, null);
  assert.equal(result.cleanup.parentReport, "failed");
  assert.equal(lines.length, 1);
  assert.equal(
    await readFile(join(reportPath, "unowned.txt"), "utf8"),
    "preserve",
  );
  await removeOwnedDirectory(scratch);
});

test("invalid, oversized, duplicate-key, and symlink child receipts are inaccessible rather than relayed", async (t) => {
  const root = await privateRoot(t);
  const absent = await readChildFailureReceipt(join(root, "absent"));
  assert.equal(absent, null);

  const receipt = unknownColdFailureReceipt();
  const valid = join(root, "valid");
  await writeFile(valid, JSON.stringify(receipt), { mode: 0o600 });
  assert.equal((await readChildFailureReceipt(valid)).primary.code, "unknown");

  const duplicate = join(root, "duplicate");
  const duplicateBytes = JSON.stringify(receipt).replace(
    '"schemaVersion":2',
    '"schemaVersion":2,"schemaVersion":2',
  );
  await writeFile(duplicate, duplicateBytes, { mode: 0o600 });
  assert.equal(await readChildFailureReceipt(duplicate), null);

  const oversized = join(root, "oversized");
  await writeFile(oversized, " ".repeat(2_049), { mode: 0o600 });
  assert.equal(await readChildFailureReceipt(oversized), null);

  const wrongMode = join(root, "wrong-mode");
  await writeFile(wrongMode, JSON.stringify(receipt), { mode: 0o644 });
  await chmod(wrongMode, 0o644);
  assert.equal(await readChildFailureReceipt(wrongMode), null);

  const link = join(root, "receipt-link");
  await symlink(valid, link);
  assert.equal(await readChildFailureReceipt(link), null);
});

test("all fixed cleanup labels are attempted in order and receipt emission errors reveal no text", async (t) => {
  const root = await privateRoot(t);
  const dir = await createOwnedTempDirectory("taskdesk-cold-cleanup-order-");
  const spec = await createOwnedFile(join(root, "spec"), "spec");
  const config = await createOwnedFile(join(root, "config"), "config");
  const observed = [];
  const cleanup = await runParentCleanup({
    childReport: "ok",
    childOutcome: "failed",
    primary: { code: "unknown", stage: "unknown" },
    generatedSpec: { ...spec.owned, path: join(root, "missing-spec") },
    generatedConfig: config.owned,
    scratch: dir,
  });
  observed.push(...Object.keys(cleanup));
  assert.deepEqual(observed, [
    "childReport",
    "parentReport",
    "generatedSpec",
    "generatedConfig",
    "scratch",
  ]);
  assert.deepEqual(cleanup, {
    childReport: "ok",
    parentReport: "not-attempted",
    generatedSpec: "ok",
    generatedConfig: "ok",
    scratch: "ok",
  });

  const lines = [];
  const empty = unknownColdFailureReceipt();
  const result = await finalizeParentOutcome({
    childOutcome: "unknown",
    primary: { code: "unknown", stage: "unknown" },
    counts: empty.counts,
    flags: empty.flags,
    childReport: "unknown",
    generatedSpec: null,
    generatedConfig: null,
    scratch: null,
    emitLine: async () => {
      throw new Error("/private/path?token=secret");
    },
  });
  lines.push(result.receipt);
  assert.equal(result.succeeded, false);
  assert.equal(lines.length, 1);
  assert.equal(JSON.stringify(lines[0]).includes("private"), false);
  assert.equal(JSON.stringify(lines[0]).includes("secret"), false);
});
