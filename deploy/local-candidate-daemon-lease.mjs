// One daemon-wide, stopped-container mutex for every canonical local mutator.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const daemonLeaseName = "taskdesk-codex-testing-selection-lock";
export const hostFenceDirectory = resolve(
  realpathSync("/var/tmp"),
  "taskdesk-codex-testing-bootstrap.lock",
);
const project = "taskdesk-codex-testing";
const fullId = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const fail = () => {
  throw new Error(
    "Local Docker lease or daemon identity is uncertain; stop and inspect before retrying.",
  );
};
const parse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return fail();
  }
};
export function isLocalDockerSocket(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "unix:" &&
      !url.hostname &&
      url.pathname.startsWith("/") &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
const directorySync = (directory) => {
  const fd = openSync(directory, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
function save(file, value) {
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  directorySync(dirname(file));
}
function hostFence({ directory, ownerPid, token, uid = process.getuid() }) {
  const expected = `${uid} ${ownerPid} ${token}\n`;
  const assertOwned = () => {
    if (
      !fullId.test(token || "") ||
      !Number.isInteger(ownerPid) ||
      ownerPid < 1 ||
      uid !== process.getuid()
    )
      fail();
    if (directory === hostFenceDirectory) {
      const parent = lstatSync(dirname(directory));
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        parent.uid !== 0 ||
        (parent.mode & 0o7777) !== 0o1777
      )
        fail();
    }
    const stat = lstatSync(directory);
    const owner = lstatSync(resolve(directory, "owner"));
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== uid ||
      stat.mode & 0o077 ||
      !owner.isFile() ||
      owner.isSymbolicLink() ||
      owner.uid !== uid ||
      owner.nlink !== 1 ||
      owner.mode & 0o077 ||
      readFileSync(resolve(directory, "owner"), "utf8") !== expected
    )
      fail();
  };
  return {
    metadata: { directory, ownerPid, token, uid },
    assertOwned,
    release() {
      assertOwned();
      unlinkSync(resolve(directory, "owner"));
      rmdirSync(directory);
      directorySync(dirname(directory));
    },
    sync() {
      assertOwned();
      const fd = openSync(resolve(directory, "owner"), "r");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      directorySync(directory);
      directorySync(dirname(directory));
    },
  };
}
export function acquireHostBootstrapFence({
  directory = hostFenceDirectory,
  ownerPid = process.pid,
  token = randomBytes(32).toString("hex"),
} = {}) {
  if (!fullId.test(token) || !Number.isInteger(ownerPid) || ownerPid < 1)
    fail();
  if (directory === hostFenceDirectory) {
    const parent = lstatSync(dirname(directory));
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== 0 ||
      (parent.mode & 0o7777) !== 0o1777
    )
      fail();
  }
  // EEXIST is always a fence, including a malformed, stale, or foreign entry.
  mkdirSync(directory, { mode: 0o700 });
  const fd = openSync(resolve(directory, "owner"), "wx", 0o600);
  try {
    writeFileSync(fd, `${process.getuid()} ${ownerPid} ${token}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const handle = hostFence({ directory, ownerPid, token });
  handle.sync();
  return handle;
}
export function borrowHostBootstrapFence({
  directory = hostFenceDirectory,
  ownerPid,
  token,
} = {}) {
  const handle = hostFence({ directory, ownerPid, token });
  handle.assertOwned();
  return handle;
}
function recordedState(stateFile) {
  const read = (file) => {
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.nlink !== 1 ||
      stat.mode & 0o077
    )
      fail();
    return parse(readFileSync(file, "utf8"));
  };
  const intent = read(stateFile);
  const state = read(`${stateFile}.owned`);
  if (
    !["daemon", "host-only"].includes(state.mode) ||
    (state.mode === "daemon"
      ? !imageId.test(state.imageId || "") || !fullId.test(state.id || "")
      : state.imageId !== null || state.id !== null) ||
    !fullId.test(state.token || "") ||
    !Number.isInteger(state.ownerPid) ||
    typeof state.releaseHost !== "boolean" ||
    state.host?.ownerPid !== state.ownerPid ||
    state.host?.token !== state.token ||
    state.host?.uid !== process.getuid() ||
    ["ownerPid", "token", "imageId", "mode", "releaseHost"].some(
      (key) => state[key] !== intent[key],
    ) ||
    JSON.stringify(state.identity) !== JSON.stringify(intent.identity) ||
    JSON.stringify(state.host) !== JSON.stringify(intent.host)
  )
    fail();
  return state;
}

function dockerClient({
  run = spawnSync,
  env = process.env,
  identity = null,
} = {}) {
  const frozenEnv = Object.fromEntries(
    ["PATH", "HOME", "DOCKER_CONFIG", "SSH_AUTH_SOCK"]
      .filter((key) => env[key] !== undefined)
      .map((key) => [key, env[key]]),
  );
  function execute(args, commandEnv) {
    const result = run("docker", args, {
      env: commandEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    if (result.error || result.status !== 0) fail();
    return result.stdout || "";
  }
  if (!identity) {
    const inspectionEnv = { ...frozenEnv };
    for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT"])
      if (env[key] !== undefined) inspectionEnv[key] = env[key];
    if (env.DOCKER_HOST && !isLocalDockerSocket(env.DOCKER_HOST)) fail();
    const context = execute(["context", "show"], inspectionEnv).trim();
    const observed = parse(
      execute(["context", "inspect", context], inspectionEnv),
    );
    if (
      observed.length !== 1 ||
      !isLocalDockerSocket(observed[0].Endpoints?.docker?.Host)
    )
      fail();
    const contextEndpoint = observed[0].Endpoints.docker.Host;
    // An explicit context takes precedence over DOCKER_HOST in Docker's CLI.
    const dockerEndpoint = env.DOCKER_CONTEXT
      ? contextEndpoint
      : env.DOCKER_HOST || contextEndpoint;
    frozenEnv.DOCKER_HOST = dockerEndpoint;
    const daemonId = execute(["info", "--format", "{{.ID}}"], frozenEnv).trim();
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(daemonId)) fail();
    identity = { dockerEndpoint, contextEndpoint, daemonId };
  } else {
    if (
      !isLocalDockerSocket(identity.dockerEndpoint) ||
      !isLocalDockerSocket(identity.contextEndpoint) ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.daemonId)
    )
      fail();
    frozenEnv.DOCKER_HOST = identity.dockerEndpoint;
  }
  const pinned = Object.freeze(structuredClone(identity));
  const assertIdentity = () => {
    if (
      execute(["info", "--format", "{{.ID}}"], frozenEnv).trim() !==
      pinned.daemonId
    )
      fail();
  };
  const command = (args) => {
    if (
      !args.length ||
      args[0].startsWith("-") ||
      args.some(
        (arg) =>
          arg === "--host" ||
          arg.startsWith("--host=") ||
          arg === "-H" ||
          arg === "--context" ||
          arg.startsWith("--context="),
      )
    )
      fail();
    assertIdentity();
    return execute(args, frozenEnv);
  };
  assertIdentity();
  return { identity: pinned, command, assertIdentity };
}

function inspectLease(client, state) {
  const values = parse(client.command(["inspect", state.id]));
  const lease = values[0];
  if (
    values.length !== 1 ||
    lease?.Id !== state.id ||
    lease.Name !== `/${daemonLeaseName}` ||
    lease.Image !== state.imageId ||
    lease.Config?.Image !== state.imageId ||
    lease.Config.Labels?.["info.taskdesk.selection.lease"] !== state.token ||
    lease.Config.Labels?.["info.taskdesk.selection.owner-pid"] !==
      String(state.ownerPid) ||
    lease.Config.Labels?.["com.docker.compose.project"] !== project ||
    lease.State?.Running !== false ||
    lease.HostConfig?.NetworkMode !== "none" ||
    lease.HostConfig.ReadonlyRootfs !== true ||
    lease.HostConfig.Privileged !== false ||
    lease.HostConfig.PublishAllPorts !== false ||
    lease.HostConfig.AutoRemove !== false ||
    !Array.isArray(lease.Mounts) ||
    lease.Mounts.length ||
    (lease.HostConfig.Binds || []).length ||
    (lease.HostConfig.VolumesFrom || []).length ||
    Object.keys(lease.HostConfig.PortBindings || {}).length ||
    JSON.stringify(lease.Config.Entrypoint) !== JSON.stringify(["node"]) ||
    JSON.stringify(lease.Config.Cmd) !==
      JSON.stringify(["-e", "process.exit(0)"]) ||
    JSON.stringify(lease.HostConfig.CapDrop) !== JSON.stringify(["ALL"]) ||
    (lease.HostConfig.CapAdd || []).length ||
    JSON.stringify(lease.HostConfig.SecurityOpt) !==
      JSON.stringify(["no-new-privileges:true"])
  )
    fail();
  return lease;
}

function assertNamedLeaseAbsent(client) {
  if (
    client
      .command([
        "ps",
        "-a",
        "-q",
        "--no-trunc",
        "--filter",
        `name=^/${daemonLeaseName}$`,
      ])
      .trim()
  )
    fail();
}
function guardedClient(client, host) {
  const command = client.command;
  const assertIdentity = client.assertIdentity;
  return {
    identity: client.identity,
    command(args) {
      host.assertOwned();
      return command(args);
    },
    assertIdentity() {
      host.assertOwned();
      assertIdentity();
    },
  };
}
function leaseHandle(client, state, stateFile, host, borrowed = false) {
  const assertOwned = () => {
    client.assertIdentity();
    if (state.mode === "daemon") inspectLease(client, state);
    else assertNamedLeaseAbsent(client);
  };
  assertOwned();
  return {
    identity: client.identity,
    id: state.id,
    token: state.token,
    command: client.command,
    assertIdentity: assertOwned,
    hasMutation() {
      return Boolean(stateFile && existsSync(`${stateFile}.mutation`));
    },
    markMutation(action) {
      assertOwned();
      if (!stateFile) fail();
      if (!existsSync(`${stateFile}.mutation`))
        save(`${stateFile}.mutation`, {
          ownerPid: state.ownerPid,
          token: state.token,
          phase: "mutation-started",
          action,
        });
    },
    release() {
      if (borrowed) return;
      assertOwned();
      if (state.mode === "daemon") client.command(["rm", state.id]);
      assertNamedLeaseAbsent(client);
      if (stateFile) {
        for (const file of [
          `${stateFile}.mutation`,
          `${stateFile}.owned`,
          stateFile,
        ])
          if (existsSync(file)) unlinkSync(file);
        directorySync(dirname(stateFile));
      }
      if (state.releaseHost) host.release();
    },
  };
}

export function acquireDockerDaemonLease({
  run,
  env,
  token = randomBytes(32).toString("hex"),
  ownerPid = process.pid,
  stateFile,
  hostDirectory = hostFenceDirectory,
  hostLease = null,
  allowAppDown = false,
} = {}) {
  if (
    !fullId.test(token) ||
    !Number.isInteger(ownerPid) ||
    ownerPid < 1 ||
    (stateFile && (existsSync(stateFile) || existsSync(`${stateFile}.owned`)))
  )
    fail();
  const ownsHost = !hostLease;
  const host =
    hostLease ||
    acquireHostBootstrapFence({ directory: hostDirectory, ownerPid, token });
  if (host.metadata.ownerPid !== ownerPid || host.metadata.token !== token)
    fail();
  host.assertOwned();
  let createAttempted = false;
  try {
    const client = guardedClient(dockerClient({ run, env }), host);
    // A pre-existing named selector lease remains a fence even on the app-down path.
    assertNamedLeaseAbsent(client);
    const sourceIds = client
      .command([
        "ps",
        ...(allowAppDown ? ["-a"] : []),
        "-q",
        "--no-trunc",
        "--filter",
        `label=com.docker.compose.project=${project}`,
        "--filter",
        "label=com.docker.compose.service=taskdesk",
      ])
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      sourceIds.length > 1 ||
      sourceIds.some((id) => !fullId.test(id)) ||
      (!allowAppDown && sourceIds.length !== 1)
    )
      fail();
    let sourceImage = null;
    if (sourceIds.length) {
      const sources = parse(client.command(["inspect", sourceIds[0]]));
      const source = sources[0];
      if (
        sources.length !== 1 ||
        source.Id !== sourceIds[0] ||
        source.Config?.Labels?.["com.docker.compose.project"] !== project ||
        source.Config.Labels?.["com.docker.compose.service"] !== "taskdesk" ||
        typeof source.State?.Running !== "boolean" ||
        (!allowAppDown && !source.State.Running) ||
        !imageId.test(source.Image || "")
      )
        fail();
      sourceImage = source.Image;
      const images = parse(client.command(["image", "inspect", sourceImage]));
      if (
        images.length !== 1 ||
        images[0].Id !== sourceImage ||
        !images[0].Config ||
        Object.keys(images[0].Config.Volumes || {}).length
      )
        fail();
    }
    const state = {
      mode: sourceImage ? "daemon" : "host-only",
      ownerPid,
      token,
      imageId: sourceImage,
      id: null,
      identity: client.identity,
      host: host.metadata,
      releaseHost: ownsHost,
    };
    if (stateFile)
      save(stateFile, {
        ...state,
        phase: sourceImage ? "creating" : "host-fenced",
      });
    if (sourceImage) {
      createAttempted = true;
      state.id = client
        .command([
          "create",
          "--pull",
          "never",
          "--name",
          daemonLeaseName,
          "--network",
          "none",
          "--read-only",
          "--no-healthcheck",
          "--security-opt",
          "no-new-privileges:true",
          "--cap-drop",
          "ALL",
          "--entrypoint",
          "node",
          "--label",
          `info.taskdesk.selection.lease=${token}`,
          "--label",
          `info.taskdesk.selection.owner-pid=${ownerPid}`,
          "--label",
          `com.docker.compose.project=${project}`,
          sourceImage,
          "-e",
          "process.exit(0)",
        ])
        .trim();
      if (!fullId.test(state.id)) fail();
    }
    const handle = leaseHandle(client, state, stateFile, host);
    if (stateFile) save(`${stateFile}.owned`, state);
    return handle;
  } catch (error) {
    if (ownsHost && !createAttempted && !(stateFile && existsSync(stateFile)))
      host.release();
    throw error;
  }
}
function reopenLease({
  stateFile,
  token,
  ownerPid,
  run,
  env,
  borrowed,
  hostDirectory = hostFenceDirectory,
}) {
  const state = recordedState(stateFile);
  if (
    state.ownerPid !== ownerPid ||
    state.token !== token ||
    state.host.directory !== hostDirectory
  )
    fail();
  const host = borrowHostBootstrapFence(state.host);
  return leaseHandle(
    guardedClient(dockerClient({ run, env, identity: state.identity }), host),
    state,
    stateFile,
    host,
    borrowed,
  );
}
export function borrowDockerDaemonLease(options = {}) {
  if (options.ownerPid !== process.ppid || !fullId.test(options.token || ""))
    fail();
  return reopenLease({ ...options, borrowed: true });
}
export function releaseRecordedDockerDaemonLease(options = {}) {
  return reopenLease({ ...options, borrowed: false }).release();
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  try {
    const [mode, stateFile, rawPid, token] = process.argv.slice(2);
    if (
      !["acquire", "release", "check", "host-check", "mark"].includes(mode) ||
      !stateFile ||
      !token
    )
      fail();
    const ownerPid = Number(rawPid);
    if (ownerPid !== process.ppid) fail();
    if (mode === "host-check") {
      if (stateFile !== hostFenceDirectory) fail();
      borrowHostBootstrapFence({ ownerPid, token }).sync();
    } else if (mode === "acquire") {
      const hostLease = borrowHostBootstrapFence({ ownerPid, token });
      acquireDockerDaemonLease({
        stateFile,
        ownerPid,
        token,
        hostLease,
        allowAppDown: true,
      });
    } else if (mode === "release")
      releaseRecordedDockerDaemonLease({ stateFile, ownerPid, token });
    else if (mode === "mark")
      borrowDockerDaemonLease({ stateFile, ownerPid, token }).markMutation(
        "installer selection",
      );
    else
      borrowDockerDaemonLease({ stateFile, ownerPid, token }).assertIdentity();
  } catch {
    console.error(
      "Local Docker lease stopped; retained ownership evidence requires inspection.",
    );
    process.exitCode = 1;
  }
}
