import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  clearFreshJournalAfterRestore,
  findUnfinishedFreshJournal,
  markFreshJournalRestoreStarted,
  resumeFreshJournal,
} from "./local-fresh-journal.mjs";
import { assertBackupLocation } from "./local-fresh-location.mjs";
import { claimFreshRecoveryLock } from "./local-fresh-lock.mjs";
import { PROJECT, planRemoval } from "./local-fresh-plan.mjs";
import {
  attachmentManifestCode,
  readRestoreProofRecord,
  validateTarFile,
} from "./local-fresh-restore-proof.mjs";

export const IMAGE_PATTERN =
  /^ghcr\.io\/thomasheinthura\/taskdesk@sha256:[0-9a-f]{64}$/;

export const COUNT_SQL =
  "SELECT count(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';\nSELECT format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I;', table_schema||'.'||table_name, table_schema, table_name) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name \\gexec";

const split = (s) => s.trim().split(/\s+/).filter(Boolean);

const SERVICE_SHUTDOWN_ORDER = {
  traefik: 0,
  taskdesk: 1,
  mailpit: 2,
  migrate: 3,
  valkey: 4,
  postgres: 5,
};

export function orderContainersForShutdown(containers) {
  return [...containers]
    .sort((a, b) => {
      const sa =
        SERVICE_SHUTDOWN_ORDER[
          a.Config?.Labels?.["com.docker.compose.service"]
        ] ?? 3;
      const sb =
        SERVICE_SHUTDOWN_ORDER[
          b.Config?.Labels?.["com.docker.compose.service"]
        ] ?? 3;
      if (sa !== sb) return sa - sb;
      return String(a.Id).localeCompare(String(b.Id));
    })
    .map((c) => c.Id);
}

