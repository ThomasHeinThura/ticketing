import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { G1_ACCOUNTS } from "../../apps/api/scripts/uat-seed-plan.ts";
import { executeFresh } from "../../deploy/local-fresh.mjs";
import { daemonProjectLockPath } from "../../deploy/local-fresh-lock.mjs";
import { PROJECT } from "../../deploy/local-fresh-plan.mjs";
import { redactFreshText } from "../../deploy/local-fresh-utils.mjs";
import { deployLocal } from "../../deploy/local-release.mjs";

const PREV_IMAGE = `ghcr.io/thomasheinthura/taskdesk@sha256:${"1".repeat(64)}`;
const PREV_IMAGE_ID = `sha256:${"2".repeat(64)}`;
const NEXT_IMAGE = `ghcr.io/thomasheinthura/taskdesk@sha256:${"3".repeat(64)}`;
const NEXT_IMAGE_ID = `sha256:${"4".repeat(64)}`;
const PG_IMAGE_ID = `sha256:${"5".repeat(64)}`;
const VALKEY_IMAGE_ID = `sha256:${"6".repeat(64)}`;
const MAILPIT_IMAGE_ID = `sha256:${"7".repeat(64)}`;
const TRAEFIK_IMAGE_ID = `sha256:${"8".repeat(64)}`;
const NEXT_TAG = "v2.22.0";

const FAKE_SECRETS = {
  appDbPass: "FAKE_APP_DB_PASS_998877",
  ownerDbPass: "FAKE_OWNER_DB_PASS_112233",
  authSecret: "FAKE_AUTH_SECRET_445566",
  seedAdminPass: "FAKE_SEED_ADMIN_PASS_77665544",
  seedCustomerPass: "FAKE_SEED_CUST_PASS_88990011",
  cookieToken: "FAKE_COOKIE_TOKEN_332211",
};

function makeMockUatCredentials(accounts = G1_ACCOUNTS) {
  return {
    accounts: accounts.map((account) => ({
      email: account.email,
      password:
        account.side === "customer"
          ? FAKE_SECRETS.seedCustomerPass
          : FAKE_SECRETS.seedAdminPass,
      role: account.roleLabel,
      name: account.name,
    })),
  };
}

function writeOctal(buf, offset, length, value) {
  const str = `${value.toString(8).padStart(length - 1, "0")}\0`;
  buf.write(str, offset, length, "ascii");
}

function makeUstarArchive(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const isDir = entry.type === "d";
    const data = isDir ? Buffer.alloc(0) : Buffer.from(entry.content ?? "");
    const rawName =
      isDir && !entry.name.endsWith("/") ? `${entry.name}/` : entry.name;
    header.write(rawName, 0, 100, "utf8");
    writeOctal(header, 100, 8, isDir ? 0o755 : 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, data.length);
    writeOctal(header, 136, 12, 1700000000);
    header.fill(32, 148, 156);
    header[156] = isDir ? 53 : 48;
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header);
    if (data.length > 0) {
      const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
      data.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function parseUstarArchive(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((b) => b === 0)) break;
    const zero = header.subarray(0, 100).indexOf(0);
    const name = header.subarray(0, zero < 0 ? 100 : zero).toString("utf8");
    const sizeRaw = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/, "")
      .trim();
    const size = Number.parseInt(sizeRaw || "0", 8);
    const type = header[156] === 53 ? "d" : "f";
    const content = Buffer.from(buffer.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
    entries.push({ name, type, content });
  }
  return entries;
}

function ustarEntriesFromFileMap(filesMap) {
  const dirs = new Set();
  for (const relPath of filesMap.keys()) {
    const parts = relPath.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  const entries = [];
  for (const dir of [...dirs].sort()) {
    entries.push({ name: `./${dir}/`, type: "d" });
  }
  for (const [relPath, content] of [...filesMap.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    entries.push({ name: `./${relPath}`, type: "f", content });
  }
  return entries;
}

function manifestFromFileMap(filesMap) {
  const dirs = new Set();
  for (const relPath of filesMap.keys()) {
    const parts = relPath.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  const tree = new Map([["", []]]);
  for (const d of dirs) {
    if (!tree.has(d)) tree.set(d, []);
    const parent = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "";
    if (!tree.has(parent)) tree.set(parent, []);
    tree.get(parent).push({ kind: "d", name: d.split("/").at(-1), rel: d });
  }
  for (const [p, buf] of filesMap.entries()) {
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (!tree.has(parent)) tree.set(parent, []);
    tree.get(parent).push({
      kind: "f",
      name: p.split("/").at(-1),
      rel: p,
      hash: createHash("sha256").update(buf).digest("hex"),
    });
  }
  const out = [];
  function walk(rel) {
    const children = (tree.get(rel) || []).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) {
      if (child.kind === "d") {
        out.push(["d", child.rel]);
        walk(child.rel);
      } else {
        out.push(["f", child.rel, child.hash]);
      }
    }
  }
  walk("");
  return JSON.stringify(out);
}

function formatDbCounts(rows) {
  const keys = Object.keys(rows).sort();
  const lines = [`table_count|${keys.length}`];
  for (const key of keys) {
    lines.push(`${key}|${rows[key]}`);
  }
  return `${lines.join("\n")}\n`;
}

function writeStdoutOrFd(options, payload) {
  const fd = options?.stdio?.[1];
  if (typeof fd === "number") {
    const buf = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(String(payload), "utf8");
    writeSync(fd, buf);
    return { status: 0, stdout: "" };
  }
  return {
    status: 0,
    stdout: Buffer.isBuffer(payload) ? payload.toString("utf8") : payload,
  };
}

function createDaemonState({
  daemonId,
  contextName,
  endpointHost,
  idPrefix,
  privateDir,
}) {
  let seq = 1;
  let dbGenSeq = 0;
  const makeId = () =>
    `${idPrefix}${(seq++).toString(16).padStart(64 - idPrefix.length, "0")}`;

  const networkId = `${idPrefix}${"f".repeat(64 - idPrefix.length)}`;
  const volumes = new Map();
  const createVolumeRecord = (
    key,
    {
      rows,
      files,
      setupCompleted = false,
      adminTotpVerified = false,
      customerPasswordEnabled = false,
      generationId,
    } = {},
  ) => {
    const name = `${PROJECT}_${key}`;
    const resolvedGenId =
      generationId || `700000000000000000${++dbGenSeq}:${16384 + dbGenSeq}`;
    volumes.set(name, {
      Name: name,
      Driver: "local",
      Mountpoint: `/var/lib/docker-${daemonId}/volumes/${name}/_data`,
      Options: null,
      Labels: {
        "com.docker.compose.project": PROJECT,
        "com.docker.compose.volume": key,
      },
      db:
        key === "postgres-data"
          ? {
              rows: rows ? { ...rows } : {},
              activeWriters: 0,
              appRoleReady: Boolean(rows && Object.keys(rows).length > 0),
              setupCompleted,
              adminTotpVerified,
              customerPasswordEnabled,
              generationId: resolvedGenId,
            }
          : undefined,
      files:
        key === "attachments"
          ? new Map(
              files
                ? [...files.entries()].map(([k, v]) => [k, Buffer.from(v)])
                : [],
            )
          : undefined,
    });
  };

  createVolumeRecord("postgres-data", {
    rows: {
      "public.tickets": 42,
      "public.users": 7,
      "public.workspaces": 1,
    },
  });
  createVolumeRecord("attachments", {
    files: new Map([
      ["2026/ticket-1.txt", Buffer.from("customer-attachment-payload-1\n")],
      ["2026/nested/screen.bin", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])],
    ]),
  });
  createVolumeRecord("mailpit-data");

  const images = new Map([
    [
      PREV_IMAGE,
      {
        Id: PREV_IMAGE_ID,
        RepoDigests: [PREV_IMAGE],
        Config: { Env: ["PATH=/usr/local/bin:/usr/bin"], Volumes: {} },
      },
    ],
    [
      NEXT_IMAGE,
      {
        Id: NEXT_IMAGE_ID,
        RepoDigests: [NEXT_IMAGE],
        Config: { Env: ["PATH=/usr/local/bin:/usr/bin"], Volumes: {} },
      },
    ],
  ]);

  const containers = new Map();
  const makeComposeContainer = (service, configImage, imageId, extra = {}) => {
    const id = makeId();
    const record = {
      Id: id,
      Name: `/${PROJECT}-${service}-1`,
      Image: imageId,
      Config: {
        Image: configImage,
        Labels: {
          "com.docker.compose.project": PROJECT,
          "com.docker.compose.service": service,
        },
        Env: ["PATH=/usr/local/bin:/usr/bin"],
      },
      HostConfig: {
        NetworkMode: `${PROJECT}_default`,
        PublishAllPorts: false,
        PortBindings: {},
        ...(extra.HostConfig || {}),
      },
      NetworkSettings: {
        Networks: {
          [`${PROJECT}_default`]: {
            NetworkID: networkId,
            Aliases: [service],
          },
        },
        Ports: {},
        ...(extra.NetworkSettings || {}),
      },
      State: {
        Running: true,
        ExitCode: 0,
        Health: { Status: "healthy" },
        ...(extra.State || {}),
      },
      Mounts: extra.Mounts || [],
      tmpFiles: new Map(),
    };
    containers.set(id, record);
    return record;
  };

  const proxyBindings = {
    "80/tcp": [
      { HostIp: "127.0.0.1", HostPort: "80" },
      { HostIp: "::1", HostPort: "80" },
    ],
    "443/tcp": [
      { HostIp: "127.0.0.1", HostPort: "443" },
      { HostIp: "::1", HostPort: "443" },
    ],
  };

  const originalDb = makeComposeContainer(
    "postgres",
    "postgres:18-alpine",
    PG_IMAGE_ID,
    {
      Mounts: [
        {
          Type: "volume",
          Name: `${PROJECT}_postgres-data`,
          Destination: "/var/lib/postgresql",
          RW: true,
        },
      ],
    },
  );
  const originalValkey = makeComposeContainer(
    "valkey",
    "valkey/valkey:9-alpine",
    VALKEY_IMAGE_ID,
  );
  const originalMailpit = makeComposeContainer(
    "mailpit",
    "axllent/mailpit:v1.24",
    MAILPIT_IMAGE_ID,
    {
      Mounts: [
        {
          Type: "volume",
          Name: `${PROJECT}_mailpit-data`,
          Destination: "/data",
          RW: true,
        },
      ],
    },
  );
  const originalApp = makeComposeContainer(
    "taskdesk",
    PREV_IMAGE,
    PREV_IMAGE_ID,
    {
      Mounts: [
        {
          Type: "volume",
          Name: `${PROJECT}_attachments`,
          Destination: "/app/data/attachments",
          RW: true,
        },
      ],
    },
  );
  const originalProxy = makeComposeContainer(
    "traefik",
    "traefik:v3.6",
    TRAEFIK_IMAGE_ID,
    {
      HostConfig: { PortBindings: structuredClone(proxyBindings) },
      NetworkSettings: {
        Networks: {
          [`${PROJECT}_default`]: {
            NetworkID: networkId,
            Aliases: ["traefik"],
          },
        },
        Ports: structuredClone(proxyBindings),
      },
    },
  );

  const buildComposeConfig = (activeImage, currentPrivateDir = privateDir) => ({
    name: PROJECT,
    services: {
      postgres: {
        image: "postgres:18-alpine",
        environment: {
          POSTGRES_USER: "sit_owner",
          POSTGRES_DB: "taskdesk_sit",
          POSTGRES_PASSWORD: FAKE_SECRETS.ownerDbPass,
        },
        volumes: [
          {
            type: "volume",
            source: "postgres-data",
            target: "/var/lib/postgresql",
          },
        ],
      },
      taskdesk: {
        image: activeImage,
        environment: {
          TASKDESK_ROLE: "all",
          TASKDESK_STORAGE_DRIVER: "filesystem",
          TASKDESK_PORT: "5173",
          TASKDESK_AUTH_SECRET: FAKE_SECRETS.authSecret,
          TASKDESK_DATABASE_URL: `postgres://taskdesk_app:${FAKE_SECRETS.appDbPass}@postgres:5432/taskdesk_sit`,
          DISABLE_REGISTRATION: "true",
          DISABLE_PASSWORD_REGISTRATION: "true",
          DISABLE_WORKSPACE_CREATION: "true",
        },
        volumes: [
          {
            type: "volume",
            source: "attachments",
            target: "/app/data/attachments",
          },
        ],
      },
      migrate: {
        image: activeImage,
        environment: {
          TASKDESK_ROLE: "migrate",
          TASKDESK_MIGRATION_DATABASE_URL: `postgres://sit_owner:${FAKE_SECRETS.ownerDbPass}@postgres:5432/taskdesk_sit`,
        },
      },
      traefik: {
        image: "traefik:v3.6",
        ports: [80, 443].flatMap((target) =>
          ["127.0.0.1", "::1"].map((host_ip) => ({
            target,
            published: String(target),
            host_ip,
            protocol: "tcp",
          })),
        ),
        volumes: [
          {
            type: "bind",
            source: resolve(currentPrivateDir, "proxy"),
            target: "/config",
            read_only: true,
          },
        ],
      },
      mailpit: {
        image: "axllent/mailpit:v1.24",
        volumes: [
          {
            type: "volume",
            source: "mailpit-data",
            target: "/data",
          },
        ],
      },
      valkey: {
        image: "valkey/valkey:9-alpine",
      },
    },
    volumes: {
      "postgres-data": { name: `${PROJECT}_postgres-data`, external: false },
      attachments: { name: `${PROJECT}_attachments`, external: false },
      "mailpit-data": { name: `${PROJECT}_mailpit-data`, external: false },
    },
  });

  return {
    daemonId,
    contextName,
    endpointHost,
    networkId,
    volumes,
    images,
    containers,
    createVolumeRecord,
    makeComposeContainer,
    makeId,
    proxyBindings,
    buildComposeConfig,
    calls: [],
    originals: {
      db: originalDb.Id,
      valkey: originalValkey.Id,
      mailpit: originalMailpit.Id,
      app: originalApp.Id,
      proxy: originalProxy.Id,
    },
  };
}

