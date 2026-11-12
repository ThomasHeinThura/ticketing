#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openFreshJournal } from "./local-fresh-journal.mjs";
import { assertBackupLocation } from "./local-fresh-location.mjs";
import { clearFreshStaleLock, inspectFreshLock } from "./local-fresh-lock.mjs";
import { PROJECT, planRemoval } from "./local-fresh-plan.mjs";
import {
  COUNT_SQL,
  executeRestoreFromBackup,
  executeResume,
  formatRecoveryFailureLines,
  freshVolumeKeysForPlan,
  IMAGE_PATTERN,
  orderContainersForShutdown,
  redactFreshText,
  runFreshInstallSteps,
  writeCommandOutputAtomically,
} from "./local-fresh-recovery.mjs";
import {
  attachmentManifestCode,
  isVerifiedRestoreProof,
  ProofCleanupUncertain,
  verifyRestoreProof,
  writeRestoreProofRecord,
} from "./local-fresh-restore-proof.mjs";
import {
  acquireLocalReleaseLock,
  deployLocalLocked,
} from "./local-release.mjs";
import { previewLocalRelease } from "./local-release-preview.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const split = (s) => s.trim().split(/\s+/).filter(Boolean);
const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const show = (bin, args) => [bin, ...args].map(quote).join(" ");

const USAGE = `Use --confirm-wipe ${PROJECT} [--dry-run], --resume [<reference>], --restore-from-backup [<reference>], or --clear-stale-lock.`;

