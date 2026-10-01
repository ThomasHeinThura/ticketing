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
import { dirname, join, relative, resolve, sep } from "node:path";
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
    owned = {
      path,
      identity: null,
      owned: true,
      verifiedPrivate: false,
    };
    const created = await lstat(path);
    if (!created.isDirectory() || created.isSymbolicLink()) return owned;
    owned.identity = { dev: created.dev, ino: created.ino };
    await chmod(path, 0o700);
    await verifyPrivateTempDirectory(owned);
    return owned;
  } catch {
    return owned ?? null;
  }
}

export async function verifyPrivateTempDirectory(owned) {
  if (!owned?.owned || !owned.identity) {
    if (owned) owned.verifiedPrivate = false;
    return false;
  }
  owned.verifiedPrivate = false;
  try {
    const stat = await lstat(owned.path);
    owned.verifiedPrivate = Boolean(
      stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        sameIdentity(stat, owned.identity) &&
        (stat.mode & 0o777) === 0o700,
    );
  } catch {
    owned.verifiedPrivate = false;
  }
  return owned.verifiedPrivate;
}

function isDirectChild(parent, child) {
  if (typeof parent !== "string" || typeof child !== "string") return false;
  const relativePath = relative(resolve(parent), resolve(child));
  return Boolean(
    relativePath &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !relativePath.includes(sep),
  );
}

export async function createOwnedScratchDirectory(scratch, path) {
  if (!isDirectChild(scratch?.path, path))
    return { owned: null, verifiedPrivate: false };
  if (!(await verifyPrivateTempDirectory(scratch)))
    return { owned: null, verifiedPrivate: false };
  try {
    await mkdir(path, { mode: 0o700 });
    const stat = await lstat(path);
    const owned = stat.isDirectory()
      ? {
          path,
          identity: { dev: stat.dev, ino: stat.ino },
          owned: true,
          verifiedPrivate: false,
        }
      : null;
    const verifiedPrivate = Boolean(
      owned &&
        (await verifyPrivateTempDirectory(scratch)) &&
        (await verifyPrivateTempDirectory(owned)),
    );
    return {
      owned,
      verifiedPrivate,
    };
  } catch {
    return { owned: null, verifiedPrivate: false };
  }
}

export async function runWithVerifiedScratch(scratch, scratchOutput, run) {
  if (
    !(await verifyPrivateTempDirectory(scratch)) ||
    !(await verifyPrivateTempDirectory(scratchOutput))
  )
    return { verifiedPrivate: false, started: false, result: undefined };
  const result = await run();
  return { verifiedPrivate: true, started: true, result };
}

export async function createOwnedScratchFile(scratch, path, contents) {
  if (!isDirectChild(scratch?.path, path))
    return { owned: null, complete: false, verifiedPrivate: false };
  if (!(await verifyPrivateTempDirectory(scratch)))
    return { owned: null, complete: false, verifiedPrivate: false };
  const result = await createOwnedFile(path, contents);
  return {
    ...result,
    verifiedPrivate: await verifyPrivateTempDirectory(scratch),
  };
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
  scratch,
  path,
  childReportOwned,
  primary,
  counts,
  flags,
}) {
  if (!isDirectChild(scratch?.path, path))
    return { receipt: null, persisted: false };
  if (!(await verifyPrivateTempDirectory(scratch)))
    return { receipt: null, persisted: false };
  const cleanup = coldCleanupStatuses();
  cleanup.childReport = await removeOwnedFile(childReportOwned);
  const receipt = createColdFailureReceipt({
    childOutcome: "failed",
    primary,
    counts,
    flags,
    cleanup,
  });
  const result = await createOwnedScratchFile(
    scratch,
    path,
    JSON.stringify(receipt),
  );
  return { receipt, persisted: result.complete && result.verifiedPrivate };
}

export async function readChildFailureReceipt(path, scratch) {
  if (!isDirectChild(scratch?.path, path)) return null;
  if (!(await verifyPrivateTempDirectory(scratch))) return null;
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
