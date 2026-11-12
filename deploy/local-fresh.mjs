#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const USAGE = `Preview with no flags or --dry-run; execute with --confirm-wipe ${PROJECT} --confirm-daemon <daemon-id>.`;

function parseFreshArgs(args) {
  if (!Array.isArray(args)) throw new Error(USAGE);
  let explicitDryRun = false;
  let allowOpen = false;
  let confirmWipe;
  let confirmDaemon;
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
    } else {
      throw new Error(USAGE);
    }
  }
  if (allowOpen && !explicitDryRun) throw new Error(USAGE);
  const noConfirmation =
    confirmWipe === undefined && confirmDaemon === undefined;
  const dry = explicitDryRun || noConfirmation;
  if (!dry) {
    if (confirmWipe !== PROJECT)
      throw new Error(
        `Refusing real run without --confirm-wipe ${PROJECT}. ${USAGE}`,
      );
    if (confirmDaemon === undefined)
      throw new Error(
        `Refusing real run without --confirm-daemon <daemon-id>. ${USAGE}`,
      );
  }
  return { dry, allowOpen, confirmDaemon };
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
  const { dry, allowOpen, confirmDaemon } = parseFreshArgs(args);
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
      cmd("docker", [
        "exec",
        ids[0],
        "node",
        "apps/api/dist/seed-sit-users.js",
        "--sit",
        "--credentials-file",
        "/tmp/sit-credentials.json",
      ]);
      const credentials = resolve(backup, "sit-credentials.json");
      into(credentials, "docker", [
        "exec",
        ids[0],
        "cat",
        "/tmp/sit-credentials.json",
      ]);
      cmd("docker", ["exec", ids[0], "rm", "-f", "/tmp/sit-credentials.json"]);
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
      safeReport("Fresh install smoke passed.");
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
