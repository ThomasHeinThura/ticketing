#!/usr/bin/env node
// Canonical SIT selection only. Never source operator environment files as shell code.
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const project = "taskdesk-codex-testing";
const composeFile = resolve("deploy/compose.testing.yml");
const fail = (message) => {
  throw new Error(message);
};
function privatePath(path, directory = false) {
  const stat = lstatSync(path);
  if (
    !isAbsolute(path) ||
    realpathSync(path) !== path ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077 ||
    (directory ? !stat.isDirectory() : !stat.isFile())
  )
    fail(
      "Private recovery configuration must be owner-only, absolute and not symlinked.",
    );
}
function dockerEnvironment() {
  const env = {};
  for (const name of [
    "PATH",
    "HOME",
    "DOCKER_CONFIG",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
  ])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}
function configuration(path) {
  privatePath(path);
  privatePath(dirname(path), true);
  const values = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1]))
      fail("Unsupported private Compose environment syntax.");
    let value = match[2];
    if (/^["']/.test(value)) {
      if (value.at(-1) !== value[0])
        fail("Unsupported private Compose environment syntax.");
      value = value.slice(1, -1);
    }
    if (
      /[$`\\]/.test(value) ||
      [...value].some((char) => char.charCodeAt(0) < 32)
    )
      fail("Private Compose values must be literal; expansions are refused.");
    if (
      ![
        "SIT_PRIVATE_DIR",
        "SIT_IMAGE",
        "SIT_DATABASE_PORT",
        "SIT_HTTP_PORT",
        "SIT_HTTPS_PORT",
        "TASKDESK_IMAGE_TAG",
      ].includes(match[1])
    )
      fail("Private Compose configuration contains an unsupported key.");
    values[match[1]] = value;
  }
  if (!values.SIT_PRIVATE_DIR || !values.SIT_IMAGE)
    fail(
      "Private Compose configuration requires SIT_PRIVATE_DIR and SIT_IMAGE.",
    );
  privatePath(values.SIT_PRIVATE_DIR, true);
  for (const name of ["postgres", "app", "migrate", "valkey"])
    privatePath(join(values.SIT_PRIVATE_DIR, `${name}.env`));
  // Compose interpolation must not inherit ambient SIT/POSTGRES/COMPOSE settings.
  const env = dockerEnvironment();
  Object.assign(env, values);
  // Never allow an env file to redirect Docker or compose discovery.
  for (const key of Object.keys(values))
    if (key.startsWith("DOCKER_") || key.startsWith("COMPOSE_"))
      fail(
        "Private Compose configuration cannot override Docker or Compose selection.",
      );
  return {
    env,
    args: ["compose", "--env-file", path, "-f", composeFile, "-p", project],
  };
}
function docker(args, env) {
  const result = spawnSync("docker", args, {
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    fail(
      "Docker recovery inspection failed; details withheld because they may contain secrets.",
    );
  return result.stdout.trim();
}
function json(args, env) {
  return JSON.parse(docker(args, env));
}
function environment(entries) {
  const result = {};
  for (const entry of entries || []) {
    const index = entry.indexOf("=");
    if (index < 1 || Object.hasOwn(result, entry.slice(0, index)))
      fail("Ambiguous container environment.");
    result[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return result;
}
function volume(mounts, destination, name, writable, source) {
  const overlapping = mounts.filter(
    (mount) =>
      mount.Destination === destination ||
      mount.Destination.startsWith(`${destination}/`) ||
      destination.startsWith(`${mount.Destination}/`),
  );
  if (
    overlapping.length !== 1 ||
    overlapping[0].Destination !== destination ||
    overlapping[0].Type !== "volume" ||
    overlapping[0].Name !== name ||
    overlapping[0].RW !== writable ||
    (source && overlapping[0].Source !== source)
  )
    fail("Canonical SIT volume name or mount layout mismatch.");
}
const databaseExec = (containerId, executable, args) => [
  "exec",
  "-i",
  containerId,
  "env",
  "-i",
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  executable,
  ...args,
];
function pinEndpoint(env, endpoint) {
  if (!endpoint?.startsWith("unix://"))
    fail("Local SIT requires a local Unix Docker endpoint.");
  delete env.DOCKER_CONTEXT;
  env.DOCKER_HOST = endpoint;
}
function identity(path, expected) {
  const { env, args } = configuration(path);
  let endpoint = expected?.dockerEndpoint;
  if (!endpoint) {
    const context = docker(["context", "show"], env);
    const contexts = json(["context", "inspect", context], env);
    endpoint = env.DOCKER_CONTEXT
      ? contexts[0]?.Endpoints?.docker?.Host
      : env.DOCKER_HOST || contexts[0]?.Endpoints?.docker?.Host;
  }
  pinEndpoint(env, endpoint);
  const daemonId = docker(["info", "--format", "{{.ID}}"], env);
  if (!/^[a-zA-Z0-9:-]+$/.test(daemonId))
    fail("Missing Docker daemon identity.");
  const config = json([...args, "config", "--format", "json"], env);
  if (config.name !== project) fail("Canonical SIT Compose project mismatch.");
  const ids = {};
  const containers = {};
  for (const service of ["taskdesk", "postgres"]) {
    const id = docker([...args, "ps", "-a", "-q", service], env);
    if (!/^[a-f0-9]{64}$/.test(id))
      fail("Expected one canonical SIT container per service.");
    const inspected = json(["inspect", id], env);
    const item = inspected[0];
    if (
      inspected.length !== 1 ||
      item.Id !== id ||
      item.Config?.Labels?.["com.docker.compose.project"] !== project ||
      item.Config.Labels["com.docker.compose.service"] !== service ||
      item.Config.Labels["com.docker.compose.project.config_files"] !==
        composeFile ||
      item.Config.Labels["com.docker.compose.oneoff"] !== "False"
    )
      fail("Canonical SIT container identity mismatch.");
    if (!/^sha256:[a-f0-9]{64}$/.test(item.Image))
      fail("Missing container image identity.");
    ids[service] = { containerId: id, imageId: item.Image };
    containers[service] = item;
  }
  if (config.services?.taskdesk?.image !== env.SIT_IMAGE)
    fail("Canonical SIT configured image reference mismatch.");
  const configuredImages = json(["image", "inspect", env.SIT_IMAGE], env);
  if (
    configuredImages.length !== 1 ||
    configuredImages[0].Id !== containers.taskdesk.Image
  )
    fail("Canonical SIT configured image differs from the running image.");
  if (!containers.postgres.State?.Running)
    fail("Canonical SIT PostgreSQL is not running.");
  const layouts = [
    ["taskdesk", "attachments", "/app/data/attachments"],
    ["postgres", "postgres-data", "/var/lib/postgresql"],
  ];
  const volumeIdentities = {};
  for (const [service, key, destination] of layouts) {
    const name = `${project}_${key}`;
    const mounts = config.services?.[service]?.volumes || [];
    const candidates = mounts.filter((mount) => mount.target === destination);
    if (
      candidates.length !== 1 ||
      candidates[0].type !== "volume" ||
      candidates[0].source !== key ||
      config.volumes?.[key]?.name !== name ||
      config.volumes[key].external
    )
      fail("Canonical SIT Compose volume layout mismatch.");
    volume(containers[service].Mounts || [], destination, name, true);
    const inspected = json(["volume", "inspect", name], env);
    if (
      inspected.length !== 1 ||
      inspected[0].Name !== name ||
      inspected[0].Driver !== "local" ||
      (inspected[0].Options && Object.keys(inspected[0].Options).length) ||
      inspected[0].Labels?.["com.docker.compose.project"] !== project ||
      inspected[0].Labels?.["com.docker.compose.volume"] !== key ||
      typeof inspected[0].CreatedAt !== "string" ||
      !inspected[0].CreatedAt ||
      !inspected[0].Mountpoint?.startsWith("/")
    )
      fail("Canonical SIT volume identity mismatch.");
    volume(
      containers[service].Mounts || [],
      destination,
      name,
      true,
      inspected[0].Mountpoint,
    );
    volumeIdentities[service] = {
      source: inspected[0].Mountpoint,
      createdAt: inspected[0].CreatedAt,
    };
  }
  const db = environment(containers.postgres.Config.Env);
  const app = environment(containers.taskdesk.Config.Env);
  for (const values of [db, config.services.postgres.environment || {}])
    if (
      Object.keys(values).some(
        (key) => key.startsWith("PG") && key !== "PGDATA",
      )
    )
      fail("Canonical SIT PostgreSQL libpq environment overrides are refused.");
  for (const key of ["POSTGRES_DB", "POSTGRES_USER"])
    if (
      !/^[a-z_][a-z0-9_]{0,62}$/.test(db[key] || "") ||
      db[key] !== config.services.postgres.environment?.[key]
    )
      fail("Canonical SIT database identity mismatch.");
  if (db.POSTGRES_DB === "taskdesk_browser_journey_1022_test")
    fail("Protected live native database name is refused.");
  const pgdata = db.PGDATA || "/var/lib/postgresql/18/docker";
  if (
    pgdata !== "/var/lib/postgresql/18/docker" ||
    (config.services.postgres.environment?.PGDATA &&
      config.services.postgres.environment.PGDATA !== pgdata)
  )
    fail("Canonical SIT PostgreSQL data layout mismatch.");
  const runningDatabase = json(
    databaseExec(ids.postgres.containerId, "psql", [
      "-h",
      "/var/run/postgresql",
      "-p",
      "5432",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      db.POSTGRES_USER,
      "-d",
      db.POSTGRES_DB,
      "-c",
      "SELECT json_build_object('database', current_database(), 'user', current_user, 'dataDirectory', current_setting('data_directory'), 'systemIdentifier', (pg_control_system()).system_identifier::text)",
    ]),
    env,
  );
  if (
    runningDatabase.database !== db.POSTGRES_DB ||
    runningDatabase.user !== db.POSTGRES_USER ||
    runningDatabase.dataDirectory !== pgdata ||
    !/^[0-9]+$/.test(runningDatabase.systemIdentifier || "")
  )
    fail("Canonical SIT running database identity mismatch.");
  const databaseUrl = app.TASKDESK_DATABASE_URL;
  if (
    !databaseUrl ||
    databaseUrl !== config.services.taskdesk.environment?.TASKDESK_DATABASE_URL
  )
    fail("Canonical SIT application database configuration mismatch.");
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "postgres" ||
    (url.port && url.port !== "5432") ||
    decodeURIComponent(url.pathname.slice(1)) !== db.POSTGRES_DB ||
    url.search ||
    url.hash
  )
    fail("Canonical SIT application database target mismatch.");
  for (const values of [app, config.services.taskdesk.environment])
    if (
      values.TASKDESK_STORAGE_FILESYSTEM_ROOT &&
      values.TASKDESK_STORAGE_FILESYSTEM_ROOT !== "/app/data/attachments"
    )
      fail("Canonical SIT filesystem root mismatch.");
  return {
    schemaVersion: 1,
    target: "local-sit",
    layout: "attachments-root-v1",
    consistency: "unfenced",
    project,
    daemonId,
    dockerEndpoint: endpoint,
    services: ids,
    database: {
      name: db.POSTGRES_DB,
      user: db.POSTGRES_USER,
      volume: `${project}_postgres-data`,
      mount: "/var/lib/postgresql",
      pgdata,
      systemIdentifier: runningDatabase.systemIdentifier,
      ...volumeIdentities.postgres,
    },
    attachments: {
      volume: `${project}_attachments`,
      mount: "/app/data/attachments",
      ...volumeIdentities.taskdesk,
    },
  };
}
function runtime(path, identityPath, action, helperId) {
  const expected = JSON.parse(readFileSync(identityPath, "utf8"));
  const env = dockerEnvironment();
  pinEndpoint(env, expected.dockerEndpoint);
  if (docker(["info", "--format", "{{.ID}}"], env) !== expected.daemonId)
    fail("Canonical SIT Docker daemon identity changed.");
  const stream = (args) => {
    const result = spawnSync("docker", args, { env, stdio: [0, 1, "pipe"] });
    if (result.status !== 0)
      fail(
        "Canonical SIT recovery command failed; private diagnostics withheld.",
      );
  };
  const checkHelper = (id) => {
    const items = json(["inspect", id], env);
    if (
      items.length !== 1 ||
      items[0].Id !== id ||
      items[0].HostConfig?.NetworkMode !== "none" ||
      JSON.stringify(items[0].HostConfig?.VolumesFrom) !==
        JSON.stringify([`${expected.services.taskdesk.containerId}:ro`])
    )
      fail("Canonical SIT attachment helper identity mismatch.");
    volume(
      items[0].Mounts || [],
      expected.attachments.mount,
      expected.attachments.volume,
      false,
      expected.attachments.source,
    );
  };
  if (action === "recheck") {
    if (JSON.stringify(identity(path, expected)) !== JSON.stringify(expected))
      fail("Canonical SIT recovery source identity changed during backup.");
  } else if (action === "dump") {
    stream(
      databaseExec(expected.services.postgres.containerId, "pg_dump", [
        "-h",
        "/var/run/postgresql",
        "-p",
        "5432",
        "-Fc",
        "-U",
        expected.database.user,
        expected.database.name,
      ]),
    );
  } else if (["list", "decode"].includes(action)) {
    stream(
      databaseExec(expected.services.postgres.containerId, "pg_restore", [
        action === "list" ? "--list" : "--file=/dev/null",
      ]),
    );
  } else if (action === "helper-create") {
    const id = docker(
      [
        "create",
        "--network",
        "none",
        "--volumes-from",
        `${expected.services.taskdesk.containerId}:ro`,
        "alpine:3.22",
        "tar",
        "-C",
        expected.attachments.mount,
        "-cf",
        "-",
        ".",
      ],
      env,
    );
    if (!/^[a-f0-9]{64}$/.test(id))
      fail("Canonical SIT attachment helper ID is invalid.");
    try {
      checkHelper(id);
      console.log(id);
    } catch (error) {
      docker(["rm", "-f", id], env);
      throw error;
    }
  } else {
    if (!/^[a-f0-9]{64}$/.test(helperId || ""))
      fail("Canonical SIT attachment helper ID is invalid.");
    if (action === "helper-start") {
      checkHelper(helperId);
      stream(["start", "-a", helperId]);
    } else if (action === "helper-status") {
      if (
        docker(
          ["inspect", "--format", "{{.State.ExitCode}}", helperId],
          env,
        ) !== "0"
      )
        fail("Canonical SIT attachment helper failed.");
    } else if (action === "helper-remove") docker(["rm", "-f", helperId], env);
    else fail("Invalid recovery runtime command.");
  }
}
try {
  const [command, path, ...args] = process.argv.slice(2);
  if (command === "identity" && !args.length)
    console.log(JSON.stringify(identity(path)));
  else if (command === "runtime" && args.length >= 2 && args.length <= 3) {
    runtime(path, ...args);
  } else if (command === "compose") {
    const config = configuration(path);
    const result = spawnSync("docker", [...config.args, ...args], {
      env: config.env,
      stdio: [0, 1, "pipe"],
    });
    if (result.status !== 0)
      fail(
        "Canonical SIT Compose command failed; private diagnostics withheld.",
      );
  } else if (command === "compare" && args.length === 1) {
    const expected = JSON.parse(readFileSync(path, "utf8"));
    const actual = JSON.parse(readFileSync(args[0], "utf8"));
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      fail("Backup source identity does not match the selected target.");
  } else if (command === "field" && args.length === 1) {
    const value = JSON.parse(readFileSync(0, "utf8"))[path]?.[args[0]];
    if (typeof value !== "string") fail("Missing recovery identity field.");
    console.log(value);
  } else fail("Invalid recovery target command.");
} catch (error) {
  // Never print parser errors, paths, Docker output or credentials.
  console.error(
    `xx ${error instanceof Error && /^(Private |Unsupported private|Canonical SIT|Local SIT|Docker recovery|Missing Docker|Expected one|Missing container|Ambiguous container|Protected live|Backup source|Missing recovery|Invalid recovery)/.test(error.message) ? error.message : "Recovery target inspection failed; private diagnostics withheld."}`,
  );
  process.exitCode = 1;
}