function serializeContainer(c) {
  const { tmpFiles: _tmp, scratchDb: _scratch, ...rest } = c;
  return structuredClone(rest);
}

function createRealChainWorld(t) {
  const baseDir = mkdtempSync(join(os.tmpdir(), "sit-fresh-real-chain-"));
  t.after(() => rmSync(baseDir, { recursive: true, force: true }));

  const privateDir = join(baseDir, "private-sit");
  const composeDir = join(baseDir, "compose-secret");
  const lockRoot = join(baseDir, "locks");
  mkdirSync(join(privateDir, "proxy"), { recursive: true, mode: 0o700 });
  mkdirSync(composeDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(privateDir, "app.env"),
    `TASKDESK_AUTH_SECRET=${FAKE_SECRETS.authSecret}\n`,
    { mode: 0o600 },
  );
  const envFile = join(composeDir, "sit.compose.env");
  writeFileSync(
    envFile,
    `SIT_IMAGE=${NEXT_IMAGE}\nTASKDESK_IMAGE_TAG=${NEXT_TAG}\n`,
    { mode: 0o600 },
  );

  const env = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: baseDir,
    SIT_PRIVATE_DIR: privateDir,
    SIT_COMPOSE_ENV: envFile,
    TASKDESK_AUTH_SECRET: FAKE_SECRETS.authSecret,
    POSTGRES_PASSWORD: FAKE_SECRETS.ownerDbPass,
    TASKDESK_APP_DB_PASSWORD: FAKE_SECRETS.appDbPass,
  };

  const sitDaemon = createDaemonState({
    daemonId: "daemon-sit-1111",
    contextName: "default",
    endpointHost: "unix:///var/run/docker.sock",
    idPrefix: "a",
    privateDir,
  });
  const otherDaemon = createDaemonState({
    daemonId: "daemon-other-2222",
    contextName: "other-local",
    endpointHost: "unix:///tmp/other-local-docker.sock",
    idPrefix: "b",
    privateDir,
  });

  const daemonsByContext = new Map([
    ["default", sitDaemon],
    ["other-local", otherDaemon],
  ]);
  const daemonsByEndpoint = new Map([
    [sitDaemon.endpointHost, sitDaemon],
    [otherDaemon.endpointHost, otherDaemon],
  ]);

  const logs = [];
  const calls = [];
  let activeContext = "default";
  let hook = null;

  const resolveDaemon = (callEnv = {}) => {
    if (callEnv.DOCKER_HOST && daemonsByEndpoint.has(callEnv.DOCKER_HOST)) {
      return daemonsByEndpoint.get(callEnv.DOCKER_HOST);
    }
    const ctxName = callEnv.DOCKER_CONTEXT || activeContext;
    return daemonsByContext.get(ctxName) || sitDaemon;
  };

  const composeContainersByService = (daemon, svc, onlyRunning = false) =>
    [...daemon.containers.values()].filter(
      (c) =>
        c.Config?.Labels?.["com.docker.compose.project"] === PROJECT &&
        c.Config?.Labels?.["com.docker.compose.service"] === svc &&
        (!onlyRunning || c.State?.Running),
    );

  const run = (bin, argv, options = {}) => {
    calls.push([bin, ...argv]);
    if (hook) {
      const outcome = hook(bin, argv, options);
      if (outcome) return outcome;
    }

    if (bin === "gh") {
      assert.equal(argv[0], "attestation");
      assert.equal(argv[1], "verify");
      return { status: 0, stdout: "Verified\n" };
    }

    if (bin === "cosign") {
      assert.equal(argv[0], "verify");
      return { status: 0, stdout: "Verified\n" };
    }

    if (bin === "curl") {
      const daemon = resolveDaemon(options.env);
      const proxies = composeContainersByService(daemon, "traefik", true);
      const apps = composeContainersByService(daemon, "taskdesk", true);
      if (proxies.length !== 1 || apps.length !== 1)
        return { status: 7, stdout: "" };
      return { status: 0, stdout: '{"status":"ready"}\n' };
    }

    if (bin === "shasum") {
      if (argv.includes("-c")) {
        const sumsFile = argv.at(-1);
        const lines = readFileSync(sumsFile, "utf8")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean);
        for (const line of lines) {
          const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line);
          if (!match || !existsSync(match[2])) return { status: 1, stdout: "" };
          const actual = createHash("sha256")
            .update(readFileSync(match[2]))
            .digest("hex");
          if (actual !== match[1]) return { status: 1, stdout: "" };
        }
        return { status: 0, stdout: "OK\n" };
      }
      const files = argv.slice(argv.indexOf("256") + 1);
      const out = files
        .map(
          (f) =>
            `${createHash("sha256").update(readFileSync(f)).digest("hex")}  ${f}`,
        )
        .join("\n");
      return writeStdoutOrFd(options, `${out}\n`);
    }

    if (bin === "tar") {
      if (argv[0] === "-tf") {
        const entries = parseUstarArchive(readFileSync(argv[1]));
        return {
          status: 0,
          stdout: `${entries.map((e) => e.name).join("\n")}\n`,
        };
      }
      if (argv.includes("-xf")) {
        const dest = argv[argv.indexOf("-C") + 1];
        const tarFile = argv[argv.indexOf("-xf") + 1];
        const entries = parseUstarArchive(readFileSync(tarFile));
        for (const entry of entries) {
          const rel = entry.name.replace(/^(?:\.\/)+/, "").replace(/\/$/, "");
          if (!rel) continue;
          const target = join(dest, rel);
          if (entry.type === "d") {
            mkdirSync(target, { recursive: true, mode: 0o700 });
          } else {
            mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
            writeFileSync(target, entry.content, { mode: 0o600 });
          }
        }
        return { status: 0, stdout: "" };
      }
      if (argv.includes("-cf")) {
        const destFile = argv[argv.indexOf("-cf") + 1];
        const srcDir = argv[argv.indexOf("-C") + 1];
        const lastArg = argv.at(-1);
        const entries = [{ name: "./", type: "d" }];
        if (lastArg === ".") {
          for (const item of readdirSync(srcDir, { withFileTypes: true })) {
            if (item.name === "fresh-backups") continue;
            const full = join(srcDir, item.name);
            if (item.isFile()) {
              entries.push({
                name: `./${item.name}`,
                type: "f",
                content: readFileSync(full),
              });
            } else if (item.isDirectory()) {
              entries.push({ name: `./${item.name}/`, type: "d" });
            }
          }
        } else {
          entries.push({
            name: `./${lastArg}`,
            type: "f",
            content: readFileSync(join(srcDir, lastArg)),
          });
        }
        writeFileSync(destFile, makeUstarArchive(entries), { mode: 0o600 });
        return { status: 0, stdout: "" };
      }
      return { status: 1, stdout: "" };
    }

    if (bin === "node") {
      if (argv[0] === "-e") {
        const real = spawnSync(process.execPath, argv, { encoding: "utf8" });
        return {
          status: real.status ?? 1,
          stdout: real.stdout || "",
          stderr: real.stderr || "",
        };
      }
      if (argv[0] === "scripts/sit/release-smoke.mjs") {
        const daemon = resolveDaemon(options.env);
        const credPath = argv[argv.indexOf("--credentials") + 1];
        if (!existsSync(credPath)) return { status: 1, stdout: "" };
        const parsed = JSON.parse(readFileSync(credPath, "utf8"));
        if (!Array.isArray(parsed?.accounts) || parsed.accounts.length === 0)
          return { status: 1, stdout: "" };
        const apps = composeContainersByService(daemon, "taskdesk", true);
        const proxies = composeContainersByService(daemon, "traefik", true);
        if (
          apps.length !== 1 ||
          proxies.length !== 1 ||
          apps[0].tmpFiles.has("/tmp/sit-credentials.json")
        )
          return { status: 1, stdout: "" };
        return {
          status: 0,
          stdout: `PASS  admin: sign-in  200\n2/2 passed; screenshots in ${join(privateDir, "smoke-out")}\n`,
        };
      }
      return { status: 1, stdout: "" };
    }

    if (bin !== "docker") return { status: 1, stdout: "" };

    const daemon = resolveDaemon(options.env);
    daemon.calls.push([...argv]);

    if (argv[0] === "context" && argv[1] === "show") {
      const ctxName = options.env?.DOCKER_CONTEXT || activeContext;
      return { status: 0, stdout: `${ctxName}\n` };
    }
    if (argv[0] === "context" && argv[1] === "inspect") {
      const inspectedCtx = daemonsByContext.get(argv[2]);
      if (!inspectedCtx) return { status: 1, stdout: "" };
      return {
        status: 0,
        stdout: JSON.stringify([
          { Endpoints: { docker: { Host: inspectedCtx.endpointHost } } },
        ]),
      };
    }
    if (argv[0] === "info") {
      return { status: 0, stdout: `${daemon.daemonId}\n` };
    }

    if (argv[0] === "compose") {
      const envFileArg = argv[argv.indexOf("--env-file") + 1];
      const fIdx = argv.indexOf("-f");
      const sub = argv.slice(fIdx + 2);
      const envContent = readFileSync(envFileArg, "utf8");
      const fileImage = /^SIT_IMAGE=(.+)$/m.exec(envContent)?.[1] || NEXT_IMAGE;
      const fileTag =
        /^TASKDESK_IMAGE_TAG=(.+)$/m.exec(envContent)?.[1] || NEXT_TAG;
      const currentPrivateDir = options.env?.SIT_PRIVATE_DIR || privateDir;

      if (sub[0] === "config" && sub[1] === "--environment") {
        return {
          status: 0,
          stdout: `SIT_IMAGE=${fileImage}\nTASKDESK_IMAGE_TAG=${fileTag}\n`,
        };
      }
      if (sub[0] === "config" && sub[1] === "--format" && sub[2] === "json") {
        return {
          status: 0,
          stdout: JSON.stringify(
            daemon.buildComposeConfig(fileImage, currentPrivateDir),
          ),
        };
      }
      if (sub[0] === "ps") {
        const all = sub.includes("-a") && !sub.includes("running");
        const svc = sub.at(-1);
        const matches = composeContainersByService(daemon, svc, !all);
        return {
          status: 0,
          stdout: matches.length
            ? `${matches.map((c) => c.Id).join("\n")}\n`
            : "",
        };
      }
      if (sub[0] === "pull") {
        return {
          status: daemon.images.has(fileImage) ? 0 : 1,
          stdout: "",
        };
      }
      if (sub[0] === "up") {
        const services = sub.filter(
          (s) => !["up", "-d", "--wait", "--no-deps"].includes(s),
        );
        for (const svc of services) {
          for (const existing of composeContainersByService(
            daemon,
            svc,
            false,
          )) {
            daemon.containers.delete(existing.Id);
          }
          if (svc === "postgres") {
            if (!daemon.volumes.has(`${PROJECT}_postgres-data`))
              daemon.createVolumeRecord("postgres-data");
            daemon.makeComposeContainer(
              "postgres",
              "postgres:18-alpine",
              PG_IMAGE_ID,
              {
                Mounts: [
                  {
                    Type: "volume",
                    Name: `${PROJECT}_postgres-data`,
                    Destination: "/var/lib/postgresql",
                    RW: true,
                  },
                ],
              },
            );
          } else if (svc === "valkey") {
            daemon.makeComposeContainer(
              "valkey",
              "valkey/valkey:9-alpine",
              VALKEY_IMAGE_ID,
            );
          } else if (svc === "mailpit") {
            if (!daemon.volumes.has(`${PROJECT}_mailpit-data`))
              daemon.createVolumeRecord("mailpit-data");
            daemon.makeComposeContainer(
              "mailpit",
              "axllent/mailpit:v1.24",
              MAILPIT_IMAGE_ID,
              {
                Mounts: [
                  {
                    Type: "volume",
                    Name: `${PROJECT}_mailpit-data`,
                    Destination: "/data",
                    RW: true,
                  },
                ],
              },
            );
          } else if (svc === "taskdesk") {
            const img = daemon.images.get(fileImage);
            daemon.makeComposeContainer("taskdesk", fileImage, img.Id, {
              Mounts: [
                {
                  Type: "volume",
                  Name: `${PROJECT}_attachments`,
                  Destination: "/app/data/attachments",
                  RW: true,
                },
              ],
            });
          } else if (svc === "traefik") {
            daemon.makeComposeContainer(
              "traefik",
              "traefik:v3.6",
              TRAEFIK_IMAGE_ID,
              {
                HostConfig: {
                  PortBindings: structuredClone(daemon.proxyBindings),
                },
                NetworkSettings: {
                  Networks: {
                    [`${PROJECT}_default`]: {
                      NetworkID: daemon.networkId,
                      Aliases: ["traefik"],
                    },
                  },
                  Ports: structuredClone(daemon.proxyBindings),
                },
              },
            );
          }
        }
        return { status: 0, stdout: "" };
      }
      if (sub[0] === "run") {
        const img = daemon.images.get(fileImage);
        const pgVol = daemon.volumes.get(`${PROJECT}_postgres-data`);
        if (!img || !pgVol?.db) return { status: 1, stdout: "" };
        if (Object.keys(pgVol.db.rows).length === 0) {
          pgVol.db.rows = {
            "public.migrations": 15,
            "public.tickets": 0,
            "public.users": 0,
            "public.workspaces": 0,
          };
        }
        pgVol.db.appRoleReady = true;
        const mig = daemon.makeComposeContainer("migrate", fileImage, img.Id, {
          State: { Running: false, ExitCode: 0 },
        });
        return { status: 0, stdout: `${mig.Id}\n` };
      }
      if (sub[0] === "exec") {
        const svc = sub[2];
        const running = composeContainersByService(daemon, svc, true);
        if (running.length !== 1) return { status: 1, stdout: "" };
        if (
          svc === "postgres" &&
          sub.join(" ").includes("information_schema.tables")
        ) {
          const pgVol = daemon.volumes.get(`${PROJECT}_postgres-data`);
          return {
            status: Object.keys(pgVol?.db?.rows || {}).length > 0 ? 0 : 1,
            stdout: "",
          };
        }
        if (
          svc === "taskdesk" &&
          sub.join(" ").includes("/api/public/health/ready")
        ) {
          const pgVol = daemon.volumes.get(`${PROJECT}_postgres-data`);
          return { status: pgVol?.db?.appRoleReady ? 0 : 1, stdout: "" };
        }
        return { status: 0, stdout: "" };
      }
      return { status: 1, stdout: "" };
    }

    if (argv[0] === "ps") {
      const filters = [];
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--filter") filters.push(argv[i + 1]);
      }
      const matched = [...daemon.containers.values()].filter((c) =>
        filters.every((f) => {
          if (f.startsWith("label=")) {
            const expr = f.slice("label=".length);
            const eq = expr.indexOf("=");
            if (eq < 0) return Object.hasOwn(c.Config?.Labels || {}, expr);
            const k = expr.slice(0, eq);
            const v = expr.slice(eq + 1);
            return c.Config?.Labels?.[k] === v;
          }
          if (f.startsWith("volume=")) {
            const vol = f.slice("volume=".length);
            return (c.Mounts || []).some((m) => m.Name === vol);
          }
          if (f.startsWith("id=")) {
            return c.Id === f.slice("id=".length);
          }
          return false;
        }),
      );
      return {
        status: 0,
        stdout: matched.length
          ? `${matched.map((c) => c.Id).join("\n")}\n`
          : "",
      };
    }

    if (argv[0] === "inspect") {
      const ids = argv.slice(1);
      const found = ids
        .map((id) => daemon.containers.get(id))
        .filter(Boolean)
        .map(serializeContainer);
      if (found.length !== ids.length) return { status: 1, stdout: "" };
      return { status: 0, stdout: JSON.stringify(found) };
    }

    if (argv[0] === "image" && argv[1] === "inspect") {
      const img = daemon.images.get(argv[2]);
      if (!img) return { status: 1, stdout: "" };
      return { status: 0, stdout: JSON.stringify([img]) };
    }

    if (argv[0] === "volume" && argv[1] === "ls") {
      const names = [...daemon.volumes.values()]
        .filter((v) => v.Labels?.["com.docker.compose.project"] === PROJECT)
        .map((v) => v.Name);
      return { status: 0, stdout: names.length ? `${names.join("\n")}\n` : "" };
    }

    if (argv[0] === "volume" && argv[1] === "inspect") {
      const names = argv.slice(2);
      const found = names
        .map((n) => daemon.volumes.get(n))
        .filter(Boolean)
        .map(({ Name, Driver, Mountpoint, Labels, Options }) => ({
          Name,
          Driver,
          Mountpoint,
          Labels,
          Options,
        }));
      if (found.length !== names.length) return { status: 1, stdout: "" };
      return { status: 0, stdout: JSON.stringify(found) };
    }

    if (argv[0] === "volume" && argv[1] === "create") {
      const labels = {};
      for (let i = 2; i < argv.length - 1; i++) {
        if (argv[i] === "--label") {
          const [k, v] = argv[i + 1].split("=");
          labels[k] = v;
          i++;
        }
      }
      const name = argv.at(-1);
      const key = labels["com.docker.compose.volume"];
      daemon.createVolumeRecord(key);
      daemon.volumes.get(name).Labels = labels;
      return { status: 0, stdout: `${name}\n` };
    }

    if (argv[0] === "volume" && argv[1] === "rm") {
      const name = argv[2];
      const inUse = [...daemon.containers.values()].some((c) =>
        (c.Mounts || []).some((m) => m.Name === name),
      );
      if (inUse || !daemon.volumes.has(name)) return { status: 1, stdout: "" };
      daemon.volumes.delete(name);
      return { status: 0, stdout: `${name}\n` };
    }

    if (argv[0] === "network" && argv[1] === "disconnect") {
      const netId = argv[2];
      const c = daemon.containers.get(argv[3]);
      if (!c) return { status: 1, stdout: "" };
      for (const [name, net] of Object.entries(
        c.NetworkSettings.Networks || {},
      )) {
        if (net.NetworkID === netId) delete c.NetworkSettings.Networks[name];
      }
      return { status: 0, stdout: "" };
    }

    if (argv[0] === "network" && argv[1] === "connect") {
      const aliases = [];
      for (let i = 2; i < argv.length - 2; i++) {
        if (argv[i] === "--alias") {
          aliases.push(argv[i + 1]);
          i++;
        }
      }
      const netId = argv.at(-2);
      const c = daemon.containers.get(argv.at(-1));
      if (!c) return { status: 1, stdout: "" };
      c.NetworkSettings.Networks[`${PROJECT}_default`] = {
        NetworkID: netId,
        Aliases: aliases,
      };
      return { status: 0, stdout: "" };
    }

    if (argv[0] === "stop") {
      const c = daemon.containers.get(argv.at(-1));
      if (!c) return { status: 1, stdout: "" };
      c.State.Running = false;
      c.NetworkSettings.Ports = {};
      return { status: 0, stdout: `${c.Id}\n` };
    }

    if (argv[0] === "start") {
      const c = daemon.containers.get(argv.at(-1));
      if (!c) return { status: 1, stdout: "" };
      c.State.Running = true;
      if (c.HostConfig?.NetworkMode === "bridge") {
        c.NetworkSettings.Networks.bridge = {};
      }
      if (Object.keys(c.HostConfig?.PortBindings || {}).length > 0) {
        c.NetworkSettings.Ports = structuredClone(c.HostConfig.PortBindings);
      }
      return { status: 0, stdout: `${c.Id}\n` };
    }

    if (argv[0] === "wait") {
      const c = daemon.containers.get(argv[1]);
      if (!c) return { status: 1, stdout: "" };
      return { status: 0, stdout: `${c.State.ExitCode ?? 0}\n` };
    }

    if (argv[0] === "rm") {
      const force = argv.includes("-f");
      const c = daemon.containers.get(argv.at(-1));
      if (!c || (c.State.Running && !force)) return { status: 1, stdout: "" };
      daemon.containers.delete(c.Id);
      return { status: 0, stdout: `${c.Id}\n` };
    }

    if (argv[0] === "create") {
      const id = daemon.makeId();
      const labels = {};
      const publishes = {};
      const mounts = [];
      const tmpfs = {};
      const securityOpt = [];
      const capDrop = [];
      let name = `created-${id.slice(0, 12)}`;
      let networkMode = "default";
      let readOnly = false;
      let noHealthcheck = false;
      let entrypoint = null;
      let i = 1;
      while (i < argv.length) {
        const token = argv[i];
        if (token === "--name") {
          name = argv[i + 1];
          i += 2;
        } else if (token === "--label") {
          const eq = argv[i + 1].indexOf("=");
          labels[argv[i + 1].slice(0, eq)] = argv[i + 1].slice(eq + 1);
          i += 2;
        } else if (token === "--network") {
          networkMode = argv[i + 1];
          i += 2;
        } else if (token === "--read-only") {
          readOnly = true;
          i += 1;
        } else if (token === "--no-healthcheck") {
          noHealthcheck = true;
          i += 1;
        } else if (token === "--security-opt") {
          securityOpt.push(argv[i + 1]);
          i += 2;
        } else if (token === "--cap-drop") {
          capDrop.push(argv[i + 1]);
          i += 2;
        } else if (token === "--entrypoint") {
          entrypoint = [argv[i + 1]];
          i += 2;
        } else if (token === "--tmpfs") {
          const [target, opts = ""] = argv[i + 1].split(":");
          tmpfs[target] = opts;
          i += 2;
        } else if (token === "--env") {
          i += 2;
        } else if (token === "--mount") {
          const parts = Object.fromEntries(
            argv[i + 1].split(",").map((part) => {
              const eq = part.indexOf("=");
              return eq < 0
                ? [part, "true"]
                : [part.slice(0, eq), part.slice(eq + 1)];
            }),
          );
          mounts.push({
            Type: parts.type,
            Name: parts.src,
            Destination: parts.dst,
            RW: parts.readonly !== "true",
          });
          i += 2;
        } else if (token === "--publish") {
          const match = /^(\[::1\]|127\.0\.0\.1):(\d+):(\d+\/tcp)$/.exec(
            argv[i + 1],
          );
          if (match) {
            const hostIp = match[1] === "[::1]" ? "::1" : match[1];
            publishes[match[3]] ??= [];
            publishes[match[3]].push({ HostIp: hostIp, HostPort: match[2] });
          }
          i += 2;
        } else {
          break;
        }
      }
      const imageRef = argv[i];
      const cmdArgs = argv.slice(i + 1);
      const img = daemon.images.get(imageRef);
      daemon.containers.set(id, {
        Id: id,
        Name: `/${name}`,
        Image: img?.Id || imageRef,
        Config: {
          Image: imageRef,
          Labels: labels,
          ...(noHealthcheck ? { Healthcheck: { Test: ["NONE"] } } : {}),
          ...(entrypoint ? { Entrypoint: entrypoint } : {}),
          ...(cmdArgs.length ? { Cmd: cmdArgs } : {}),
          Env: [...(img?.Config?.Env || [])],
        },
        HostConfig: {
          NetworkMode: networkMode,
          ReadonlyRootfs: readOnly,
          Privileged: false,
          AutoRemove: false,
          SecurityOpt: securityOpt,
          PublishAllPorts: false,
          CapDrop: capDrop,
          CapAdd: [],
          Binds: [],
          VolumesFrom: [],
          PortBindings: publishes,
          Tmpfs: tmpfs,
        },
        NetworkSettings: { Networks: {}, Ports: {} },
        State: { Running: false, ExitCode: 0 },
        Mounts: mounts,
        tmpFiles: new Map(),
        scratchDb: { rows: {} },
      });
      return { status: 0, stdout: `${id}\n` };
    }

    if (argv[0] === "exec") {
      const hasStdin = argv[1] === "-i";
      const hasEnv = argv[1] === "-e";
      const containerId = hasStdin ? argv[2] : hasEnv ? argv[3] : argv[1];
      const sub = argv.slice(hasStdin ? 3 : hasEnv ? 4 : 2);
      const c = daemon.containers.get(containerId);
      if (!c) return { status: 1, stdout: "" };
      // The seed guard refuses to run without the database confirmation.
      if (
        sub.includes("apps/api/dist/seed-uat.js") &&
        !(hasEnv && /^TASKDESK_SEED_CONFIRM_DATABASE=.+/.test(argv[2]))
      )
        return { status: 1, stdout: "" };
      const joined = sub.join(" ");

      if (joined.includes("/sys/class/net/*")) {
        const netCount = Object.keys(c.NetworkSettings?.Networks || {}).length;
        return { status: netCount === 0 ? 0 : 1, stdout: "" };
      }
      if (
        joined.includes("pg_stat_activity") &&
        (sub.includes("writers") || sub.includes("sessions"))
      ) {
        const pgVol = daemon.volumes.get(`${PROJECT}_postgres-data`);
        return {
          status: 0,
          stdout: `${pgVol?.db?.activeWriters ?? 0}\n`,
        };
      }
      if (joined.includes("pg_dump -Fc")) {
        const pgVol = daemon.volumes.get(`${PROJECT}_postgres-data`);
        const dumpJson = JSON.stringify({
          magic: "PGDMP",
          dbName: sub.at(-1),
          rows: pgVol?.db?.rows || {},
        });
        return writeStdoutOrFd(options, `${dumpJson}\n`);
      }
      if (sub[0] === "pg_restore" && sub[1] === "--list") {
        const raw = readFileSync(options.stdio[0], "utf8");
        try {
          const parsed = JSON.parse(raw);
          if (parsed.magic !== "PGDMP") return { status: 1, stdout: "" };
          const toc = Object.keys(parsed.rows || {}).map(
            (table, idx) => `${idx + 1}; 1259 ${16400 + idx} TABLE ${table}`,
          );
          return { status: 0, stdout: `${toc.join("\n")}\n` };
        } catch {
          return { status: 1, stdout: "" };
        }
      }
      if (sub[0] === "pg_isready") {
        return { status: c.State?.Running ? 0 : 1, stdout: "" };
      }
      if (sub[0] === "pg_restore" && sub.includes("--exit-on-error")) {
        const raw = readFileSync(options.stdio[0], "utf8");
        try {
          const parsed = JSON.parse(raw);
          if (parsed.magic !== "PGDMP") return { status: 1, stdout: "" };
          c.scratchDb = { rows: structuredClone(parsed.rows || {}) };
          return { status: 0, stdout: "" };
        } catch {
          return { status: 1, stdout: "" };
        }
      }
      if (joined.includes("ON_ERROR_STOP=1") && sub.includes("db-gen")) {
        const sqlText = String(options.input || "");
        if (
          !sqlText.includes("pg_control_system") ||
          !sqlText.includes("pg_database")
        )
          return { status: 1, stdout: "" };
        const pgDb = daemon.volumes.get(`${PROJECT}_postgres-data`)?.db;
        return writeStdoutOrFd(
          options,
          `${pgDb?.generationId || "7000000000000000001:16385"}\n`,
        );
      }
      if (joined.includes("ON_ERROR_STOP=1") && sub.includes("setup-check")) {
        const sqlText = String(options.input || "");
        if (
          !sqlText.includes("instance_setting") ||
          !sqlText.includes("two_factor") ||
          !sqlText.includes("instance_plugin_config") ||
          !sqlText.includes("scope = 'instance'")
        )
          return { status: 1, stdout: "" };
        const pgDb = daemon.volumes.get(`${PROJECT}_postgres-data`)?.db;
        return writeStdoutOrFd(
          options,
          `${pgDb?.setupCompleted ? "1" : "0"}|${pgDb?.adminTotpVerified ? "1" : "0"}|${pgDb?.customerPasswordEnabled ? "1" : "0"}\n`,
        );
      }
      if (
        joined.includes("ON_ERROR_STOP=1") &&
        (sub[0] === "psql" || sub.includes("counts"))
      ) {
        if (!String(options.input || "").includes("information_schema.tables"))
          return { status: 1, stdout: "" };
        const rows = c.Config?.Labels?.["info.taskdesk.restore-proof"]
          ? c.scratchDb?.rows || {}
          : daemon.volumes.get(`${PROJECT}_postgres-data`)?.db?.rows || {};
        return writeStdoutOrFd(options, formatDbCounts(rows));
      }
      if (sub[0] === "tar" && sub.includes("/app/data/attachments")) {
        const attVol = daemon.volumes.get(`${PROJECT}_attachments`);
        const archive = makeUstarArchive(
          ustarEntriesFromFileMap(attVol?.files || new Map()),
        );
        return writeStdoutOrFd(options, archive);
      }
      if (sub[0] === "node" && sub[1] === "-e") {
        const attVol = daemon.volumes.get(`${PROJECT}_attachments`);
        return {
          status: 0,
          stdout: manifestFromFileMap(attVol?.files || new Map()),
        };
      }
      if (sub[0] === "sh" && sub[1] === "-c" && sub[3] === "restore-creds") {
        const dest = sub[4];
        const body = Buffer.isBuffer(options.input)
          ? options.input.toString("utf8")
          : String(options.input || "");
        c.tmpFiles.set(dest, body);
        return { status: 0, stdout: "" };
      }
      if (sub.includes("apps/api/dist/seed-uat.js")) {
        if (!sub.includes("--uat")) return { status: 1, stdout: "" };
        const credDest = sub[sub.indexOf("--credentials-file") + 1];
        if (c.tmpFiles.has(credDest)) {
          JSON.parse(c.tmpFiles.get(credDest));
        } else {
          c.tmpFiles.set(credDest, JSON.stringify(makeMockUatCredentials()));
        }
        const pgVol = daemon.volumes.get(`${PROJECT}_postgres-data`);
        if (pgVol?.db) {
          pgVol.db.rows["public.users"] = 6;
          pgVol.db.rows["public.workspaces"] = 1;
          pgVol.db.rows["public.automation_rules"] = 2;
          pgVol.db.rows["public.pages"] = 1;
          pgVol.db.rows["public.reports"] = 1;
        }
        return { status: 0, stdout: "" };
      }
      if (sub[0] === "cat") {
        const content = c.tmpFiles.get(sub[1]);
        if (content === undefined) return { status: 1, stdout: "" };
        return writeStdoutOrFd(options, content);
      }
      if (sub[0] === "rm" && sub[1] === "-f") {
        c.tmpFiles.delete(sub[2]);
        return { status: 0, stdout: "" };
      }
      return { status: 0, stdout: "" };
    }

    return { status: 1, stdout: "" };
  };

  const removedOriginalResources = (daemon = sitDaemon) => {
    const originalIds = new Set(Object.values(daemon.originals));
    return daemon.calls.filter(
      ([op, sub, ...rest]) =>
        (op === "rm" && originalIds.has([sub, ...rest].at(-1))) ||
        (op === "volume" && sub === "rm"),
    );
  };

  const destructiveDaemonCalls = (daemon) =>
    daemon.calls.filter(
      ([op, sub]) =>
        ["stop", "rm", "create"].includes(op) ||
        (op === "network" && sub === "disconnect") ||
        (op === "volume" && ["rm", "create"].includes(sub)) ||
        (op === "compose" &&
          daemon.calls.some(
            (c) =>
              c[0] === "compose" && (c.includes("up") || c.includes("run")),
          )),
    );

  const assertPreProofRollback = (daemon = sitDaemon) => {
    assert.equal(
      removedOriginalResources(daemon).length,
      0,
      "Expected zero removals of original containers or volumes before proof completes",
    );
    for (const [role, id] of Object.entries(daemon.originals)) {
      const live = daemon.containers.get(id);
      assert.ok(live, `Original ${role} container must still exist`);
      assert.equal(
        live.State.Running,
        true,
        `Original ${role} container must be running after rollback`,
      );
    }
    const dbNet = daemon.containers.get(daemon.originals.db).NetworkSettings
      .Networks[`${PROJECT}_default`];
    assert.equal(
      dbNet?.NetworkID,
      daemon.networkId,
      "Original database network must be reconnected",
    );
    for (const key of ["postgres-data", "attachments", "mailpit-data"]) {
      assert.ok(
        daemon.volumes.has(`${PROJECT}_${key}`),
        `Original volume ${key} must remain intact`,
      );
    }
  };

  const assertNoSecretsLogged = (extraTexts = []) => {
    const combined = [...logs, ...extraTexts].join("\n");
    for (const secret of Object.values(FAKE_SECRETS)) {
      assert.ok(
        !combined.includes(secret),
        `Output leaked secret value ${secret}`,
      );
    }
    assert.doesNotMatch(combined, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(combined, /\b(?:set-cookie|cookie)\s*:/i);
    assert.doesNotMatch(combined, /better-auth\.session_token=/i);
    assert.ok(
      !combined.includes(privateDir),
      "Output leaked raw SIT_PRIVATE_DIR path",
    );
    assert.ok(
      !combined.includes(envFile),
      "Output leaked raw SIT_COMPOSE_ENV path",
    );
  };

  return {
    baseDir,
    privateDir,
    composeDir,
    envFile,
    lockRoot,
    env,
    sitDaemon,
    otherDaemon,
    logs,
    calls,
    run,
    setActiveContext: (ctx) => {
      activeContext = ctx;
    },
    setHook: (fn) => {
      hook = fn;
    },
    removedOriginalResources,
    destructiveDaemonCalls,
    assertPreProofRollback,
    assertNoSecretsLogged,
    execute: (override = {}) =>
      executeFresh({
        args: [
          "--confirm-wipe",
          PROJECT,
          "--confirm-daemon",
          sitDaemon.daemonId,
        ],
        env,
        run,
        lockRoot,
        clock: () => new Date("2026-11-12T12:00:00.000Z"),
        report: (line) => logs.push(line),
        ...override,
      }),
  };
}