export function executeFresh({
  args,
  env = process.env,
  run = spawnSync,
  report = console.log,
  clock = () => new Date(),
  preflight = deployLocalLocked,
  upgrade = deployLocalLocked,
  previewUpgrade = previewLocalRelease,
  lock = acquireLocalReleaseLock,
  verifyBackup = verifyRestoreProof,
  signal,
}) {
  if (!Array.isArray(args) || args.length === 0) throw new Error(USAGE);
  const safeReport = (line) =>
    report(redactFreshText(line, { env, checkout: root }));

  if (args.length === 1 && args[0] === "--clear-stale-lock") {
    for (const key of ["SIT_COMPOSE_ENV", "SIT_PRIVATE_DIR"]) {
      if (!env[key] || !isAbsolute(env[key]) || !existsSync(env[key]))
        throw new Error(`${key} must be an existing absolute private path.`);
    }
    assertBackupLocation({
      privateDir: env.SIT_PRIVATE_DIR,
      composeEnv: env.SIT_COMPOSE_ENV,
      checkout: root,
      volumes: [],
    });
    const state = inspectFreshLock(env, signal ? { signal } : undefined);
    if (state.state !== "stale" || state.hasJournal)
      throw new Error(
        "Only a stale lock without a pending journal can be cleared.",
      );
    safeReport(
      `Stale lock owner PID ${state.pid}, created ${state.createdAt}.`,
    );
    clearFreshStaleLock(env, signal ? { signal } : undefined);
    safeReport("Stale lock cleared.");
    return;
  }

  if (args[0] === "--resume") {
    if (args.length > 2 || (args.length === 2 && args[1].startsWith("--")))
      throw new Error(USAGE);
    executeResume({
      reference: args[1],
      env,
      run,
      report: safeReport,
      upgrade,
      lock,
      signal,
      checkout: root,
    });
    return;
  }

  if (args[0] === "--restore-from-backup") {
    if (args.length > 2 || (args.length === 2 && args[1].startsWith("--")))
      throw new Error(USAGE);
    executeRestoreFromBackup({
      reference: args[1],
      env,
      run,
      report: safeReport,
      lock,
      signal,
      checkout: root,
      clock,
    });
    return;
  }

  const dry = args.includes("--dry-run");
  const allowOpen = args.includes("--dry-run-allow-open-registration");
  const rest = args.filter(
    (a) => !["--dry-run", "--dry-run-allow-open-registration"].includes(a),
  );
  if (
    rest.length !== 2 ||
    rest[0] !== "--confirm-wipe" ||
    rest[1] !== PROJECT ||
    args.filter((a) => a === "--dry-run").length > 1 ||
    args.filter((a) => a === "--dry-run-allow-open-registration").length > 1 ||
    (allowOpen && !dry)
  )
    throw new Error(USAGE);

  for (const key of ["SIT_COMPOSE_ENV", "SIT_PRIVATE_DIR"])
    if (!env[key] || !isAbsolute(env[key]) || !existsSync(env[key]))
      throw new Error(`${key} must be an existing absolute private path.`);
  const priorState = inspectFreshLock(env, signal ? { signal } : undefined);
  if (priorState.hasJournal)
    throw new Error(
      "Unfinished recovery journal or proof cleanup requires operator recovery; fresh installation is blocked.",
    );

  let release;
  try {
    release = dry ? () => {} : lock(env);
  } catch (error) {
    const state = inspectFreshLock(env, signal ? { signal } : undefined);
    if (state.state === "stale") {
      safeReport(
        `Stale lock owner PID ${state.pid}, created ${state.createdAt}; ${state.hasJournal ? "a recovery journal exists and must be resolved" : "run scripts/deploy.sh local-fresh --clear-stale-lock to clear it"}.`,
      );
    }
    throw error;
  }

  const previousMask = dry ? undefined : process.umask(0o077);
  let keepLock = false;
  try {
    const preflightCommands = [];
    const pre = preflight({
      args: [],
      env,
      run: dry
        ? (bin, argv, options) => {
            preflightCommands.push([bin, ...argv]);
            return run(bin, argv, options);
          }
        : run,
      preflightOnly: true,
      dryRun: dry,
    });
    const { config, image, tag, dbName, prefix, composeEnv } = pre;
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
      report(
        `WARNING: DRY RUN ONLY; private app environment must set ${openSwitches.map((key) => `${key}=true`).join(", ")} before execution.`,
      );

    const inventoryCommands = [];
    function cmd(bin, argv, options = {}) {
      if (dry) inventoryCommands.push([bin, ...argv]);
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

    function inventory() {
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
        confirmation: rest[1],
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
          c.State?.Running &&
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
      const previousImageId = apps[0].Image;
      if (!/^sha256:[0-9a-f]{64}$/.test(previousImageId || ""))
        throw new Error("Running application image ID is invalid.");
      let previousImage = apps[0].Config?.Image || "";
      let previousTag;
      if (!IMAGE_PATTERN.test(previousImage)) {
        const tagMatch =
          /^ghcr\.io\/thomasheinthura\/taskdesk:([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$/.exec(
            previousImage,
          );
        if (tagMatch) previousTag = tagMatch[1];
        const imgDetails = inspect(["image", "inspect", previousImageId]);
        const repoDigest = (imgDetails[0]?.RepoDigests || []).find((d) =>
          IMAGE_PATTERN.test(d),
        );
        if (!repoDigest)
          throw new Error(
            "Running application image does not have a pinned signed release digest.",
          );
        previousImage = repoDigest;
      } else if (previousImage === image) {
        previousTag = tag;
      }
      return {
        containers: orderContainersForShutdown(containers),
        volumes: [...plan.volumes].sort(),
        app: apps[0].Id,
        db: dbs[0].Id,
        dbImage: dbs[0].Image,
        previousImage,
        previousImageId,
        previousTag,
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
    const proofFile = resolve(backup, "restore-proof.json");
    const journalFile = resolve(backup, "journal.json");
    const dcargs = (a) => [...prefix, ...a];
    const dbExec = (a) => ["exec", plan.db, ...a];
    const pgDump = dbExec([
      "sh",
      "-c",
      'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$1"',
      "dump",
      dbName,
    ]);
    const pgList = ["exec", "-i", plan.db, "pg_restore", "--list"];
    const countSql = COUNT_SQL;
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
      'exec psql -X -Atqc "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> \'idle\'" -U "$POSTGRES_USER" -d "$1"',
      "writers",
      dbName,
    ];
    const attachmentArgs = [
      "exec",
      plan.app,
      "tar",
      "--format=ustar",
      "-C",
      "/app/data/attachments",
      "-cf",
      "-",
      ".",
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
    const verifyCommands = [
      [
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
      ],
      [
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
      ],
    ];
    const masked = (value) => {
      let result = String(value);
      for (const [path, label] of [
        [env.SIT_COMPOSE_ENV, "<private-compose-env>"],
        [env.SIT_PRIVATE_DIR, "<private-dir>"],
        [dirname(env.SIT_COMPOSE_ENV), "<private-compose-dir>"],
        [root, "<checkout>"],
        [env.NODE_EXTRA_CA_CERTS, "<private-ca-certificate>"],
      ]) {
        if (path) result = result.replaceAll(path, label);
      }
      if (result === dbName) return "<database-name>";
      if (result === basename(env.SIT_COMPOSE_ENV))
        return "<private-env-filename>";
      return result;
    };
    const render = (command) => show(command[0], command.slice(1).map(masked));
    const migrationId = "<new-fresh-migration-id>";
    const appId = "<new-application-id>";
    const freshVolumeKeys = freshVolumeKeysForPlan(plan.volumes, config);

    if (dry) {
      const lines = [
        `IMAGE ${image} TAG ${tag}`,
        `PREVIOUS_IMAGE ${plan.previousImage}`,
        "Runtime-created IDs and the random marker are shown as tokens; their values do not exist during a read-only preview.",
        ...preflightCommands.map(render),
        ...verifyCommands.map(([bin, argv]) => render([bin, ...argv])),
        ...inventoryCommands.map(render),
        `filesystem mkdir recursive mode=0700 ${quote(masked(backup))}`,
        `${render(["docker", ...pgDump])} > ${quote(masked(dump))}`,
        `${render(["docker", ...pgList])} < ${quote(masked(dump))}`,
        `stdin ${quote(countSql)} | ${render(["docker", ...countArgs])} > ${quote(masked(counts))}`,
        `${render(["docker", ...attachmentArgs])} > ${quote(masked(tar))}`,
        render(["tar", ...privateArgs]),
        render(["tar", ...envArgs]),
        ...[tar, privateTar, envTar].map((f) => render(["tar", "-tf", f])),
        `${render(["shasum", "-a", "256", dump, tar, privateTar, envTar, counts])} > ${quote(masked(sums))}`,
        render(["shasum", "-a", "256", "-c", sums]),
        render([
          "docker",
          "exec",
          plan.app,
          "node",
          "-e",
          attachmentManifestCode,
          "/app/data/attachments",
        ]),
        "filesystem validate tar headers and create private temporary extraction directory",
        render([
          "tar",
          "-C",
          "<private-proof-directory>",
          "--no-same-owner",
          "--no-same-permissions",
          "-xf",
          tar,
        ]),
        render([
          "node",
          "-e",
          attachmentManifestCode,
          "<private-proof-directory>",
        ]),
        render([
          "docker",
          "exec",
          plan.app,
          "node",
          "-e",
          attachmentManifestCode,
          "/app/data/attachments",
        ]),
        render([
          "docker",
          "create",
          "--name",
          "taskdesk-fresh-restore-proof-<random-marker>",
          "--label",
          "info.taskdesk.restore-proof=<random-marker>",
          "--network",
          "none",
          "--tmpfs",
          "/var/lib/postgresql:rw,nosuid,nodev",
          "--env",
          "POSTGRES_HOST_AUTH_METHOD=trust",
          plan.dbImage,
        ]),
        render(["docker", "inspect", "<restore-proof-id>"]),
        render(["docker", "start", "<restore-proof-id>"]),
        render([
          "docker",
          "exec",
          "<restore-proof-id>",
          "pg_isready",
          "-U",
          "postgres",
        ]),
        `${render(["docker", "exec", "-i", "<restore-proof-id>", "pg_restore", "--exit-on-error", "--no-owner", "--no-acl", "-U", "postgres", "-d", "postgres"])} < ${quote(masked(dump))}`,
        `stdin ${quote(countSql)} | ${render(["docker", "exec", "-i", "<restore-proof-id>", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"])}`,
        render(["docker", ...activeWriterArgs]),
        `stdin ${quote(countSql)} | ${render(["docker", ...countArgs])}`,
        render(["docker", "rm", "-f", "-v", "<restore-proof-id>"]),
        render([
          "docker",
          "ps",
          "-a",
          "-q",
          "--no-trunc",
          "--filter",
          "id=<restore-proof-id>",
        ]),
        "filesystem remove exact private proof directory",
        `filesystem write mode=0600 ${quote(masked(proofFile))}`,
        ...inventoryCommands.map(render),
        `filesystem open journal mode=0600 ${quote(masked(journalFile))}`,
        ...plan.containers.flatMap((id) => [
          render(["docker", "stop", id]),
          render(["docker", "rm", id]),
        ]),
        ...plan.volumes.map((name) => render(["docker", "volume", "rm", name])),
        ...freshVolumeKeys.map((v) =>
          render([
            "docker",
            "volume",
            "create",
            "--label",
            `com.docker.compose.project=${PROJECT}`,
            "--label",
            `com.docker.compose.volume=${v}`,
            `${PROJECT}_${v}`,
          ]),
        ),
        render([
          "docker",
          "volume",
          "inspect",
          ...freshVolumeKeys.map((v) => `${PROJECT}_${v}`),
        ]),
        render([
          "docker",
          ...dcargs(["up", "-d", "--wait", "postgres", "valkey", "mailpit"]),
        ]),
        render([
          "docker",
          ...dcargs(["ps", "--status", "running", "-q", "mailpit"]),
        ]),
        render(["docker", ...dcargs(["run", "-d", "--no-deps", "migrate"])]),
        render(["docker", "wait", migrationId]),
        render(["docker", "rm", migrationId]),
        ...previewUpgrade({
          env,
          config,
          image,
          tag,
          contextName: preflightCommands.find(
            (c) =>
              c[0] === "docker" && c[1] === "context" && c[2] === "inspect",
          )?.[3],
        }).map(render),
        render(["docker", ...dcargs(["ps", "-q", "taskdesk"])]),
        render([
          "docker",
          "exec",
          appId,
          "node",
          "apps/api/dist/seed-sit-users.js",
          "--sit",
          "--credentials-file",
          "/tmp/sit-credentials.json",
        ]),
        `${render(["docker", "exec", appId, "cat", "/tmp/sit-credentials.json"])} > ${quote(masked(resolve(backup, "sit-credentials.json")))}`,
        render([
          "docker",
          "exec",
          appId,
          "rm",
          "-f",
          "/tmp/sit-credentials.json",
        ]),
        ...["ticketing.localhost", "portal.localhost"].map((host) =>
          render([
            "curl",
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
        ),
        `NODE_EXTRA_CA_CERTS=${quote(masked(env.NODE_EXTRA_CA_CERTS || resolve(root, "deploy/local/certs/local.crt")))} ${render(
          [
            "node",
            "scripts/sit/release-smoke.mjs",
            "--credentials",
            resolve(backup, "sit-credentials.json"),
          ],
        )}`,
        `recovery resume: scripts/deploy.sh local-fresh --resume ${stamp}`,
        `recovery restore: scripts/deploy.sh local-fresh --restore-from-backup ${stamp}`,
        "recovery stale-lock: scripts/deploy.sh local-fresh --clear-stale-lock",
      ];
      for (const line of lines) report(line);
      return;
    }

    mkdirSync(backup, { recursive: true, mode: 0o700 });
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
    into(counts, "docker", countArgs, `${countSql}\n`);
    into(tar, "docker", attachmentArgs);
    cmd("tar", privateArgs);
    cmd("tar", envArgs);
    for (const f of [tar, privateTar, envTar]) cmd("tar", ["-tf", f]);
    into(sums, "shasum", ["-a", "256", dump, tar, privateTar, envTar, counts]);
    cmd("shasum", ["-a", "256", "-c", sums]);

    let proofReceipt;
    try {
      proofReceipt = verifyBackup({
        cmd,
        databaseId: plan.db,
        databaseImage: plan.dbImage,
        dbName,
        appId: plan.app,
        dump,
        counts,
        countSql,
        attachments: tar,
        backupDir: backup,
        report: safeReport,
      });
    } catch (error) {
      if (error instanceof ProofCleanupUncertain) {
        keepLock = true;
        writeFileSync(
          resolve(backup, "proof-uncertain"),
          `${redactFreshText(error.message, { env, checkout: root })}\n`,
          { flag: "wx", mode: 0o600 },
        );
        safeReport(
          `Restore proof cleanup is uncertain; retain the lock and inspect private recovery reference ${stamp}.`,
        );
      }
      throw error;
    }
    if (
      (verifyBackup === verifyRestoreProof &&
        !isVerifiedRestoreProof(proofReceipt)) ||
      proofReceipt === false
    ) {
      throw new Error(
        "Restore proof must complete in this run before any resource is removed.",
      );
    }
    writeRestoreProofRecord(
      backup,
      stamp,
      isVerifiedRestoreProof(proofReceipt)
        ? proofReceipt
        : {
            verified: true,
            verifiedAt: clock().toISOString(),
            attachmentManifest:
              typeof proofReceipt?.attachmentManifest === "string"
                ? proofReceipt.attachmentManifest
                : "[]",
          },
    );

    const current = inventory();
    if (JSON.stringify(current) !== JSON.stringify(plan))
      throw new Error(
        "Project inventory changed after backup; no removal performed.",
      );

    const journal = openFreshJournal(journalFile, {
      reference: stamp,
      image,
      tag,
      dbName,
      previousImage: plan.previousImage,
      previousImageId: plan.previousImageId,
      ...(plan.previousTag ? { previousTag: plan.previousTag } : {}),
      containers: plan.containers,
      volumes: plan.volumes,
    });
    safeReport(`Recovery reference: ${stamp}`);

    let removalStarted = false;
    try {
      runFreshInstallSteps({
        journal,
        plan,
        backup,
        config,
        composeEnv,
        env,
        checkout: root,
        cmd,
        dc,
        inspect,
        upgrade,
        run,
        report: safeReport,
        resuming: false,
        onRemovalStart: () => {
          removalStarted = true;
        },
      });
      safeReport(
        `Fresh install smoke passed. Private recovery reference: ${stamp}`,
      );
    } catch (error) {
      if (removalStarted) {
        keepLock = true;
        for (const line of formatRecoveryFailureLines(
          stamp,
          journal.snapshot().steps,
          plan.containers,
          plan.volumes,
        )) {
          safeReport(line);
        }
      }
      throw error;
    }
  } finally {
    if (previousMask !== undefined) process.umask(previousMask);
    if (!keepLock) release();
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
