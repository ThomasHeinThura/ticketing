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
  writeChildSnapshotReceipt,
  writeValidatedColdReport,
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
    networkClockState: {
      invalidStart: 1,
      terminalNotSeen: 1,
      invalidTerminal: 0,
      notSeenAfterResponse: 0,
      incompleteAfterRedirect: 0,
      unexpectedSameIdReplacement: 0,
      duplicateTerminal: 0,
      unmatchedTrackedEvent: 0,
    },
  };
}

function knownSuccessfulChildEvidence() {
  const unknown = unknownColdFailureReceipt();
  return {
    counts: {
      ...unknown.counts,
      clockSamples: 3,
      traceEventsReceived: 100,
      timelineRecordsRetained: 40,
      trackedRequests: 5,
      incompleteTrackedRequests: 0,
      cpuSamples: 75,
      cpuNodes: 12,
    },
    flags: {
      ...unknown.flags,
      journeyAssertionsComplete: true,
      traceOverflow: false,
      networkOverflow: false,
      traceDataLoss: false,
      reportPrivacyPassed: true,
    },
    networkClockState: {
      invalidStart: 0,
      terminalNotSeen: 0,
      invalidTerminal: 0,
      notSeenAfterResponse: 0,
      incompleteAfterRedirect: 0,
      unexpectedSameIdReplacement: 0,
      duplicateTerminal: 0,
      unmatchedTrackedEvent: 0,
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
    scratch,
    path: receiptPath,
    childReportOwned: childReport.owned,
    primary: { code: "network-clock", stage: "network" },
    ...evidence,
  });
  assert.equal(childWrite.persisted, true);
  assert.equal(childWrite.receipt.cleanup.childReport, "failed");
  assert.equal((await lstat(receiptPath)).mode & 0o777, 0o600);
  const relayed = await readChildFailureReceipt(receiptPath, scratch);
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
    networkClockState: relayed.networkClockState,
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

test("failed private-scratch verification blocks child launch and all scratch data writes in a real subprocess", async (t) => {
  const root = await privateRoot(t);
  const source = `
import { chmod, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createOwnedScratchDirectory, createOwnedScratchFile, createOwnedTempDirectory, finalizeParentOutcome, runWithVerifiedScratch, writeChildFailureReceipt } from ${JSON.stringify(new URL("./hosted-cold-recording-io.mjs", import.meta.url).href)};
const scratch = await createOwnedTempDirectory("taskdesk-cold-private-verify-");
const resultsPath = join(scratch.path, "playwright-results");
const results = await createOwnedScratchDirectory(scratch, resultsPath);
await chmod(scratch.path, 0o755);
const reportPath = join(scratch.path, "report.json");
const receiptPath = join(scratch.path, "receipt.json");
const outputPath = join(resultsPath, "test-output");
let childStarted = false;
const blockedRun = await runWithVerifiedScratch(scratch, results.owned, async () => {
  childStarted = true;
  await createOwnedScratchFile(scratch, outputPath, "test output");
});
const report = await createOwnedScratchFile(scratch, reportPath, "private report");
const empty = { clockSamples: null, traceEventsReceived: null, timelineRecordsRetained: null, trackedRequests: null, incompleteTrackedRequests: null, cpuSamples: null, cpuNodes: null };
const flags = { journeyAssertionsComplete: null, traceOverflow: null, networkOverflow: null, traceDataLoss: null, reportPrivacyPassed: null };
const receipt = await writeChildFailureReceipt({ scratch, path: receiptPath, primary: { code: "unknown", stage: "prepare" }, counts: empty, flags });
const absent = async (path) => { try { await lstat(path); return false; } catch (error) { return error?.code === "ENOENT"; } };
const result = { scratchVerificationFailed: !(await import(${JSON.stringify(new URL("./hosted-cold-recording-io.mjs", import.meta.url).href)}).then((m) => m.verifyPrivateTempDirectory(scratch))), childNotStarted: !childStarted, blockedRun: !blockedRun.verifiedPrivate && !blockedRun.started, reportWriteBlocked: !report.complete && !report.verifiedPrivate, receiptBlocked: receipt.receipt === null && !receipt.persisted, reportAbsent: await absent(reportPath), receiptAbsent: await absent(receiptPath), outputAbsent: await absent(outputPath), resultsEmpty: (await readdir(resultsPath)).length === 0 };
await chmod(scratch.path, 0o700);
const lines = [];
const final = await finalizeParentOutcome({ childOutcome: "not-started", primary: { code: "report-write", stage: "prepare" }, counts: empty, flags, childReport: "unknown", scratch, emitLine: (line) => lines.push(line) });
result.cleanupOk = !final.succeeded && final.receipt.cleanup.scratch === "ok";
result.receiptLineCount = lines.length;
result.receiptLine = lines[0]?.trim() ?? "";
result.scratchRemoved = await absent(scratch.path);
process.stdout.write(JSON.stringify(result));
process.exitCode = Object.entries(result).filter(([key]) => key !== "receiptLine").every(([, value]) => value === true || value === 1) ? 0 : 1;
`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source, root],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(child.status, 0);
  assert.equal(child.stderr, "");
  const childResult = JSON.parse(child.stdout);
  const { receiptLine, ...childEvidence } = childResult;
  assert.deepEqual(childEvidence, {
    scratchVerificationFailed: true,
    childNotStarted: true,
    blockedRun: true,
    reportWriteBlocked: true,
    receiptBlocked: true,
    reportAbsent: true,
    receiptAbsent: true,
    outputAbsent: true,
    resultsEmpty: true,
    cleanupOk: true,
    receiptLineCount: 1,
    scratchRemoved: true,
  });
  assert.equal(receiptLine.startsWith(COLD_FAILURE_RECEIPT_PREFIX), true);
  const failedReceipt = parseColdFailureReceipt(
    Buffer.from(receiptLine.slice(COLD_FAILURE_RECEIPT_PREFIX.length)),
  );
  assert.equal(failedReceipt.primary.code, "report-write");
  assert.equal(failedReceipt.primary.stage, "prepare");
  assert.ok(
    Object.values(failedReceipt.counts).every((value) => value === null),
  );
  assert.deepEqual(failedReceipt.cleanup, {
    childReport: "unknown",
    parentReport: "not-attempted",
    generatedSpec: "not-attempted",
    generatedConfig: "not-attempted",
    scratch: "ok",
  });
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
  const evidence = knownSuccessfulChildEvidence();
  const flags = evidence.flags;
  const lines = [];
  const result = await finalizeParentOutcome({
    childOutcome: "passed",
    primary: null,
    counts: evidence.counts,
    flags,
    networkClockState: evidence.networkClockState,
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

test("successful child snapshot handoff survives only in private cleanup receipt when parent cleanup fails", async (t) => {
  const root = await privateRoot(t);
  const scratch = await createOwnedTempDirectory("taskdesk-cold-snapshot-");
  const { counts, flags, networkClockState } = knownSuccessfulChildEvidence();
  const receiptPath = join(scratch.path, "snapshot-receipt.json");
  const childSnapshot = await writeChildSnapshotReceipt({
    scratch,
    path: receiptPath,
    counts,
    flags,
    networkClockState,
  });
  assert.equal(childSnapshot.persisted, true);
  assert.equal((await lstat(receiptPath)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await readChildFailureReceipt(receiptPath, scratch)).networkClockState,
    networkClockState,
  );

  const reportPath = join(root, "report.json");
  const report = await createOwnedFile(reportPath, "validated report bytes");
  const spec = await createOwnedFile(join(root, "generated.spec"), "spec");
  const configPath = join(root, "generated.config");
  const config = await createOwnedFile(configPath, "config");
  await rm(configPath);
  await mkdir(configPath);
  const lines = [];
  const final = await finalizeParentOutcome({
    childOutcome: "passed",
    primary: null,
    counts,
    flags,
    networkClockState: childSnapshot.receipt.networkClockState,
    childReport: "not-attempted",
    parentReport: report.owned,
    generatedSpec: spec.owned,
    generatedConfig: config.owned,
    scratch,
    emitLine: (line) => lines.push(line),
  });
  assert.equal(final.succeeded, false);
  assert.equal(final.receipt.primary, null);
  assert.deepEqual(final.receipt.networkClockState, networkClockState);
  assert.equal(final.receipt.cleanup.generatedConfig, "failed");
  assert.equal(lines.length, 1);
  const parsed = parseColdFailureReceipt(
    Buffer.from(lines[0].slice(COLD_FAILURE_RECEIPT_PREFIX.length).trim()),
  );
  assert.deepEqual(parsed.networkClockState, networkClockState);
  assert.equal(JSON.stringify(parsed).includes(root), false);
  await assert.rejects(lstat(reportPath), { code: "ENOENT" });
});

test("production passed-handoff writer rejects incomplete, zero-request, anomalous, missing-state, and unsuccessful evidence", async (t) => {
  const scratch = await createOwnedTempDirectory(
    "taskdesk-cold-invalid-success-",
  );
  t.after(async () => removeOwnedDirectory(scratch));
  const evidence = knownSuccessfulChildEvidence();
  const invalid = [
    {
      ...evidence,
      counts: { ...evidence.counts, incompleteTrackedRequests: 1 },
      networkClockState: {
        ...evidence.networkClockState,
        invalidStart: 1,
      },
    },
    {
      ...evidence,
      counts: {
        ...evidence.counts,
        trackedRequests: 0,
      },
    },
    {
      ...evidence,
      networkClockState: {
        ...evidence.networkClockState,
        unmatchedTrackedEvent: 1,
      },
    },
    {
      ...evidence,
      flags: { ...evidence.flags, traceDataLoss: true },
    },
  ];
  for (let index = 0; index < invalid.length; index += 1) {
    const path = join(scratch.path, `invalid-${index}.json`);
    await assert.rejects(
      writeChildSnapshotReceipt({
        scratch,
        path,
        ...invalid[index],
      }),
    );
    await assert.rejects(lstat(path), { code: "ENOENT" });
  }
  const missingPath = join(scratch.path, "missing-state.json");
  const missing = await writeChildSnapshotReceipt({
    scratch,
    path: missingPath,
    ...evidence,
    networkClockState: null,
  });
  assert.deepEqual(missing, { receipt: null, persisted: false });
  await assert.rejects(lstat(missingPath), { code: "ENOENT" });
});

test("parent publication writer refuses mismatched or missing handoff evidence and writes only a matching report", async (t) => {
  const root = await privateRoot(t);
  const evidence = knownSuccessfulChildEvidence();
  const scratch = await createOwnedTempDirectory(
    "taskdesk-cold-publication-handoff-",
  );
  t.after(async () => removeOwnedDirectory(scratch));
  const handoff = await writeChildSnapshotReceipt({
    scratch,
    path: join(scratch.path, "receipt.json"),
    ...evidence,
  });
  assert.equal(handoff.persisted, true);
  const passedReceipt = handoff.receipt;
  const report = {
    resources: Array.from({ length: 5 }, () => ({})),
    clocks: {
      traceEventCount: 100,
      timelineRecordCount: 40,
      cpuSamples: 75,
      dataLoss: false,
    },
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  const mismatchPath = join(root, "mismatch.json");
  const mismatch = await writeValidatedColdReport({
    path: mismatchPath,
    report,
    reportBytes,
    handoff: {
      ...passedReceipt,
      counts: { ...passedReceipt.counts, trackedRequests: 4 },
    },
  });
  assert.equal(mismatch.handoffMatches, false);
  await assert.rejects(lstat(mismatchPath), { code: "ENOENT" });
  const byteMismatchPath = join(root, "byte-mismatch.json");
  const byteMismatch = await writeValidatedColdReport({
    path: byteMismatchPath,
    report,
    reportBytes: Buffer.from("{}"),
    handoff: passedReceipt,
  });
  assert.equal(byteMismatch.handoffMatches, false);
  await assert.rejects(lstat(byteMismatchPath), { code: "ENOENT" });
  const missingPath = join(root, "missing.json");
  const missing = await writeValidatedColdReport({
    path: missingPath,
    report,
    reportBytes,
    handoff: { ...passedReceipt, networkClockState: null },
  });
  assert.equal(missing.handoffMatches, false);
  await assert.rejects(lstat(missingPath), { code: "ENOENT" });
  const successPath = join(root, "success.json");
  const success = await writeValidatedColdReport({
    path: successPath,
    report,
    reportBytes,
    handoff: passedReceipt,
  });
  assert.equal(success.handoffMatches, true);
  assert.equal(success.complete, true);
  assert.equal((await lstat(successPath)).mode & 0o777, 0o600);
  await removeOwnedFile(success.owned);
  await assert.rejects(lstat(successPath), { code: "ENOENT" });
});

test("clean success preserves the exact owned report and emits no failure receipt", async (t) => {
  const root = await privateRoot(t);
  const scratch = await createOwnedTempDirectory(
    "taskdesk-cold-clean-success-",
  );
  const evidence = knownSuccessfulChildEvidence();
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
    flags: evidence.flags,
    networkClockState: evidence.networkClockState,
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
const child = await writeChildFailureReceipt({ scratch, path: join(scratch.path, "receipt"), childReportOwned: report.owned, primary: { code: "clock-alignment", stage: "clock" }, counts: { ...empty.counts, clockSamples: 3 }, flags: { ...empty.flags, journeyAssertionsComplete: false } });
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
    ...knownSuccessfulChildEvidence(),
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
  const receiptScratch = await createOwnedTempDirectory(
    "taskdesk-cold-invalid-receipt-",
  );
  t.after(async () => removeOwnedDirectory(receiptScratch));
  const absent = await readChildFailureReceipt(
    join(receiptScratch.path, "absent"),
    receiptScratch,
  );
  assert.equal(absent, null);

  const receipt = unknownColdFailureReceipt();
  const valid = join(receiptScratch.path, "valid");
  await writeFile(valid, JSON.stringify(receipt), { mode: 0o600 });
  assert.equal(
    (await readChildFailureReceipt(valid, receiptScratch)).primary.code,
    "unknown",
  );

  const duplicate = join(receiptScratch.path, "duplicate");
  const duplicateBytes = JSON.stringify(receipt).replace(
    '"schemaVersion":3',
    '"schemaVersion":3,"schemaVersion":3',
  );
  await writeFile(duplicate, duplicateBytes, { mode: 0o600 });
  assert.equal(await readChildFailureReceipt(duplicate, receiptScratch), null);

  const oversized = join(receiptScratch.path, "oversized");
  await writeFile(oversized, " ".repeat(2_049), { mode: 0o600 });
  assert.equal(await readChildFailureReceipt(oversized, receiptScratch), null);

  const wrongMode = join(receiptScratch.path, "wrong-mode");
  await writeFile(wrongMode, JSON.stringify(receipt), { mode: 0o644 });
  await chmod(wrongMode, 0o644);
  assert.equal(await readChildFailureReceipt(wrongMode, receiptScratch), null);

  const link = join(receiptScratch.path, "receipt-link");
  await symlink(valid, link);
  assert.equal(await readChildFailureReceipt(link, receiptScratch), null);
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
