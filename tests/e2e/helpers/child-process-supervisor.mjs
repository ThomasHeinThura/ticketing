import { spawn } from "node:child_process";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const lockPath =
  process.argv[2] ?? resolve(tmpdir(), "taskdesk-mfa-csrf-metrics-9464.lock");
const waitMs = Number(process.argv[3] ?? 180_000);
const pollMs = Number(process.argv[4] ?? 100);
const owner = { pid: process.pid, token: `${Date.now()}-${Math.random()}` };
const children = new Map();
let closing = false;
let lockAcquired = false;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function readOwner(path = lockPath) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (
      Number.isSafeInteger(value?.pid) &&
      value.pid > 0 &&
      typeof value.token === "string" &&
      Array.isArray(value.childPids) &&
      value.childPids.every((pid) => Number.isSafeInteger(pid) && pid > 0)
    ) {
      return value;
    }
  } catch {
    // An incomplete lock is not reclaimed based on a guess.
  }
  return undefined;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function unlinkOwnedFile(path, descriptor) {
  try {
    const opened = fstatSync(descriptor);
    const current = statSync(path);
    if (sameFile(opened, current)) unlinkSync(path);
  } catch {
    // The file may already have been removed or replaced by its next owner.
  }
}

function reclaimDeadOwner(ownerToReclaim) {
  if (alive(ownerToReclaim.pid)) return false;

  const reaperPath = `${lockPath}.reap`;
  const reaper = {
    pid: process.pid,
    token: `${owner.token}-reap`,
    childPids: [],
  };
  let descriptor;
  try {
    descriptor = openSync(reaperPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }

  try {
    writeFileSync(descriptor, JSON.stringify(reaper));
    fsyncSync(descriptor);

    // Revalidate the dead owner and file identity while holding the exclusive
    // reaper file. No compliant contender can now unlink a replacement owner.
    if (alive(ownerToReclaim.pid)) return false;
    if (ownerToReclaim.childPids.some(alive)) return false;
    const before = statSync(lockPath);
    const current = readOwner();
    const after = statSync(lockPath);
    if (
      !current ||
      current.pid !== ownerToReclaim.pid ||
      current.token !== ownerToReclaim.token ||
      current.childPids.some(alive) ||
      !sameFile(before, after) ||
      alive(current.pid)
    ) {
      return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch {
    // Missing, malformed, or changed lock state fails closed.
    return false;
  } finally {
    unlinkOwnedFile(reaperPath, descriptor);
    closeSync(descriptor);
  }
}

function writeLock() {
  const fd = openSync(lockPath, "w", 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        ...owner,
        childPids: [...children.values()]
          .map((child) => child.pid)
          .filter(Number.isSafeInteger),
      }),
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

async function acquireLock() {
  const deadline = Date.now() + waitMs;
  while (!lockAcquired) {
    if (!process.connected) {
      throw new Error("The fixture worker exited before acquiring its lock.");
    }
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ ...owner, childPids: [] }));
        fsyncSync(fd);
        lockAcquired = true;
      } finally {
        closeSync(fd);
      }
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      send({ type: "waiting" });
      const current = readOwner();
      if (current && !alive(current.pid)) reclaimDeadOwner(current);
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting for the prior metrics listener supervisor, reaper, or its owned children to exit.",
        );
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
    }
  }
}

function send(message) {
  if (process.connected) process.send(message);
}

function removeChild(id, child, code, signal) {
  if (children.get(id) !== child) return;
  children.delete(id);
  try {
    writeLock();
  } catch {
    // Keep cleanup moving; the supervisor still owns the lock file.
  }
  send({ type: "exit", id, code, signal });
}

function spawnOwned(message) {
  if (
    typeof message.id !== "string" ||
    typeof message.command !== "string" ||
    !Array.isArray(message.args) ||
    typeof message.cwd !== "string" ||
    typeof message.evidenceDir !== "string" ||
    typeof message.logPrefix !== "string"
  ) {
    send({
      type: "spawn-error",
      id: message.id,
      message: "Invalid child request.",
    });
    return;
  }
  const stdoutFd = openSync(
    resolve(message.evidenceDir, `${message.logPrefix}.stdout.log`),
    "wx",
    0o600,
  );
  const stderrFd = openSync(
    resolve(message.evidenceDir, `${message.logPrefix}.stderr.log`),
    "wx",
    0o600,
  );
  let child;
  try {
    child = spawn(message.command, message.args, {
      cwd: message.cwd,
      env: message.env,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  children.set(message.id, child);
  let started = false;
  child.once("spawn", () => {
    started = true;
    try {
      writeLock();
    } catch {
      child.kill("SIGTERM");
    }
    send({ type: "spawned", id: message.id, pid: child.pid });
  });
  child.once("close", (code, signal) =>
    removeChild(message.id, child, code, signal),
  );
  child.once("error", () => {
    if (!started) {
      send({
        type: "spawn-error",
        id: message.id,
        message: "The supervised child process could not start.",
      });
    }
    removeChild(message.id, child, null, null);
  });
}

function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveClose) => child.once("close", resolveClose));
}

async function stopOwnedChildren() {
  const current = [...children.values()];
  for (const child of current) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  let timer;
  const graceful = await Promise.race([
    Promise.all(current.map(waitForClose)).then(() => true),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), 8_000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (!graceful) {
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    await Promise.all([...children.values()].map(waitForClose));
  }
}

function removeOwnedLock() {
  const current = readOwner();
  if (current?.pid === owner.pid && current.token === owner.token) {
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function shutdown() {
  if (closing) return;
  closing = true;
  await stopOwnedChildren();
  removeOwnedLock();
  send({ type: "closed" });
  if (process.connected) process.disconnect();
}

process.on("message", (message) => {
  if (message?.type === "spawn") spawnOwned(message);
  else if (message?.type === "kill") {
    const child = children.get(message.id);
    if (child && ["SIGTERM", "SIGKILL"].includes(message.signal)) {
      child.kill(message.signal);
    }
  } else if (message?.type === "shutdown") {
    void shutdown();
  }
});

process.once("disconnect", () => {
  void shutdown();
});

try {
  await acquireLock();
  send({ type: "ready", pid: process.pid });
} catch (error) {
  send({
    type: "error",
    message:
      error instanceof Error
        ? error.message
        : "Could not acquire fixture lock.",
  });
  if (process.connected) process.disconnect();
}
