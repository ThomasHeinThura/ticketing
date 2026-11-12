#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = "taskdesk-codex-testing";
const imagePattern =
  /^ghcr\.io\/thomasheinthura\/taskdesk@sha256:[0-9a-f]{64}$/;
const fail = (message) => {
  throw new Error(message);
};

export function acquireLocalReleaseLock(env) {
  const file = realpathSync(env.SIT_COMPOSE_ENV);
  const directory = `${file}.lock`;
  const ownerFile = `${directory}/owner`;
  const supplied = env.TASKDESK_LOCAL_LOCK_TOKEN;
  if (supplied || env.TASKDESK_LOCAL_LOCK_PID) {
    const pid = Number(env.TASKDESK_LOCAL_LOCK_PID);
    if (
      !/^[a-f0-9]{64}$/.test(supplied || "") ||
      pid !== process.ppid ||
      readFileSync(ownerFile, "utf8") !== `${pid} ${supplied}\n`
    )
      fail("Local release lock handoff is invalid.");
    return () => {};
  }
  const token = randomBytes(32).toString("hex");
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch {
    fail(
      "Local release lock exists or cannot be acquired; inspect it before retrying.",
    );
  }
  try {
    writeFileSync(ownerFile, `${process.pid} ${token}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch {
    try {
      rmdirSync(directory);
    } catch {}
    fail("Local release lock could not be initialized.");
  }
  const release = () => {
    try {
      if (readFileSync(ownerFile, "utf8") === `${process.pid} ${token}\n`) {
        unlinkSync(ownerFile);
        rmdirSync(directory);
      }
    } catch {
      /* A changed or inaccessible lock is left for operator inspection. */
    }
  };
  try {
    if (
      readdirSync(dirname(file)).some((name) =>
        name.startsWith(".sit-selection-backup."),
      )
    )
      fail(
        "Unresolved private selection backup exists; inspect runtime and database before retrying.",
      );
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

export function deployLocal(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  if (
    args.length ||
    !env.SIT_COMPOSE_ENV ||
    !isAbsolute(env.SIT_COMPOSE_ENV) ||
    !exists(env.SIT_COMPOSE_ENV) ||
    !env.SIT_PRIVATE_DIR ||
    !isAbsolute(env.SIT_PRIVATE_DIR) ||
    !exists(env.SIT_PRIVATE_DIR)
  )
    return deployLocalLocked(options);
  const release = (options.acquireLock ?? acquireLocalReleaseLock)(env);
  try {
    return deployLocalLocked(options);
  } finally {
    release();
  }
}

export function deployLocalLocked({
  args = process.argv.slice(2),
  env = process.env,
  run = spawnSync,
  exists = existsSync,
  realpath = realpathSync,
  report = console.log,
  preflightOnly = false,
  dryRun = false,
} = {}) {
  if (dryRun && !preflightOnly) fail("Dry run is restricted to preflight.");
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    return "Usage: scripts/deploy.sh local\nSet SIT_COMPOSE_ENV and SIT_PRIVATE_DIR to absolute private paths after independently verifying the pre-existing copied project and backup. No seeding or initial import is performed.";
  }
  if (args.length) fail("Local release accepts no flags.");
  if (
    !env.SIT_COMPOSE_ENV ||
    !isAbsolute(env.SIT_COMPOSE_ENV) ||
    !exists(env.SIT_COMPOSE_ENV)
  )
    fail(
      "Set SIT_COMPOSE_ENV to an existing absolute private environment file.",
    );
  if (
    !env.SIT_PRIVATE_DIR ||
    !isAbsolute(env.SIT_PRIVATE_DIR) ||
    !exists(env.SIT_PRIVATE_DIR)
  )
    fail(
      "Set SIT_PRIVATE_DIR to the existing absolute private configuration directory.",
    );
  const privateDir = realpath(env.SIT_PRIVATE_DIR);
  const composeEnv = {
    PATH: env.PATH,
    HOME: env.HOME,
    DOCKER_HOST: env.DOCKER_HOST,
    DOCKER_CONTEXT: env.DOCKER_CONTEXT,
    DOCKER_CONFIG: env.DOCKER_CONFIG,
    SSH_AUTH_SOCK: env.SSH_AUTH_SOCK,
    SIT_PRIVATE_DIR: privateDir,
    COMPOSE_DISABLE_ENV_FILE: "1",
  };
  for (const key of Object.keys(composeEnv))
    if (composeEnv[key] === undefined) delete composeEnv[key];
  const prefix = [
    "compose",
    "--project-name",
    project,
    "--env-file",
    env.SIT_COMPOSE_ENV,
    "-f",
    resolve(root, "deploy/compose.testing.yml"),
  ];
  function command(bin, argv, description, timeout) {
    const result = run(bin, argv, {
      cwd: root,
      env: composeEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    });
    if (result.error || result.status !== 0) fail(`${description} failed.`);
    return result.stdout || "";
  }
  const dc = (argv, description) =>
    command("docker", [...prefix, ...argv], description);
  const json = (value, message) => {
    try {
      return JSON.parse(value);
    } catch {
      return fail(message);
    }
  };
  const localSocket = (value) => {
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
  };
  if (env.DOCKER_HOST && !localSocket(env.DOCKER_HOST))
    fail("Docker endpoint must be a local Unix socket.");
  const contextName = command(
    "docker",
    ["context", "show"],
    "Docker context inspection",
  ).trim();
  if (!contextName) fail("Docker context could not be determined.");
  const contexts = json(
    command(
      "docker",
      ["context", "inspect", contextName],
      "Docker context inspection",
    ),
    "Invalid Docker context inspection.",
  );
  if (
    contexts.length !== 1 ||
    !localSocket(contexts[0].Endpoints?.docker?.Host)
  )
    fail("Docker context must use a local Unix socket.");
  const interpolation = dc(
    ["config", "--environment"],
    "Compose interpolation inspection",
  );
  const tagLines = interpolation
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TASKDESK_IMAGE_TAG="));
  const tag =
    tagLines.length === 1
      ? tagLines[0].slice("TASKDESK_IMAGE_TAG=".length)
      : "";
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag))
    fail(
      "A valid TASKDESK_IMAGE_TAG is required in the private Compose environment.",
    );
  const config = json(
    dc(["config", "--format", "json"], "Compose configuration"),
    "Invalid Compose configuration.",
  );
  if (config.name !== project) fail("Unexpected Compose project.");
  const services = config.services || {};
  const image = services.taskdesk?.image;
  if (!imagePattern.test(image || "") || services.migrate?.image !== image)
    fail(
      "Application and migration images must match the signed digest format.",
    );
  const appVars = services.taskdesk?.environment || {};
  const migrateVars = services.migrate?.environment || {};
  const pgUser = services.postgres?.environment?.POSTGRES_USER;
  if (
    migrateVars.TASKDESK_ROLE !== "migrate" ||
    !["all", "web"].includes(appVars.TASKDESK_ROLE || "all")
  )
    fail("Unsafe application or migration role.");
  if (appVars.TASKDESK_MIGRATION_DATABASE_URL)
    fail("Application must not receive migration credentials.");
  if (
    appVars.TASKDESK_STORAGE_DRIVER &&
    appVars.TASKDESK_STORAGE_DRIVER.trim().toLowerCase() !== "filesystem"
  )
    fail("Only filesystem storage is supported for a copied local release.");
  if (typeof pgUser !== "string" || !pgUser || pgUser === "taskdesk_app")
    fail("Unexpected migration database owner.");
  const databases = [];
  for (const service of ["taskdesk", "migrate"]) {
    const vars = services[service]?.environment || {};
    const keys = Object.keys(vars).filter((key) => /DATABASE_URL$/.test(key));
    if (
      service === "taskdesk" &&
      keys.some((key) => key !== "TASKDESK_DATABASE_URL")
    )
      fail("Unexpected application database credential.");
    const required =
      service === "taskdesk"
        ? "TASKDESK_DATABASE_URL"
        : "TASKDESK_MIGRATION_DATABASE_URL";
    if (!keys.includes(required))
      fail("Required database configuration is missing.");
    for (const key of keys) {
      let url;
      try {
        url = new URL(vars[key]);
      } catch {
        fail("Invalid database configuration.");
      }
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.hostname !== "postgres" ||
        (url.port || "5432") !== "5432" ||
        url.search ||
        url.hash
      )
        fail(
          "Database configuration must target Compose postgres on port 5432.",
        );
      let username;
      try {
        username = decodeURIComponent(url.username);
      } catch {
        fail("Invalid database user.");
      }
      if (
        service === "taskdesk" &&
        key === "TASKDESK_DATABASE_URL" &&
        username !== "taskdesk_app"
      )
        fail("Application database user is unsafe.");
      if (
        service === "migrate" &&
        key === "TASKDESK_MIGRATION_DATABASE_URL" &&
        username !== pgUser
      )
        fail("Migration database user must match the Compose database owner.");
      databases.push(url.pathname);
    }
  }
  if (new Set(databases).size !== 1 || databases[0] === "/")
    fail(
      "Application and migration must target the same initialized database.",
    );
  if (services.taskdesk.environment.TASKDESK_MIGRATION_DATABASE_URL)
    fail("Application must not receive migration credentials.");
  const port = services.taskdesk.environment.TASKDESK_PORT || "5173";
  if (
    !/^[0-9]{1,5}$/.test(String(port)) ||
    Number(port) < 1 ||
    Number(port) > 65535
  )
    fail("Invalid application port.");
  if (
    services.taskdesk.ports?.length ||
    services.taskdesk.network_mode === "host"
  )
    fail("Application port must remain unpublished.");
  const proxyMount = services.traefik?.volumes?.find(
    (v) => v.target === "/config",
  );
  if (
    proxyMount?.type !== "bind" ||
    !proxyMount.read_only ||
    realpath(proxyMount.source) !== realpath(resolve(privateDir, "proxy"))
  )
    fail("Unexpected proxy configuration binding.");
  const proxyPorts = services.traefik?.ports;
  if (!Array.isArray(proxyPorts) || proxyPorts.length !== 4)
    fail("Unexpected proxy port configuration.");
  const endpoints = proxyPorts.map((binding) => {
    const host = binding.host_ip;
    const published = String(binding.published || "");
    const target = Number(binding.target);
    if (
      !["127.0.0.1", "::1"].includes(host) ||
      !/^[0-9]{1,5}$/.test(published) ||
      Number(published) < 1 ||
      Number(published) > 65535 ||
      ![80, 443].includes(target) ||
      (binding.protocol || "tcp") !== "tcp"
    )
      fail("Unexpected proxy port configuration.");
    return { host, published, target };
  });
  if (new Set(endpoints.map((e) => `${e.host}/${e.target}`)).size !== 4)
    fail("Unexpected proxy port configuration.");
  const proxyIds = dc(["ps", "-q", "traefik"], "Existing proxy inspection")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const ownedBindings = new Set();
  if (proxyIds.length) {
    const proxies = json(
      command("docker", ["inspect", ...proxyIds], "Existing proxy inspection"),
      "Invalid proxy inspection.",
    );
    if (proxies.length !== proxyIds.length)
      fail("Existing proxy inspection failed.");
    for (const proxy of proxies) {
      if (
        proxy.Config?.Labels?.["com.docker.compose.project"] !== project ||
        proxy.Config?.Labels?.["com.docker.compose.service"] !== "traefik" ||
        !proxy.State?.Running
      )
        fail("Existing proxy ownership is unexpected.");
      for (const endpoint of endpoints) {
        const key = `${endpoint.target}/tcp`;
        const matches = (entries) =>
          Array.isArray(entries) &&
          entries.some(
            (entry) =>
              entry.HostIp === endpoint.host &&
              entry.HostPort === endpoint.published,
          );
        if (
          matches(proxy.HostConfig?.PortBindings?.[key]) &&
          matches(proxy.NetworkSettings?.Ports?.[key])
        )
          ownedBindings.add(
            `${endpoint.host}/${endpoint.published}/${endpoint.target}`,
          );
      }
    }
  }
  const unownedPorts = endpoints.filter(
    (e) => !ownedBindings.has(`${e.host}/${e.published}/${e.target}`),
  );
  for (const [key, name] of [
    ["postgres-data", `${project}_postgres-data`],
    ["attachments", `${project}_attachments`],
  ]) {
    if (config.volumes?.[key]?.name !== name || config.volumes[key].external)
      fail("Unexpected Compose volume binding.");
    const vol = json(
      command(
        "docker",
        ["volume", "inspect", name],
        "Existing volume inspection",
      ),
      "Invalid volume inspection.",
    );
    if (
      vol.length !== 1 ||
      vol[0].Name !== name ||
      vol[0].Labels?.["com.docker.compose.project"] !== project ||
      vol[0].Labels?.["com.docker.compose.volume"] !== key
    )
      fail("Existing volume does not belong to the canonical project.");
  }
  for (const [service, target, source] of [
    ["postgres", "/var/lib/postgresql", "postgres-data"],
    ["taskdesk", "/app/data/attachments", "attachments"],
  ]) {
    const mounts =
      services[service]?.volumes?.filter((v) => v.target === target) || [];
    if (
      mounts.length !== 1 ||
      mounts[0].type !== "volume" ||
      mounts[0].source !== source
    )
      fail("Unexpected service volume binding.");
  }
  if (services.postgres?.ports?.some((p) => String(p.published) === "62870"))
    fail("Database port conflicts with the protected native database.");
  const postgresIds = dc(
    ["ps", "--status", "running", "-q", "postgres"],
    "Existing database inspection",
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const valkeyIds = dc(
    ["ps", "--status", "running", "-q", "valkey"],
    "Existing cache inspection",
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (postgresIds.length !== 1 || valkeyIds.length !== 1)
    fail(
      "The initialized canonical database and cache must already be running.",
    );
  const pg = json(
    command(
      "docker",
      ["inspect", postgresIds[0]],
      "Existing database inspection",
    ),
    "Invalid database inspection.",
  );
  if (
    pg.length !== 1 ||
    pg[0].Config?.Labels?.["com.docker.compose.project"] !== project ||
    pg[0].State?.Health?.Status !== "healthy" ||
    !pg[0].Mounts?.some(
      (m) =>
        m.Name === `${project}_postgres-data` &&
        m.Destination === "/var/lib/postgresql",
    )
  )
    fail("Existing database container or volume is unexpected.");
  const cache = json(
    command("docker", ["inspect", valkeyIds[0]], "Existing cache inspection"),
    "Invalid cache inspection.",
  );
  if (
    cache.length !== 1 ||
    cache[0].Config?.Labels?.["com.docker.compose.project"] !== project ||
    cache[0].State?.Health?.Status !== "healthy"
  )
    fail("Existing cache container is unexpected.");
  const dbName = decodeURIComponent(databases[0].slice(1));
  if (!dbName || dbName.includes("/") || dbName.includes("\0"))
    fail("Invalid database name.");
  if (!dryRun) {
    command(
      "gh",
      [
        "attestation",
        "verify",
        `oci://${image}`,
        "--owner",
        "ThomasHeinThura",
        "--signer-workflow",
        "ThomasHeinThura/ticketing/.github/workflows/release.yml",
        "--source-ref",
        "refs/heads/main",
      ],
      "Release attestation verification",
    );
    command(
      "cosign",
      [
        "verify",
        "--certificate-oidc-issuer",
        "https://token.actions.githubusercontent.com",
        "--certificate-identity",
        "https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main",
        "--annotations",
        `tag=${tag}`,
        image,
      ],
      "Release signature verification",
    );
  }
  if (preflightOnly) return { image, tag, dbName, config, prefix, composeEnv };
  dc(
    [
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      `test "$(psql -U "$POSTGRES_USER" -d "$1" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" -gt 0`,
      "check",
      dbName,
    ],
    "Initialized database check",
  );
  dc(["pull", "migrate", "taskdesk"], "Image pull");
  const imageDetails = json(
    command("docker", ["image", "inspect", image], "Pinned image inspection"),
    "Invalid pinned image inspection.",
  );
  if (
    imageDetails.length !== 1 ||
    !/^sha256:[0-9a-f]{64}$/.test(imageDetails[0].Id || "")
  )
    fail("Pinned image ID could not be confirmed.");
  if (unownedPorts.length) {
    if (
      !imageDetails[0].Config ||
      Object.keys(imageDetails[0].Config.Volumes || {}).length
    )
      fail("Pinned image declares volumes and cannot be used for port proof.");
    const labelKey = "info.taskdesk.local-port-proof";
    const existingProofs = command(
      "docker",
      ["ps", "-a", "-q", "--no-trunc", "--filter", `label=${labelKey}`],
      "Prior port proof inspection",
      30000,
    ).trim();
    if (existingProofs)
      fail("A previous port proof requires inspection before retrying.");
    const marker = randomBytes(24).toString("hex");
    const proofName = `taskdesk-port-proof-${marker}`;
    const label = `${labelKey}=${marker}`;
    const probeCode =
      "setInterval(() => {}, 60000); setTimeout(() => process.exit(0), 60000)";
    const createArgs = [
      "create",
      "--name",
      proofName,
      "--label",
      label,
      "--network",
      "bridge",
      "--read-only",
      "--no-healthcheck",
      "--security-opt",
      "no-new-privileges:true",
      "--cap-drop",
      "ALL",
      "--entrypoint",
      "node",
    ];
    for (const endpoint of unownedPorts) {
      const host = endpoint.host === "::1" ? "[::1]" : endpoint.host;
      createArgs.push(
        "--publish",
        `${host}:${endpoint.published}:${endpoint.target}/tcp`,
      );
    }
    createArgs.push(image, "-e", probeCode);
    const inspectProof = (id) => {
      const result = json(
        command("docker", ["inspect", id], "Port proof inspection", 30000),
        "Invalid port proof inspection.",
      );
      if (
        result.length !== 1 ||
        result[0].Id !== id ||
        result[0].Name !== `/${proofName}` ||
        result[0].Config?.Labels?.[labelKey] !== marker ||
        result[0].Config?.Image !== image ||
        result[0].Image !== imageDetails[0].Id
      )
        fail("Port proof container ownership is not confirmed.");
      return result[0];
    };
    const findProof = () =>
      command(
        "docker",
        ["ps", "-a", "-q", "--no-trunc", "--filter", `label=${label}`],
        "Port proof recovery",
        30000,
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    let proofId;
    report(`Port proof ownership marker: ${marker}`);
    try {
      const created = command(
        "docker",
        createArgs,
        "Port proof creation",
        30000,
      ).trim();
      if (!/^[0-9a-f]{64}$/.test(created))
        fail("Port proof container ID is invalid.");
      proofId = created;
    } catch {
      // A daemon may create the container even when the client gets an error.
      // Only a unique unpredictable label plus inspected name/image is removable.
      const candidates = findProof();
      if (candidates.length === 1 && /^[0-9a-f]{64}$/.test(candidates[0])) {
        inspectProof(candidates[0]);
        proofId = candidates[0];
        report(`Port proof container created: ${proofId}`);
        command("docker", ["rm", "-f", proofId], "Port proof cleanup", 30000);
        if (findProof().length)
          fail("Port proof cleanup could not be confirmed.");
        report(`Port proof container removed: ${proofId}`);
      } else if (candidates.length)
        fail("Port proof creation is ambiguous; inspect the private ledger.");
      fail("Port proof creation failed; no migration was run.");
    }
    report(`Port proof container created: ${proofId}`);
    let ownershipConfirmed = false;
    try {
      const created = inspectProof(proofId);
      ownershipConfirmed = true;
      if (
        created.HostConfig?.NetworkMode !== "bridge" ||
        created.HostConfig?.ReadonlyRootfs !== true ||
        created.HostConfig?.Privileged !== false ||
        created.HostConfig?.AutoRemove !== false ||
        !created.HostConfig?.SecurityOpt?.includes("no-new-privileges:true") ||
        JSON.stringify(created.Config?.Healthcheck?.Test) !==
          JSON.stringify(["NONE"]) ||
        created.HostConfig?.PublishAllPorts !== false ||
        !created.HostConfig?.CapDrop?.includes("ALL") ||
        (created.HostConfig?.CapAdd || []).length ||
        !Array.isArray(created.Mounts) ||
        created.Mounts.length ||
        (created.HostConfig?.Binds || []).length ||
        (created.HostConfig?.VolumesFrom || []).length ||
        JSON.stringify([...(created.Config?.Env || [])].sort()) !==
          JSON.stringify([...(imageDetails[0].Config.Env || [])].sort()) ||
        JSON.stringify(created.Config?.Entrypoint) !==
          JSON.stringify(["node"]) ||
        JSON.stringify(created.Config?.Cmd) !==
          JSON.stringify(["-e", probeCode])
      )
        fail("Port proof isolation is not confirmed.");
      command("docker", ["start", proofId], "Port proof start", 30000);
      report(`Port proof container started: ${proofId}`);
      ownershipConfirmed = false;
      const running = inspectProof(proofId);
      ownershipConfirmed = true;
      if (
        !running.State?.Running ||
        running.HostConfig?.NetworkMode !== "bridge" ||
        !running.NetworkSettings?.Networks?.bridge
      )
        fail("Port proof network or state is not confirmed.");
      const expected = unownedPorts
        .map((e) => `${e.target}/tcp|${e.host}|${e.published}`)
        .sort();
      const bindings = (ports) =>
        Object.entries(ports || {})
          .flatMap(([key, entries]) =>
            (entries || []).map(
              (entry) => `${key}|${entry.HostIp}|${entry.HostPort}`,
            ),
          )
          .sort();
      if (
        JSON.stringify(bindings(running.HostConfig?.PortBindings)) !==
          JSON.stringify(expected) ||
        JSON.stringify(bindings(running.NetworkSettings?.Ports)) !==
          JSON.stringify(expected)
      )
        fail("Port proof bindings are not confirmed.");
    } finally {
      if (!ownershipConfirmed)
        fail(
          "Port proof ownership is uncertain; inspect its marker and container ID manually.",
        );
      command("docker", ["rm", "-f", proofId], "Port proof cleanup", 30000);
      const remaining = command(
        "docker",
        ["ps", "-a", "-q", "--no-trunc", "--filter", `id=${proofId}`],
        "Port proof cleanup inspection",
        30000,
      ).trim();
      if (remaining) fail("Port proof cleanup could not be confirmed.");
      report(`Port proof container removed: ${proofId}`);
    }
  }
  const migrationId = dc(
    ["run", "-d", "--no-deps", "migrate"],
    "Migration start",
  ).trim();
  if (!/^[0-9a-f]{64}$/.test(migrationId))
    fail(
      "Migration container ID could not be confirmed; inspect the canonical project before retrying.",
    );
  report(`Migration container started: ${migrationId}`);
  let migrationStatus;
  try {
    migrationStatus = command(
      "docker",
      ["wait", migrationId],
      "Migration wait",
      300000,
    ).trim();
    if (!/^[0-9]+$/.test(migrationStatus))
      fail("Migration status could not be confirmed.");
  } catch {
    try {
      command(
        "docker",
        ["stop", "--time", "10", migrationId],
        "Migration stop",
        30000,
      );
    } catch {
      /* Attempt exact-ID removal even if stop failed. */
    }
    try {
      command("docker", ["rm", "-f", migrationId], "Migration cleanup", 30000);
      report(`Migration container removed: ${migrationId}`);
    } catch {
      fail(
        `Migration status and cleanup failed; inspect container ${migrationId}.`,
      );
    }
    fail("Migration wait failed; the owned migration container was removed.");
  }
  command("docker", ["rm", migrationId], "Migration container cleanup", 30000);
  report(`Migration container removed: ${migrationId}`);
  if (migrationStatus !== "0") fail("Migration failed.");
  dc(["up", "-d", "--wait", "--no-deps", "taskdesk"], "Application start");
  const ids = dc(["ps", "-a", "-q", "taskdesk"], "Application inspection")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) fail("Application containers are missing.");
  const containers = json(
    command("docker", ["inspect", ...ids], "Application inspection"),
    "Invalid application inspection.",
  );
  if (
    containers.length !== ids.length ||
    containers.some(
      (c) => c.Config?.Image !== image || c.Image !== imageDetails[0].Id,
    )
  )
    fail("Running application image does not match the pinned release.");
  if (
    containers.length !== ids.length ||
    containers.some(
      (c) =>
        c.Config?.Labels?.["com.docker.compose.project"] !== project ||
        c.HostConfig?.NetworkMode === "host" ||
        c.HostConfig?.PublishAllPorts ||
        Object.keys(c.HostConfig?.PortBindings || {}).length ||
        Object.values(c.NetworkSettings?.Ports || {}).some(Boolean),
    )
  )
    fail("Application port is not proven unpublished.");
  if (
    containers.some((c) => {
      const mounts = (c.Mounts || []).filter(
        (m) => m.Destination === "/app/data/attachments",
      );
      return (
        mounts.length !== 1 ||
        mounts[0].Type !== "volume" ||
        mounts[0].Name !== `${project}_attachments`
      );
    })
  )
    fail("Running application attachment volume is unexpected.");
  dc(
    [
      "exec",
      "-T",
      "taskdesk",
      "node",
      "-e",
      `fetch('http://127.0.0.1:${port}/api/public/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`,
    ],
    "Internal readiness probe",
  );
  dc(["up", "-d", "--wait", "--no-deps", "traefik"], "Proxy start");
  return "Proxy started; public HTTPS, readiness and browser smoke remain pending.";
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(deployLocal());
  } catch (error) {
    console.error(`Local release stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
