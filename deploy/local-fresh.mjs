#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT, planRemoval } from "./local-fresh-plan.mjs";
import {
  acquireLocalReleaseLock,
  deployLocalLocked,
} from "./local-release.mjs";
import { previewLocalRelease } from "./local-release-preview.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const split = (s) => s.trim().split(/\s+/).filter(Boolean);
const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const show = (bin, args) => [bin, ...args].map(quote).join(" ");

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
}) {
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
    throw new Error(`Use --confirm-wipe ${PROJECT} [--dry-run].`);
  for (const key of ["SIT_COMPOSE_ENV", "SIT_PRIVATE_DIR"])
    if (!env[key] || !isAbsolute(env[key]) || !existsSync(env[key]))
      throw new Error(`${key} must be an existing absolute private path.`);
  const release = dry ? () => {} : lock(env);
  const previousMask = dry ? undefined : process.umask(0o077);
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
    const inspect = (argv) => JSON.parse(cmd("docker", argv));
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
      return {
        containers: [...plan.containers].sort(),
        volumes: [...plan.volumes].sort(),
        app: apps[0].Id,
        db: dbs[0].Id,
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
    const countSql =
      "SELECT count(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';\nSELECT format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I;', table_schema||'.'||table_name, table_schema, table_name) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name \\gexec";
    const countArgs = [
      "exec",
      "-i",
      plan.db,
      ...[
        "sh",
        "-c",
        'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"',
        "counts",
        dbName,
      ],
    ];
    const attachmentArgs = [
      "exec",
      plan.app,
      "tar",
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
    const lines = dry
      ? [
          `IMAGE ${image} TAG ${tag}`,
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
          ...inventoryCommands.map(render),
          ...plan.containers.flatMap((id) => [
            render(["docker", "stop", id]),
            render(["docker", "rm", id]),
          ]),
          ...plan.volumes.map((name) =>
            render(["docker", "volume", "rm", name]),
          ),
          ...["postgres-data", "attachments"].map((v) =>
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
            `${PROJECT}_postgres-data`,
            `${PROJECT}_attachments`,
          ]),
          render([
            "docker",
            ...dcargs(["up", "-d", "--wait", "postgres", "valkey"]),
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
        ]
      : [];
    if (dry) {
      for (const line of lines) report(line);
      return;
    }
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    const into = (file, bin, argv, input) => {
      const fd = openSync(file, "wx", 0o600);
      try {
        cmd(bin, argv, { input, stdio: ["pipe", fd, "pipe"] });
      } finally {
        closeSync(fd);
      }
    };
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
    const current = inventory();
    if (JSON.stringify(current) !== JSON.stringify(plan))
      throw new Error(
        "Project inventory changed after backup; no removal performed.",
      );
    for (const id of plan.containers) {
      cmd("docker", ["stop", id]);
      cmd("docker", ["rm", id]);
      report(`Removed container ${id}`);
    }
    for (const name of plan.volumes) {
      cmd("docker", ["volume", "rm", name]);
      report(`Removed volume ${name}`);
    }
    for (const v of ["postgres-data", "attachments"]) {
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
    const newVolumes = inspect([
      "volume",
      "inspect",
      `${PROJECT}_postgres-data`,
      `${PROJECT}_attachments`,
    ]);
    const checkedVolumes = planRemoval({
      confirmation: PROJECT,
      config,
      containers: [],
      volumes: newVolumes,
    }).volumes;
    if (
      checkedVolumes.length !== 2 ||
      !["postgres-data", "attachments"].every((v) =>
        checkedVolumes.includes(`${PROJECT}_${v}`),
      )
    )
      throw new Error("Fresh volume ownership could not be confirmed.");
    dc(["up", "-d", "--wait", "postgres", "valkey"]);
    const migration = dc(["run", "-d", "--no-deps", "migrate"]).trim();
    if (!/^[a-f0-9]{64}$/.test(migration))
      throw new Error("Migration ID invalid; inspect project.");
    let result;
    try {
      result = cmd("docker", ["wait", migration], { timeout: 300000 }).trim();
    } catch {
      try {
        cmd("docker", ["stop", "--time", "10", migration], { timeout: 30000 });
      } catch {}
      try {
        cmd("docker", ["rm", "-f", migration], { timeout: 30000 });
        report(`Removed migration container ${migration}`);
      } catch {
        throw new Error(
          `Migration wait and cleanup failed; inspect ${migration}.`,
        );
      }
      throw new Error("Migration wait failed.");
    }
    cmd("docker", ["rm", migration]);
    report(`Removed migration container ${migration}`);
    if (result !== "0") throw new Error("Migration failed.");
    upgrade({ args: [], env, run, report });
    const appIds = split(dc(["ps", "-q", "taskdesk"]));
    if (appIds.length !== 1 || !/^[a-f0-9]{64}$/.test(appIds[0]))
      throw new Error("Fresh app container is ambiguous.");
    const seed = [
      "exec",
      appIds[0],
      "node",
      "apps/api/dist/seed-sit-users.js",
      "--sit",
      "--credentials-file",
      "/tmp/sit-credentials.json",
    ];
    cmd("docker", seed);
    const credentials = resolve(backup, "sit-credentials.json");
    into(credentials, "docker", [
      "exec",
      appIds[0],
      "cat",
      "/tmp/sit-credentials.json",
    ]);
    cmd("docker", ["exec", appIds[0], "rm", "-f", "/tmp/sit-credentials.json"]);
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
    cmd(
      "node",
      ["scripts/sit/release-smoke.mjs", "--credentials", credentials],
      {
        env: {
          ...composeEnv,
          NODE_EXTRA_CA_CERTS:
            env.NODE_EXTRA_CA_CERTS ||
            resolve(root, "deploy/local/certs/local.crt"),
        },
        stdio: "inherit",
      },
    );
    report(`Fresh install smoke passed. Backup: ${backup}`);
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
    console.error(`Local fresh install stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
