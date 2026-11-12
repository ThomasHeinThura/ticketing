import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readFreshJournal } from "./local-fresh-journal.mjs";

function hasUnfinishedJournal(privateDir) {
  const root = join(realpathSync(privateDir), "fresh-backups");
  if (!existsSync(root)) return false;
  if (!lstatSync(root).isDirectory())
    throw new Error("Backup directory is not a trusted directory.");
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error("Backup inventory contains a symbolic link.");
    if (!entry.isDirectory()) continue;
    if (existsSync(join(root, entry.name, "proof-uncertain"))) return true;
    const file = join(root, entry.name, "journal.json");
    if (existsSync(`${file}.next`)) return true;
    if (!existsSync(file)) continue;
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Recovery journal is not a regular file.");
    const journal = readFreshJournal(file);
    if (
      !journal.steps.some(
        (step) => step.name === "complete" && step.state === "done",
      )
    )
      return true;
  }
  return false;
}

export function inspectFreshLock(
  env,
  { signal = (pid) => process.kill(pid, 0) } = {},
) {
  const directory = `${realpathSync(env.SIT_COMPOSE_ENV)}.lock`;
  if (!existsSync(directory))
    return {
      state: "absent",
      hasJournal: hasUnfinishedJournal(env.SIT_PRIVATE_DIR),
    };
  if (!lstatSync(directory).isDirectory())
    throw new Error("Release lock is not a directory.");
  const ownerFile = join(directory, "owner");
  const info = lstatSync(ownerFile);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Release lock owner is not a regular file.");
  const owner = readFileSync(ownerFile, "utf8");
  const match = /^([1-9]\d*) ([a-f0-9]{64})\n$/.exec(owner);
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new Error("Release lock owner is invalid.");
  const pid = Number(match[1]);
  let dead = false;
  try {
    signal(pid);
  } catch (error) {
    if (error.code === "ESRCH") dead = true;
    else throw new Error("Cannot establish whether lock owner is alive.");
  }
  const hasJournal = hasUnfinishedJournal(env.SIT_PRIVATE_DIR);
  return {
    state: dead ? "stale" : "live",
    pid,
    createdAt: statSync(ownerFile).birthtime.toISOString(),
    hasJournal,
  };
}

export function clearFreshStaleLock(
  env,
  { signal = (pid) => process.kill(pid, 0) } = {},
) {
  const directory = `${realpathSync(env.SIT_COMPOSE_ENV)}.lock`;
  const before = inspectFreshLock(env, { signal });
  if (before.state !== "stale" || before.hasJournal)
    throw new Error(
      "Only a stale lock without an unfinished journal can be cleared.",
    );
  const originalOwner = readFileSync(join(directory, "owner"), "utf8");
  const guard = join(directory, "recovery-claim");
  try {
    mkdirSync(guard, { mode: 0o700 });
  } catch {
    throw new Error("Another recovery operation owns the lock claim.");
  }
  try {
    const again = inspectFreshLock(env, { signal });
    if (
      again.state !== "stale" ||
      again.hasJournal ||
      again.pid !== before.pid ||
      again.createdAt !== before.createdAt ||
      readFileSync(join(directory, "owner"), "utf8") !== originalOwner
    )
      throw new Error("Lock state changed; no lock was cleared.");
    const owner = join(directory, "owner");
    // Refuse unexpected entries instead of removing anything not owned by us.
    const entries = readdirSync(directory).sort();
    if (JSON.stringify(entries) !== JSON.stringify(["owner", "recovery-claim"]))
      throw new Error("Unexpected lock contents; inspect manually.");
    unlinkSync(owner);
  } finally {
    rmdirSync(guard);
  }
  rmdirSync(directory);
  return before;
}

export function claimFreshRecoveryLock(
  env,
  { lock, signal = (pid) => process.kill(pid, 0) },
) {
  const before = inspectFreshLock(env, { signal });
  if (before.state === "live")
    throw new Error("Local release lock owner is still running.");
  if (!before.hasJournal)
    throw new Error("No unfinished recovery journal exists.");
  if (before.state === "absent") return lock(env);
  const directory = `${realpathSync(env.SIT_COMPOSE_ENV)}.lock`;
  const ownerFile = join(directory, "owner");
  const originalOwner = readFileSync(ownerFile, "utf8");
  const guard = join(directory, "recovery-claim");
  try {
    mkdirSync(guard, { mode: 0o700 });
  } catch {
    throw new Error("Another recovery operation owns the lock claim.");
  }
  const token = randomBytes(32).toString("hex");
  const nextOwner = `${process.pid} ${token}\n`;
  try {
    const again = inspectFreshLock(env, { signal });
    if (
      again.state !== "stale" ||
      !again.hasJournal ||
      again.pid !== before.pid ||
      again.createdAt !== before.createdAt ||
      readFileSync(ownerFile, "utf8") !== originalOwner
    )
      throw new Error("Lock state changed; recovery lock was not claimed.");
    const entries = readdirSync(directory).sort();
    if (JSON.stringify(entries) !== JSON.stringify(["owner", "recovery-claim"]))
      throw new Error("Unexpected lock contents; inspect manually.");
    const nextFile = join(directory, "owner.next");
    const fd = openSync(nextFile, "wx", 0o600);
    try {
      writeFileSync(fd, nextOwner);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(nextFile, ownerFile);
    const dirFd = openSync(directory, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } finally {
    rmdirSync(guard);
  }
  return () => {
    try {
      if (readFileSync(ownerFile, "utf8") === nextOwner) {
        unlinkSync(ownerFile);
        rmdirSync(directory);
      }
    } catch {}
  };
}