test("real chain: default preview prints daemon id, context/endpoint, project and exact targets without changes", (t) => {
  const w = createRealChainWorld(t);
  w.execute({ args: [] });

  assert.ok(w.logs.includes(`Docker daemon ID: ${w.sitDaemon.daemonId}`));
  assert.ok(
    w.logs.includes(
      `Docker context: ${w.sitDaemon.contextName} (${w.sitDaemon.endpointHost})`,
    ),
  );
  assert.ok(w.logs.includes(`Compose project: ${PROJECT}`));
  const containerLine = w.logs.find((l) => l.startsWith("Containers: "));
  assert.ok(containerLine);
  for (const id of Object.values(w.sitDaemon.originals)) {
    assert.ok(containerLine.includes(id));
  }
  const volumeLine = w.logs.find((l) => l.startsWith("Volumes: "));
  assert.ok(volumeLine);
  for (const key of ["postgres-data", "attachments", "mailpit-data"]) {
    assert.ok(volumeLine.includes(`${PROJECT}_${key}`));
  }
  assert.equal(w.destructiveDaemonCalls(w.sitDaemon).length, 0);
  assert.equal(existsSync(join(w.privateDir, "fresh-backups")), false);
  assert.equal(
    existsSync(
      daemonProjectLockPath({
        daemonId: w.sitDaemon.daemonId,
        project: PROJECT,
        lockRoot: w.lockRoot,
      }),
    ),
    false,
  );
  w.assertNoSecretsLogged();
});

