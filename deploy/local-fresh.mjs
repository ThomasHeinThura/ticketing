#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { G1_ACCOUNTS } from "../apps/api/scripts/uat-seed-plan.ts";
import { assertBackupLocation } from "./local-fresh-location.mjs";
import {
  acquireDaemonProjectLock,
  assertSameDockerDaemon,
  DAEMON_ID_PATTERN,
  readDockerDaemonIdentity,
} from "./local-fresh-lock.mjs";
import { PROJECT, planRemoval } from "./local-fresh-plan.mjs";
import {
  isVerifiedRestoreProof,
  verifyRestoreProof,
} from "./local-fresh-restore-proof.mjs";
import {
  COUNT_SQL,
  orderContainersForShutdown,
  redactFreshText,
  writeCommandOutputAtomically,
} from "./local-fresh-utils.mjs";
import { deployLocalLocked } from "./local-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const split = (s) => s.trim().split(/\s+/).filter(Boolean);
const USAGE = `Preview with no flags or --dry-run; execute with --confirm-wipe ${PROJECT} --confirm-daemon <daemon-id> or --resume-seed <stamp> --confirm-daemon <daemon-id>.`;
const STAMP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const DB_GENERATION_SQL =
  "SELECT s.system_identifier::text || ':' || d.oid::text FROM pg_control_system() s CROSS JOIN pg_database d WHERE d.datname = current_database();";
const SETUP_CHECK_SQL = [
  "SELECT",
  "  CASE WHEN EXISTS(SELECT 1 FROM instance_setting WHERE id = 'singleton' AND setup_completed_at IS NOT NULL) THEN '1' ELSE '0' END,",
  "  CASE WHEN EXISTS(SELECT 1 FROM \"user\" u JOIN two_factor tf ON tf.user_id = u.id WHERE u.role = 'admin' AND u.two_factor_enabled = true AND tf.verified = true) THEN '1' ELSE '0' END,",
  "  CASE WHEN EXISTS(SELECT 1 FROM instance_plugin_config WHERE plugin_id = 'auth.password' AND enabled = true AND scope = 'instance' AND portal_scope IN ('both', 'customer')) THEN '1' ELSE '0' END;",
].join(" ");

