import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { executeFresh } from "../../deploy/local-fresh.mjs";
import { PROJECT } from "../../deploy/local-fresh-plan.mjs";

const PREV_DIGEST = `sha256:${"1".repeat(64)}`;
const PREV_IMAGE = `ghcr.io/thomasheinthura/taskdesk@${PREV_DIGEST}`;
const PREV_IMAGE_ID = `sha256:${"2".repeat(64)}`;

const NEXT_DIGEST = `sha256:${"a".repeat(64)}`;
const NEXT_IMAGE = `ghcr.io/thomasheinthura/taskdesk@${NEXT_DIGEST}`;
const NEXT_IMAGE_ID = `sha256:${"b".repeat(64)}`;
const NEXT_TAG = "v2.1.0";

const PG_IMAGE_ID = `sha256:${"9".repeat(64)}`;

function writeOctal(buf, offset, length, value) {
  const str = value.toString(8).padStart(length - 1, "0");
  buf.write(str, offset, length - 1, "ascii");
  buf[offset + length - 1] = 0;
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
    const chk = `${sum.toString(8).padStart(6, "0")}\0 `;
    header.write(chk, 148, 8, "ascii");
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
    const content = buffer.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    entries.push({ name, type, content: Buffer.from(content) });
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
  const all = [
    ...[...dirs].map((p) => ({ kind: "d", path: p })),
    ...[...filesMap.entries()].map(([p, buf]) => ({
      kind: "f",
      path: p,
      hash: createHash("sha256").update(buf).digest("hex"),
    })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  // Match walk('') traversal order in attachmentManifestCode (depth-first sorted per directory)
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
  void all;
  walk("");
  return JSON.stringify(out);
}

function manifestFromDisk(rootDir) {
  const filesMap = new Map();
  const emptyDirs = [];
  function scan(current) {
    const items = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const item of items) {
      const full = join(current, item.name);
      const rel = relative(rootDir, full);
      if (item.isSymbolicLink()) throw new Error("symlink");
      if (item.isDirectory()) {
        emptyDirs.push(rel);
        scan(full);
      } else if (item.isFile()) {
        filesMap.set(rel, readFileSync(full));
      }
    }
  }
  scan(rootDir);
  const out = [];
  function walk(dir) {
    const items = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const item of items) {
      const full = join(dir, item.name);
      const rel = relative(rootDir, full);
      if (item.isDirectory()) {
        out.push(["d", rel]);
        walk(full);
      } else if (item.isFile()) {
        out.push([
          "f",
          rel,
          createHash("sha256").update(readFileSync(full)).digest("hex"),
        ]);
      }
    }
  }
  void emptyDirs;
  walk(rootDir);
  return JSON.stringify(out);
}

function formatDbCounts(rows) {
  const keys = Object.keys(rows).sort();
  const lines = [`table_count:${keys.length}`];
  for (const key of keys) {
    lines.push(`${key}:${rows[key]}`);
  }
  return `${lines.join("\n")}\n`;
}

