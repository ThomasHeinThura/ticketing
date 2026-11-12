import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const DAEMON_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{3,127}$/;
const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isLocalUnixSocket(value) {
  try {
    const endpoint = new URL(value);
    return (
      endpoint.protocol === "unix:" &&
      !endpoint.hostname &&
      endpoint.pathname.startsWith("/") &&
      !endpoint.search &&
      !endpoint.hash
    );
  } catch {
    return false;
  }
}

export function buildDockerClientEnv(env = process.env, extra = {}) {
  const clientEnv = {
    PATH: env.PATH,
    HOME: env.HOME,
    DOCKER_HOST: env.DOCKER_HOST,
    DOCKER_CONTEXT: env.DOCKER_CONTEXT,
    DOCKER_CONFIG: env.DOCKER_CONFIG,
    SSH_AUTH_SOCK: env.SSH_AUTH_SOCK,
    COMPOSE_DISABLE_ENV_FILE: "1",
    ...extra,
  };
  for (const key of Object.keys(clientEnv)) {
    if (clientEnv[key] === undefined) delete clientEnv[key];
  }
  return clientEnv;
}

export function readDockerDaemonIdentity({
  env = process.env,
  run = spawnSync,
  checkout = process.cwd(),
} = {}) {
  if (env.DOCKER_HOST && !isLocalUnixSocket(env.DOCKER_HOST))
    throw new Error("Docker endpoint must be a local Unix socket.");

  const clientEnv = buildDockerClientEnv(env);
  const execDocker = (argv, label) => {
    const result = run("docker", argv, {
      cwd: checkout,
      env: clientEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    if (result.error || result.status !== 0)
      throw new Error(`${label} failed.`);
    return result.stdout || "";
  };

  const contextName = execDocker(
    ["context", "show"],
    "Docker context inspection",
  ).trim();
  if (!contextName) throw new Error("Docker context could not be determined.");

  let contexts;
  try {
    contexts = JSON.parse(
      execDocker(
        ["context", "inspect", contextName],
        "Docker context inspection",
      ),
    );
  } catch (error) {
    if (error.message === "Docker context inspection failed.") throw error;
    throw new Error("Invalid Docker context inspection.");
  }
  const endpointHost = contexts?.[0]?.Endpoints?.docker?.Host;
  if (
    !Array.isArray(contexts) ||
    contexts.length !== 1 ||
    !isLocalUnixSocket(endpointHost)
  )
    throw new Error("Docker context must use a local Unix socket.");

  const daemonId = execDocker(
    ["info", "--format", "{{.ID}}"],
    "Docker daemon identity inspection",
  ).trim();
  if (!DAEMON_ID_PATTERN.test(daemonId))
    throw new Error("Docker daemon ID could not be verified.");

  return {
    daemonId,
    contextName,
    endpointHost,
    dockerHost: env.DOCKER_HOST ?? "",
    dockerContext: env.DOCKER_CONTEXT ?? "",
    dockerConfig: env.DOCKER_CONFIG ?? "",
  };
}

export function assertSameDockerDaemon(expected, options = {}) {
  const current = readDockerDaemonIdentity(options);
  if (
    !expected ||
    current.daemonId !== expected.daemonId ||
    current.contextName !== expected.contextName ||
    current.endpointHost !== expected.endpointHost ||
    current.dockerHost !== expected.dockerHost ||
    current.dockerContext !== expected.dockerContext ||
    current.dockerConfig !== expected.dockerConfig
  ) {
    throw new Error(
      "Docker daemon or context changed during run; refusing destructive command.",
    );
  }
  return current;
}

export function defaultDaemonLockRoot() {
  return realpathSync("/tmp");
}

function ensureTrustedLockRoot(lockRoot) {
  if (!existsSync(lockRoot))
    mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  const info = lstatSync(lockRoot);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error("Daemon lock root is not a trusted directory.");
  if (lockRoot === defaultDaemonLockRoot()) {
    if (info.uid !== 0 || (info.mode & 0o1002) !== 0o1002)
      throw new Error("Shared lock root is not a root-owned sticky directory.");
  } else {
    if (typeof process.getuid === "function" && info.uid !== process.getuid())
      throw new Error("Daemon lock root is not owned by the current user.");
    if ((info.mode & 0o077) !== 0)
      throw new Error("Daemon lock root permissions are too broad.");
  }
}

export function daemonProjectLockPath({
  daemonId,
  project,
  lockRoot = defaultDaemonLockRoot(),
}) {
  if (!DAEMON_ID_PATTERN.test(String(daemonId || "")))
    throw new Error("Daemon ID is invalid for lock derivation.");
  if (!PROJECT_NAME_PATTERN.test(String(project || "")))
    throw new Error("Compose project name is invalid for lock derivation.");
  ensureTrustedLockRoot(lockRoot);
  const digest = createHash("sha256")
    .update(`${daemonId}\0${project}`)
    .digest("hex")
    .slice(0, 32);
  return join(lockRoot, `taskdesk-sit-${project}-${digest}.lock`);
}

function describeExistingOwner(directory, signal) {
  try {
    const dirInfo = lstatSync(directory);
    if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) return "";
    const ownerFile = join(directory, "owner");
    const ownerInfo = lstatSync(ownerFile);
    if (ownerInfo.isSymbolicLink() || !ownerInfo.isFile()) return "";
    const raw = readFileSync(ownerFile, "utf8");
    const match = /^([1-9]\d*) ([a-f0-9]{64})\n$/.exec(raw);
    if (!match || !Number.isSafeInteger(Number(match[1]))) return "";
    const pid = Number(match[1]);
    try {
      signal(pid);
      return ` by live PID ${pid}`;
    } catch (error) {
      if (error?.code === "ESRCH")
        return ` from dead PID ${pid}; inspect Docker state and remove the lock directory manually`;
      return ` by PID ${pid}`;
    }
  } catch {
    return "";
  }
}

export function acquireDaemonProjectLock({
  daemonId,
  project,
  lockRoot,
  signal = (pid) => process.kill(pid, 0),
}) {
  const directory = daemonProjectLockPath({ daemonId, project, lockRoot });
  const ownerFile = join(directory, "owner");
  const token = randomBytes(32).toString("hex");
  const expectedOwner = `${process.pid} ${token}\n`;

  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch {
    const detail = describeExistingOwner(directory, signal);
    throw new Error(
      `Daemon project lock ${directory} is already held${detail || "; inspect Docker state before retrying"}.`,
    );
  }

  let fd;
  try {
    fd = openSync(ownerFile, "wx", 0o600);
    writeFileSync(fd, expectedOwner);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
    try {
      unlinkSync(ownerFile);
    } catch {}
    try {
      rmdirSync(directory);
    } catch {}
    throw new Error("Daemon project lock could not be initialized.");
  }

  return () => {
    try {
      const dirInfo = lstatSync(directory);
      const fileInfo = lstatSync(ownerFile);
      if (
        !dirInfo.isSymbolicLink() &&
        dirInfo.isDirectory() &&
        !fileInfo.isSymbolicLink() &&
        fileInfo.isFile() &&
        readFileSync(ownerFile, "utf8") === expectedOwner
      ) {
        unlinkSync(ownerFile);
        rmdirSync(directory);
      }
    } catch {
      /* Leave altered or inaccessible lock state for manual inspection. */
    }
  };
}