function writePrivateJsonAtomically(file, payload) {
  const temp = `${file}.tmp`;
  if (existsSync(temp)) unlinkSync(temp);
  const fd = openSync(temp, "wx", 0o600);
  let closed = false;
  try {
    writeSync(fd, `${JSON.stringify(payload, null, 2)}\n`, null, "utf8");
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

function readDbGeneration({ cmd, dbContainer, dbName }) {
  const raw = cmd(
    "docker",
    [
      "exec",
      "-i",
      dbContainer,
      "sh",
      "-c",
      'exec psql -X -A -t -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"',
      "db-gen",
      dbName,
    ],
    { input: `${DB_GENERATION_SQL}\n` },
  );
  const generation = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!generation || !/^\d+:\d+$/.test(generation))
    throw new Error(
      "Could not inspect PostgreSQL database generation identity.",
    );
  return generation;
}

function readPendingCheckpoint({ privateDir, stamp, dbName, daemonId, image }) {
  const backupsRoot = resolve(privateDir, "fresh-backups");
  const backup = resolve(backupsRoot, stamp);
  if (dirname(backup) !== backupsRoot || !existsSync(backup))
    throw new Error(`Fresh backup checkpoint ${stamp} does not exist.`);
  const sums = resolve(backup, "SHA256SUMS");
  const checkpointFile = resolve(backup, "fresh-setup-pending.json");
  if (!existsSync(sums) || !existsSync(checkpointFile))
    throw new Error(
      `Fresh checkpoint ${stamp} is missing SHA256SUMS or fresh-setup-pending.json.`,
    );
  const parsed = JSON.parse(readFileSync(checkpointFile, "utf8"));
  if (
    !parsed ||
    parsed.stamp !== stamp ||
    parsed.project !== PROJECT ||
    parsed.dbName !== dbName ||
    parsed.daemonId !== daemonId
  )
    throw new Error(
      `Fresh checkpoint ${stamp} does not match target instance.`,
    );
  if (parsed.image !== image)
    throw new Error(`Fresh checkpoint ${stamp} does not match target image.`);
  if (
    typeof parsed.dbGeneration !== "string" ||
    !/^\d+:\d+$/.test(parsed.dbGeneration)
  )
    throw new Error(
      `Fresh checkpoint ${stamp} is missing PostgreSQL database generation identity.`,
    );
  const parsedTs = Date.parse(parsed.createdAt || "");
  for (const entry of readdirSync(backupsRoot, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name === stamp ||
      !STAMP_PATTERN.test(entry.name)
    )
      continue;
    const otherFile = resolve(
      backupsRoot,
      entry.name,
      "fresh-setup-pending.json",
    );
    if (!existsSync(otherFile)) continue;
    let other;
    try {
      other = JSON.parse(readFileSync(otherFile, "utf8"));
    } catch {
      if (entry.name > stamp)
        throw new Error(
          `Fresh checkpoint ${stamp} cannot be verified because newer checkpoint ${entry.name} is unreadable.`,
        );
      continue;
    }
    if (!other || typeof other !== "object") {
      if (entry.name > stamp)
        throw new Error(
          `Fresh checkpoint ${stamp} cannot be verified because newer checkpoint ${entry.name} is unreadable.`,
        );
      continue;
    }
    if (
      typeof other.project !== "string" ||
      typeof other.daemonId !== "string"
    ) {
      if (entry.name > stamp)
        throw new Error(
          `Fresh checkpoint ${stamp} cannot be verified because newer checkpoint ${entry.name} is unreadable.`,
        );
      continue;
    }
    if (other.project !== PROJECT || other.daemonId !== daemonId) continue;
    const otherTs = Date.parse(other.createdAt || "");
    const isNewer =
      Number.isFinite(otherTs) && Number.isFinite(parsedTs)
        ? otherTs > parsedTs || (otherTs === parsedTs && entry.name > stamp)
        : entry.name > stamp;
    if (isNewer)
      throw new Error(
        `Fresh checkpoint ${stamp} has been superseded by newer checkpoint ${entry.name}.`,
      );
  }
  if (parsed.status === "seeded")
    throw new Error(`Fresh checkpoint ${stamp} is already seeded.`);
  if (
    parsed.status !== "awaiting_setup" &&
    parsed.status !== "seeded_awaiting_smoke"
  )
    throw new Error(`Fresh checkpoint ${stamp} is not awaiting setup.`);
  return { backup, sums, checkpointFile, checkpoint: parsed };
}

function assertSetupAndPortalAuthReady({ cmd, dbContainer, dbName }) {
  const raw = cmd(
    "docker",
    [
      "exec",
      "-i",
      dbContainer,
      "sh",
      "-c",
      'exec psql -X -A -t -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"',
      "setup-check",
      dbName,
    ],
    { input: `${SETUP_CHECK_SQL}\n` },
  );
  const line = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  const parts = line ? line.split("|") : [];
  if (parts.length !== 3)
    throw new Error("Could not inspect instance setup state in PostgreSQL.");
  const [setupDone, adminTotp, customerPassword] = parts;
  if (setupDone !== "1")
    throw new Error(
      "Initial instance setup is incomplete; complete /setup first.",
    );
  if (adminTotp !== "1")
    throw new Error(
      "First-admin setup requires a verified TOTP factor before seeding.",
    );
  if (customerPassword !== "1")
    throw new Error(
      "Enable Email/Password authentication (auth.password) for Customer Portal before seeding.",
    );
}

function verifyPublicReady(cmd) {
  for (const host of ["ticketing.localhost", "portal.localhost"])
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

function readValidatedCredentials(credentialsFile) {
  const info = lstatSync(credentialsFile);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error(
      `Fresh credential artifact ${basename(credentialsFile)} must be a private regular file (mode 0600).`,
    );
  }
  const raw = readFileSync(credentialsFile, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Fresh credential artifact ${basename(credentialsFile)} is not valid JSON.`,
    );
  }
  if (
    !Array.isArray(parsed?.accounts) ||
    parsed.accounts.length !== G1_ACCOUNTS.length
  ) {
    throw new Error(
      `Fresh credential artifact ${basename(credentialsFile)} must contain exactly the ${G1_ACCOUNTS.length} UAT accounts.`,
    );
  }
  for (const expected of G1_ACCOUNTS) {
    const matching = parsed.accounts.filter(
      (row) => row && typeof row === "object" && row.email === expected.email,
    );
    if (
      matching.length !== 1 ||
      typeof matching[0].password !== "string" ||
      matching[0].password.length < 24
    ) {
      throw new Error(
        `Fresh credential artifact ${basename(credentialsFile)} has missing, duplicate or weak account credentials.`,
      );
    }
    if (
      matching[0].role !== expected.roleLabel ||
      (matching[0].side !== undefined && matching[0].side !== expected.side)
    ) {
      throw new Error(
        `Fresh credential artifact ${basename(credentialsFile)} has invalid role or side metadata.`,
      );
    }
  }
  return parsed;
}

function removeContainerCredentials({ cmd, containerId }) {
  try {
    cmd("docker", [
      "exec",
      containerId,
      "rm",
      "-f",
      "/tmp/sit-credentials.json",
    ]);
  } catch (error) {
    throw new Error(
      `Failed to remove temporary sit-credentials.json from container ${containerId}: ${error.message}`,
    );
  }
}

function cleanContainerCredentialsAfterError(
  { cmd, containerId },
  primaryError,
) {
  try {
    removeContainerCredentials({ cmd, containerId });
  } catch (cleanupError) {
    throw new Error(`${primaryError.message} (${cleanupError.message})`, {
      cause: primaryError,
    });
  }
  throw primaryError;
}

function restoreContainerCredentials({ cmd, containerId, credentials }) {
  try {
    cmd(
      "docker",
      [
        "exec",
        "-i",
        containerId,
        "sh",
        "-c",
        'umask 077 && rm -f "$1" && cat > "$1"',
        "restore-creds",
        "/tmp/sit-credentials.json",
      ],
      { input: readFileSync(credentials) },
    );
  } catch (error) {
    cleanContainerCredentialsAfterError({ cmd, containerId }, error);
  }
}

function tryRescueContainerCredentials({ cmd, containerId, credentials }) {
  try {
    writeCommandOutputAtomically(credentials, cmd, "docker", [
      "exec",
      containerId,
      "cat",
      "/tmp/sit-credentials.json",
    ]);
    return true;
  } catch (error) {
    if (error.message === "docker exec failed.") return false;
    throw error;
  }
}

function ensureHostCredentials({
  cmd,
  containerId,
  credentials,
  checkpointFile,
  checkpoint,
  clock,
}) {
  if (checkpoint.status === "seeded_awaiting_smoke") {
    if (!existsSync(credentials)) {
      throw new Error(
        `Fresh checkpoint ${checkpoint.stamp} is missing ${basename(credentials)}.`,
      );
    }
    try {
      readValidatedCredentials(credentials);
    } catch (validationError) {
      cleanContainerCredentialsAfterError(
        { cmd, containerId },
        validationError,
      );
    }
    removeContainerCredentials({ cmd, containerId });
    return checkpoint;
  }

  // Restore any preserved or container-resident credentials before re-running
  // the idempotent UAT seed so passwords never drift on recovery.
  if (existsSync(credentials)) {
    try {
      readValidatedCredentials(credentials);
    } catch (validationError) {
      cleanContainerCredentialsAfterError(
        { cmd, containerId },
        validationError,
      );
    }
    restoreContainerCredentials({ cmd, containerId, credentials });
  } else if (tryRescueContainerCredentials({ cmd, containerId, credentials })) {
    try {
      readValidatedCredentials(credentials);
    } catch (validationError) {
      try {
        unlinkSync(credentials);
      } catch {}
      cleanContainerCredentialsAfterError(
        { cmd, containerId },
        validationError,
      );
    }
    restoreContainerCredentials({ cmd, containerId, credentials });
  }

  let seedError = null;
  try {
    cmd("docker", [
      "exec",
      containerId,
      "node",
      "apps/api/dist/seed-uat.js",
      "--uat",
      "--credentials-file",
      "/tmp/sit-credentials.json",
    ]);
  } catch (error) {
    seedError = error;
  }

  let copiedThisAttempt = false;
  if (!existsSync(credentials)) {
    try {
      writeCommandOutputAtomically(credentials, cmd, "docker", [
        "exec",
        containerId,
        "cat",
        "/tmp/sit-credentials.json",
      ]);
      copiedThisAttempt = true;
    } catch (copyError) {
      // Leave /tmp/sit-credentials.json intact if host copy did not finish.
      if (seedError) {
        throw new Error(`${seedError.message} (${copyError.message})`, {
          cause: seedError,
        });
      }
      throw copyError;
    }
  }

  try {
    readValidatedCredentials(credentials);
  } catch (validationError) {
    if (copiedThisAttempt) {
      try {
        unlinkSync(credentials);
      } catch {}
    }
    const baseError = seedError
      ? new Error(`${seedError.message} (${validationError.message})`, {
          cause: seedError,
        })
      : validationError;
    cleanContainerCredentialsAfterError({ cmd, containerId }, baseError);
  }

  try {
    removeContainerCredentials({ cmd, containerId });
  } catch (cleanupError) {
    if (seedError) {
      throw new Error(`${seedError.message} (${cleanupError.message})`, {
        cause: seedError,
      });
    }
    throw cleanupError;
  }

  const credentialsSavedAt = clock().toISOString();
  if (seedError) {
    writePrivateJsonAtomically(checkpointFile, {
      ...checkpoint,
      status: "awaiting_setup",
      credentialsSavedAt,
    });
    throw seedError;
  }

  const activeCheckpoint = {
    ...checkpoint,
    status: "seeded_awaiting_smoke",
    credentialsSavedAt,
  };
  writePrivateJsonAtomically(checkpointFile, activeCheckpoint);
  return activeCheckpoint;
}

function seedAndSmoke({
  cmd,
  dc,
  checkedContainer,
  env,
  composeEnv,
  backup,
  checkpointFile,
  checkpoint,
  clock,
  safeReport,
}) {
  const ids = split(dc(["ps", "-q", "taskdesk"]));
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]))
    throw new Error("Fresh app is ambiguous.");
  const containerId = ids[0];
  checkedContainer(containerId);
  const credentials = resolve(backup, "sit-credentials.json");
  const activeCheckpoint = ensureHostCredentials({
    cmd,
    containerId,
    credentials,
    checkpointFile,
    checkpoint,
    clock,
  });
  verifyPublicReady(cmd);
  const smokeOutput = cmd(
    "node",
    ["scripts/sit/release-smoke.mjs", "--credentials", credentials],
    {
      env: {
        ...composeEnv,
        NODE_EXTRA_CA_CERTS:
          env.NODE_EXTRA_CA_CERTS ||
          resolve(root, "deploy/local/certs/local.crt"),
      },
    },
  );
  for (const line of smokeOutput.split(/\r?\n/).filter(Boolean))
    safeReport(line);
  writePrivateJsonAtomically(checkpointFile, {
    ...activeCheckpoint,
    status: "seeded",
    seededAt: clock().toISOString(),
  });
  safeReport("Fresh install smoke passed.");
}

function parseFreshArgs(args) {
  if (!Array.isArray(args)) throw new Error(USAGE);
  let explicitDryRun = false;
  let allowOpen = false;
  let confirmWipe;
  let confirmDaemon;
  let resumeStamp;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      if (explicitDryRun) throw new Error(USAGE);
      explicitDryRun = true;
    } else if (arg === "--dry-run-allow-open-registration") {
      if (allowOpen) throw new Error(USAGE);
      allowOpen = true;
    } else if (arg === "--confirm-wipe") {
      if (confirmWipe !== undefined || i + 1 >= args.length)
        throw new Error(USAGE);
      confirmWipe = args[++i];
      if (confirmWipe !== PROJECT) throw new Error(USAGE);
    } else if (arg === "--confirm-daemon") {
      if (confirmDaemon !== undefined || i + 1 >= args.length)
        throw new Error(
          `Invalid or missing --confirm-daemon <daemon-id>. ${USAGE}`,
        );
      confirmDaemon = args[++i];
      if (!DAEMON_ID_PATTERN.test(confirmDaemon))
        throw new Error(
          `Invalid --confirm-daemon value; expected a verified Docker daemon ID. ${USAGE}`,
        );
    } else if (arg === "--resume-seed") {
      if (resumeStamp !== undefined || i + 1 >= args.length)
        throw new Error(`Invalid or missing --resume-seed <stamp>. ${USAGE}`);
      resumeStamp = args[++i];
      if (!STAMP_PATTERN.test(resumeStamp))
        throw new Error(`Invalid --resume-seed checkpoint stamp. ${USAGE}`);
    } else {
      throw new Error(USAGE);
    }
  }
  if (allowOpen && !explicitDryRun) throw new Error(USAGE);
  if (
    resumeStamp !== undefined &&
    (explicitDryRun || allowOpen || confirmWipe !== undefined)
  ) {
    throw new Error(
      `Cannot combine --resume-seed with --confirm-wipe or dry-run flags. ${USAGE}`,
    );
  }
  const noConfirmation =
    confirmWipe === undefined &&
    confirmDaemon === undefined &&
    resumeStamp === undefined;
  const dry = explicitDryRun || noConfirmation;
  if (!dry) {
    if (resumeStamp !== undefined) {
      if (confirmDaemon === undefined)
        throw new Error(
          `Refusing --resume-seed without --confirm-daemon <daemon-id>. ${USAGE}`,
        );
      return {
        mode: "resume-seed",
        dry: false,
        allowOpen: false,
        confirmDaemon,
        resumeStamp,
      };
    }
    if (confirmWipe !== PROJECT)
      throw new Error(
        `Refusing real run without --confirm-wipe ${PROJECT}. ${USAGE}`,
      );
    if (confirmDaemon === undefined)
      throw new Error(
        `Refusing real run without --confirm-daemon <daemon-id>. ${USAGE}`,
      );
  }
  return {
    mode: dry ? "dry" : "fresh",
    dry,
    allowOpen,
    confirmDaemon,
    resumeStamp: undefined,
  };
}

export function executeFresh({
  args,
  env = process.env,
  run = spawnSync,
  report = console.log,
  clock = () => new Date(),
  preflight = deployLocalLocked,
  upgrade = deployLocalLocked,
  verifyBackup = verifyRestoreProof,
  lockRoot,
  signal,
}) {
  const { dry, allowOpen, confirmDaemon, resumeStamp } = parseFreshArgs(args);
  const safeReport = (line) =>
    report(redactFreshText(line, { env, checkout: root }));

  for (const key of ["SIT_COMPOSE_ENV", "SIT_PRIVATE_DIR"])
    if (!env[key] || !isAbsolute(env[key]) || !existsSync(env[key]))
      throw new Error(`${key} must be an existing absolute private path.`);
  const daemonOptions = { env, run, checkout: root };
  const daemon = readDockerDaemonIdentity(daemonOptions);
  if (confirmDaemon !== undefined && daemon.daemonId !== confirmDaemon) {
    throw new Error(
      `Docker daemon ID mismatch: expected ${confirmDaemon}, observed ${daemon.daemonId} on context ${daemon.contextName} (${daemon.effectiveEndpoint}).`,
    );
  }
  const release = dry
    ? () => {}
    : acquireDaemonProjectLock({
        daemonId: daemon.daemonId,
        project: PROJECT,
        lockRoot,
        signal,
      });
  const previousMask = dry ? undefined : process.umask(0o077);
  try {
    if (!dry) assertSameDockerDaemon(daemon, daemonOptions);
    const pre = preflight({
      args: [],
      env,
      run,
      preflightOnly: true,
      dryRun: dry,
    });
    const { config, image, dbName, prefix, composeEnv } = pre;
    const pgEnv = config.services.postgres.environment || {};
    if ((pgEnv.POSTGRES_DB || pgEnv.POSTGRES_USER) !== dbName)
      throw new Error(
        "Fresh PostgreSQL database name does not match migration target.",
      );
    const openSwitches = [];
    for (const key of [
      "DISABLE_REGISTRATION",
      "DISABLE_PASSWORD_REGISTRATION",
      "DISABLE_WORKSPACE_CREATION",
    ])
      if (config.services.taskdesk.environment?.[key] !== "true")
        openSwitches.push(key);
    if (openSwitches.length && !allowOpen)
      throw new Error(
        `Private app environment must set ${openSwitches[0]}=true.`,
      );
    if (openSwitches.length)
      safeReport(
        `WARNING: DRY RUN ONLY; private app environment must set ${openSwitches.map((key) => `${key}=true`).join(", ")} before execution.`,
      );

    function cmd(bin, argv, options = {}) {
      const result = run(bin, argv, {
        cwd: root,
        env: composeEnv,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        ...options,
      });
      if (result.error || result.status !== 0)
        throw new Error(`${bin} ${argv[0]} failed.`);
      return result.stdout || "";
    }
    const dc = (argv, options) => cmd("docker", [...prefix, ...argv], options);
    const inspect = (argv) => {
      const parsed = JSON.parse(cmd("docker", argv));
      if (!Array.isArray(parsed))
        throw new Error("Invalid Docker inspection output.");
      return parsed;
    };

    const sameDaemon = () => assertSameDockerDaemon(daemon, daemonOptions);

    function inventory({ requireRunningApp = true } = {}) {
      sameDaemon();
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
      const names = split(
        cmd("docker", [
          "volume",
          "ls",
          "-q",
          "--filter",
          `label=com.docker.compose.project=${PROJECT}`,
        ]),
      );
      const containers = ids.length ? inspect(["inspect", ...ids]) : [];
      const volumes = names.length
        ? inspect(["volume", "inspect", ...names])
        : [];
      assertBackupLocation({
        privateDir: env.SIT_PRIVATE_DIR,
        composeEnv: env.SIT_COMPOSE_ENV,
        checkout: root,
        volumes,
      });
      const plan = planRemoval({
        confirmation: PROJECT,
        config,
        containers,
        volumes,
      });
      if (
        ids.length !== containers.length ||
        names.length !== volumes.length ||
        ids.some((id) => !plan.containers.includes(id)) ||
        names.some((name) => !plan.volumes.includes(name)) ||
        !["postgres-data", "attachments"].every((v) =>
          plan.volumes.includes(`${PROJECT}_${v}`),
        )
      )
        throw new Error("Incomplete project inventory.");
      for (const name of plan.volumes) {
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
        if (users.some((id) => !plan.containers.includes(id)))
          throw new Error(
            "A project volume is referenced by an outside container.",
          );
      }
      const apps = containers.filter(
        (c) =>
          c.Config?.Labels?.["com.docker.compose.service"] === "taskdesk" &&
          (!requireRunningApp || c.State?.Running) &&
          c.Mounts?.some(
            (m) =>
              m.Type === "volume" &&
              m.Name === `${PROJECT}_attachments` &&
              m.Destination === "/app/data/attachments",
          ),
      );
      const dbs = containers.filter(
        (c) =>
          c.Config?.Labels?.["com.docker.compose.service"] === "postgres" &&
          c.State?.Running,
      );
      if (apps.length !== 1 || dbs.length !== 1)
        throw new Error(
          "Expected one running app with attachments and one database.",
        );
      if (!/^sha256:[0-9a-f]{64}$/.test(dbs[0].Image || ""))
        throw new Error("Running database image ID is invalid.");
      return {
        containers: orderContainersForShutdown(containers),
        volumes: [...plan.volumes].sort(),
        app: apps[0].Id,
        db: dbs[0].Id,
        dbImage: dbs[0].Image,
      };
    }

    const plan = inventory();
    const stamp = clock().toISOString().replace(/[:.]/g, "-");
    const backup = resolve(env.SIT_PRIVATE_DIR, "fresh-backups", stamp);
    const dump = resolve(backup, "postgres.dump");
    const tar = resolve(backup, "attachments.tar");
    const privateTar = resolve(backup, "private-config.tar");
    const envTar = resolve(backup, "compose-env.tar");
    const counts = resolve(backup, "counts.txt");
    const sums = resolve(backup, "SHA256SUMS");
    const dbExec = (a) => ["exec", plan.db, ...a];
    const pgDump = dbExec([
      "sh",
      "-c",
      'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$1"',
      "dump",
      dbName,
    ]);
    const pgList = ["exec", "-i", plan.db, "pg_restore", "--list"];
    const countArgs = [
      "exec",
      "-i",
      plan.db,
      "sh",
      "-c",
      'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"',
      "counts",
      dbName,
    ];
    const activeWriterArgs = [
      "exec",
      plan.db,
      "sh",
      "-c",
      'exec psql -X -Atqc "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() " -U "$POSTGRES_USER" -d "$1"',
      "writers",
      dbName,
    ];
    const privateArgs = [
      "-C",
      env.SIT_PRIVATE_DIR,
      "--exclude=./fresh-backups",
      "-cf",
      privateTar,
      ".",
    ];
    const envArgs = [
      "-C",
      dirname(env.SIT_COMPOSE_ENV),
      "-cf",
      envTar,
      basename(env.SIT_COMPOSE_ENV),
    ];
    const checkedContainer = (id) => {
      sameDaemon();
      const liveIds = split(
        cmd("docker", [
          "ps",
          "-a",
          "-q",
          "--no-trunc",
          "--filter",
          `label=com.docker.compose.project=${PROJECT}`,
        ]),
      );
      if (!liveIds.includes(id))
        throw new Error("Container no longer belongs to project inventory.");
      const c = inspect(["inspect", id]);
      if (c.length !== 1 || c[0].Id !== id)
        throw new Error("Container identity changed.");
      planRemoval({
        confirmation: PROJECT,
        config,
        containers: c,
        volumes: [],
      });
      return c[0];
    };
    const checkedVolume = (name) => {
      sameDaemon();
      const liveNames = split(
        cmd("docker", [
          "volume",
          "ls",
          "-q",
          "--filter",
          `label=com.docker.compose.project=${PROJECT}`,
        ]),
      );
      if (!liveNames.includes(name))
        throw new Error("Volume no longer belongs to project inventory.");
      const volumes = inspect(["volume", "inspect", name]);
      if (volumes.length !== 1 || volumes[0].Name !== name)
        throw new Error("Volume identity changed.");
      planRemoval({ confirmation: PROJECT, config, containers: [], volumes });
    };
    if (resumeStamp) {
      const {
        backup: resumeBackup,
        sums: resumeSums,
        checkpointFile,
        checkpoint,
      } = readPendingCheckpoint({
        privateDir: env.SIT_PRIVATE_DIR,
        stamp: resumeStamp,
        dbName,
        daemonId: daemon.daemonId,
        image,
      });
      cmd("shasum", ["-a", "256", "-c", resumeSums]);
      safeReport(`Docker daemon ID: ${daemon.daemonId}`);
      safeReport(`Compose project: ${PROJECT}`);
      safeReport(`Resuming seed from checkpoint: ${resumeStamp}`);
      sameDaemon();
      const liveDbGeneration = readDbGeneration({
        cmd,
        dbContainer: plan.db,
        dbName,
      });
      if (liveDbGeneration !== checkpoint.dbGeneration)
        throw new Error(
          `Fresh checkpoint ${resumeStamp} does not match current PostgreSQL database generation.`,
        );
      assertSetupAndPortalAuthReady({
        cmd,
        dbContainer: plan.db,
        dbName,
      });
      seedAndSmoke({
        cmd,
        dc,
        checkedContainer,
        env,
        composeEnv,
        backup: resumeBackup,
        checkpointFile,
        checkpoint,
        clock,
        safeReport,
      });
      return;
    }
    const appContainers = plan.containers.filter((id) => id !== plan.db);
    safeReport(`Docker daemon ID: ${daemon.daemonId}`);
    safeReport(
      `Docker context: ${daemon.contextName} (${daemon.effectiveEndpoint})`,
    );
    safeReport(`Compose project: ${PROJECT}`);
    safeReport(`Backup directory: ${backup}`);
    safeReport(`Containers: ${plan.containers.join(" ")}`);
    safeReport(`Volumes: ${plan.volumes.join(" ")}`);
    if (dry) {
      safeReport(
        `Dry run: no changes made; confirm daemon with --confirm-wipe ${PROJECT} --confirm-daemon ${daemon.daemonId} to stop application containers, isolate the database, verify the backup, remove the inspected project resources, then install.`,
      );
      return;
    }
    const stopped = [];
    const disconnected = [];
    let removing = false;
    let helper;
    const checkSessions = () => {
      sameDaemon();
      if (cmd("docker", activeWriterArgs).trim() !== "0")
        throw new Error(
          "Database has client sessions; refusing backup or removal.",
        );
    };
    const stopContainer = (id) => {
      const c = checkedContainer(id);
      if (c.State?.Running) {
        stopped.push(id);
        cmd("docker", ["stop", id]);
      }
      if (checkedContainer(id).State?.Running !== false)
        throw new Error("Container did not stop.");
    };
    const cleanupHelper = () => {
      if (!helper) return;
      const c = checkedContainer(helper);
      if (c.Config?.Labels?.["info.taskdesk.attachment-proof"] !== helperMarker)
        throw new Error("Attachment helper ownership changed.");
      cmd("docker", ["rm", "-f", helper]);
      helper = undefined;
    };
    const helperMarker = randomBytes(24).toString("hex");
    try {
      for (const id of appContainers) stopContainer(id);
      const database = checkedContainer(plan.db);
      if (database.HostConfig?.NetworkMode?.startsWith("container:"))
        throw new Error(
          "Shared database network namespace cannot be isolated.",
        );
      for (const net of Object.values(
        database.NetworkSettings?.Networks || {},
      )) {
        if (!/^[a-f0-9]{64}$/.test(net.NetworkID || ""))
          throw new Error("Database network identity is invalid.");
        checkedContainer(plan.db);
        disconnected.push({ id: net.NetworkID, aliases: net.Aliases || [] });
        cmd("docker", ["network", "disconnect", net.NetworkID, plan.db]);
      }
      if (
        Object.keys(checkedContainer(plan.db).NetworkSettings?.Networks || {})
          .length
      )
        throw new Error("Database network isolation failed.");
      for (const id of appContainers)
        if (checkedContainer(id).State?.Running !== false)
          throw new Error("Application write barrier failed.");
      cmd("docker", [
        "exec",
        plan.db,
        "sh",
        "-c",
        'for n in /sys/class/net/*; do [ "$n" = /sys/class/net/lo ] || exit 1; done',
      ]);
      checkSessions();
      mkdirSync(resolve(env.SIT_PRIVATE_DIR, "fresh-backups"), {
        recursive: true,
        mode: 0o700,
      });
      mkdirSync(backup, { mode: 0o700 });
      const into = (file, bin, argv, input) =>
        writeCommandOutputAtomically(file, cmd, bin, argv, input);
      into(dump, "docker", pgDump);
      const dumpFd = openSync(dump, "r");
      let listing;
      try {
        listing = cmd("docker", pgList, { stdio: [dumpFd, "pipe", "pipe"] });
      } finally {
        closeSync(dumpFd);
      }
      if (!listing.split(/\r?\n/).some((line) => /^\d+;/.test(line)))
        throw new Error("Backup restore listing is empty.");
      into(counts, "docker", countArgs, `${COUNT_SQL}\n`);
      checkedVolume(`${PROJECT}_attachments`);
      try {
        helper = cmd("docker", [
          "create",
          "--label",
          `com.docker.compose.project=${PROJECT}`,
          "--label",
          `info.taskdesk.attachment-proof=${helperMarker}`,
          "--network",
          "none",
          "--read-only",
          "--mount",
          `type=volume,src=${PROJECT}_attachments,dst=/app/data/attachments,readonly`,
          "--entrypoint",
          "node",
          image,
          "-e",
          "setInterval(()=>{},60000)",
        ]).trim();
      } catch (error) {
        safeReport(
          `Attachment helper creation uncertain; inspect Docker label info.taskdesk.attachment-proof=${helperMarker} manually.`,
        );
        throw error;
      }
      if (!/^[a-f0-9]{64}$/.test(helper))
        throw new Error("Attachment helper ID is invalid.");
      const helperInfo = checkedContainer(helper);
      if (
        helperInfo.Config?.Labels?.["info.taskdesk.attachment-proof"] !==
          helperMarker ||
        helperInfo.Config?.Image !== image ||
        helperInfo.HostConfig?.NetworkMode !== "none" ||
        helperInfo.HostConfig?.ReadonlyRootfs !== true ||
        helperInfo.Mounts?.length !== 1 ||
        helperInfo.Mounts[0].Type !== "volume" ||
        helperInfo.Mounts[0].Destination !== "/app/data/attachments" ||
        helperInfo.Mounts[0].Name !== `${PROJECT}_attachments` ||
        helperInfo.Mounts[0].RW !== false
      )
        throw new Error("Attachment helper isolation is invalid.");
      cmd("docker", ["start", helper]);
      into(tar, "docker", [
        "exec",
        helper,
        "tar",
        "--format=ustar",
        "-C",
        "/app/data/attachments",
        "-cf",
        "-",
        ".",
      ]);
      cmd("tar", privateArgs);
      cmd("tar", envArgs);
      for (const f of [tar, privateTar, envTar]) cmd("tar", ["-tf", f]);
      into(sums, "shasum", [
        "-a",
        "256",
        dump,
        tar,
        privateTar,
        envTar,
        counts,
      ]);
      cmd("shasum", ["-a", "256", "-c", sums]);
      const receipt = verifyBackup({
        cmd,
        databaseId: plan.db,
        databaseImage: plan.dbImage,
        dbName,
        appId: helper,
        dump,
        counts,
        countSql: COUNT_SQL,
        attachments: tar,
        backupDir: backup,
        report: safeReport,
        beforeRemove: sameDaemon,
      });
      if (
        (verifyBackup === verifyRestoreProof &&
          !isVerifiedRestoreProof(receipt)) ||
        receipt?.verified !== true
      )
        throw new Error("Restore proof must complete in this run.");
      cleanupHelper();
      cmd("shasum", ["-a", "256", "-c", sums]);
      checkSessions();
      for (const id of appContainers)
        if (checkedContainer(id).State?.Running !== false)
          throw new Error("Application write barrier was violated.");
      if (
        Object.keys(checkedContainer(plan.db).NetworkSettings?.Networks || {})
          .length
      )
        throw new Error("Database isolation was violated.");
      const live = inventory({ requireRunningApp: false });
      if (
        JSON.stringify(live.containers) !== JSON.stringify(plan.containers) ||
        JSON.stringify(live.volumes) !== JSON.stringify(plan.volumes)
      )
        throw new Error("Project inventory changed; no removal performed.");
      const remaining = new Set(live.containers);
      for (const id of live.containers) {
        const currentIds = split(
          cmd("docker", [
            "ps",
            "-a",
            "-q",
            "--no-trunc",
            "--filter",
            `label=com.docker.compose.project=${PROJECT}`,
          ]),
        );
        if (
          currentIds.length !== remaining.size ||
          currentIds.some((current) => !remaining.has(current))
        )
          throw new Error("Project inventory changed during removal.");
        cmd("docker", [
          "exec",
          plan.db,
          "sh",
          "-c",
          'for n in /sys/class/net/*; do [ "$n" = /sys/class/net/lo ] || exit 1; done',
        ]);
        checkSessions();
        for (const appId of appContainers.filter((value) =>
          remaining.has(value),
        )) {
          if (checkedContainer(appId).State?.Running !== false)
            throw new Error("Application write barrier was violated.");
        }
        if (
          Object.keys(checkedContainer(plan.db).NetworkSettings?.Networks || {})
            .length
        )
          throw new Error("Database isolation was violated.");
        const c = checkedContainer(id);
        if (c.State?.Running) {
          stopped.push(id);
          cmd("docker", ["stop", id]);
        }
        checkedContainer(id);
        removing = true;
        cmd("docker", ["rm", id]);
        remaining.delete(id);
        safeReport(`Removed container ${id}`);
      }
      for (const name of live.volumes) {
        checkedVolume(name);
        if (
          split(
            cmd("docker", [
              "ps",
              "-a",
              "-q",
              "--no-trunc",
              "--filter",
              `volume=${name}`,
            ]),
          ).length
        )
          throw new Error("Volume has remaining users.");
        checkedVolume(name);
        cmd("docker", ["volume", "rm", name]);
        safeReport(`Removed volume ${name}`);
      }
      for (const name of live.volumes) {
        sameDaemon();
        const key = name.slice(PROJECT.length + 1);
        cmd("docker", [
          "volume",
          "create",
          "--label",
          `com.docker.compose.project=${PROJECT}`,
          "--label",
          `com.docker.compose.volume=${key}`,
          name,
        ]);
        checkedVolume(name);
      }
      const requireServicesAbsent = (services) => {
        sameDaemon();
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
        if (ids.length !== current.length)
          throw new Error("Project service inventory is incomplete.");
        planRemoval({
          confirmation: PROJECT,
          config,
          containers: current,
          volumes: [],
        });
        if (
          current.some((c) =>
            services.includes(c.Config?.Labels?.["com.docker.compose.service"]),
          )
        )
          throw new Error(
            "Fresh service already exists; refusing Compose replacement.",
          );
      };
      requireServicesAbsent(["postgres", "valkey", "mailpit"]);
      dc(["up", "-d", "--wait", "postgres", "valkey", "mailpit"]);
      sameDaemon();
      const migration = dc(["run", "-d", "--no-deps", "migrate"]).trim();
      if (!/^[a-f0-9]{64}$/.test(migration))
        throw new Error("Migration ID invalid.");
      const result = cmd("docker", ["wait", migration], {
        timeout: 300000,
      }).trim();
      checkedContainer(migration);
      cmd("docker", ["rm", migration]);
      if (result !== "0") throw new Error("Migration failed.");
      const guardedRun = (bin, argv, options) => {
        if (bin === "docker" && ["stop", "rm"].includes(argv[0])) {
          const target = argv.at(-1);
          if (!/^[a-f0-9]{64}$/.test(target || ""))
            throw new Error("Upgrade removal target is invalid.");
          checkedContainer(target);
        } else if (
          bin === "docker" &&
          argv[0] === "compose" &&
          argv.includes("up")
        ) {
          const service = argv.at(-1);
          if (!["taskdesk", "traefik"].includes(service))
            throw new Error("Unexpected Compose replacement target.");
          requireServicesAbsent([service]);
        } else if (
          bin === "docker" &&
          (["create", "start"].includes(argv[0]) ||
            (argv[0] === "compose" &&
              (argv.includes("pull") || argv.includes("run"))))
        ) {
          sameDaemon();
        }
        return run(bin, argv, options);
      };
      upgrade({ args: [], env, run: guardedRun, report: safeReport });
      sameDaemon();
      const ids = split(dc(["ps", "-q", "taskdesk"]));
      if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]))
        throw new Error("Fresh app is ambiguous.");
      checkedContainer(ids[0]);
      verifyPublicReady(cmd);
      const pgIds = split(dc(["ps", "-q", "postgres"]));
      if (pgIds.length !== 1 || !/^[a-f0-9]{64}$/.test(pgIds[0]))
        throw new Error("Fresh PostgreSQL container is ambiguous.");
      checkedContainer(pgIds[0]);
      const dbGeneration = readDbGeneration({
        cmd,
        dbContainer: pgIds[0],
        dbName,
      });
      const checkpointFile = resolve(backup, "fresh-setup-pending.json");
      writePrivateJsonAtomically(checkpointFile, {
        stamp,
        project: PROJECT,
        dbName,
        image,
        dbGeneration,
        daemonId: daemon.daemonId,
        createdAt: clock().toISOString(),
        status: "awaiting_setup",
      });
      safeReport(
        `Fresh empty install ready (checkpoint ${stamp}); complete first-admin setup with verified TOTP via /setup and enable Customer Portal Email/Password (auth.password) before seeding.`,
      );
      safeReport(
        `Then run: node deploy/local-fresh.mjs --resume-seed ${stamp} --confirm-daemon ${daemon.daemonId}`,
      );
    } catch (error) {
      try {
        cleanupHelper();
      } catch {
        safeReport(
          `Attachment helper cleanup failed; inspect exact ID ${helper} manually.`,
        );
      }
      if (!removing) {
        for (const network of disconnected) {
          try {
            checkedContainer(plan.db);
            cmd("docker", [
              "network",
              "connect",
              ...network.aliases.flatMap((alias) => ["--alias", alias]),
              network.id,
              plan.db,
            ]);
          } catch {
            safeReport(
              `Database network reconnection failed for ${network.id}.`,
            );
          }
        }
        for (const id of [...stopped].reverse()) {
          try {
            checkedContainer(id);
            cmd("docker", ["start", id]);
          } catch {
            safeReport(`Restart failed for ${id}.`);
          }
        }
      }
      throw error;
    }
  } finally {
    if (previousMask !== undefined) process.umask(previousMask);
    release();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    executeFresh({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(
      `Local fresh install stopped: ${redactFreshText(error.message, { env: process.env, checkout: root })}`,
    );
    process.exitCode = 1;
  }
}