function createSitWorld(t) {
  const baseDir = mkdtempSync(join(os.tmpdir(), "sit-real-chain-"));
  t.after(() => rmSync(baseDir, { recursive: true, force: true }));

  const privateDir = join(baseDir, "private");
  const composeDir = join(baseDir, "compose-secret");
  mkdirSync(join(privateDir, "proxy"), { recursive: true, mode: 0o700 });
  mkdirSync(composeDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(privateDir, "app.env"),
    "TASKDESK_AUTH_SECRET=topsecret\n",
    {
      mode: 0o600,
    },
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
  };

  let nextIdSeq = 1;
  const makeHexId = () => (nextIdSeq++).toString(16).padStart(64, "0");

  const initialDbRows = {
    "public.tickets": 42,
    "public.users": 7,
    "public.workspaces": 1,
  };
  const initialAttachmentFiles = new Map([
    ["2026/ticket-1.txt", Buffer.from("customer-attachment-payload-1\n")],
    ["2026/nested/screen.bin", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])],
  ]);

  const volumes = new Map();
  const createVolumeRecord = (key, { rows, files } = {}) => {
    const name = `${PROJECT}_${key}`;
    volumes.set(name, {
      Name: name,
      Driver: "local",
      Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
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
  createVolumeRecord("postgres-data", { rows: initialDbRows });
  createVolumeRecord("attachments", { files: initialAttachmentFiles });
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
      PREV_IMAGE_ID,
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
    [
      NEXT_IMAGE_ID,
      {
        Id: NEXT_IMAGE_ID,
        RepoDigests: [NEXT_IMAGE],
        Config: { Env: ["PATH=/usr/local/bin:/usr/bin"], Volumes: {} },
      },
    ],
  ]);

  const containers = new Map();
  const makeComposeContainer = (service, imageRef, imageId, extra = {}) => {
    const id = makeHexId();
    const record = {
      Id: id,
      Name: `/${PROJECT}-${service}-1`,
      Image: imageId,
      Config: {
        Image: imageRef,
        Labels: {
          "com.docker.compose.project": PROJECT,
          "com.docker.compose.service": service,
        },
        ...(extra.Config || {}),
      },
      HostConfig: {
        NetworkMode: `${PROJECT}_default`,
        PublishAllPorts: false,
        PortBindings: {},
        ...(extra.HostConfig || {}),
      },
      NetworkSettings: {
        Ports: {},
        Networks: { [`${PROJECT}_default`]: {} },
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
      scratchDb: undefined,
    };
    containers.set(id, record);
    return record;
  };

  const traefikBindings = {
    "80/tcp": [
      { HostIp: "127.0.0.1", HostPort: "80" },
      { HostIp: "::1", HostPort: "80" },
    ],
    "443/tcp": [
      { HostIp: "127.0.0.1", HostPort: "443" },
      { HostIp: "::1", HostPort: "443" },
    ],
  };

  makeComposeContainer("postgres", "postgres:18-alpine", PG_IMAGE_ID, {
    Mounts: [
      {
        Type: "volume",
        Name: `${PROJECT}_postgres-data`,
        Destination: "/var/lib/postgresql",
      },
    ],
  });
  makeComposeContainer(
    "valkey",
    "valkey/valkey:9-alpine",
    `sha256:${"3".repeat(64)}`,
  );
  makeComposeContainer(
    "mailpit",
    "axllent/mailpit:v1.28",
    `sha256:${"4".repeat(64)}`,
    {
      Mounts: [
        {
          Type: "volume",
          Name: `${PROJECT}_mailpit-data`,
          Destination: "/data",
        },
      ],
    },
  );
  makeComposeContainer("taskdesk", PREV_IMAGE, PREV_IMAGE_ID, {
    Mounts: [
      {
        Type: "volume",
        Name: `${PROJECT}_attachments`,
        Destination: "/app/data/attachments",
      },
    ],
  });
  makeComposeContainer(
    "traefik",
    "traefik:v3.6.7",
    `sha256:${"5".repeat(64)}`,
    {
      HostConfig: {
        NetworkMode: `${PROJECT}_default`,
        PublishAllPorts: false,
        PortBindings: traefikBindings,
      },
      NetworkSettings: {
        Ports: traefikBindings,
        Networks: { [`${PROJECT}_default`]: {} },
      },
    },
  );

  const world = {
    baseDir,
    privateDir,
    composeDir,
    envFile,
    env,
    containers,
    volumes,
    images,
    initialDbRows,
    initialAttachmentFiles,
    initialCountsText: formatDbCounts(initialDbRows),
    initialAttachmentManifest: manifestFromFileMap(initialAttachmentFiles),
    calls: [],
    closedSwitches: {
      DISABLE_REGISTRATION: "true",
      DISABLE_PASSWORD_REGISTRATION: "true",
      DISABLE_WORKSPACE_CREATION: "true",
    },
    fault: null,
    stalePids: new Set(),
  };

  const signal = (pid) => {
    if (world.stalePids.has(pid)) {
      const err = new Error("No such process");
      err.code = "ESRCH";
      throw err;
    }
    return true;
  };
  world.signal = signal;

  const markCurrentLockOwnerStale = () => {
    const lockOwner = join(`${envFile}.lock`, "owner");
    if (existsSync(lockOwner)) {
      const pid = Number(readFileSync(lockOwner, "utf8").split(" ")[0]);
      world.stalePids.add(pid);
    }
  };
  world.markCurrentLockOwnerStale = markCurrentLockOwnerStale;

  const writeStdoutOrFd = (options, payload) => {
    const buf = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(payload, "utf8");
    if (options?.stdio && typeof options.stdio[1] === "number") {
      writeSync(options.stdio[1], buf);
      return { status: 0, stdout: "" };
    }
    return { status: 0, stdout: buf.toString("utf8") };
  };

  const readStdinOrFd = (options) => {
    if (options?.stdio && typeof options.stdio[0] === "number") {
      return readFileSync(options.stdio[0]);
    }
    if (options?.input !== undefined) {
      return Buffer.isBuffer(options.input)
        ? options.input
        : Buffer.from(String(options.input), "utf8");
    }
    return Buffer.alloc(0);
  };

  const buildComposeConfig = (activeImage) => ({
    name: PROJECT,
    services: {
      postgres: {
        image: "postgres:18-alpine",
        environment: { POSTGRES_USER: "sit_owner", POSTGRES_DB: "sit_db" },
        ports: [
          {
            target: 5432,
            published: "62873",
            host_ip: "127.0.0.1",
            protocol: "tcp",
          },
        ],
        volumes: [
          {
            type: "volume",
            source: "postgres-data",
            target: "/var/lib/postgresql",
          },
        ],
      },
      migrate: {
        image: activeImage,
        environment: {
          TASKDESK_ROLE: "migrate",
          TASKDESK_MIGRATION_DATABASE_URL:
            "postgres://sit_owner:ownerpass@postgres:5432/sit_db",
        },
      },
      taskdesk: {
        image: activeImage,
        environment: {
          TASKDESK_ROLE: "all",
          TASKDESK_PORT: "5173",
          TASKDESK_STORAGE_DRIVER: "filesystem",
          TASKDESK_DATABASE_URL:
            "postgres://taskdesk_app:apppass@postgres:5432/sit_db",
          ...world.closedSwitches,
        },
        volumes: [
          {
            type: "volume",
            source: "attachments",
            target: "/app/data/attachments",
          },
        ],
      },
      traefik: {
        image: "traefik:v3.6.7",
        ports: [
          {
            target: 80,
            published: "80",
            host_ip: "127.0.0.1",
            protocol: "tcp",
          },
          { target: 80, published: "80", host_ip: "::1", protocol: "tcp" },
          {
            target: 443,
            published: "443",
            host_ip: "127.0.0.1",
            protocol: "tcp",
          },
          { target: 443, published: "443", host_ip: "::1", protocol: "tcp" },
        ],
        volumes: [
          {
            type: "bind",
            source: join(privateDir, "proxy"),
            target: "/config",
            read_only: true,
          },
        ],
      },
      mailpit: {
        image: "axllent/mailpit:v1.28",
        ports: [
          {
            target: 8025,
            published: "18025",
            host_ip: "127.0.0.1",
            protocol: "tcp",
          },
          {
            target: 1025,
            published: "11025",
            host_ip: "127.0.0.1",
            protocol: "tcp",
          },
        ],
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

  const composeContainersByService = (svc, onlyRunning = false) =>
    [...containers.values()].filter(
      (c) =>
        c.Config?.Labels?.["com.docker.compose.project"] === PROJECT &&
        c.Config?.Labels?.["com.docker.compose.service"] === svc &&
        (!onlyRunning || c.State?.Running),
    );

  world.run = (bin, argv, options = {}) => {
    world.calls.push([bin, ...argv]);
    if (world.fault) {
      const faultOutcome = world.fault(bin, argv, options);
      if (faultOutcome) return faultOutcome;
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
      const proxies = composeContainersByService("traefik", true);
      const apps = composeContainersByService("taskdesk", true);
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
        const buf = readFileSync(argv[1]);
        const entries = parseUstarArchive(buf);
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
        const targetDir = argv[2];
        return { status: 0, stdout: manifestFromDisk(targetDir) };
      }
      if (argv[0] === "scripts/sit/release-smoke.mjs") {
        const credPath = argv[argv.indexOf("--credentials") + 1];
        if (!existsSync(credPath)) return { status: 1, stdout: "" };
        const parsed = JSON.parse(readFileSync(credPath, "utf8"));
        if (!parsed?.admin?.email) return { status: 1, stdout: "" };
        if (
          composeContainersByService("taskdesk", true).length !== 1 ||
          composeContainersByService("traefik", true).length !== 1
        )
          return { status: 1, stdout: "" };
        return { status: 0, stdout: "" };
      }
      return { status: 1, stdout: "" };
    }

    if (bin !== "docker") return { status: 1, stdout: "" };

    if (argv[0] === "context" && argv[1] === "show") {
      return { status: 0, stdout: "default\n" };
    }
    if (argv[0] === "context" && argv[1] === "inspect") {
      return {
        status: 0,
        stdout: JSON.stringify([
          { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
        ]),
      };
    }

    if (argv[0] === "compose") {
      const fIdx = argv.indexOf("-f");
      const sub = argv.slice(fIdx + 2);
      const envContent = readFileSync(envFile, "utf8");
      const fileImage = /^SIT_IMAGE=(.+)$/m.exec(envContent)?.[1] || NEXT_IMAGE;
      const fileTag =
        /^TASKDESK_IMAGE_TAG=(.+)$/m.exec(envContent)?.[1] || NEXT_TAG;
      const activeImage = options.env?.SIT_IMAGE || fileImage;

      if (sub[0] === "config" && sub[1] === "--environment") {
        return {
          status: 0,
          stdout: `SIT_IMAGE=${activeImage}\nTASKDESK_IMAGE_TAG=${fileTag}\n`,
        };
      }
      if (sub[0] === "config" && sub[1] === "--format" && sub[2] === "json") {
        return {
          status: 0,
          stdout: JSON.stringify(buildComposeConfig(activeImage)),
        };
      }
      if (sub[0] === "ps") {
        const all = sub.includes("-a");
        const runningOnly = !all || sub.includes("running");
        const svc = sub.at(-1);
        const matches = composeContainersByService(svc, runningOnly);
        return {
          status: 0,
          stdout: matches.length
            ? `${matches.map((c) => c.Id).join("\n")}\n`
            : "",
        };
      }
      if (sub[0] === "pull") {
        if (!images.has(activeImage)) return { status: 1, stdout: "" };
        return { status: 0, stdout: "" };
      }
      if (sub[0] === "up") {
        const services = sub.filter(
          (t) => !["up", "-d", "--wait", "--no-deps"].includes(t),
        );
        for (const svc of services) {
          for (const existing of composeContainersByService(svc, false)) {
            containers.delete(existing.Id);
          }
          if (svc === "postgres") {
            if (!volumes.has(`${PROJECT}_postgres-data`))
              createVolumeRecord("postgres-data");
            makeComposeContainer(
              "postgres",
              "postgres:18-alpine",
              PG_IMAGE_ID,
              {
                Mounts: [
                  {
                    Type: "volume",
                    Name: `${PROJECT}_postgres-data`,
                    Destination: "/var/lib/postgresql",
                  },
                ],
              },
            );
          } else if (svc === "valkey") {
            makeComposeContainer(
              "valkey",
              "valkey/valkey:9-alpine",
              `sha256:${"3".repeat(64)}`,
            );
          } else if (svc === "mailpit") {
            if (!volumes.has(`${PROJECT}_mailpit-data`))
              createVolumeRecord("mailpit-data");
            makeComposeContainer(
              "mailpit",
              "axllent/mailpit:v1.28",
              `sha256:${"4".repeat(64)}`,
              {
                Mounts: [
                  {
                    Type: "volume",
                    Name: `${PROJECT}_mailpit-data`,
                    Destination: "/data",
                  },
                ],
              },
            );
          } else if (svc === "taskdesk") {
            const img = images.get(activeImage);
            const pgVol = volumes.get(`${PROJECT}_postgres-data`);
            if (!img || !pgVol?.db?.appRoleReady)
              return { status: 1, stdout: "" };
            makeComposeContainer("taskdesk", activeImage, img.Id, {
              Mounts: [
                {
                  Type: "volume",
                  Name: `${PROJECT}_attachments`,
                  Destination: "/app/data/attachments",
                },
              ],
            });
          } else if (svc === "traefik") {
            makeComposeContainer(
              "traefik",
              "traefik:v3.6.7",
              `sha256:${"5".repeat(64)}`,
              {
                HostConfig: {
                  NetworkMode: `${PROJECT}_default`,
                  PublishAllPorts: false,
                  PortBindings: traefikBindings,
                },
                NetworkSettings: {
                  Ports: traefikBindings,
                  Networks: { [`${PROJECT}_default`]: {} },
                },
              },
            );
          }
        }
        return { status: 0, stdout: "" };
      }
      if (sub[0] === "run" && sub.includes("migrate")) {
        const img = images.get(activeImage);
        const pgVol = volumes.get(`${PROJECT}_postgres-data`);
        if (!img || !pgVol?.db) return { status: 1, stdout: "" };
        const shouldFailMigration = world.failNextMigration === true;
        if (shouldFailMigration) {
          world.failNextMigration = false;
        } else {
          if (Object.keys(pgVol.db.rows).length === 0) {
            pgVol.db.rows = {
              "public.migrations": 15,
              "public.tickets": 0,
              "public.users": 0,
              "public.workspaces": 0,
            };
          }
          pgVol.db.appRoleReady = true;
        }
        const mig = makeComposeContainer("migrate", activeImage, img.Id, {
          State: {
            Running: false,
            ExitCode: shouldFailMigration ? 1 : 0,
          },
        });
        return { status: 0, stdout: `${mig.Id}\n` };
      }
      if (sub[0] === "exec") {
        const svc = sub[2];
        const running = composeContainersByService(svc, true);
        if (running.length !== 1) return { status: 1, stdout: "" };
        if (
          svc === "postgres" &&
          sub.join(" ").includes("information_schema.tables")
        ) {
          const pgVol = volumes.get(`${PROJECT}_postgres-data`);
          return {
            status: Object.keys(pgVol?.db?.rows || {}).length > 0 ? 0 : 1,
            stdout: "",
          };
        }
        if (
          svc === "taskdesk" &&
          sub.join(" ").includes("/api/public/health/ready")
        ) {
          const pgVol = volumes.get(`${PROJECT}_postgres-data`);
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
      const matched = [...containers.values()].filter((c) =>
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
      const found = ids.map((id) => containers.get(id)).filter(Boolean);
      if (found.length !== ids.length) return { status: 1, stdout: "" };
      return { status: 0, stdout: JSON.stringify(found) };
    }

    if (argv[0] === "image" && argv[1] === "inspect") {
      const ref = argv[2];
      const img = images.get(ref);
      if (!img) return { status: 1, stdout: "" };
      return { status: 0, stdout: JSON.stringify([img]) };
    }

    if (argv[0] === "volume" && argv[1] === "ls") {
      const names = [...volumes.values()]
        .filter((v) => v.Labels?.["com.docker.compose.project"] === PROJECT)
        .map((v) => v.Name);
      return { status: 0, stdout: names.length ? `${names.join("\n")}\n` : "" };
    }

    if (argv[0] === "volume" && argv[1] === "inspect") {
      const names = argv.slice(2);
      const found = names.map((n) => volumes.get(n)).filter(Boolean);
      if (found.length !== names.length) return { status: 1, stdout: "" };
      return {
        status: 0,
        stdout: JSON.stringify(
          found.map(({ Name, Driver, Mountpoint, Labels }) => ({
            Name,
            Driver,
            Mountpoint,
            Labels,
          })),
        ),
      };
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
      createVolumeRecord(key);
      volumes.get(name).Labels = labels;
      return { status: 0, stdout: `${name}\n` };
    }

    if (argv[0] === "volume" && argv[1] === "rm") {
      const name = argv[2];
      const inUse = [...containers.values()].some((c) =>
        (c.Mounts || []).some((m) => m.Name === name),
      );
      if (inUse || !volumes.has(name)) return { status: 1, stdout: "" };
      volumes.delete(name);
      return { status: 0, stdout: `${name}\n` };
    }

    if (argv[0] === "stop") {
      const id = argv.at(-1);
      const c = containers.get(id);
      if (!c) return { status: 1, stdout: "" };
      c.State.Running = false;
      return { status: 0, stdout: `${id}\n` };
    }

    if (argv[0] === "rm") {
      const force = argv.includes("-f");
      const id = argv.at(-1);
      const c = containers.get(id);
      if (!c || (c.State.Running && !force)) return { status: 1, stdout: "" };
      containers.delete(id);
      return { status: 0, stdout: `${id}\n` };
    }

    if (argv[0] === "create") {
      const id = makeHexId();
      const name = argv[argv.indexOf("--name") + 1];
      const labelExpr = argv[argv.indexOf("--label") + 1];
      const [labelKey, labelVal] = labelExpr.split("=");
      const network = argv[argv.indexOf("--network") + 1];
      if (labelKey === "info.taskdesk.restore-proof") {
        const imageRef = argv.at(-1);
        containers.set(id, {
          Id: id,
          Name: `/${name}`,
          Image: imageRef,
          Config: {
            Image: imageRef,
            Labels: { [labelKey]: labelVal },
          },
          HostConfig: {
            NetworkMode: network,
            PublishAllPorts: false,
            PortBindings: {},
            Tmpfs: { "/var/lib/postgresql": "rw,nosuid,nodev" },
          },
          NetworkSettings: { Ports: {}, Networks: {} },
          State: { Running: false, ExitCode: 0 },
          Mounts: [],
          tmpFiles: new Map(),
          scratchDb: { rows: {} },
        });
        return { status: 0, stdout: `${id}\n` };
      }
      // Port-proof container from deployLocalLocked
      const portBindings = {};
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--publish") {
          const spec = argv[i + 1];
          const match = /^(\[::1\]|127\.0\.0\.1):(\d+):(\d+\/tcp)$/.exec(spec);
          if (match) {
            const hostIp = match[1] === "[::1]" ? "::1" : match[1];
            portBindings[match[3]] = portBindings[match[3]] || [];
            portBindings[match[3]].push({ HostIp: hostIp, HostPort: match[2] });
          }
        }
      }
      const imageRef = argv.at(-3);
      const img = images.get(imageRef);
      containers.set(id, {
        Id: id,
        Name: `/${name}`,
        Image: img?.Id || NEXT_IMAGE_ID,
        Config: {
          Image: imageRef,
          Labels: { [labelKey]: labelVal },
          Healthcheck: { Test: ["NONE"] },
          Env: [...(img?.Config?.Env || [])],
          Entrypoint: ["node"],
          Cmd: argv.slice(-2),
        },
        HostConfig: {
          NetworkMode: "bridge",
          ReadonlyRootfs: true,
          Privileged: false,
          AutoRemove: false,
          SecurityOpt: ["no-new-privileges:true"],
          PublishAllPorts: false,
          CapDrop: ["ALL"],
          CapAdd: [],
          Binds: [],
          VolumesFrom: [],
          PortBindings: portBindings,
        },
        NetworkSettings: { Ports: {}, Networks: {} },
        State: { Running: false, ExitCode: 0 },
        Mounts: [],
        tmpFiles: new Map(),
      });
      return { status: 0, stdout: `${id}\n` };
    }

    if (argv[0] === "start") {
      const id = argv[1];
      const c = containers.get(id);
      if (!c) return { status: 1, stdout: "" };
      c.State.Running = true;
      if (c.HostConfig.NetworkMode === "bridge") {
        c.NetworkSettings.Networks = { bridge: {} };
        c.NetworkSettings.Ports = structuredClone(c.HostConfig.PortBindings);
      }
      return { status: 0, stdout: `${id}\n` };
    }

    if (argv[0] === "wait") {
      const id = argv[1];
      const c = containers.get(id);
      if (!c) return { status: 1, stdout: "" };
      return { status: 0, stdout: `${c.State.ExitCode ?? 0}\n` };
    }

    if (argv[0] === "exec") {
      const interactive = argv[1] === "-i";
      const id = argv[interactive ? 2 : 1];
      const rest = argv.slice(interactive ? 3 : 2);
      const c = containers.get(id);
      if (!c?.State.Running) return { status: 1, stdout: "" };

      const cmdText = rest.join(" ");
      const getDb = () =>
        c.scratchDb || volumes.get(`${PROJECT}_postgres-data`)?.db;

      if (rest[0] === "pg_isready") {
        return { status: 0, stdout: "accepting connections\n" };
      }
      if (cmdText.includes("pg_dump -Fc")) {
        const db = getDb();
        const payload = JSON.stringify({
          magic: "PGDMP",
          rows: db.rows,
        });
        return writeStdoutOrFd(options, payload);
      }
      if (rest[0] === "pg_restore" && rest[1] === "--list") {
        const raw = readStdinOrFd(options).toString("utf8");
        const parsed = JSON.parse(raw);
        if (parsed.magic !== "PGDMP") return { status: 1, stdout: "" };
        return {
          status: 0,
          stdout:
            "1; 2615 2200 SCHEMA - public sit\n2; 1259 16385 TABLE public tickets sit\n",
        };
      }
      if (
        cmdText.includes("pg_restore") &&
        cmdText.includes("--exit-on-error")
      ) {
        const raw = readStdinOrFd(options).toString("utf8");
        const parsed = JSON.parse(raw);
        if (parsed.magic !== "PGDMP") return { status: 1, stdout: "" };
        const db = getDb();
        db.rows = { ...parsed.rows };
        if (world.driftLiveDbDuringProof && c.scratchDb) {
          volumes.get(`${PROJECT}_postgres-data`).db.rows["public.tickets"] +=
            1;
        }
        return { status: 0, stdout: "" };
      }
      if (cmdText.includes("pg_stat_activity")) {
        const db = getDb();
        return { status: 0, stdout: `${db.activeWriters || 0}\n` };
      }
      if (
        cmdText.includes("SELECT count(*) FROM information_schema.tables") &&
        cmdText.includes("-gt 0")
      ) {
        const db = getDb();
        return {
          status: Object.keys(db?.rows || {}).length > 0 ? 0 : 1,
          stdout: "",
        };
      }
      if (cmdText.includes("psql")) {
        const db = getDb();
        return writeStdoutOrFd(options, formatDbCounts(db.rows));
      }
      if (rest[0] === "tar" && rest.includes("-cf")) {
        const attVol = volumes.get(`${PROJECT}_attachments`);
        const entries = [{ name: "./", type: "d" }];
        const dirs = new Set();
        for (const relPath of attVol.files.keys()) {
          const parts = relPath.split("/");
          for (let i = 1; i < parts.length; i++) {
            dirs.add(parts.slice(0, i).join("/"));
          }
        }
        for (const d of [...dirs].sort()) {
          entries.push({ name: `./${d}/`, type: "d" });
        }
        for (const [relPath, content] of [...attVol.files.entries()].sort(
          (a, b) => a[0].localeCompare(b[0]),
        )) {
          entries.push({ name: `./${relPath}`, type: "f", content });
        }
        return writeStdoutOrFd(options, makeUstarArchive(entries));
      }
      if (rest[0] === "tar" && rest.includes("-xf")) {
        const attVol = volumes.get(`${PROJECT}_attachments`);
        attVol.files.clear();
        const entries = parseUstarArchive(readStdinOrFd(options));
        for (const entry of entries) {
          if (entry.type !== "f") continue;
          const rel = entry.name.replace(/^(?:\.\/)+/, "");
          attVol.files.set(rel, entry.content);
        }
        return { status: 0, stdout: "" };
      }
      if (rest[0] === "node" && rest[1] === "-e") {
        const attVol = volumes.get(`${PROJECT}_attachments`);
        return { status: 0, stdout: manifestFromFileMap(attVol.files) };
      }
      if (rest.includes("apps/api/dist/seed-sit-users.js")) {
        const db = volumes.get(`${PROJECT}_postgres-data`).db;
        db.rows["public.users"] = 4;
        db.rows["public.workspaces"] = 1;
        c.tmpFiles.set(
          "/tmp/sit-credentials.json",
          JSON.stringify({
            admin: { email: "admin@sit.local", password: "generated-secret" },
          }),
        );
        return { status: 0, stdout: "seeded\n" };
      }
      if (rest[0] === "cat" && rest[1] === "/tmp/sit-credentials.json") {
        const creds = c.tmpFiles.get("/tmp/sit-credentials.json");
        if (!creds) return { status: 1, stdout: "" };
        return writeStdoutOrFd(options, `${creds}\n`);
      }
      if (rest[0] === "rm" && rest.includes("/tmp/sit-credentials.json")) {
        c.tmpFiles.delete("/tmp/sit-credentials.json");
        return { status: 0, stdout: "" };
      }
      if (
        rest[0] === "test" &&
        rest[1] === "-s" &&
        rest[2] === "/tmp/sit-credentials.json"
      ) {
        return {
          status: c.tmpFiles.has("/tmp/sit-credentials.json") ? 0 : 1,
          stdout: "",
        };
      }
      if (
        rest[0] === "test" &&
        rest[1] === "!" &&
        rest[2] === "-e" &&
        rest[3] === "/tmp/sit-credentials.json"
      ) {
        return {
          status: c.tmpFiles.has("/tmp/sit-credentials.json") ? 1 : 0,
          stdout: "",
        };
      }
    }

    return { status: 1, stdout: "" };
  };

  return world;
}

function hasDestructiveDockerCalls(calls) {
  return calls.some(([bin, op, sub, ...rest]) => {
    if (bin !== "docker") return false;
    if (op === "stop") return true;
    if (op === "volume" && sub === "rm") return true;
    if (op === "rm") {
      // Removing an ephemeral proof container (-f -v) is cleanup, not project removal;
      // verify no project container is removed by checking absence of 2-arg `docker rm <id>`.
      return argvIsProjectRm([op, sub, ...rest]);
    }
    return false;
  });
}

function argvIsProjectRm(args) {
  return args[0] === "rm" && args.length === 2;
}

test("real chain dry-run prints proof and recovery commands with zero mutations or writes", (t) => {
  const w = createSitWorld(t);
  const lines = [];
  executeFresh({
    args: ["--confirm-wipe", PROJECT, "--dry-run"],
    env: w.env,
    run: w.run,
    report: (line) => lines.push(line),
    clock: () => new Date("2026-11-12T08:00:00.000Z"),
  });

  assert.equal(existsSync(`${w.envFile}.lock`), false);
  assert.equal(existsSync(join(w.privateDir, "fresh-backups")), false);
  assert.equal(hasDestructiveDockerCalls(w.calls), false);
  assert.ok(
    !w.calls.some(
      ([bin, op]) =>
        ["gh", "cosign", "tar", "shasum", "curl", "node"].includes(bin) ||
        (bin === "docker" &&
          ["stop", "rm", "create", "start", "wait", "exec"].includes(op)),
    ),
  );
  const output = lines.join("\n");
  assert.ok(!output.includes("execution is disabled"));
  assert.ok(output.includes(`IMAGE ${NEXT_IMAGE} TAG ${NEXT_TAG}`));
  assert.ok(output.includes(`PREVIOUS_IMAGE ${PREV_IMAGE}`));
  assert.ok(output.includes("taskdesk-fresh-restore-proof-<random-marker>"));
  assert.ok(
    output.includes(
      "scripts/deploy.sh local-fresh --resume 2026-11-12T08-00-00-000Z",
    ),
  );
  assert.ok(
    output.includes(
      "scripts/deploy.sh local-fresh --restore-from-backup 2026-11-12T08-00-00-000Z",
    ),
  );
  assert.ok(!output.includes(w.privateDir));
  assert.ok(!output.includes(w.envFile));
  assert.ok(!output.includes("sit_db"));
});

test("real chain fresh install completes backup, isolated proof, writer-first wipe, mailpit, upgrade, seed and smoke", (t) => {
  const w = createSitWorld(t);
  const lines = [];
  const ref = "2026-11-12T08-15-00-000Z";
  executeFresh({
    args: ["--confirm-wipe", PROJECT],
    env: w.env,
    run: w.run,
    report: (line) => lines.push(line),
    clock: () => new Date("2026-11-12T08:15:00.000Z"),
  });

  assert.equal(existsSync(`${w.envFile}.lock`), false);
  const backupDir = join(w.privateDir, "fresh-backups", ref);
  const journal = JSON.parse(
    readFileSync(join(backupDir, "journal.json"), "utf8"),
  );
  assert.equal(journal.previousImage, PREV_IMAGE);
  assert.equal(journal.previousImageId, PREV_IMAGE_ID);
  assert.equal(journal.image, NEXT_IMAGE);
  assert.equal(journal.steps.at(-1).name, "complete");
  assert.equal(journal.steps.at(-1).state, "done");

  const proofRecord = JSON.parse(
    readFileSync(join(backupDir, "restore-proof.json"), "utf8"),
  );
  assert.equal(proofRecord.verified, true);
  assert.equal(proofRecord.attachmentManifest, w.initialAttachmentManifest);

  const runningServices = [...w.containers.values()]
    .filter((c) => c.State.Running)
    .map((c) => c.Config.Labels["com.docker.compose.service"])
    .sort();
  assert.deepEqual(runningServices, [
    "mailpit",
    "postgres",
    "taskdesk",
    "traefik",
    "valkey",
  ]);
  const app = [...w.containers.values()].find(
    (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
  );
  assert.equal(app.Config.Image, NEXT_IMAGE);
  assert.equal(app.Image, NEXT_IMAGE_ID);
  assert.equal(app.tmpFiles.size, 0);

  const credsStat = lstatSync(join(backupDir, "sit-credentials.json"));
  assert.equal(credsStat.mode & 0o777, 0o600);
  assert.ok(
    lines.some((l) => l.includes(`Private recovery reference: ${ref}`)),
  );
  assert.ok(!lines.some((l) => l.includes(w.privateDir)));
  assert.ok(!lines.some((l) => l.includes(w.envFile)));
});

for (const preFailure of [
  "attestation",
  "cosign",
  "pg-dump",
  "checksum",
  "proof-hash",
  "proof-restore",
  "proof-counts",
  "active-writers",
  "live-db-drift",
  "inventory-changed",
]) {
  test(`real chain ${preFailure} failure removes nothing and releases lock`, (t) => {
    const w = createSitWorld(t);
    const initialIds = [...w.containers.keys()].sort();
    const initialVols = [...w.volumes.keys()].sort();

    if (preFailure === "active-writers") {
      w.volumes.get(`${PROJECT}_postgres-data`).db.activeWriters = 2;
    } else if (preFailure === "live-db-drift") {
      w.driftLiveDbDuringProof = true;
    } else {
      let inspectCount = 0;
      w.fault = (bin, argv) => {
        if (preFailure === "attestation" && bin === "gh")
          return { status: 1, stdout: "" };
        if (preFailure === "cosign" && bin === "cosign")
          return { status: 1, stdout: "" };
        if (
          preFailure === "pg-dump" &&
          bin === "docker" &&
          argv.join(" ").includes("pg_dump")
        )
          return { status: 1, stdout: "" };
        if (
          preFailure === "checksum" &&
          bin === "shasum" &&
          argv.includes("-c")
        )
          return { status: 1, stdout: "" };
        if (preFailure === "proof-hash" && bin === "node" && argv[0] === "-e")
          return { status: 0, stdout: '[["f","tampered.txt","00"]]' };
        if (
          preFailure === "proof-restore" &&
          bin === "docker" &&
          argv.includes("--exit-on-error")
        )
          return { status: 1, stdout: "" };
        if (
          preFailure === "proof-counts" &&
          bin === "docker" &&
          argv.includes("-d") &&
          argv.includes("postgres") &&
          argv.includes("psql")
        )
          return { status: 0, stdout: "table_count:0\n" };
        if (
          preFailure === "inventory-changed" &&
          bin === "docker" &&
          argv[0] === "ps" &&
          argv.includes(`label=com.docker.compose.project=${PROJECT}`)
        ) {
          inspectCount++;
          if (inspectCount === 2) {
            const rogue = "f".repeat(64);
            w.containers.set(rogue, {
              Id: rogue,
              Image: PREV_IMAGE_ID,
              Config: {
                Labels: {
                  "com.docker.compose.project": PROJECT,
                  "com.docker.compose.service": "valkey",
                },
              },
              HostConfig: {},
              State: { Running: true },
              Mounts: [],
            });
          }
        }
        return null;
      };
    }

    assert.throws(() =>
      executeFresh({
        args: ["--confirm-wipe", PROJECT],
        env: w.env,
        run: w.run,
        report: () => {},
        clock: () => new Date("2026-11-12T08:30:00.000Z"),
      }),
    );

    assert.equal(hasDestructiveDockerCalls(w.calls), false);
    assert.equal(existsSync(`${w.envFile}.lock`), false);
    if (preFailure !== "inventory-changed") {
      assert.deepEqual([...w.containers.keys()].sort(), initialIds);
    }
    assert.deepEqual([...w.volumes.keys()].sort(), initialVols);
    if (preFailure === "pg-dump") {
      const dumpFile = join(
        w.privateDir,
        "fresh-backups",
        "2026-11-12T08-30-00-000Z",
        "postgres.dump",
      );
      assert.equal(existsSync(dumpFile), false);
    }
  });
}

const POST_PROOF_STEPS = [
  "stop-first-container",
  "remove-second-container",
  "remove-second-volume",
  "create-second-volume",
  "start-dependencies",
  "start-migration",
  "wait-migration",
  "remove-migration",
  "upgrade-before-app",
  "upgrade-after-app",
  "seed",
  "copy-credentials",
  "remove-temporary-credentials",
  "readiness-ticketing",
  "readiness-portal",
  "release-smoke",
];

function installStepFault(w, stepKind) {
  let rmContainerCount = 0;
  let rmVolumeCount = 0;
  let createVolumeCount = 0;
  let migrateRunCount = 0;
  let migrateRmCount = 0;

  if (stepKind === "wait-migration") {
    w.failNextMigration = true;
    return;
  }

  w.fault = (bin, argv) => {
    if (
      stepKind === "stop-first-container" &&
      bin === "docker" &&
      argv[0] === "stop"
    ) {
      return { status: 1, stdout: "" };
    }
    if (
      stepKind === "remove-second-container" &&
      bin === "docker" &&
      argvIsProjectRm(argv)
    ) {
      rmContainerCount++;
      if (rmContainerCount === 2) return { status: 1, stdout: "" };
    }
    if (
      stepKind === "remove-second-volume" &&
      bin === "docker" &&
      argv[0] === "volume" &&
      argv[1] === "rm"
    ) {
      rmVolumeCount++;
      if (rmVolumeCount === 2) return { status: 1, stdout: "" };
    }
    if (
      stepKind === "create-second-volume" &&
      bin === "docker" &&
      argv[0] === "volume" &&
      argv[1] === "create"
    ) {
      createVolumeCount++;
      if (createVolumeCount === 2) return { status: 1, stdout: "" };
    }
    if (
      stepKind === "start-dependencies" &&
      bin === "docker" &&
      argv[0] === "compose" &&
      argv.includes("up") &&
      argv.includes("mailpit")
    ) {
      return { status: 1, stdout: "" };
    }
    if (
      stepKind === "start-migration" &&
      bin === "docker" &&
      argv[0] === "compose" &&
      argv.includes("run") &&
      argv.includes("migrate")
    ) {
      migrateRunCount++;
      if (migrateRunCount === 1) return { status: 1, stdout: "" };
    }
    if (
      stepKind === "remove-migration" &&
      bin === "docker" &&
      argvIsProjectRm(argv)
    ) {
      // First 5 project `docker rm` calls remove the 5 old containers; 6th removes fresh migration.
      migrateRmCount++;
      if (migrateRmCount === 6) return { status: 1, stdout: "" };
    }
    if (
      stepKind === "upgrade-before-app" &&
      bin === "docker" &&
      argv[0] === "compose" &&
      argv.includes("pull")
    ) {
      return { status: 1, stdout: "" };
    }
    if (
      stepKind === "upgrade-after-app" &&
      bin === "docker" &&
      argv[0] === "compose" &&
      argv.includes("up") &&
      argv.includes("traefik")
    ) {
      return { status: 1, stdout: "" };
    }
    if (
      stepKind === "seed" &&
      bin === "docker" &&
      argv.includes("apps/api/dist/seed-sit-users.js")
    ) {
      return { status: 1, stdout: "" };
    }
    if (
      stepKind === "copy-credentials" &&
      bin === "docker" &&
      argv.includes("cat") &&
      argv.includes("/tmp/sit-credentials.json")
    ) {
      return { status: 1, stdout: "" };
    }
    if (
      stepKind === "remove-temporary-credentials" &&
      bin === "docker" &&
      argv.includes("rm") &&
      argv.includes("/tmp/sit-credentials.json")
    ) {
      return { status: 1, stdout: "" };
    }
    if (
      stepKind === "readiness-ticketing" &&
      bin === "curl" &&
      argv.some((a) => a.includes("ticketing.localhost"))
    ) {
      return { status: 22, stdout: "" };
    }
    if (
      stepKind === "readiness-portal" &&
      bin === "curl" &&
      argv.some((a) => a.includes("portal.localhost"))
    ) {
      return { status: 22, stdout: "" };
    }
    if (
      stepKind === "release-smoke" &&
      bin === "node" &&
      argv[0] === "scripts/sit/release-smoke.mjs"
    ) {
      return { status: 1, stdout: "" };
    }
    return null;
  };
}

for (const stepKind of POST_PROOF_STEPS) {
  test(`real chain failure at ${stepKind} keeps lock, writes journal, prints recovery, and --resume completes`, (t) => {
    const w = createSitWorld(t);
    const ref = "2026-11-12T09-00-00-000Z";
    installStepFault(w, stepKind);

    const failLines = [];
    assert.throws(() =>
      executeFresh({
        args: ["--confirm-wipe", PROJECT],
        env: w.env,
        run: w.run,
        report: (line) => failLines.push(line),
        clock: () => new Date("2026-11-12T09:00:00.000Z"),
        signal: w.signal,
      }),
    );

    // Lock retained and journal persisted with failed step
    assert.equal(existsSync(`${w.envFile}.lock`), true);
    const backupDir = join(w.privateDir, "fresh-backups", ref);
    const journalPath = join(backupDir, "journal.json");
    const failedJournal = JSON.parse(readFileSync(journalPath, "utf8"));
    assert.equal(failedJournal.steps.at(-1).state, "failed");
    assert.ok(!failedJournal.steps.some((s) => s.name === "complete"));

    if (stepKind === "copy-credentials") {
      assert.equal(existsSync(join(backupDir, "sit-credentials.json")), false);
    }

    // Output reports removed, remaining, backup reference and exact recovery commands
    assert.ok(
      failLines.some(
        (l) =>
          l.includes(`Recovery reference: ${ref}`) &&
          l.includes("removed:") &&
          l.includes("uncertain:") &&
          l.includes("remaining:"),
      ),
    );
    assert.ok(
      failLines.some(
        (l) =>
          l.includes(`scripts/deploy.sh local-fresh --resume ${ref}`) &&
          l.includes(
            `scripts/deploy.sh local-fresh --restore-from-backup ${ref}`,
          ),
      ),
    );
    assert.ok(!failLines.some((l) => l.includes(w.privateDir)));

    // Clear fault, mark crashed PID stale, and resume!
    w.fault = null;
    w.markCurrentLockOwnerStale();

    const resumeLines = [];
    executeFresh({
      args: stepKind === "seed" ? ["--resume"] : ["--resume", ref],
      env: w.env,
      run: w.run,
      report: (line) => resumeLines.push(line),
      signal: w.signal,
    });

    assert.equal(existsSync(`${w.envFile}.lock`), false);
    const completedJournal = JSON.parse(readFileSync(journalPath, "utf8"));
    assert.equal(completedJournal.steps.at(-1).name, "complete");
    assert.equal(completedJournal.steps.at(-1).state, "done");

    const app = [...w.containers.values()].find(
      (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
    );
    assert.equal(app.Config.Image, NEXT_IMAGE);
    assert.equal(app.Image, NEXT_IMAGE_ID);
    assert.ok(statSync(join(backupDir, "sit-credentials.json")).size > 0);
    assert.ok(
      resumeLines.some((l) =>
        l.includes(
          `Fresh install smoke passed. Private recovery reference: ${ref}`,
        ),
      ),
    );
  });

  test(`real chain failure at ${stepKind} recovers previous stack via --restore-from-backup`, (t) => {
    const w = createSitWorld(t);
    const ref = "2026-11-12T10-00-00-000Z";
    installStepFault(w, stepKind);

    assert.throws(() =>
      executeFresh({
        args: ["--confirm-wipe", PROJECT],
        env: w.env,
        run: w.run,
        report: () => {},
        clock: () => new Date("2026-11-12T10:00:00.000Z"),
        signal: w.signal,
      }),
    );

    assert.equal(existsSync(`${w.envFile}.lock`), true);
    w.fault = null;
    w.markCurrentLockOwnerStale();

    const restoreLines = [];
    executeFresh({
      args:
        stepKind === "seed"
          ? ["--restore-from-backup"]
          : ["--restore-from-backup", ref],
      env: w.env,
      run: w.run,
      report: (line) => restoreLines.push(line),
      clock: () => new Date("2026-11-12T10:05:00.000Z"),
      signal: w.signal,
    });

    // Lock released and active journal cleared (archived to journal.restored.json)
    assert.equal(existsSync(`${w.envFile}.lock`), false);
    const backupDir = join(w.privateDir, "fresh-backups", ref);
    assert.equal(existsSync(join(backupDir, "journal.json")), false);
    assert.equal(existsSync(join(backupDir, "journal.restored.json")), true);

    // Previous stack is running on previousImage (NOT NEXT_IMAGE!) with original DB counts & attachments
    const runningServices = [...w.containers.values()]
      .filter((c) => c.State.Running)
      .map((c) => c.Config.Labels["com.docker.compose.service"])
      .sort();
    assert.deepEqual(runningServices, [
      "mailpit",
      "postgres",
      "taskdesk",
      "traefik",
      "valkey",
    ]);
    const restoredApp = [...w.containers.values()].find(
      (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
    );
    assert.equal(restoredApp.Config.Image, PREV_IMAGE);
    assert.equal(restoredApp.Image, PREV_IMAGE_ID);

    const restoredDb = w.volumes.get(`${PROJECT}_postgres-data`).db;
    assert.equal(formatDbCounts(restoredDb.rows), w.initialCountsText);

    const restoredAttachments = w.volumes.get(`${PROJECT}_attachments`).files;
    assert.equal(
      manifestFromFileMap(restoredAttachments),
      w.initialAttachmentManifest,
    );
    assert.ok(
      restoreLines.some((l) =>
        l.includes(`Restored previous stack from backup reference: ${ref}`),
      ),
    );
    assert.ok(!restoreLines.some((l) => l.includes(w.privateDir)));
  });
}

test("--resume refuses when Docker state disagrees with completed or unstarted journal steps", (t) => {
  // Case 1: Completed volume creation missing in Docker
  {
    const w = createSitWorld(t);
    const ref = "2026-11-12T11-00-00-000Z";
    installStepFault(w, "start-dependencies");
    assert.throws(() =>
      executeFresh({
        args: ["--confirm-wipe", PROJECT],
        env: w.env,
        run: w.run,
        report: () => {},
        clock: () => new Date("2026-11-12T11:00:00.000Z"),
        signal: w.signal,
      }),
    );
    w.fault = null;
    w.markCurrentLockOwnerStale();
    // Manually delete a volume that journal recorded as created
    w.volumes.delete(`${PROJECT}_postgres-data`);
    assert.throws(
      () =>
        executeFresh({
          args: ["--resume", ref],
          env: w.env,
          run: w.run,
          report: () => {},
          signal: w.signal,
        }),
      /Docker state disagrees with create-volume:postgres-data/,
    );
    assert.equal(existsSync(`${w.envFile}.lock`), true);
  }

  // Case 2: Unstarted container removal already gone from Docker
  {
    const w = createSitWorld(t);
    const ref = "2026-11-12T11-10-00-000Z";
    installStepFault(w, "stop-first-container");
    assert.throws(() =>
      executeFresh({
        args: ["--confirm-wipe", PROJECT],
        env: w.env,
        run: w.run,
        report: () => {},
        clock: () => new Date("2026-11-12T11:10:00.000Z"),
        signal: w.signal,
      }),
    );
    w.fault = null;
    w.markCurrentLockOwnerStale();
    const lastId = [...w.containers.keys()].at(-1);
    w.containers.delete(lastId);
    assert.throws(
      () =>
        executeFresh({
          args: ["--resume", ref],
          env: w.env,
          run: w.run,
          report: () => {},
          signal: w.signal,
        }),
      /Docker state disagrees with unstarted removal of container/,
    );
    assert.equal(existsSync(`${w.envFile}.lock`), true);
  }

  // Case 3: Unexpected container present before dependency start
  {
    const w = createSitWorld(t);
    const ref = "2026-11-12T11-20-00-000Z";
    installStepFault(w, "remove-second-container");
    assert.throws(() =>
      executeFresh({
        args: ["--confirm-wipe", PROJECT],
        env: w.env,
        run: w.run,
        report: () => {},
        clock: () => new Date("2026-11-12T11:20:00.000Z"),
        signal: w.signal,
      }),
    );
    w.fault = null;
    w.markCurrentLockOwnerStale();
    const extraId = "e".repeat(64);
    w.containers.set(extraId, {
      Id: extraId,
      Image: PREV_IMAGE_ID,
      Config: {
        Labels: {
          "com.docker.compose.project": PROJECT,
          "com.docker.compose.service": "valkey",
        },
      },
      HostConfig: {},
      State: { Running: true },
      Mounts: [],
    });
    assert.throws(
      () =>
        executeFresh({
          args: ["--resume", ref],
          env: w.env,
          run: w.run,
          report: () => {},
          signal: w.signal,
        }),
      /unexpected container present/,
    );
    assert.equal(existsSync(`${w.envFile}.lock`), true);
  }
});

test("interrupted --restore-from-backup blocks --resume, allows retry of --restore-from-backup, and refuses live owners or completed stacks", (t) => {
  const w = createSitWorld(t);
  const ref = "2026-11-12T12-00-00-000Z";
  installStepFault(w, "start-dependencies");
  assert.throws(() =>
    executeFresh({
      args: ["--confirm-wipe", PROJECT],
      env: w.env,
      run: w.run,
      report: () => {},
      clock: () => new Date("2026-11-12T12:00:00.000Z"),
      signal: w.signal,
    }),
  );

  // While lock owner is STILL ALIVE, both --resume and --restore-from-backup refuse!
  w.fault = null;
  assert.throws(
    () =>
      executeFresh({
        args: ["--resume", ref],
        env: w.env,
        run: w.run,
        report: () => {},
        signal: w.signal,
      }),
    /lock owner is still running/,
  );
  assert.throws(
    () =>
      executeFresh({
        args: ["--restore-from-backup", ref],
        env: w.env,
        run: w.run,
        report: () => {},
        signal: w.signal,
      }),
    /lock owner is still running/,
  );

  // Simulate mid-restore failure (curl readiness fails during restore)
  w.markCurrentLockOwnerStale();
  w.fault = (bin) => (bin === "curl" ? { status: 22, stdout: "" } : null);
  assert.throws(() =>
    executeFresh({
      args: ["--restore-from-backup", ref],
      env: w.env,
      run: w.run,
      report: () => {},
      signal: w.signal,
    }),
  );
  assert.equal(existsSync(`${w.envFile}.lock`), true);

  // --resume must now refuse because restoreStarted is recorded in journal.json!
  w.fault = null;
  w.markCurrentLockOwnerStale();
  assert.throws(
    () =>
      executeFresh({
        args: ["--resume", ref],
        env: w.env,
        run: w.run,
        report: () => {},
        signal: w.signal,
      }),
    /Backup restoration is already in progress/,
  );

  // Retrying --restore-from-backup succeeds and clears the journal!
  executeFresh({
    args: ["--restore-from-backup", ref],
    env: w.env,
    run: w.run,
    report: () => {},
    signal: w.signal,
  });
  assert.equal(existsSync(`${w.envFile}.lock`), false);

  // Once restored (no unfinished journal), --restore-from-backup refuses to touch the live stack
  assert.throws(
    () =>
      executeFresh({
        args: ["--restore-from-backup", ref],
        env: w.env,
        run: w.run,
        report: () => {},
        signal: w.signal,
      }),
    /has no unfinished journal|No unfinished recovery journal/,
  );
  unlinkSync(join(w.privateDir, "fresh-backups", ref, "journal.restored.json"));
});