export function writeCommandOutputAtomically(file, cmd, bin, argv, input) {
  if (existsSync(file))
    throw new Error("Refusing to overwrite existing private output file.");
  const temp = `${file}.tmp`;
  if (existsSync(temp)) unlinkSync(temp);
  const fd = openSync(temp, "wx", 0o600);
  let closed = false;
  try {
    cmd(bin, argv, { input, stdio: ["pipe", fd, "pipe"] });
    fsyncSync(fd);
    closeSync(fd);
    closed = true;
    renameSync(temp, file);
    const dirFd = openSync(dirname(file), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch (error) {
    if (!closed) {
      try {
        closeSync(fd);
      } catch {}
    }
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}

export function redactFreshText(value, { env = {}, checkout } = {}) {
  let result = String(value);
  result = result.replace(
    /postgres(?:ql)?:\/\/[^\s'"]+/gi,
    "<redacted-db-url>",
  );
  for (const [secretPath, label] of [
    [env.SIT_COMPOSE_ENV, "<private-compose-env>"],
    [env.SIT_PRIVATE_DIR, "<private-dir>"],
    [
      env.SIT_COMPOSE_ENV ? dirname(env.SIT_COMPOSE_ENV) : undefined,
      "<private-compose-dir>",
    ],
    [checkout, "<checkout>"],
    [env.NODE_EXTRA_CA_CERTS, "<private-ca-certificate>"],
  ]) {
    if (secretPath) result = result.replaceAll(secretPath, label);
  }
  result = result.replace(/(?:^|(?<=[\s'"=(:]))\/[^\s'"]+/g, "<private-path>");
  return result;
}

export function formatRecoveryFailureLines(
  reference,
  steps,
  plannedContainers,
  plannedVolumes,
) {
  const removed = steps
    .filter(
      (step) =>
        step.state === "done" &&
        (step.name.startsWith("remove-container:") ||
          step.name.startsWith("remove-volume:")),
    )
    .map((step) => step.name);
  const uncertain = steps
    .filter((step) => step.state !== "done")
    .map((step) => step.name);
  const remaining = [...plannedContainers, ...plannedVolumes].filter(
    (item) =>
      !removed.some((entry) => entry.endsWith(`:${item}`)) &&
      !uncertain.some((entry) => entry.endsWith(`:${item}`)),
  );
  return [
    `Recovery reference: ${reference}; removed: ${removed.join(", ") || "none"}; uncertain: ${uncertain.join(", ") || "none"}; remaining: ${remaining.join(", ") || "none"}.`,
    `Recovery commands: scripts/deploy.sh local-fresh --resume ${reference} | scripts/deploy.sh local-fresh --restore-from-backup ${reference}`,
  ];
}

function assertPrivateInputs(env, checkout) {
  for (const key of ["SIT_COMPOSE_ENV", "SIT_PRIVATE_DIR"]) {
    if (!env[key] || !isAbsolute(env[key]) || !existsSync(env[key]))
      throw new Error(`${key} must be an existing absolute private path.`);
  }
  assertBackupLocation({
    privateDir: env.SIT_PRIVATE_DIR,
    composeEnv: env.SIT_COMPOSE_ENV,
    checkout,
    volumes: [],
  });
}

function isLocalUnixSocket(value) {
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

function buildComposeRuntime({
  env,
  run,
  checkout,
  overrideSitImage,
  requireClosedSwitches,
}) {
  const privateDir = realpathSync(env.SIT_PRIVATE_DIR);
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
  if (overrideSitImage) composeEnv.SIT_IMAGE = overrideSitImage;
  for (const key of Object.keys(composeEnv))
    if (composeEnv[key] === undefined) delete composeEnv[key];

  const prefix = [
    "compose",
    "--project-name",
    PROJECT,
    "--env-file",
    env.SIT_COMPOSE_ENV,
    "-f",
    resolve(checkout, "deploy/compose.testing.yml"),
  ];

  const cmd = (bin, argv, options = {}) => {
    const result = run(bin, argv, {
      cwd: checkout,
      env: composeEnv,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
    if (result.error || result.status !== 0)
      throw new Error(`${bin} ${argv[0]} failed.`);
    return result.stdout || "";
  };
  const tryCmd = (bin, argv, options = {}) => {
    const result = run(bin, argv, {
      cwd: checkout,
      env: composeEnv,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
    return !result.error && result.status === 0;
  };
  const dc = (argv, options) => cmd("docker", [...prefix, ...argv], options);
  const inspect = (argv) => {
    const parsed = JSON.parse(cmd("docker", argv));
    if (!Array.isArray(parsed))
      throw new Error("Invalid Docker inspection output.");
    return parsed;
  };

  if (env.DOCKER_HOST && !isLocalUnixSocket(env.DOCKER_HOST))
    throw new Error("Docker endpoint must be a local Unix socket.");
  const contextName = cmd("docker", ["context", "show"]).trim();
  if (!contextName) throw new Error("Docker context could not be determined.");
  const contexts = inspect(["context", "inspect", contextName]);
  if (
    contexts.length !== 1 ||
    !isLocalUnixSocket(contexts[0]?.Endpoints?.docker?.Host)
  )
    throw new Error("Docker context must use a local Unix socket.");

  const interpolation = dc(["config", "--environment"]);
  const tagLines = interpolation
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TASKDESK_IMAGE_TAG="));
  const tag =
    tagLines.length === 1
      ? tagLines[0].slice("TASKDESK_IMAGE_TAG=".length)
      : "";
  if (!overrideSitImage && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag))
    throw new Error(
      "A valid TASKDESK_IMAGE_TAG is required in the private Compose environment.",
    );

  const config = JSON.parse(dc(["config", "--format", "json"]));
  if (config?.name !== PROJECT) throw new Error("Unexpected Compose project.");
  const services = config.services || {};
  const image = services.taskdesk?.image;
  if (!IMAGE_PATTERN.test(image || "") || services.migrate?.image !== image)
    throw new Error(
      "Application and migration images must match the signed digest format.",
    );
  if (overrideSitImage && image !== overrideSitImage)
    throw new Error(
      "Compose configuration did not resolve to the recorded previous image digest.",
    );

  const pgEnv = services.postgres?.environment || {};
  const pgUser = pgEnv.POSTGRES_USER;
  if (typeof pgUser !== "string" || !pgUser || pgUser === "taskdesk_app")
    throw new Error("Unexpected migration database owner.");
  const appVars = services.taskdesk?.environment || {};
  const migrateVars = services.migrate?.environment || {};
  if (
    migrateVars.TASKDESK_ROLE !== "migrate" ||
    !["all", "web"].includes(appVars.TASKDESK_ROLE || "all") ||
    appVars.TASKDESK_MIGRATION_DATABASE_URL
  )
    throw new Error("Unsafe application or migration role.");
  if (
    appVars.TASKDESK_STORAGE_DRIVER &&
    appVars.TASKDESK_STORAGE_DRIVER.trim().toLowerCase() !== "filesystem"
  )
    throw new Error("Only filesystem storage is supported.");

  const dbPaths = [];
  for (const [svc, key, expectedUser] of [
    ["taskdesk", "TASKDESK_DATABASE_URL", "taskdesk_app"],
    ["migrate", "TASKDESK_MIGRATION_DATABASE_URL", pgUser],
  ]) {
    const raw = services[svc]?.environment?.[key];
    if (!raw) throw new Error("Required database configuration is missing.");
    const url = new URL(raw);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "postgres" ||
      (url.port || "5432") !== "5432" ||
      url.search ||
      url.hash ||
      decodeURIComponent(url.username) !== expectedUser
    )
      throw new Error("Unsafe database configuration.");
    dbPaths.push(url.pathname);
  }
  if (new Set(dbPaths).size !== 1 || dbPaths[0] === "/")
    throw new Error(
      "Application and migration must target the same initialized database.",
    );
  const dbName = decodeURIComponent(dbPaths[0].slice(1));
  if (!dbName || dbName.includes("/") || dbName.includes("\0"))
    throw new Error("Invalid database name.");
  if ((pgEnv.POSTGRES_DB || pgUser) !== dbName)
    throw new Error(
      "Fresh PostgreSQL database name does not match migration target.",
    );
  if (
    services.taskdesk?.ports?.length ||
    services.taskdesk?.network_mode === "host"
  )
    throw new Error("Application port must remain unpublished.");
  const proxyMount = services.traefik?.volumes?.find(
    (v) => v.target === "/config",
  );
  if (
    proxyMount?.type !== "bind" ||
    !proxyMount.read_only ||
    realpathSync(proxyMount.source) !==
      realpathSync(resolve(privateDir, "proxy"))
  )
    throw new Error("Unexpected proxy configuration binding.");

  if (requireClosedSwitches) {
    for (const key of [
      "DISABLE_REGISTRATION",
      "DISABLE_PASSWORD_REGISTRATION",
      "DISABLE_WORKSPACE_CREATION",
    ]) {
      if (appVars[key] !== "true")
        throw new Error(`Private app environment must set ${key}=true.`);
    }
  }

  return {
    config,
    image,
    tag,
    dbName,
    prefix,
    composeEnv,
    cmd,
    tryCmd,
    dc,
    inspect,
  };
}

function verifySignedImage({ cmd, image, tag }) {
  cmd("gh", [
    "attestation",
    "verify",
    `oci://${image}`,
    "--owner",
    "ThomasHeinThura",
    "--signer-workflow",
    "ThomasHeinThura/ticketing/.github/workflows/release.yml",
    "--source-ref",
    "refs/heads/main",
  ]);
  const cosignArgs = [
    "verify",
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "--certificate-identity",
    "https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main",
  ];
  if (tag) cosignArgs.push("--annotations", `tag=${tag}`);
  cosignArgs.push(image);
  cmd("cosign", cosignArgs);
}

function inspectLiveProjectState({ cmd, inspect, config, env, checkout }) {
  for (const labelKey of [
    "info.taskdesk.local-port-proof",
    "info.taskdesk.restore-proof",
  ]) {
    if (
      cmd("docker", [
        "ps",
        "-a",
        "-q",
        "--no-trunc",
        "--filter",
        `label=${labelKey}`,
      ]).trim()
    )
      throw new Error(
        `Leftover proof container (${labelKey}) requires manual inspection.`,
      );
  }
  const ids = split(
    cmd("docker", [
      "ps",
      "-a",
      "-q",
      "--no-trunc",
      "--filter",
      `label=com.docker.compose.project=${PROJECT}`,
    ]),
  );
  const volumeNames = split(
    cmd("docker", [
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${PROJECT}`,
    ]),
  );
  const containers = ids.length ? inspect(["inspect", ...ids]) : [];
  const volumes = volumeNames.length
    ? inspect(["volume", "inspect", ...volumeNames])
    : [];
  if (ids.length !== containers.length || volumeNames.length !== volumes.length)
    throw new Error("Docker inspection count mismatch.");
  assertBackupLocation({
    privateDir: env.SIT_PRIVATE_DIR,
    composeEnv: env.SIT_COMPOSE_ENV,
    checkout,
    volumes,
  });
  const checked = planRemoval({
    confirmation: PROJECT,
    config,
    containers,
    volumes,
  });
  for (const name of checked.volumes) {
    const users = split(
      cmd("docker", [
        "ps",
        "-a",
        "-q",
        "--no-trunc",
        "--filter",
        `volume=${name}`,
      ]),
    );
    if (users.some((id) => !checked.containers.includes(id)))
      throw new Error(
        "A project volume is referenced by an outside container.",
      );
  }
  return {
    containersById: new Map(containers.map((c) => [c.Id, c])),
    volumesByName: new Map(volumes.map((v) => [v.Name, v])),
    containers,
    volumes,
  };
}

function findRecordedMigrationId(snapshot, containersById) {
  for (const step of snapshot.steps) {
    if (step.name.startsWith("wait-migration:"))
      return step.name.slice("wait-migration:".length);
    if (step.name.startsWith("remove-migration:"))
      return step.name.slice("remove-migration:".length);
  }
  const migs = [...containersById.values()].filter(
    (c) => c.Config?.Labels?.["com.docker.compose.service"] === "migrate",
  );
  if (migs.length === 1) return migs[0].Id;
  throw new Error("Recorded migration container ID could not be resolved.");
}

export function freshVolumeKeysForPlan(volumes, config) {
  const keys = ["postgres-data", "attachments"];
  if (
    volumes.includes(`${PROJECT}_mailpit-data`) ||
    config?.volumes?.["mailpit-data"]
  )
    keys.push("mailpit-data");
  return keys;
}

export function runFreshInstallSteps({
  journal,
  plan,
  backup,
  config,
  composeEnv,
  env,
  checkout,
  cmd,
  dc,
  inspect,
  upgrade,
  run,
  report,
  resuming = false,
  liveContainersById = new Map(),
  onRemovalStart = () => {},
}) {
  for (const id of plan.containers) {
    onRemovalStart();
    journal.step(`stop-container:${id}`, () => cmd("docker", ["stop", id]));
    const removedNow = journal.step(
      `remove-container:${id}`,
      () => {
        cmd("docker", ["rm", id]);
        return true;
      },
      false,
    );
    if (removedNow) report(`Removed container ${id}`);
  }
  for (const name of plan.volumes) {
    onRemovalStart();
    const removedNow = journal.step(
      `remove-volume:${name}`,
      () => {
        cmd("docker", ["volume", "rm", name]);
        return true;
      },
      false,
    );
    if (removedNow) report(`Removed volume ${name}`);
  }
  const volumeKeys = freshVolumeKeysForPlan(plan.volumes, config);
  for (const v of volumeKeys) {
    journal.step(`create-volume:${v}`, () =>
      cmd("docker", [
        "volume",
        "create",
        "--label",
        `com.docker.compose.project=${PROJECT}`,
        "--label",
        `com.docker.compose.volume=${v}`,
        `${PROJECT}_${v}`,
      ]),
    );
  }
  const expectedVolumeNames = volumeKeys.map((v) => `${PROJECT}_${v}`);
  const newVolumes = inspect(["volume", "inspect", ...expectedVolumeNames]);
  const checkedVolumes = planRemoval({
    confirmation: PROJECT,
    config,
    containers: [],
    volumes: newVolumes,
  }).volumes;
  if (
    checkedVolumes.length !== expectedVolumeNames.length ||
    !expectedVolumeNames.every((name) => checkedVolumes.includes(name))
  )
    throw new Error("Fresh volume ownership could not be confirmed.");

  journal.step("start-dependencies", () => {
    dc(["up", "-d", "--wait", "postgres", "valkey", "mailpit"]);
    const mailpitIds = split(
      dc(["ps", "--status", "running", "-q", "mailpit"]),
    );
    if (mailpitIds.length !== 1 || !/^[a-f0-9]{64}$/.test(mailpitIds[0]))
      throw new Error("Mailpit container failed to start.");
  });

  const migration = journal
    .step(
      "start-migration",
      () => dc(["run", "-d", "--no-deps", "migrate"]),
      () => findRecordedMigrationId(journal.snapshot(), liveContainersById),
    )
    .trim();
  if (!/^[a-f0-9]{64}$/.test(migration))
    throw new Error("Migration ID invalid; inspect project.");

  let alreadyRemovedMigration = false;
  journal.step(`wait-migration:${migration}`, () => {
    if (resuming) {
      const existing = inspect(["inspect", migration]);
      if (
        existing.length === 1 &&
        !existing[0].State?.Running &&
        typeof existing[0].State?.ExitCode === "number" &&
        existing[0].State.ExitCode !== 0
      ) {
        cmd("docker", ["rm", migration]);
        alreadyRemovedMigration = true;
        report(`Removed migration container ${migration}`);
        const retryMigration = dc(["run", "-d", "--no-deps", "migrate"]).trim();
        if (!/^[a-f0-9]{64}$/.test(retryMigration))
          throw new Error("Migration ID invalid; inspect project.");
        const retryResult = cmd("docker", ["wait", retryMigration], {
          timeout: 300000,
        }).trim();
        cmd("docker", ["rm", retryMigration]);
        report(`Removed migration container ${retryMigration}`);
        if (retryResult !== "0") throw new Error("Migration failed.");
        return retryResult;
      }
    }
    const result = cmd("docker", ["wait", migration], {
      timeout: 300000,
    }).trim();
    if (result !== "0") throw new Error("Migration failed.");
    return result;
  });

  journal.step(`remove-migration:${migration}`, () => {
    if (!alreadyRemovedMigration) {
      cmd("docker", ["rm", migration]);
      report(`Removed migration container ${migration}`);
    }
  });

  journal.step("release-upgrade", () => {
    if (resuming) {
      const ids = split(
        cmd("docker", [
          "ps",
          "-a",
          "-q",
          "--no-trunc",
          "--filter",
          `label=com.docker.compose.project=${PROJECT}`,
        ]),
      );
      const current = ids.length ? inspect(["inspect", ...ids]) : [];
      planRemoval({
        confirmation: PROJECT,
        config,
        containers: current,
        volumes: [],
      });
      for (const c of current) {
        const svc = c.Config?.Labels?.["com.docker.compose.service"];
        if (["taskdesk", "traefik"].includes(svc) && !c.State?.Running) {
          cmd("docker", ["rm", c.Id]);
        }
      }
    }
    return upgrade({ args: [], env, run, report });
  });

  const appIds = split(dc(["ps", "-q", "taskdesk"]));
  if (appIds.length !== 1 || !/^[a-f0-9]{64}$/.test(appIds[0]))
    throw new Error("Fresh app container is ambiguous.");

  journal.step("seed", () =>
    cmd("docker", [
      "exec",
      appIds[0],
      "node",
      "apps/api/dist/seed-sit-users.js",
      "--sit",
      "--credentials-file",
      "/tmp/sit-credentials.json",
    ]),
  );

  const credentials = resolve(backup, "sit-credentials.json");
  journal.step("copy-credentials", () =>
    writeCommandOutputAtomically(credentials, cmd, "docker", [
      "exec",
      appIds[0],
      "cat",
      "/tmp/sit-credentials.json",
    ]),
  );

  journal.step("remove-temporary-credentials", () =>
    cmd("docker", ["exec", appIds[0], "rm", "-f", "/tmp/sit-credentials.json"]),
  );

  for (const host of ["ticketing.localhost", "portal.localhost"]) {
    journal.step(`readiness:${host}`, () =>
      cmd("curl", [
        "--fail",
        "--silent",
        "--show-error",
        "--retry",
        "30",
        "--retry-delay",
        "2",
        "--retry-all-errors",
        "--max-time",
        "5",
        "--insecure",
        `https://${host}/api/public/health/ready`,
      ]),
    );
  }

  journal.step("release-smoke", () =>
    cmd(
      "node",
      ["scripts/sit/release-smoke.mjs", "--credentials", credentials],
      {
        env: {
          ...composeEnv,
          NODE_EXTRA_CA_CERTS:
            env.NODE_EXTRA_CA_CERTS ||
            resolve(checkout, "deploy/local/certs/local.crt"),
        },
        stdio: "inherit",
      },
    ),
  );

  journal.step("complete", () => {});
}

export function executeResume({
  reference: requestedReference,
  env,
  run,
  report,
  upgrade,
  lock,
  signal,
  checkout,
}) {
  assertPrivateInputs(env, checkout);
  const found = findUnfinishedFreshJournal(
    env.SIT_PRIVATE_DIR,
    requestedReference,
  );
  const { reference, backupDir, journalFile, journal: saved } = found;
  if (saved.restoreStarted)
    throw new Error(
      "Backup restoration is already in progress; finish with --restore-from-backup.",
    );
  if (
    !IMAGE_PATTERN.test(saved.image || "") ||
    !Array.isArray(saved.containers) ||
    !Array.isArray(saved.volumes)
  )
    throw new Error("Recovery journal metadata is incomplete.");

  const release = claimFreshRecoveryLock(env, { lock, signal });
  const previousMask = process.umask(0o077);
  let keepLock = true;
  let resumedJournal;
  try {
    const runtime = buildComposeRuntime({
      env,
      run,
      checkout,
      requireClosedSwitches: true,
    });
    const { config, image, tag, dbName, composeEnv, cmd, tryCmd, dc, inspect } =
      runtime;
    if (
      image !== saved.image ||
      tag !== saved.tag ||
      (saved.dbName && dbName !== saved.dbName)
    )
      throw new Error(
        "Compose target changed since the interrupted install; restore from backup or revert private inputs.",
      );
    verifySignedImage({ cmd, image, tag });

    const live = inspectLiveProjectState({
      cmd,
      inspect,
      config,
      env,
      checkout,
    });
    const { containersById, volumesByName } = live;

    const recordedNames = new Set(saved.steps.map((s) => s.name));
    for (const id of saved.containers) {
      if (!recordedNames.has(`remove-container:${id}`)) {
        const existing = containersById.get(id);
        if (!existing)
          throw new Error(
            `Docker state disagrees with unstarted removal of container ${id}.`,
          );
        if (
          !recordedNames.has(`stop-container:${id}`) &&
          !existing.State?.Running
        )
          throw new Error(
            `Docker state disagrees with unstarted stop of container ${id}.`,
          );
      }
    }
    const anyCreateVolume = saved.steps.some((s) =>
      s.name.startsWith("create-volume:"),
    );
    if (!anyCreateVolume) {
      for (const name of saved.volumes) {
        if (
          !recordedNames.has(`remove-volume:${name}`) &&
          !volumesByName.has(name)
        )
          throw new Error(
            `Docker state disagrees with unstarted removal of volume ${name}.`,
          );
      }
    }
    if (!recordedNames.has("start-dependencies")) {
      const originalIds = new Set(saved.containers);
      for (const id of containersById.keys()) {
        if (!originalIds.has(id))
          throw new Error(
            "Docker state disagrees with journal: unexpected container present before dependency start.",
          );
      }
    }

    const freshContainers = () =>
      [...containersById.values()].filter(
        (c) => !saved.containers.includes(c.Id),
      );
    const byService = (svc) =>
      freshContainers().filter(
        (c) => c.Config?.Labels?.["com.docker.compose.service"] === svc,
      );
    let cachedTablesInitialized;
    const checkTablesInitialized = () => {
      if (cachedTablesInitialized !== undefined) return cachedTablesInitialized;
      const pgs = byService("postgres");
      if (pgs.length !== 1 || !pgs[0].State?.Running) {
        cachedTablesInitialized = false;
        return false;
      }
      cachedTablesInitialized = tryCmd("docker", [
        "exec",
        pgs[0].Id,
        "sh",
        "-c",
        `test "$(psql -U "$POSTGRES_USER" -d "$1" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" -gt 0`,
        "check",
        dbName,
      ]);
      return cachedTablesInitialized;
    };

    const inspectStep = (name) => {
      if (name.startsWith("stop-container:")) {
        const id = name.slice("stop-container:".length);
        const removeRecorded = recordedNames.has(`remove-container:${id}`);
        if (!containersById.has(id))
          return removeRecorded ? "applied" : "unknown";
        return containersById.get(id).State?.Running
          ? "not-applied"
          : "applied";
      }
      if (name.startsWith("remove-container:")) {
        const id = name.slice("remove-container:".length);
        return containersById.has(id) ? "not-applied" : "applied";
      }
      if (name.startsWith("remove-volume:")) {
        const volName = name.slice("remove-volume:".length);
        const key = volName.slice(PROJECT.length + 1);
        if (recordedNames.has(`create-volume:${key}`)) return "applied";
        return volumesByName.has(volName) ? "not-applied" : "applied";
      }
      if (name.startsWith("create-volume:")) {
        const key = name.slice("create-volume:".length);
        return volumesByName.has(`${PROJECT}_${key}`)
          ? "applied"
          : "not-applied";
      }
      if (name === "start-dependencies") {
        const pgs = byService("postgres");
        const caches = byService("valkey");
        const mails = byService("mailpit");
        if (pgs.length > 1 || caches.length > 1 || mails.length > 1)
          return "unknown";
        if (
          pgs.length === 1 &&
          caches.length === 1 &&
          mails.length === 1 &&
          pgs[0].State?.Running &&
          caches[0].State?.Running &&
          mails[0].State?.Running &&
          pgs[0].State?.Health?.Status === "healthy" &&
          caches[0].State?.Health?.Status === "healthy" &&
          pgs[0].Mounts?.some(
            (m) =>
              m.Name === `${PROJECT}_postgres-data` &&
              m.Destination === "/var/lib/postgresql",
          )
        )
          return "applied";
        return "not-applied";
      }
      if (name === "start-migration") {
        const waitStep = saved.steps.find((s) =>
          s.name.startsWith("wait-migration:"),
        );
        const mId = waitStep
          ? waitStep.name.slice("wait-migration:".length)
          : undefined;
        const removeRecorded = saved.steps.some((s) =>
          s.name.startsWith("remove-migration:"),
        );
        if (removeRecorded && (!mId || !containersById.has(mId))) {
          return byService("migrate").length === 0 && checkTablesInitialized()
            ? "applied"
            : "not-applied";
        }
        if (mId) {
          return containersById.has(mId) ? "applied" : "not-applied";
        }
        const migs = byService("migrate");
        if (migs.length === 0) return "not-applied";
        const startStep = saved.steps.find((s) => s.name === "start-migration");
        if (migs.length === 1 && startStep?.state === "started")
          return "applied";
        return "unknown";
      }
      if (name.startsWith("wait-migration:")) {
        const mId = name.slice("wait-migration:".length);
        const removeRecorded = saved.steps.some(
          (s) => s.name === `remove-migration:${mId}`,
        );
        if (removeRecorded && !containersById.has(mId)) {
          return checkTablesInitialized() ? "applied" : "not-applied";
        }
        const c = containersById.get(mId);
        if (!c) return "not-applied";
        const thisStep = saved.steps.find((s) => s.name === name);
        if (thisStep?.state === "done") {
          return !c.State?.Running && c.State?.ExitCode === 0
            ? "applied"
            : "not-applied";
        }
        return "not-applied";
      }
      if (name.startsWith("remove-migration:")) {
        const mId = name.slice("remove-migration:".length);
        return !containersById.has(mId) && checkTablesInitialized()
          ? "applied"
          : "not-applied";
      }
      if (name === "release-upgrade") {
        const apps = byService("taskdesk");
        const proxies = byService("traefik");
        if (apps.length > 1 || proxies.length > 1) return "unknown";
        if (apps.some((c) => c.Config?.Image && c.Config.Image !== saved.image))
          return "unknown";
        if (
          apps.length === 1 &&
          apps[0].State?.Running &&
          apps[0].Config?.Image === saved.image &&
          !apps[0].HostConfig?.PublishAllPorts &&
          apps[0].HostConfig?.NetworkMode !== "host" &&
          !Object.keys(apps[0].HostConfig?.PortBindings || {}).length &&
          !Object.values(apps[0].NetworkSettings?.Ports || {}).some(Boolean) &&
          proxies.length === 1 &&
          proxies[0].State?.Running
        )
          return "applied";
        return "not-applied";
      }
      if (name === "seed") {
        const thisStep = saved.steps.find((s) => s.name === "seed");
        if (thisStep?.state !== "done") return "not-applied";
        const credentials = resolve(backupDir, "sit-credentials.json");
        const copyDone = saved.steps.some(
          (s) => s.name === "copy-credentials" && s.state === "done",
        );
        if (copyDone) {
          return existsSync(credentials) && statSync(credentials).size > 0
            ? "applied"
            : "not-applied";
        }
        const apps = byService("taskdesk");
        if (apps.length !== 1 || !apps[0].State?.Running) return "not-applied";
        return tryCmd("docker", [
          "exec",
          apps[0].Id,
          "test",
          "-s",
          "/tmp/sit-credentials.json",
        ])
          ? "applied"
          : "not-applied";
      }
      if (name === "copy-credentials") {
        const credentials = resolve(backupDir, "sit-credentials.json");
        return existsSync(credentials) && statSync(credentials).size > 0
          ? "applied"
          : "not-applied";
      }
      if (name === "remove-temporary-credentials") {
        const apps = byService("taskdesk");
        if (apps.length !== 1 || !apps[0].State?.Running) return "not-applied";
        const absent = tryCmd("docker", [
          "exec",
          apps[0].Id,
          "test",
          "!",
          "-e",
          "/tmp/sit-credentials.json",
        ]);
        return absent ? "applied" : "not-applied";
      }
      if (name.startsWith("readiness:")) {
        const thisStep = saved.steps.find((s) => s.name === name);
        if (thisStep?.state !== "done") return "not-applied";
        const apps = byService("taskdesk");
        const proxies = byService("traefik");
        return apps.length === 1 &&
          apps[0].State?.Running &&
          proxies.length === 1 &&
          proxies[0].State?.Running
          ? "applied"
          : "not-applied";
      }
      if (name === "release-smoke") {
        const thisStep = saved.steps.find((s) => s.name === "release-smoke");
        if (thisStep?.state !== "done") return "not-applied";
        const credentials = resolve(backupDir, "sit-credentials.json");
        return existsSync(credentials) && statSync(credentials).size > 0
          ? "applied"
          : "not-applied";
      }
      return "unknown";
    };

    resumedJournal = resumeFreshJournal(journalFile, inspectStep);
    report(`Resuming fresh install from recovery reference: ${reference}`);
    runFreshInstallSteps({
      journal: resumedJournal,
      plan: {
        containers: saved.containers,
        volumes: saved.volumes,
      },
      backup: backupDir,
      config,
      composeEnv,
      env,
      checkout,
      cmd,
      dc,
      inspect,
      upgrade,
      run,
      report,
      resuming: true,
      liveContainersById: containersById,
    });
    keepLock = false;
    report(
      `Fresh install smoke passed. Private recovery reference: ${reference}`,
    );
  } catch (error) {
    if (resumedJournal) {
      for (const line of formatRecoveryFailureLines(
        reference,
        resumedJournal.snapshot().steps,
        saved.containers,
        saved.volumes,
      ))
        report(line);
    }
    throw error;
  } finally {
    process.umask(previousMask);
    if (!keepLock) release();
  }
}

export function executeRestoreFromBackup({
  reference: requestedReference,
  env,
  run,
  report,
  lock,
  signal,
  checkout,
  clock = () => new Date(),
}) {
  assertPrivateInputs(env, checkout);
  const found = findUnfinishedFreshJournal(
    env.SIT_PRIVATE_DIR,
    requestedReference,
  );
  const { reference, backupDir, journalFile, journal: saved } = found;
  if (
    !IMAGE_PATTERN.test(saved.previousImage || "") ||
    (saved.previousImageId &&
      !/^sha256:[0-9a-f]{64}$/.test(saved.previousImageId))
  )
    throw new Error(
      "Recovery journal does not contain a valid previous signed image digest.",
    );

  const proofRecord = readRestoreProofRecord(backupDir, reference);
  const dump = resolve(backupDir, "postgres.dump");
  const tar = resolve(backupDir, "attachments.tar");
  const privateTar = resolve(backupDir, "private-config.tar");
  const envTar = resolve(backupDir, "compose-env.tar");
  const counts = resolve(backupDir, "counts.txt");
  const sums = resolve(backupDir, "SHA256SUMS");
  for (const file of [dump, tar, privateTar, envTar, counts, sums]) {
    if (!existsSync(file))
      throw new Error("Required backup archive file is missing.");
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Backup archive entry is not a regular file.");
  }
  validateTarFile(tar);

  const release = claimFreshRecoveryLock(env, { lock, signal });
  const previousMask = process.umask(0o077);
  let keepLock = true;
  try {
    const runtime = buildComposeRuntime({
      env,
      run,
      checkout,
      overrideSitImage: saved.previousImage,
      requireClosedSwitches: false,
    });
    const { config, dbName, cmd, dc, inspect } = runtime;
    if (saved.dbName && dbName !== saved.dbName)
      throw new Error("Compose database name disagrees with backup journal.");

    cmd("shasum", ["-a", "256", "-c", sums]);
    for (const f of [tar, privateTar, envTar]) cmd("tar", ["-tf", f]);

    const live = inspectLiveProjectState({
      cmd,
      inspect,
      config,
      env,
      checkout,
    });

    verifySignedImage({
      cmd,
      image: saved.previousImage,
      tag: saved.previousTag,
    });
    dc(["pull", "migrate", "taskdesk"]);
    const imageDetails = inspect(["image", "inspect", saved.previousImage]);
    if (
      imageDetails.length !== 1 ||
      !/^sha256:[0-9a-f]{64}$/.test(imageDetails[0]?.Id || "") ||
      (saved.previousImageId && imageDetails[0].Id !== saved.previousImageId)
    )
      throw new Error("Previous pinned image ID could not be confirmed.");

    markFreshJournalRestoreStarted(journalFile);
    report(`Restoring previous stack from backup reference: ${reference}`);

    for (const id of orderContainersForShutdown(live.containers)) {
      const container = live.containersById.get(id);
      if (container?.State?.Running) cmd("docker", ["stop", id]);
      cmd("docker", ["rm", id]);
    }
    for (const volume of live.volumes) {
      cmd("docker", ["volume", "rm", volume.Name]);
    }

    const volumeKeys = freshVolumeKeysForPlan(saved.volumes || [], config);
    for (const v of volumeKeys) {
      cmd("docker", [
        "volume",
        "create",
        "--label",
        `com.docker.compose.project=${PROJECT}`,
        "--label",
        `com.docker.compose.volume=${v}`,
        `${PROJECT}_${v}`,
      ]);
    }
    const expectedVolumeNames = volumeKeys.map((v) => `${PROJECT}_${v}`);
    const recreatedVolumes = inspect([
      "volume",
      "inspect",
      ...expectedVolumeNames,
    ]);
    const checkedVolumes = planRemoval({
      confirmation: PROJECT,
      config,
      containers: [],
      volumes: recreatedVolumes,
    }).volumes;
    if (
      checkedVolumes.length !== expectedVolumeNames.length ||
      !expectedVolumeNames.every((name) => checkedVolumes.includes(name))
    )
      throw new Error("Restored volume ownership could not be confirmed.");

    dc(["up", "-d", "--wait", "postgres", "valkey", "mailpit"]);
    const pgIds = split(dc(["ps", "--status", "running", "-q", "postgres"]));
    const cacheIds = split(dc(["ps", "--status", "running", "-q", "valkey"]));
    const mailpitIds = split(
      dc(["ps", "--status", "running", "-q", "mailpit"]),
    );
    if (pgIds.length !== 1 || cacheIds.length !== 1 || mailpitIds.length !== 1)
      throw new Error("Restored database, cache and mailpit failed to start.");
    const pgInspect = inspect(["inspect", pgIds[0]]);
    if (
      pgInspect.length !== 1 ||
      pgInspect[0].Config?.Labels?.["com.docker.compose.project"] !== PROJECT ||
      pgInspect[0].State?.Health?.Status !== "healthy" ||
      !pgInspect[0].Mounts?.some(
        (m) =>
          m.Name === `${PROJECT}_postgres-data` &&
          m.Destination === "/var/lib/postgresql",
      )
    )
      throw new Error("Restored database container ownership is unexpected.");

    const dumpFd = openSync(dump, "r");
    try {
      cmd(
        "docker",
        [
          "exec",
          "-i",
          pgIds[0],
          "sh",
          "-c",
          'exec pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U "$POSTGRES_USER" -d "$1"',
          "restore",
          dbName,
        ],
        { stdio: [dumpFd, "pipe", "pipe"] },
      );
    } finally {
      closeSync(dumpFd);
    }

    const expectedCounts = readFileSync(counts, "utf8");
    const checkCounts = () => {
      const actual = cmd(
        "docker",
        [
          "exec",
          "-i",
          pgIds[0],
          "sh",
          "-c",
          'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"',
          "counts",
          dbName,
        ],
        { input: `${COUNT_SQL}\n` },
      );
      if (actual !== expectedCounts)
        throw new Error(
          "Restored database table or row counts do not match backup.",
        );
    };
    checkCounts();

    const migrationId = dc(["run", "-d", "--no-deps", "migrate"]).trim();
    if (!/^[a-f0-9]{64}$/.test(migrationId))
      throw new Error("Restore migration container ID is invalid.");
    const migrationStatus = cmd("docker", ["wait", migrationId], {
      timeout: 300000,
    }).trim();
    cmd("docker", ["rm", migrationId]);
    if (migrationStatus !== "0")
      throw new Error("Restore role and grant bootstrap failed.");
    checkCounts();

    dc(["up", "-d", "--wait", "--no-deps", "taskdesk"]);
    const appIds = split(dc(["ps", "-q", "taskdesk"]));
    if (appIds.length !== 1 || !/^[a-f0-9]{64}$/.test(appIds[0]))
      throw new Error("Restored application container is ambiguous.");
    const appInspect = inspect(["inspect", appIds[0]]);
    if (
      appInspect.length !== 1 ||
      appInspect[0].Config?.Labels?.["com.docker.compose.project"] !==
        PROJECT ||
      appInspect[0].Config?.Image !== saved.previousImage ||
      (saved.previousImageId &&
        appInspect[0].Image !== saved.previousImageId) ||
      appInspect[0].HostConfig?.NetworkMode === "host" ||
      appInspect[0].HostConfig?.PublishAllPorts ||
      Object.keys(appInspect[0].HostConfig?.PortBindings || {}).length ||
      Object.values(appInspect[0].NetworkSettings?.Ports || {}).some(Boolean) ||
      !appInspect[0].Mounts?.some(
        (m) =>
          m.Type === "volume" &&
          m.Name === `${PROJECT}_attachments` &&
          m.Destination === "/app/data/attachments",
      )
    )
      throw new Error(
        "Restored application image, port isolation or volume mount is unexpected.",
      );

    const tarFd = openSync(tar, "r");
    try {
      cmd(
        "docker",
        [
          "exec",
          "-i",
          appIds[0],
          "tar",
          "-C",
          "/app/data/attachments",
          "--no-same-owner",
          "--no-same-permissions",
          "-xf",
          "-",
        ],
        { stdio: [tarFd, "pipe", "pipe"] },
      );
    } finally {
      closeSync(tarFd);
    }

    const restoredAttachments = cmd("docker", [
      "exec",
      appIds[0],
      "node",
      "-e",
      attachmentManifestCode,
      "/app/data/attachments",
    ]);
    if (restoredAttachments !== proofRecord.attachmentManifest)
      throw new Error(
        "Restored attachment files or hashes do not match backup.",
      );

    const port = config.services.taskdesk?.environment?.TASKDESK_PORT || "5173";
    dc([
      "exec",
      "-T",
      "taskdesk",
      "node",
      "-e",
      `fetch('http://127.0.0.1:${port}/api/public/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`,
    ]);

    dc(["up", "-d", "--wait", "--no-deps", "traefik"]);
    const proxyIds = split(dc(["ps", "-q", "traefik"]));
    if (proxyIds.length !== 1 || !/^[a-f0-9]{64}$/.test(proxyIds[0]))
      throw new Error("Restored proxy container failed to start.");
    for (const host of ["ticketing.localhost", "portal.localhost"]) {
      cmd("curl", [
        "--fail",
        "--silent",
        "--show-error",
        "--retry",
        "30",
        "--retry-delay",
        "2",
        "--retry-all-errors",
        "--max-time",
        "5",
        "--insecure",
        `https://${host}/api/public/health/ready`,
      ]);
    }
    checkCounts();

    clearFreshJournalAfterRestore(journalFile, clock().toISOString());
    keepLock = false;
    report(`Restored previous stack from backup reference: ${reference}`);
  } finally {
    process.umask(previousMask);
    if (!keepLock) release();
  }
}