test("real chain: starting on a different valid local daemon with identical project labels makes zero stop/disconnect/removal calls", (t) => {
  const w = createRealChainWorld(t);
  const otherSocketEnv = {
    ...w.env,
    DOCKER_HOST: w.otherDaemon.endpointHost,
  };

  // Preview on the other valid daemon works and changes nothing
  const previewLogs = [];
  w.execute({
    args: [],
    env: otherSocketEnv,
    report: (line) => previewLogs.push(line),
  });
  assert.ok(
    previewLogs.includes(`Docker daemon ID: ${w.otherDaemon.daemonId}`),
  );
  assert.ok(
    previewLogs.includes(
      `Docker context: default (${w.otherDaemon.endpointHost})`,
    ),
  );
  assert.equal(w.destructiveDaemonCalls(w.otherDaemon).length, 0);

  // Attempting a real run targeting the intended SIT daemon ID against the other daemon refuses before lock/stop/disconnect/removal
  w.otherDaemon.calls.length = 0;
  assert.throws(
    () =>
      w.execute({
        env: otherSocketEnv,
        args: [
          "--confirm-wipe",
          PROJECT,
          "--confirm-daemon",
          w.sitDaemon.daemonId,
        ],
      }),
    /Docker daemon ID mismatch/,
  );
  assert.equal(w.destructiveDaemonCalls(w.otherDaemon).length, 0);
  assert.equal(w.destructiveDaemonCalls(w.sitDaemon).length, 0);
  assert.equal(
    existsSync(
      daemonProjectLockPath({
        daemonId: w.otherDaemon.daemonId,
        project: PROJECT,
        lockRoot: w.lockRoot,
      }),
    ),
    false,
  );
  for (const id of Object.values(w.otherDaemon.originals)) {
    assert.equal(w.otherDaemon.containers.get(id).State.Running, true);
  }
});

