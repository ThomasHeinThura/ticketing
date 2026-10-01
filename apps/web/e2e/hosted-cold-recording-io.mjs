import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  COLD_CLEANUP_OPERATIONS,
  COLD_FAILURE_RECEIPT_MAX_BYTES,
  coldCleanupStatuses,
  createColdFailureReceipt,
  formatColdFailureReceiptLine,
  parseColdFailureReceipt,
  unknownColdFailureReceipt,
} from "./hosted-cold-recording-validation.mjs";

function sameIdentity(stat, identity) {
  return Boolean(
    identity && stat.dev === identity.dev && stat.ino === identity.ino,
  );
}

export async function createOwnedTempDirectory(prefix = "taskdesk-g11-cold-") {
  let owned;
  try {
    const path = await mkdtemp(join(tmpdir(), prefix));
    owned = { path, identity: null, owned: true };
    const created = await lstat(path);
    if (!created.isDirectory() || created.isSymbolicLink()) return owned;
    owned.identity = { dev: created.dev, ino: created.ino };
    await chmodDirectoryPrivate(path);
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameIdentity(stat, owned.identity) ||
      (stat.mode & 0o777) !== 0o700
    )
      return owned;
    return owned;
  } catch {
    return owned ?? null;
  }
}

async function chmodDirectoryPrivate(path) {
  await chmod(path, 0o700);
}

export async function createOwnedFile(path, contents) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch {
    return { owned: null, complete: false };
  }
  const owned = { path, identity: null, owned: true };
  let complete = false;
  try {
    const stat = await handle.stat();
    // A successful exclusive open establishes ownership before any write.
    // Keep that identity even if mode verification or a later write fails so
    // finalization can remove only the exact file this invocation created.
    if (stat.isFile()) owned.identity = { dev: stat.dev, ino: stat.ino };
    if (owned.identity && (stat.mode & 0o777) === 0o600) {
      await handle.writeFile(contents);
      await handle.sync();
      complete = true;
    }
  } catch {
    complete = false;
  }
  try {
    await handle.close();
  } catch {
    complete = false;
  }
  return { owned, complete };
}

export async function removeOwnedFile(owned) {
  if (!owned?.owned) return "not-attempted";
  if (!owned.identity) return "failed";
  try {
    const stat = await lstat(owned.path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !sameIdentity(stat, owned.identity)
    )
      return "failed";
    await unlink(owned.path);
    return "ok";
  } catch (error) {
    return error?.code === "ENOENT" ? "ok" : "failed";
  }
}

export async function ownedFileStillPresent(owned) {
  if (!owned?.owned || !owned.identity) return false;
  try {
    const stat = await lstat(owned.path);
    return Boolean(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        sameIdentity(stat, owned.identity) &&
        (stat.mode & 0o777) === 0o600,
    );
  } catch {
    return false;
  }
}

export async function removeOwnedDirectory(owned) {
  if (!owned?.owned) return "not-attempted";
  if (!owned.identity) return "failed";
  try {
    const stat = await lstat(owned.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameIdentity(stat, owned.identity)
    )
      return "failed";
    await rm(owned.path, { recursive: true, force: true });
    return "ok";
  } catch (error) {
    return error?.code === "ENOENT" ? "ok" : "failed";
  }
}

export async function outputTargetIsAbsent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

export async function writeChildFailureReceipt({
  path,
  childReportOwned,
  primary,
  counts,
  flags,
}) {
  const cleanup = coldCleanupStatuses();
  cleanup.childReport = await removeOwnedFile(childReportOwned);
  const receipt = createColdFailureReceipt({
    childOutcome: "failed",
    primary,
    counts,
    flags,
    cleanup,
  });
  const result = await createOwnedFile(path, JSON.stringify(receipt));
  return { receipt, persisted: result.complete };
}

export async function readChildFailureReceipt(path) {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > COLD_FAILURE_RECEIPT_MAX_BYTES
    )
      return null;
    return parseColdFailureReceipt(await readFile(path));
  } catch {
    return null;
  }
}

export async function runParentCleanup({
  childReport = "not-attempted",
  childOutcome,
  primary,
  parentReport,
  generatedSpec,
  generatedConfig,
  scratch,
}) {
  const cleanup = coldCleanupStatuses();
  cleanup.childReport = childReport;
  const steps = [
    ["generatedSpec", () => removeOwnedFile(generatedSpec)],
    ["generatedConfig", () => removeOwnedFile(generatedConfig)],
    ["scratch", () => removeOwnedDirectory(scratch)],
  ];
  for (const [label, operation] of steps) {
    try {
      cleanup[label] = await operation();
    } catch {
      cleanup[label] = "failed";
    }
  }
  if (
    childOutcome === "passed" &&
    primary === null &&
    !cleanupHasFailure(cleanup) &&
    parentReport?.owned &&
    !(await ownedFileStillPresent(parentReport))
  ) {
    cleanup.parentReport = "failed";
  }
  const removeParentReport =
    primary !== null || childOutcome !== "passed" || cleanupHasFailure(cleanup);
  if (removeParentReport && parentReport?.owned) {
    try {
      const removalStatus = await removeOwnedFile(parentReport);
      if (cleanup.parentReport === "not-attempted")
        cleanup.parentReport = removalStatus;
    } catch {
      cleanup.parentReport = "failed";
    }
  }
  return cleanup;
}

export async function finalizeParentOutcome({
  childOutcome,
  primary,
  counts,
  flags,
  childReport,
  parentReport,
  generatedSpec,
  generatedConfig,
  scratch,
  emitLine,
}) {
  let finalPrimary = primary;
  if (childOutcome !== "passed" && finalPrimary === null)
    finalPrimary = { code: "child-exit", stage: "child-start" };
  if (
    childOutcome === "passed" &&
    !parentReport?.owned &&
    finalPrimary === null
  )
    finalPrimary = { code: "report-write", stage: "report-write" };
  const cleanup = await runParentCleanup({
    childReport,
    childOutcome,
    primary: finalPrimary,
    parentReport,
    generatedSpec,
    generatedConfig,
    scratch,
  });
  const failed =
    childOutcome !== "passed" ||
    finalPrimary !== null ||
    cleanupHasFailure(cleanup);
  if (!failed) return { succeeded: true, receipt: null, cleanup };
  const empty = unknownColdFailureReceipt();
  const receipt = createColdFailureReceipt({
    childOutcome,
    primary: finalPrimary,
    counts: counts ?? empty.counts,
    flags: flags ?? empty.flags,
    cleanup,
  });
  try {
    await emitLine(`${formatColdFailureReceiptLine(receipt)}\n`);
  } catch {
    // Keep the process failure nonzero without exposing an I/O error string.
  }
  return { succeeded: false, receipt, cleanup };
}

export async function createReportParent(path) {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    return true;
  } catch {
    return false;
  }
}

export function cleanupHasFailure(cleanup) {
  return COLD_CLEANUP_OPERATIONS.some(
    (operation) => cleanup[operation] === "failed",
  );
}