test("real chain: refuses missing --confirm-daemon, wrong daemon id, and context change between preview and run", (t) => {
  const w = createRealChainWorld(t);

  // 1. Missing --confirm-daemon flag
  assert.throws(
    () => w.execute({ args: ["--confirm-wipe", PROJECT] }),
    /confirm-daemon/,
  );
  assert.equal(w.calls.length, 0);

  // 2. Wrong daemon ID
  assert.throws(
    () =>
      w.execute({
        args: [
          "--confirm-wipe",
          PROJECT,
          "--confirm-daemon",
          "daemon-wrong-9999",
        ],
      }),
    /Docker daemon ID mismatch/,
  );
  assert.equal(w.destructiveDaemonCalls(w.sitDaemon).length, 0);

  // 3. Context changed between preview and run
  const previewLines = [];
  w.execute({ args: ["--dry-run"], report: (l) => previewLines.push(l) });
  const printedId = /^Docker daemon ID: (.+)$/m.exec(
    previewLines.join("\n"),
  )?.[1];
  assert.equal(printedId, w.sitDaemon.daemonId);

  w.setActiveContext("other-local");
  assert.throws(
    () =>
      w.execute({
        args: ["--confirm-wipe", PROJECT, "--confirm-daemon", printedId],
      }),
    /Docker daemon ID mismatch/,
  );
  assert.equal(w.destructiveDaemonCalls(w.sitDaemon).length, 0);
  assert.equal(w.destructiveDaemonCalls(w.otherDaemon).length, 0);
});

test("real chain: Stage 1 checkpoints empty instance for /setup + portal auth and Stage 2 --resume-seed enforces gates before seeding", (t) => {
  const w = createRealChainWorld(t);
  w.execute();

  const stamp = "2026-11-12T12-00-00-000Z";
  assert.ok(
    w.logs.some((line) =>
      line.includes(`Fresh empty install ready (checkpoint ${stamp})`),
    ),
    "Expected Stage 1 checkpoint instructions",
  );
  assert.equal(w.logs.includes("Fresh install smoke passed."), false);
  assert.ok(
    w.logs.includes(
      "Restore proof matched database counts and attachment hashes.",
    ),
  );

  // Original containers were all removed; 5 fresh canonical services are running
  for (const oldId of Object.values(w.sitDaemon.originals)) {
    assert.equal(w.sitDaemon.containers.has(oldId), false);
  }
  for (const svc of ["postgres", "valkey", "mailpit", "taskdesk", "traefik"]) {
    const running = [...w.sitDaemon.containers.values()].filter(
      (c) =>
        c.Config?.Labels?.["com.docker.compose.service"] === svc &&
        c.State?.Running,
    );
    assert.equal(running.length, 1, `Expected running fresh ${svc}`);
  }

  // Backup artifacts exist outside removed volumes with valid checksums and 0700/0600 permissions; seeding has NOT run yet
  const backupDir = join(w.privateDir, "fresh-backups", stamp);
  assert.equal(statSync(backupDir).mode & 0o777, 0o700);
  for (const artifact of [
    "postgres.dump",
    "attachments.tar",
    "private-config.tar",
    "compose-env.tar",
    "counts.txt",
    "SHA256SUMS",
    "fresh-setup-pending.json",
  ]) {
    assert.ok(existsSync(join(backupDir, artifact)), `Missing ${artifact}`);
  }
  assert.equal(existsSync(join(backupDir, "sit-credentials.json")), false);
  assert.equal(
    w.sitDaemon.calls.some(
      (argv) =>
        argv[0] === "exec" && argv.includes("apps/api/dist/seed-uat.js"),
    ),
    false,
    "Stage 1 must not seed before interactive /setup with TOTP and portal auth configuration",
  );
  const pendingCheckpoint = JSON.parse(
    readFileSync(join(backupDir, "fresh-setup-pending.json"), "utf8"),
  );
  assert.equal(pendingCheckpoint.status, "awaiting_setup");
  assert.equal(pendingCheckpoint.image, NEXT_IMAGE);
  assert.match(pendingCheckpoint.dbGeneration, /^\d+:\d+$/);
  assert.equal(
    pendingCheckpoint.dbGeneration,
    w.sitDaemon.volumes.get(`${PROJECT}_postgres-data`).db.generationId,
  );
  assert.equal(
    statSync(join(backupDir, "fresh-setup-pending.json")).mode & 0o777,
    0o600,
  );

  // Stage 2 refuses until /setup, verified admin TOTP, and customer auth.password are complete
  const resumeArgs = [
    "--resume-seed",
    stamp,
    "--confirm-daemon",
    w.sitDaemon.daemonId,
  ];
  assert.throws(
    () => w.execute({ args: resumeArgs }),
    /Initial instance setup is incomplete/,
  );

  const freshPg = w.sitDaemon.volumes.get(`${PROJECT}_postgres-data`).db;
  freshPg.setupCompleted = true;
  assert.throws(
    () => w.execute({ args: resumeArgs }),
    /First-admin setup requires a verified TOTP factor/,
  );

  freshPg.adminTotpVerified = true;
  assert.throws(
    () => w.execute({ args: resumeArgs }),
    /Enable Email\/Password authentication/,
  );

  // Once all Stage 2 prerequisites hold, Stage 2 seeds once and runs smoke
  freshPg.customerPasswordEnabled = true;
  w.execute({ args: resumeArgs });
  assert.ok(w.logs.includes("Fresh install smoke passed."));
  assert.ok(existsSync(join(backupDir, "sit-credentials.json")));
  assert.ok(
    w.sitDaemon.calls.some(
      (argv) =>
        argv[0] === "exec" &&
        argv.includes("apps/api/dist/seed-uat.js") &&
        argv.includes("--uat"),
    ),
    "Expected Stage 2 to invoke apps/api/dist/seed-uat.js --uat",
  );
  assert.ok(
    !w.sitDaemon.calls.some((argv) =>
      argv.some((arg) => String(arg).includes("seed-sit-users.js")),
    ),
    "Fresh install must never invoke seed-sit-users.js",
  );
  const seededCheckpoint = JSON.parse(
    readFileSync(join(backupDir, "fresh-setup-pending.json"), "utf8"),
  );
  assert.equal(seededCheckpoint.status, "seeded");
  assert.throws(() => w.execute({ args: resumeArgs }), /already seeded/);

  const countsContent = readFileSync(join(backupDir, "counts.txt"), "utf8");
  const sumsContent = readFileSync(join(backupDir, "SHA256SUMS"), "utf8");
  w.assertNoSecretsLogged([countsContent]);
  for (const secret of Object.values(FAKE_SECRETS)) {
    assert.ok(!sumsContent.includes(secret));
  }
  assert.doesNotMatch(sumsContent, /postgres(?:ql)?:\/\//i);
});

test("real chain: failures at dump, archive, checksum, scratch restore and count comparison preserve originals and restart app", (t) => {
  const scenarios = [
    {
      name: "dump command failure",
      setup: (w) =>
        w.setHook((bin, argv) => {
          if (bin === "docker" && argv.join(" ").includes("pg_dump -Fc"))
            return {
              status: 1,
              stdout: "",
              stderr: `postgres://sit_owner:${FAKE_SECRETS.ownerDbPass}@postgres:5432/taskdesk_sit Cookie: better-auth.session_token=${FAKE_SECRETS.cookieToken}`,
            };
        }),
      expected: /docker exec failed/,
    },
    {
      name: "corrupt attachment archive rejected by validateTarFile",
      setup: (w) =>
        w.setHook((bin, argv, options) => {
          if (
            bin === "docker" &&
            argv[0] === "exec" &&
            argv.includes("/app/data/attachments") &&
            argv.includes("tar")
          ) {
            const corrupt = makeUstarArchive([
              { name: "./ok.txt", type: "f", content: "x" },
            ]);
            corrupt[257] = 0x58; // break ustar magic while tar -tf only reads header names
            return writeStdoutOrFd(options, corrupt);
          }
        }),
      expected: /Unsupported tar format/,
    },
    {
      name: "attachment hash mismatch during restore proof",
      setup: (w) => {
        let manifestReads = 0;
        w.setHook((bin, argv) => {
          if (
            bin === "docker" &&
            argv[0] === "exec" &&
            argv.includes("node") &&
            argv.includes("/app/data/attachments")
          ) {
            manifestReads += 1;
            // Mutate live attachment content before restore-proof's post-extract manifest comparison
            if (manifestReads === 2) {
              w.sitDaemon.volumes
                .get(`${PROJECT}_attachments`)
                .files.set(
                  "att-1/hello.txt",
                  Buffer.from("tampered-live-bytes\n"),
                );
            }
          }
        });
      },
      expected: /Attachment restore hash or file count mismatch/,
    },
    {
      name: "checksum verification failure",
      setup: (w) => {
        let checks = 0;
        w.setHook((bin, argv) => {
          if (bin === "shasum" && argv.includes("-c")) {
            checks += 1;
            if (checks === 1) return { status: 1, stdout: "" };
          }
        });
      },
      expected: /shasum -a failed/,
    },
    {
      name: "scratch pg_restore failure",
      setup: (w) =>
        w.setHook((bin, argv) => {
          if (
            bin === "docker" &&
            argv.includes("pg_restore") &&
            argv.includes("--exit-on-error")
          ) {
            return { status: 1, stdout: "" };
          }
        }),
      expected: /docker exec failed/,
    },
    {
      name: "scratch restored row count mismatch",
      setup: (w) =>
        w.setHook((bin, argv, options) => {
          if (
            bin === "docker" &&
            argv[0] === "exec" &&
            argv.includes("psql") &&
            argv.includes("postgres")
          ) {
            return writeStdoutOrFd(
              options,
              "table_count|3\npublic.tickets|999\npublic.users|7\npublic.workspaces|1\n",
            );
          }
        }),
      expected: /Restored database table or row counts mismatch/,
    },
    {
      name: "live database row count changed during restore proof (dbName branch)",
      setup: (w) => {
        let countCalls = 0;
        w.setHook((bin, argv) => {
          if (
            bin === "docker" &&
            argv[0] === "exec" &&
            argv.includes("counts")
          ) {
            countCalls += 1;
            if (countCalls === 2) {
              w.sitDaemon.volumes.get(`${PROJECT}_postgres-data`).db.rows[
                "public.tickets"
              ] = 43;
            }
          }
        });
      },
      expected: /Live database changed during backup verification/,
    },
  ];

  for (const scenario of scenarios) {
    const w = createRealChainWorld(t);
    scenario.setup(w);
    let caught;
    assert.throws(
      () => {
        try {
          w.execute();
        } catch (err) {
          caught = err;
          throw err;
        }
      },
      scenario.expected,
      `Scenario failed: ${scenario.name}`,
    );
    w.assertPreProofRollback();
    // Ensure temporary scratch restore-proof and attachment-helper containers were cleaned up
    assert.equal(
      w.sitDaemon.containers.size,
      5,
      `Scenario left leaked helper containers: ${scenario.name}`,
    );
    const redactedErr = redactFreshText(caught.message, {
      env: w.env,
      checkout: process.cwd(),
    });
    w.assertNoSecretsLogged([redactedErr]);
  }
});

test("real chain: connected client sessions refuse before dump and during restore proof (dbName branch), restarting app", (t) => {
  // 1. Pre-dump active writer session
  const preDump = createRealChainWorld(t);
  preDump.sitDaemon.volumes.get(`${PROJECT}_postgres-data`).db.activeWriters =
    1;
  assert.throws(() => preDump.execute(), /client sessions/);
  assert.ok(
    !preDump.sitDaemon.calls.some((args) =>
      args.join(" ").includes("pg_dump -Fc"),
    ),
  );
  preDump.assertPreProofRollback();
  preDump.assertNoSecretsLogged();

  // 2. Client session appearing during verifyRestoreProof's dbName check
  const midProof = createRealChainWorld(t);
  midProof.setHook((bin, argv) => {
    if (bin === "docker" && argv.includes("sessions")) {
      midProof.sitDaemon.volumes.get(
        `${PROJECT}_postgres-data`,
      ).db.activeWriters = 2;
    }
  });
  assert.throws(
    () => midProof.execute(),
    /Client database sessions detected during snapshot verification/,
  );
  midProof.assertPreProofRollback();
  midProof.assertNoSecretsLogged();
});

test("real chain: daemon or context change mid-run refuses destructive commands on both daemons", (t) => {
  // 1. Active context switches right before scratch proof cleanup (beforeRemove)
  const midProof = createRealChainWorld(t);
  let countChecks = 0;
  let switchOnNextDaemonCheck = false;
  midProof.setHook((bin, argv) => {
    if (bin === "docker" && argv[0] === "exec" && argv.includes("counts")) {
      countChecks += 1;
      if (countChecks === 2) switchOnNextDaemonCheck = true;
    } else if (
      switchOnNextDaemonCheck &&
      bin === "docker" &&
      argv[0] === "context" &&
      argv[1] === "show"
    ) {
      switchOnNextDaemonCheck = false;
      midProof.setActiveContext("other-local");
    }
  });
  assert.throws(() => midProof.execute(), /daemon or context changed/);
  assert.equal(midProof.removedOriginalResources(midProof.sitDaemon).length, 0);
  assert.equal(midProof.destructiveDaemonCalls(midProof.otherDaemon).length, 0);
  midProof.assertNoSecretsLogged();

  // 2. Active context switches right after restore proof completes, before original removal
  const preRemoval = createRealChainWorld(t);
  let shasumChecks = 0;
  preRemoval.setHook((bin, argv) => {
    if (bin === "shasum" && argv.includes("-c")) {
      shasumChecks += 1;
      if (shasumChecks === 2) preRemoval.setActiveContext("other-local");
    }
  });
  assert.throws(() => preRemoval.execute(), /daemon or context changed/);
  assert.equal(
    preRemoval.removedOriginalResources(preRemoval.sitDaemon).length,
    0,
  );
  assert.equal(
    preRemoval.destructiveDaemonCalls(preRemoval.otherDaemon).length,
    0,
  );
  preRemoval.assertNoSecretsLogged();
});

test("real chain: container or volume ownership/label change right before its own removal refuses removal", (t) => {
  // 1. First container's project label changes right before its own removal -> zero removals at all
  const firstContainer = createRealChainWorld(t);
  let sawPostProofInventory = false;
  firstContainer.setHook((bin, argv) => {
    if (bin === "docker" && argv[0] === "rm" && argv.includes("-v")) {
      sawPostProofInventory = true;
    } else if (
      sawPostProofInventory &&
      bin === "docker" &&
      argv[0] === "inspect" &&
      argv.length === 2 &&
      argv[1] === firstContainer.sitDaemon.originals.proxy
    ) {
      // Mutate right after post-proof inventory, on the per-container checkedContainer() before rm
      const proxy = firstContainer.sitDaemon.containers.get(
        firstContainer.sitDaemon.originals.proxy,
      );
      proxy.Config.Labels["com.docker.compose.project"] = "foreign-project";
    }
  });
  assert.throws(() => firstContainer.execute(), /Unsafe container ownership/);
  assert.equal(firstContainer.removedOriginalResources().length, 0);

  // 2. Second container's project label changes after first container is removed -> second container is NOT removed
  const secondContainer = createRealChainWorld(t);
  let proxyRemoved = false;
  secondContainer.setHook((bin, argv) => {
    if (
      bin === "docker" &&
      argv[0] === "rm" &&
      argv[1] === secondContainer.sitDaemon.originals.proxy
    ) {
      proxyRemoved = true;
    } else if (
      proxyRemoved &&
      bin === "docker" &&
      argv[0] === "inspect" &&
      argv.length === 2 &&
      argv[1] === secondContainer.sitDaemon.originals.app
    ) {
      const app = secondContainer.sitDaemon.containers.get(
        secondContainer.sitDaemon.originals.app,
      );
      app.Config.Labels["com.docker.compose.project"] = "foreign-project";
    }
  });
  assert.throws(
    () => secondContainer.execute(),
    /Unsafe container ownership|Project inventory changed/,
  );
  assert.ok(
    !secondContainer.sitDaemon.calls.some(
      ([op, id]) =>
        op === "rm" && id === secondContainer.sitDaemon.originals.app,
    ),
    "Mutated second container must never be passed to docker rm",
  );
  assert.ok(
    secondContainer.sitDaemon.containers.has(
      secondContainer.sitDaemon.originals.app,
    ),
  );

  // 3. Volume project label changes right before its own docker volume rm -> volume is not removed
  const volumeCase = createRealChainWorld(t);
  const targetVol = `${PROJECT}_attachments`;
  let containersRemoved = 0;
  volumeCase.setHook((bin, argv) => {
    if (
      bin === "docker" &&
      argv[0] === "rm" &&
      !argv.includes("-f") &&
      Object.values(volumeCase.sitDaemon.originals).includes(argv.at(-1))
    ) {
      containersRemoved += 1;
      if (containersRemoved === 5) {
        volumeCase.sitDaemon.volumes.get(targetVol).Labels[
          "com.docker.compose.project"
        ] = "foreign-project";
      }
    }
  });
  assert.throws(
    () => volumeCase.execute(),
    /Volume no longer belongs to project inventory|Unsafe volume ownership/,
  );
  assert.ok(
    !volumeCase.sitDaemon.calls.some(
      ([op, sub, name]) =>
        op === "volume" && sub === "rm" && name === targetVol,
    ),
    "Mutated volume must never be passed to docker volume rm",
  );
  assert.ok(volumeCase.sitDaemon.volumes.has(targetVol));
});

test("real chain: concurrent invocation with different env-file and private-dir paths is blocked by daemon-project lock", (t) => {
  const w = createRealChainWorld(t);
  const secondPrivate = join(w.baseDir, "second-private");
  const secondComposeDir = join(w.baseDir, "second-compose");
  mkdirSync(join(secondPrivate, "proxy"), { recursive: true, mode: 0o700 });
  mkdirSync(secondComposeDir, { recursive: true, mode: 0o700 });
  const secondEnvFile = join(secondComposeDir, "other.compose.env");
  writeFileSync(
    secondEnvFile,
    `SIT_IMAGE=${NEXT_IMAGE}\nTASKDESK_IMAGE_TAG=${NEXT_TAG}\n`,
    { mode: 0o600 },
  );

  let concurrentChecked = false;
  w.setHook((bin, argv) => {
    if (
      !concurrentChecked &&
      bin === "docker" &&
      argv.join(" ").includes("pg_dump -Fc")
    ) {
      concurrentChecked = true;
      const callsBefore = w.sitDaemon.calls.length;
      assert.throws(
        () =>
          w.execute({
            env: {
              ...w.env,
              SIT_PRIVATE_DIR: secondPrivate,
              SIT_COMPOSE_ENV: secondEnvFile,
            },
          }),
        /Daemon project lock .* is already held/,
      );
      assert.throws(
        () =>
          deployLocal({
            args: [],
            env: {
              ...w.env,
              SIT_PRIVATE_DIR: secondPrivate,
              SIT_COMPOSE_ENV: secondEnvFile,
            },
            run: w.run,
            lockRoot: w.lockRoot,
          }),
        /Daemon project lock .* is already held/,
      );
      // Only read-only daemon identity inspection ran in the blocked invocations
      const during = w.sitDaemon.calls.slice(callsBefore);
      assert.ok(during.every(([op]) => ["context", "info"].includes(op)));
    }
  });

  w.execute();
  assert.equal(concurrentChecked, true);
  assert.ok(
    w.logs.some((line) =>
      line.includes("Fresh empty install ready (checkpoint"),
    ),
  );
  w.assertNoSecretsLogged();
});

function completeStage1AndSetup(w) {
  w.execute();
  const stamp = "2026-11-12T12-00-00-000Z";
  const freshPg = w.sitDaemon.volumes.get(`${PROJECT}_postgres-data`).db;
  freshPg.setupCompleted = true;
  freshPg.adminTotpVerified = true;
  freshPg.customerPasswordEnabled = true;
  return {
    stamp,
    backupDir: join(w.privateDir, "fresh-backups", stamp),
    resumeArgs: [
      "--resume-seed",
      stamp,
      "--confirm-daemon",
      w.sitDaemon.daemonId,
    ],
  };
}

test("real chain: Stage 2 rescues credentials on seed failure, restores and re-runs idempotent seed until exit 0, and retries smoke only once seed exits 0", (t) => {
  // 1. Pre-commit seed-uat.js failure (writes /tmp/sit-credentials.json before DB rows)
  // rescues host creds, deletes container /tmp copy, keeps status awaiting_setup, and
  // restores the identical passwords into /tmp/sit-credentials.json when re-running seed.
  const preCommit = createRealChainWorld(t);
  const pc = completeStage1AndSetup(preCommit);
  let preCommitSeedCalls = 0;
  let preCommitSecondCallHadCreds = false;
  const savedPasswords = makeMockUatCredentials();
  preCommit.setHook((bin, argv) => {
    if (bin === "docker" && argv.includes("apps/api/dist/seed-uat.js")) {
      preCommitSeedCalls += 1;
      const app = [...preCommit.sitDaemon.containers.values()].find(
        (c) => c.Config?.Labels?.["com.docker.compose.service"] === "taskdesk",
      );
      const credPath = argv[argv.indexOf("--credentials-file") + 1];
      if (preCommitSeedCalls === 1) {
        app.tmpFiles.set(credPath, JSON.stringify(savedPasswords));
        return { status: 1, stdout: "" };
      }
      preCommitSecondCallHadCreds =
        app.tmpFiles.get(credPath) === JSON.stringify(savedPasswords);
    }
  });
  assert.throws(
    () => preCommit.execute({ args: pc.resumeArgs }),
    /docker exec failed/,
  );
  assert.ok(existsSync(join(pc.backupDir, "sit-credentials.json")));
  assert.equal(
    JSON.parse(
      readFileSync(join(pc.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "awaiting_setup",
  );
  const pcPg = preCommit.sitDaemon.volumes.get(`${PROJECT}_postgres-data`).db;
  assert.equal(pcPg.rows["public.users"], 0);
  for (const c of preCommit.sitDaemon.containers.values()) {
    assert.equal(c.tmpFiles.has("/tmp/sit-credentials.json"), false);
  }
  preCommit.execute({ args: pc.resumeArgs });
  assert.equal(preCommitSeedCalls, 2);
  assert.equal(preCommitSecondCallHadCreds, true);
  assert.equal(
    readFileSync(join(pc.backupDir, "sit-credentials.json"), "utf8"),
    JSON.stringify(savedPasswords),
  );
  assert.equal(pcPg.rows["public.users"], 6);
  assert.equal(pcPg.rows["public.workspaces"], 1);
  assert.equal(pcPg.rows["public.automation_rules"], 2);
  assert.equal(pcPg.rows["public.pages"], 1);
  assert.equal(pcPg.rows["public.reports"], 1);
  assert.equal(
    JSON.parse(
      readFileSync(join(pc.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "seeded",
  );
  for (const c of preCommit.sitDaemon.containers.values()) {
    assert.equal(c.tmpFiles.has("/tmp/sit-credentials.json"), false);
  }

  // 2. Post-core partial fixture failure (accounts committed, fails before G-1 automations/pages/reports)
  // keeps awaiting_setup and completes remaining fixtures on resume with preserved passwords.
  const partialPostCore = createRealChainWorld(t);
  const ppc = completeStage1AndSetup(partialPostCore);
  let ppcSeedCalls = 0;
  let ppcReusedHostCreds = false;
  partialPostCore.setHook((bin, argv) => {
    if (bin === "docker" && argv.includes("apps/api/dist/seed-uat.js")) {
      ppcSeedCalls += 1;
      const app = [...partialPostCore.sitDaemon.containers.values()].find(
        (c) => c.Config?.Labels?.["com.docker.compose.service"] === "taskdesk",
      );
      const pgDb = partialPostCore.sitDaemon.volumes.get(
        `${PROJECT}_postgres-data`,
      ).db;
      const credPath = argv[argv.indexOf("--credentials-file") + 1];
      if (ppcSeedCalls === 1) {
        app.tmpFiles.set(credPath, JSON.stringify(savedPasswords));
        pgDb.rows["public.users"] = 6;
        pgDb.rows["public.workspaces"] = 1;
        return { status: 1, stdout: "" };
      }
      ppcReusedHostCreds =
        app.tmpFiles.get(credPath) === JSON.stringify(savedPasswords);
    }
  });
  assert.throws(
    () => partialPostCore.execute({ args: ppc.resumeArgs }),
    /docker exec failed/,
  );
  const ppcPg = partialPostCore.sitDaemon.volumes.get(
    `${PROJECT}_postgres-data`,
  ).db;
  assert.equal(ppcPg.rows["public.users"], 6);
  assert.equal(ppcPg.rows["public.automation_rules"] ?? 0, 0);
  assert.equal(
    JSON.parse(
      readFileSync(join(ppc.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "awaiting_setup",
  );
  partialPostCore.execute({ args: ppc.resumeArgs });
  assert.equal(ppcSeedCalls, 2);
  assert.equal(ppcReusedHostCreds, true);
  assert.equal(ppcPg.rows["public.automation_rules"], 2);
  assert.equal(ppcPg.rows["public.pages"], 1);
  assert.equal(ppcPg.rows["public.reports"], 1);
  assert.equal(
    JSON.parse(
      readFileSync(join(ppc.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "seeded",
  );

  // 3. Host copy failure after seed preserves container creds and keeps awaiting_setup;
  // retry rescues container copy, restores it into container, re-runs idempotent seed, and finishes cleanly.
  const copyFail = createRealChainWorld(t);
  const cf = completeStage1AndSetup(copyFail);
  let copyFailSeedCalls = 0;
  let failedCopyOnce = false;
  copyFail.setHook((bin, argv) => {
    if (bin === "docker" && argv.includes("apps/api/dist/seed-uat.js")) {
      copyFailSeedCalls += 1;
    }
    if (
      !failedCopyOnce &&
      bin === "docker" &&
      argv[0] === "exec" &&
      argv.includes("cat") &&
      argv.includes("/tmp/sit-credentials.json") &&
      copyFailSeedCalls === 1
    ) {
      failedCopyOnce = true;
      return { status: 1, stdout: "" };
    }
  });
  assert.throws(
    () => copyFail.execute({ args: cf.resumeArgs }),
    /docker exec failed/,
  );
  assert.equal(existsSync(join(cf.backupDir, "sit-credentials.json")), false);
  assert.equal(
    JSON.parse(
      readFileSync(join(cf.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "awaiting_setup",
  );
  const cfApp = [...copyFail.sitDaemon.containers.values()].find(
    (c) => c.Config?.Labels?.["com.docker.compose.service"] === "taskdesk",
  );
  assert.equal(cfApp.tmpFiles.has("/tmp/sit-credentials.json"), true);
  copyFail.execute({ args: cf.resumeArgs });
  assert.equal(copyFailSeedCalls, 2);
  assert.equal(cfApp.tmpFiles.has("/tmp/sit-credentials.json"), false);
  assert.ok(existsSync(join(cf.backupDir, "sit-credentials.json")));
  assert.equal(
    JSON.parse(
      readFileSync(join(cf.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "seeded",
  );

  // 4. Container rm -f failure throws loudly and leaves awaiting_setup;
  // retry restores creds, re-runs idempotent seed, cleans up, and passes smoke.
  const rmFail = createRealChainWorld(t);
  const rf = completeStage1AndSetup(rmFail);
  let rmFailSeedCalls = 0;
  let failedRmOnce = false;
  rmFail.setHook((bin, argv) => {
    if (bin === "docker" && argv.includes("apps/api/dist/seed-uat.js")) {
      rmFailSeedCalls += 1;
    }
    if (
      !failedRmOnce &&
      bin === "docker" &&
      argv[0] === "exec" &&
      argv.includes("rm") &&
      argv.includes("/tmp/sit-credentials.json")
    ) {
      failedRmOnce = true;
      return { status: 1, stdout: "" };
    }
  });
  assert.throws(
    () => rmFail.execute({ args: rf.resumeArgs }),
    /Failed to remove temporary sit-credentials\.json from container/,
  );
  assert.ok(existsSync(join(rf.backupDir, "sit-credentials.json")));
  assert.equal(
    JSON.parse(
      readFileSync(join(rf.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "awaiting_setup",
  );
  rmFail.execute({ args: rf.resumeArgs });
  assert.equal(rmFailSeedCalls, 2);
  assert.ok(rmFail.logs.includes("Fresh install smoke passed."));
  assert.equal(
    JSON.parse(
      readFileSync(join(rf.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "seeded",
  );

  // 5. Invalid rescued container credential JSON still cleans up container /tmp copy (Opus L2)
  const badCreds = createRealChainWorld(t);
  const bc = completeStage1AndSetup(badCreds);
  badCreds.setHook((bin, argv) => {
    if (bin === "docker" && argv.includes("apps/api/dist/seed-uat.js")) {
      const app = [...badCreds.sitDaemon.containers.values()].find(
        (c) => c.Config?.Labels?.["com.docker.compose.service"] === "taskdesk",
      );
      const invalidSet = makeMockUatCredentials();
      invalidSet.accounts[0] = {
        ...invalidSet.accounts[0],
        password: "",
      };
      app.tmpFiles.set(
        argv[argv.indexOf("--credentials-file") + 1],
        JSON.stringify(invalidSet),
      );
      return { status: 0, stdout: "" };
    }
  });
  assert.throws(
    () => badCreds.execute({ args: bc.resumeArgs }),
    /missing, duplicate or weak account credentials/,
  );
  assert.equal(existsSync(join(bc.backupDir, "sit-credentials.json")), false);
  for (const c of badCreds.sitDaemon.containers.values()) {
    assert.equal(c.tmpFiles.has("/tmp/sit-credentials.json"), false);
  }

  // 6. release-smoke.mjs failure retries from seeded_awaiting_smoke without re-running seed-uat.js
  const smokeFail = createRealChainWorld(t);
  const sf = completeStage1AndSetup(smokeFail);
  let sfSeedCalls = 0;
  let failedSmokeOnce = false;
  smokeFail.setHook((bin, argv) => {
    if (bin === "docker" && argv.includes("apps/api/dist/seed-uat.js")) {
      sfSeedCalls += 1;
      if (sfSeedCalls > 1)
        throw new Error("seed-uat.js must not re-run during smoke retry");
    }
    if (
      !failedSmokeOnce &&
      bin === "node" &&
      argv[0] === "scripts/sit/release-smoke.mjs"
    ) {
      failedSmokeOnce = true;
      return { status: 1, stdout: "" };
    }
  });
  assert.throws(
    () => smokeFail.execute({ args: sf.resumeArgs }),
    /node scripts\/sit\/release-smoke\.mjs failed/,
  );
  assert.equal(
    JSON.parse(
      readFileSync(join(sf.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "seeded_awaiting_smoke",
  );
  smokeFail.execute({ args: sf.resumeArgs });
  assert.equal(sfSeedCalls, 1);
  assert.equal(
    JSON.parse(
      readFileSync(join(sf.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "seeded",
  );
  smokeFail.assertNoSecretsLogged();

  // 7. Subset credential JSON (1 account with strong 24+ char password) is rejected in seeded_awaiting_smoke (Sol L1),
  // and simultaneous container rm -f failure surfaces both errors (Sol L2).
  const subsetCreds = createRealChainWorld(t);
  const sc = completeStage1AndSetup(subsetCreds);
  let failSmokeSubsetOnce = true;
  let failRmOnSubset = false;
  subsetCreds.setHook((bin, argv) => {
    if (
      failSmokeSubsetOnce &&
      bin === "node" &&
      argv[0] === "scripts/sit/release-smoke.mjs"
    ) {
      failSmokeSubsetOnce = false;
      return { status: 1, stdout: "" };
    }
    if (
      failRmOnSubset &&
      bin === "docker" &&
      argv[0] === "exec" &&
      argv.includes("rm") &&
      argv.includes("/tmp/sit-credentials.json")
    ) {
      return { status: 1, stdout: "" };
    }
  });
  assert.throws(
    () => subsetCreds.execute({ args: sc.resumeArgs }),
    /release-smoke\.mjs failed/,
  );
  const subsetPath = join(sc.backupDir, "sit-credentials.json");
  writeFileSync(
    subsetPath,
    JSON.stringify({ accounts: [makeMockUatCredentials().accounts[0]] }),
  );
  chmodSync(subsetPath, 0o600);
  failRmOnSubset = true;
  assert.throws(
    () => subsetCreds.execute({ args: sc.resumeArgs }),
    new RegExp(
      `must contain exactly the ${G1_ACCOUNTS.length} UAT accounts.*Failed to remove temporary sit-credentials\\.json`,
    ),
  );
  subsetCreds.assertNoSecretsLogged();

  // 8. Interrupted restore-creds + container rm -f failure surfaces both errors (Sol L2)
  const restoreFail = createRealChainWorld(t);
  const rst = completeStage1AndSetup(restoreFail);
  let failRestoreSeedOnce = true;
  let failRestoreRmCombo = false;
  restoreFail.setHook((bin, argv) => {
    if (
      failRestoreSeedOnce &&
      bin === "docker" &&
      argv.includes("apps/api/dist/seed-uat.js")
    ) {
      failRestoreSeedOnce = false;
      const app = [...restoreFail.sitDaemon.containers.values()].find(
        (c) => c.Config?.Labels?.["com.docker.compose.service"] === "taskdesk",
      );
      app.tmpFiles.set(
        argv[argv.indexOf("--credentials-file") + 1],
        JSON.stringify(makeMockUatCredentials()),
      );
      return { status: 1, stdout: "" };
    }
    if (
      failRestoreRmCombo &&
      bin === "docker" &&
      argv.includes("restore-creds")
    ) {
      return { status: 1, stdout: "" };
    }
    if (
      failRestoreRmCombo &&
      bin === "docker" &&
      argv[0] === "exec" &&
      argv.includes("rm") &&
      argv.includes("/tmp/sit-credentials.json")
    ) {
      return { status: 1, stdout: "" };
    }
  });
  assert.throws(
    () => restoreFail.execute({ args: rst.resumeArgs }),
    /docker exec failed/,
  );
  failRestoreRmCombo = true;
  assert.throws(
    () => restoreFail.execute({ args: rst.resumeArgs }),
    /docker exec failed.*Failed to remove temporary sit-credentials\.json/,
  );
  assert.ok(existsSync(join(rst.backupDir, "sit-credentials.json")));
  assert.equal(
    JSON.parse(
      readFileSync(join(rst.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "awaiting_setup",
  );
  restoreFail.assertNoSecretsLogged();

  // 9. Seed failure + container rm -f failure surfaces seed error + cleanup error (Opus L1)
  const seedRmFail = createRealChainWorld(t);
  const srf = completeStage1AndSetup(seedRmFail);
  seedRmFail.setHook((bin, argv) => {
    if (bin === "docker" && argv.includes("apps/api/dist/seed-uat.js")) {
      const app = [...seedRmFail.sitDaemon.containers.values()].find(
        (c) => c.Config?.Labels?.["com.docker.compose.service"] === "taskdesk",
      );
      app.tmpFiles.set(
        argv[argv.indexOf("--credentials-file") + 1],
        JSON.stringify(makeMockUatCredentials()),
      );
      return { status: 1, stdout: "" };
    }
    if (
      bin === "docker" &&
      argv[0] === "exec" &&
      argv.includes("rm") &&
      argv.includes("/tmp/sit-credentials.json")
    ) {
      return { status: 1, stdout: "" };
    }
  });
  assert.throws(
    () => seedRmFail.execute({ args: srf.resumeArgs }),
    /docker exec failed.*Failed to remove temporary sit-credentials\.json/,
  );
  assert.equal(
    JSON.parse(
      readFileSync(join(srf.backupDir, "fresh-setup-pending.json"), "utf8"),
    ).status,
    "awaiting_setup",
  );
  seedRmFail.assertNoSecretsLogged();

  // 10. Missing/mismatched role or contradictory side rejects in both seeded_awaiting_smoke and awaiting_setup (Sol L1)
  for (const fieldCase of [
    {
      name: "missing role",
      mutate: () => {
        const next = makeMockUatCredentials();
        const { role: _omitted, ...withoutRole } = next.accounts[0];
        next.accounts[0] = withoutRole;
        return next;
      },
    },
    {
      name: "wrong customer role",
      mutate: () => {
        const next = makeMockUatCredentials();
        const custIndex = next.accounts.findIndex((a) =>
          a.role.startsWith("Customer"),
        );
        next.accounts[custIndex] = {
          ...next.accounts[custIndex],
          role: "Workspace viewer",
        };
        return next;
      },
    },
    {
      name: "contradictory side",
      mutate: () => {
        const next = makeMockUatCredentials();
        const custIndex = next.accounts.findIndex((a) =>
          a.role.startsWith("Customer"),
        );
        next.accounts[custIndex] = {
          ...next.accounts[custIndex],
          side: "staff",
        };
        return next;
      },
    },
  ]) {
    const smokeRoleFail = createRealChainWorld(t);
    const srfMeta = completeStage1AndSetup(smokeRoleFail);
    let failSmokeOnce = true;
    let smokeCalls = 0;
    smokeRoleFail.setHook((bin, argv) => {
      if (bin === "node" && argv[0] === "scripts/sit/release-smoke.mjs") {
        smokeCalls += 1;
        if (failSmokeOnce) {
          failSmokeOnce = false;
          return { status: 1, stdout: "" };
        }
      }
    });
    assert.throws(
      () => smokeRoleFail.execute({ args: srfMeta.resumeArgs }),
      /release-smoke\.mjs failed/,
    );
    const metaCredPath = join(srfMeta.backupDir, "sit-credentials.json");
    writeFileSync(metaCredPath, JSON.stringify(fieldCase.mutate()));
    chmodSync(metaCredPath, 0o600);
    assert.throws(
      () => smokeRoleFail.execute({ args: srfMeta.resumeArgs }),
      /invalid role or side metadata/,
      `${fieldCase.name} in seeded_awaiting_smoke must fail closed`,
    );
    assert.equal(smokeCalls, 1, `${fieldCase.name} must block smoke retry`);
    smokeRoleFail.assertNoSecretsLogged();

    const setupRoleFail = createRealChainWorld(t);
    const setMeta = completeStage1AndSetup(setupRoleFail);
    let setupSeedCalls = 0;
    setupRoleFail.setHook((bin, argv) => {
      if (bin === "docker" && argv.includes("apps/api/dist/seed-uat.js")) {
        setupSeedCalls += 1;
      }
    });
    const setupCredPath = join(setMeta.backupDir, "sit-credentials.json");
    writeFileSync(setupCredPath, JSON.stringify(fieldCase.mutate()));
    chmodSync(setupCredPath, 0o600);
    assert.throws(
      () => setupRoleFail.execute({ args: setMeta.resumeArgs }),
      /invalid role or side metadata/,
      `${fieldCase.name} in awaiting_setup must fail closed`,
    );
    assert.equal(setupSeedCalls, 0, `${fieldCase.name} must block seed`);
    setupRoleFail.assertNoSecretsLogged();
  }
});

test("real chain: Stage 2 refuses superseded checkpoint, image mismatch, and PostgreSQL generation mismatch", (t) => {
  const w = createRealChainWorld(t);
  w.execute({ clock: () => new Date("2026-11-12T12:00:00.000Z") });
  const oldStamp = "2026-11-12T12-00-00-000Z";
  w.execute({ clock: () => new Date("2026-11-12T13:00:00.000Z") });
  const newStamp = "2026-11-12T13-00-00-000Z";

  const freshPg = w.sitDaemon.volumes.get(`${PROJECT}_postgres-data`).db;
  freshPg.setupCompleted = true;
  freshPg.adminTotpVerified = true;
  freshPg.customerPasswordEnabled = true;

  assert.throws(
    () =>
      w.execute({
        args: [
          "--resume-seed",
          oldStamp,
          "--confirm-daemon",
          w.sitDaemon.daemonId,
        ],
      }),
    new RegExp(`superseded by newer checkpoint ${newStamp}`),
  );

  // Unreadable newer sibling checkpoint fails closed rather than treating oldStamp as active (Opus L4)
  const newCheckpointFile = join(
    w.privateDir,
    "fresh-backups",
    newStamp,
    "fresh-setup-pending.json",
  );
  const origCheckpoint = JSON.parse(readFileSync(newCheckpointFile, "utf8"));
  writeFileSync(newCheckpointFile, "{corrupt json", { mode: 0o600 });
  assert.throws(
    () =>
      w.execute({
        args: [
          "--resume-seed",
          oldStamp,
          "--confirm-daemon",
          w.sitDaemon.daemonId,
        ],
      }),
    new RegExp(`newer checkpoint ${newStamp} is unreadable`),
  );

  // Image mismatch on current checkpoint refuses before running seeding
  writeFileSync(
    newCheckpointFile,
    `${JSON.stringify({ ...origCheckpoint, image: PREV_IMAGE }, null, 2)}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      w.execute({
        args: [
          "--resume-seed",
          newStamp,
          "--confirm-daemon",
          w.sitDaemon.daemonId,
        ],
      }),
    /does not match target image/,
  );

  // DB generation mismatch refuses cleanly
  writeFileSync(
    newCheckpointFile,
    `${JSON.stringify({ ...origCheckpoint, dbGeneration: "9999999999999999999:99999" }, null, 2)}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      w.execute({
        args: [
          "--resume-seed",
          newStamp,
          "--confirm-daemon",
          w.sitDaemon.daemonId,
        ],
      }),
    /does not match current PostgreSQL database generation/,
  );
  w.assertNoSecretsLogged();
});
