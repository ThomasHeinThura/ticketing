// Offline coordinator only. No CLI or default Docker/restore adapter is provided.
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { acquireDockerDaemonLease } from "./local-candidate-daemon-lease.mjs";

export const localProject = "taskdesk-codex-testing";
export const coordinatorDirectory = join(
  userInfo().homedir,
  ".taskdesk",
  "local-selection",
  localProject,
);
export const baselineVolumes = Object.freeze({
  database: `${localProject}_postgres-data`,
  files: `${localProject}_attachments`,
});
const reject = (message) => {
  throw new Error(message);
};
const same = isDeepStrictEqual;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hex = /^[a-f0-9]{64}$/;
const releaseImage =
  /^ghcr\.io\/thomasheinthura\/taskdesk@sha256:[a-f0-9]{64}$/;
function syncDirectory(directory) {
  const fd = openSync(directory, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function privateDirectory(directory) {
  // Check every existing ancestor; mkdir({recursive:true}) must not follow a link.
  for (let current = resolve(directory); ; current = dirname(current)) {
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        reject("Coordinator path is not a real directory.");
    }
    if (current === dirname(current)) break;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (stat.uid !== process.getuid() || stat.mode & 0o077)
    reject("Coordinator directory must be private and owned by this user.");
}
function durableWrite(file, value) {
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, value);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(dirname(file));
}

// The default path is independent of checkout, Compose env file, and caller HOME.
// directory is an in-process test seam, never an environment/CLI input.
export function acquireProjectSelectionLease({
  directory = coordinatorDirectory,
  token = randomBytes(32).toString("hex"),
} = {}) {
  privateDirectory(directory);
  const lock = join(directory, "active");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    reject(
      "Local project lock exists or cannot be acquired; inspect it before retrying.",
    );
  }
  syncDirectory(directory);
  const owner = `${process.pid} ${token}\n`;
  // Failure leaves the directory locked, including interruption before owner write.
  durableWrite(join(lock, "owner"), owner);
  return {
    directory,
    lock,
    release() {
      if (readFileSync(join(lock, "owner"), "utf8") !== owner)
        reject("Local project lock ownership changed.");
      unlinkSync(join(lock, "owner"));
      rmdirSync(lock);
      syncDirectory(directory);
    },
  };
}
export function assertProjectSelectionHandoff(
  pid,
  token,
  directory = coordinatorDirectory,
) {
  if (
    pid !== process.ppid ||
    !hex.test(token || "") ||
    readFileSync(join(directory, "active", "owner"), "utf8") !==
      `${pid} ${token}\n`
  )
    reject("Local project lock handoff is invalid.");
}

export function candidateVolumes(slot) {
  if (!/^[a-f0-9]{32}$/.test(slot || ""))
    reject("Candidate slot must be a new 32-character hexadecimal identifier.");
  return {
    database: `${localProject}_candidate-${slot}_postgres-data`,
    files: `${localProject}_candidate-${slot}_attachments`,
  };
}
function localSocket(value) {
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
const portList = (ports = []) =>
  ports
    .map(
      (p) => `${p.host_ip}|${p.published}|${p.target}|${p.protocol || "tcp"}`,
    )
    .sort();
const enginePorts = (ports = {}) =>
  Object.entries(ports)
    .flatMap(([target, bindings]) =>
      (bindings || []).map(
        (binding) =>
          `${binding.HostIp}|${binding.HostPort}|${target.replace("/", "|")}`,
      ),
    )
    .sort();
const expectedPorts = {
  postgres: ["127.0.0.1|62873|5432|tcp"],
  traefik: [
    "127.0.0.1|80|80|tcp",
    "::1|80|80|tcp",
    "127.0.0.1|443|443|tcp",
    "::1|443|443|tcp",
  ].sort(),
  mailpit: ["127.0.0.1|18025|8025|tcp", "127.0.0.1|11025|1025|tcp"].sort(),
};

// A closed representation of compose.testing.yml. Private environment values
// are validated separately and frozen across the entire selection; service
// structure is never copied from the observed runtime into this contract.
export function canonicalSelectionConfig({
  image,
  privateDir,
  volumes = baselineVolumes,
  environment = {},
}) {
  const networks = { default: null };
  const common = { restart: "unless-stopped", networks };
  const hardened = {
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
  };
  const tmpfs = [
    "/tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=1770",
  ];
  const ports = (name) =>
    (expectedPorts[name] || []).map((entry) => {
      const [host_ip, published, target, protocol] = entry.split("|");
      return { host_ip, published, target: Number(target), protocol };
    });
  const services = {
    postgres: {
      ...common,
      image: "postgres:18-alpine",
      volumes: [
        {
          type: "volume",
          source: "postgres-data",
          target: "/var/lib/postgresql",
        },
      ],
      ports: ports("postgres"),
      healthcheck: {
        test: ["CMD-SHELL", 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
        interval: "5s",
        timeout: "3s",
        retries: 20,
      },
    },
    migrate: {
      networks,
      image,
      restart: "no",
      ...hardened,
      tmpfs,
      depends_on: { postgres: { condition: "service_healthy" } },
    },
    taskdesk: {
      ...common,
      image,
      ...hardened,
      tmpfs,
      volumes: [
        {
          type: "volume",
          source: "attachments",
          target: "/app/data/attachments",
        },
      ],
      depends_on: {
        migrate: { condition: "service_completed_successfully" },
        valkey: { condition: "service_healthy" },
      },
      healthcheck: {
        test: ["CMD", "node", "/app/healthcheck.mjs"],
        interval: "10s",
        timeout: "3s",
        start_period: "30s",
        retries: 12,
      },
    },
    traefik: {
      ...common,
      image: "traefik:v3.6.7",
      ...hardened,
      command: [
        "--providers.file.filename=/config/dynamic.yml",
        "--entrypoints.web.address=:80",
        "--entrypoints.web.http.redirections.entrypoint.to=websecure",
        "--entrypoints.web.http.redirections.entrypoint.scheme=https",
        "--entrypoints.websecure.address=:443",
        "--entrypoints.websecure.transport.respondingtimeouts.idletimeout=180s",
        "--accesslog=false",
        "--log.level=ERROR",
      ],
      volumes: [
        {
          type: "bind",
          source: join(privateDir, "proxy"),
          target: "/config",
          read_only: true,
        },
      ],
      ports: ports("traefik"),
      depends_on: { taskdesk: { condition: "service_healthy" } },
    },
    mailpit: {
      ...common,
      image: "axllent/mailpit:v1.28",
      volumes: [{ type: "volume", source: "mailpit-data", target: "/data" }],
      ports: ports("mailpit"),
    },
    valkey: {
      ...common,
      image: "valkey/valkey:9-alpine",
      command: [
        "sh",
        "-c",
        'exec valkey-server --save "" --appendonly no --protected-mode yes --maxmemory 64mb --requirepass "$REDISCLI_AUTH"',
      ],
      healthcheck: {
        test: ["CMD", "valkey-cli", "ping"],
        interval: "5s",
        timeout: "3s",
        retries: 12,
      },
    },
  };
  for (const [name, service] of Object.entries(services))
    service.environment = structuredClone(environment[name] || {});
  services.mailpit.environment = { MP_DATABASE: "/data/mailpit.db" };
  return {
    name: localProject,
    services,
    networks: { default: { name: `${localProject}_default` } },
    volumes: {
      "postgres-data": { name: volumes.database },
      attachments: { name: volumes.files },
      "mailpit-data": { name: `${localProject}_mailpit-data` },
    },
  };
}

function normalizedSelectionConfig(config, privateDir) {
  const result = structuredClone(config);
  if (same(result.networks?.default?.ipam, {}))
    delete result.networks.default.ipam;
  for (const [name, service] of Object.entries(result.services || {})) {
    if (service.command === null) delete service.command;
    if (service.entrypoint === null) delete service.entrypoint;
    service.environment ??= {};
    // These are presentation defaults emitted by Compose, not override fields.
    for (const binding of service.ports || [])
      if (binding.mode === "ingress") delete binding.mode;
    if (service.ports)
      service.ports.sort((a, b) =>
        portList([a])[0].localeCompare(portList([b])[0]),
      );
    for (const mount of service.volumes || []) {
      if (mount.read_only === false) delete mount.read_only;
      if (same(mount.volume, { nocopy: false })) delete mount.volume;
      if (same(mount.volume, {})) delete mount.volume;
      if (same(mount.bind, { create_host_path: true })) delete mount.bind;
      if (same(mount.bind, {})) delete mount.bind;
    }
    for (const dependency of Object.values(service.depends_on || {}))
      if (dependency.required === true) delete dependency.required;
    if (same(service.networks?.default, {})) service.networks.default = null;
    if (
      name === "postgres" &&
      typeof service.healthcheck?.test?.[1] === "string"
    )
      service.healthcheck.test[1] = service.healthcheck.test[1]
        .replaceAll("$$POSTGRES_USER", "$POSTGRES_USER")
        .replaceAll("$$POSTGRES_DB", "$POSTGRES_DB");
    if (name === "valkey" && typeof service.command?.[2] === "string")
      service.command[2] = service.command[2].replaceAll(
        "$$REDISCLI_AUTH",
        "$REDISCLI_AUTH",
      );
    if (service.env_file) {
      const file = {
        postgres: "postgres.env",
        migrate: "migrate.env",
        taskdesk: "app.env",
        valkey: "valkey.env",
      }[name];
      if (
        !file ||
        !same(service.env_file, [
          { path: join(privateDir, file), required: true },
        ])
      )
        reject("Unexpected private service environment file.");
      delete service.env_file;
    }
  }
  return result;
}

function effectiveEnvironment(image, service) {
  const values = {};
  if (!Array.isArray(image.Config?.Env))
    reject("Image environment inspection is required.");
  for (const entry of image.Config.Env) {
    const split = entry.indexOf("=");
    const key = entry.slice(0, split);
    if (split < 1 || Object.hasOwn(values, key))
      reject("Duplicate or malformed image environment.");
    values[key] = entry.slice(split + 1);
  }
  return { ...values, ...service.environment };
}

function normalizedHealthcheck(healthcheck) {
  if (healthcheck == null || same(healthcheck, {})) return null;
  const defaults = {
    Test: null,
    Interval: 0,
    Timeout: 0,
    StartPeriod: 0,
    StartInterval: 0,
    Retries: 0,
  };
  if (Object.keys(healthcheck).some((key) => !Object.hasOwn(defaults, key)))
    reject("Unknown engine healthcheck configuration.");
  const normalized = { ...defaults, ...healthcheck };
  if (
    !Array.isArray(normalized.Test) ||
    normalized.Test.some((value) => typeof value !== "string") ||
    Object.entries(normalized).some(
      ([key, value]) =>
        key !== "Test" && (!Number.isSafeInteger(value) || value < 0),
    )
  )
    reject("Invalid engine healthcheck configuration.");
  return normalized;
}

function assertEffectiveHealthcheck(container, service, image) {
  const expected = { ...(image.Config.Healthcheck || {}) };
  const duration = (value) => {
    const match = /^(\d+)(ns|us|ms|s|m|h)$/.exec(value);
    if (!match) reject("Unsupported canonical healthcheck duration.");
    return (
      Number(match[1]) *
      {
        ns: 1,
        us: 1000,
        ms: 1000000,
        s: 1000000000,
        m: 60000000000,
        h: 3600000000000,
      }[match[2]]
    );
  };
  for (const [key, value] of Object.entries(service.healthcheck || {})) {
    const field = {
      test: "Test",
      interval: "Interval",
      timeout: "Timeout",
      start_period: "StartPeriod",
      start_interval: "StartInterval",
      retries: "Retries",
    }[key];
    if (!field) reject("Unsupported canonical healthcheck field.");
    expected[field] = ["test", "retries"].includes(key)
      ? value
      : duration(value);
  }
  if (
    !same(
      normalizedHealthcheck(container.Config.Healthcheck),
      normalizedHealthcheck(expected),
    )
  )
    reject(
      "Engine healthcheck differs from the inspected image and canonical Compose.",
    );
}

function assertEffectiveContainer(container, service, image, postgresPaths) {
  assertEffectiveHealthcheck(container, service, image);
  const expected = effectiveEnvironment(image, service);
  if (container.Config.Labels["com.docker.compose.service"] === "postgres") {
    if (
      expected.POSTGRES_INITDB_ARGS !== undefined &&
      String(expected.POSTGRES_INITDB_ARGS).trim() !== ""
    )
      reject(
        "Custom PostgreSQL initdb arguments are not permitted for an isolated candidate copy.",
      );
    const contained = (value) =>
      typeof value === "string" &&
      value.startsWith("/var/lib/postgresql/") &&
      !value
        .split("/")
        .some((part, index) => index > 0 && ["", ".", ".."].includes(part));
    if (
      !contained(expected.PGDATA) ||
      (expected.POSTGRES_INITDB_WALDIR !== undefined &&
        !contained(expected.POSTGRES_INITDB_WALDIR))
    )
      reject(
        "Postgres data and WAL directories must remain inside the selected volume without traversal.",
      );
    // Resolve SHOW data_directory and its pg_wal target in the inspected
    // postgres container: strings alone miss symlinks and server config overrides.
    if (
      !contained(postgresPaths?.dataDirectory) ||
      !contained(postgresPaths?.walDirectory)
    )
      reject(
        "Resolved PostgreSQL data and WAL paths must remain on the selected volume.",
      );
  }
  if (
    ["TASKDESK_STORAGE_DRIVER", "TASKDESK_STORAGE_FILESYSTEM_ROOT"].some(
      (key) =>
        expected[key] !== undefined &&
        expected[key] !==
          (key.endsWith("ROOT") ? "/app/data/attachments" : "filesystem"),
    )
  )
    reject("Effective storage must remain inside the attachment volume.");
  if (
    Object.keys(expected).some((key) =>
      [
        "NODE_OPTIONS",
        "NODE_PATH",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "BASH_ENV",
        "ENV",
      ].includes(key),
    )
  )
    reject("Runtime code injection environment is not allowed.");
  const observedEnvironment = container.Config.Env || [];
  if (
    !same(
      [...observedEnvironment].sort(),
      Object.entries(expected)
        .map(([key, value]) => `${key}=${value}`)
        .sort(),
    )
  )
    reject(
      "Engine effective environment differs from the inspected image and Compose.",
    );
  const command = service.command ?? image.Config.Cmd ?? null;
  for (const [field, value] of Object.entries({
    Entrypoint: image.Config.Entrypoint ?? null,
    Cmd: command,
    User: image.Config.User || "",
    WorkingDir: image.Config.WorkingDir || "",
  }))
    if (!same(container.Config[field], value))
      reject("Engine command, user or working directory was overridden.");
  const host = container.HostConfig;
  const expectedSecurity = {
    ReadonlyRootfs: service.read_only || false,
    CapAdd: [],
    CapDrop: service.cap_drop || [],
    SecurityOpt: service.security_opt || [],
    ExtraHosts: [],
    Dns: [],
    DnsSearch: [],
    DnsOptions: [],
    Links: [],
    VolumesFrom: [],
    Devices: [],
    DeviceRequests: [],
    DeviceCgroupRules: [],
    GroupAdd: [],
    PidMode: "",
    UsernsMode: "",
    UTSMode: "",
    CgroupParent: "",
    CgroupnsMode: "private",
    IpcMode: "private",
    Sysctls: {},
    Tmpfs: Object.fromEntries(
      (service.tmpfs || []).map((entry) => {
        const split = entry.indexOf(":");
        return [entry.slice(0, split), entry.slice(split + 1)];
      }),
    ),
    AutoRemove: false,
    Runtime: "runc",
  };
  for (const [key, value] of Object.entries(expectedSecurity))
    if (
      !same(
        host[key] ??
          (Array.isArray(value)
            ? []
            : typeof value === "object"
              ? {}
              : undefined),
        value,
      )
    )
      reject(
        "Engine security or routing configuration differs from canonical Compose.",
      );
  const allowedBinds = container.Mounts.map(
    (m) =>
      `${m.Type === "volume" ? m.Name : m.Source}:${m.Destination}:${m.RW === false ? "ro" : "rw"}`,
  ).sort();
  if ((host.Binds || []).length && !same([...host.Binds].sort(), allowedBinds))
    reject("Engine bind declarations differ from inspected mounts.");
  const network = container.NetworkSettings.Networks[`${localProject}_default`];
  const serviceName = container.Config.Labels["com.docker.compose.service"];
  if (container.Name !== `/${localProject}-${serviceName}-1`)
    reject("Engine service name differs from canonical Compose.");
  const aliases = network.Aliases || [];
  if (
    aliases.some(
      (alias) =>
        alias !== serviceName && alias !== container.Name?.replace(/^\//, ""),
    ) ||
    (network.Links || []).length ||
    (network.DriverOpts && Object.keys(network.DriverOpts).length)
  )
    reject("Engine network aliases or routing were overridden.");
}

function assertSelectionDelta(snapshot, original, volumes, image) {
  const expectedConfig = structuredClone(original.config);
  expectedConfig.services.taskdesk.image = image;
  expectedConfig.services.migrate.image = image;
  expectedConfig.volumes["postgres-data"].name = volumes.database;
  expectedConfig.volumes.attachments.name = volumes.files;
  if (
    !same(
      normalizedSelectionConfig(snapshot.config, original.privateDir),
      normalizedSelectionConfig(expectedConfig, original.privateDir),
    )
  )
    reject(
      "Selection changed configuration outside the planned image and storage names.",
    );
  const projection = (value, volumeNames) => {
    const normalizeNames = (item) => {
      if (typeof item === "string")
        return item
          .replaceAll(volumeNames.database, baselineVolumes.database)
          .replaceAll(volumeNames.files, baselineVolumes.files);
      if (Array.isArray(item)) return item.map(normalizeNames);
      if (item && typeof item === "object")
        return Object.fromEntries(
          Object.entries(item).map(([key, entry]) => [
            key,
            normalizeNames(entry),
          ]),
        );
      return item;
    };
    return value.containers
      .map((container) => {
        const config = structuredClone(container.Config);
        for (const key of ["Hostname", "Image", "Labels"]) delete config[key];
        return {
          name: container.Config.Labels["com.docker.compose.service"],
          config,
          host: normalizeNames(container.HostConfig),
          mounts: normalizeNames(container.Mounts).sort((a, b) =>
            a.Destination.localeCompare(b.Destination),
          ),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  if (
    !same(projection(snapshot, volumes), projection(original, baselineVolumes))
  )
    reject(
      "Engine configuration changed outside the planned image and storage names.",
    );
  if (!same(snapshot.supportingImages, original.supportingImages))
    reject("Supporting images changed during candidate selection.");
}

// Inputs are raw engine/config inspection evidence, not a boolean attestation.
export function assertSelectionSnapshot(
  snapshot,
  { volumes = baselineVolumes, image, privateDir },
) {
  if (
    !snapshot ||
    !localSocket(snapshot.dockerEndpoint) ||
    !localSocket(snapshot.contextEndpoint)
  )
    reject("Selection requires a local Docker Unix socket.");
  const config = snapshot.config;
  const names = [
    "postgres",
    "migrate",
    "taskdesk",
    "traefik",
    "mailpit",
    "valkey",
  ].sort();
  if (
    config?.name !== localProject ||
    !same(Object.keys(config.services || {}).sort(), names)
  )
    reject("Unexpected local project or service set.");
  if (!privateDir || resolve(privateDir) !== privateDir)
    reject("Private configuration path must be absolute.");
  const normalized = normalizedSelectionConfig(config, privateDir);
  const canonical = normalizedSelectionConfig(
    canonicalSelectionConfig({
      image,
      privateDir,
      volumes,
      environment: Object.fromEntries(
        Object.entries(config.services).map(([name, service]) => [
          name,
          service.environment || {},
        ]),
      ),
    }),
    privateDir,
  );
  if (!same(normalized, canonical))
    reject(
      "Compose configuration differs from the canonical local selection contract.",
    );
  if (
    !same(Object.keys(config.networks || {}), ["default"]) ||
    config.networks.default.name !== `${localProject}_default` ||
    config.networks.default.external ||
    config.networks.default.driver_opts
  )
    reject("Unexpected Compose network.");
  for (const [name, service] of Object.entries(config.services)) {
    if (
      service.network_mode ||
      service.privileged ||
      service.volumes_from?.length ||
      service.devices?.length ||
      service.build ||
      service.provider
    )
      reject("Service isolation is not confirmed.");
    if (!same(Object.keys(service.networks || {}), ["default"]))
      reject("Service must use only the local project network.");
    if (!same(portList(service.ports), expectedPorts[name] || []))
      reject("Unexpected local host or port binding.");
    const mounts = service.volumes || [];
    const expected =
      name === "postgres"
        ? [
            {
              type: "volume",
              source: "postgres-data",
              target: "/var/lib/postgresql",
            },
          ]
        : name === "taskdesk"
          ? [
              {
                type: "volume",
                source: "attachments",
                target: "/app/data/attachments",
              },
            ]
          : name === "mailpit"
            ? [{ type: "volume", source: "mailpit-data", target: "/data" }]
            : name === "traefik"
              ? [
                  {
                    type: "bind",
                    source: join(privateDir, "proxy"),
                    target: "/config",
                    read_only: true,
                  },
                ]
              : [];
    if (
      mounts.length !== expected.length ||
      expected.some(
        (e) =>
          !mounts.some((m) => Object.entries(e).every(([k, v]) => m[k] === v)),
      )
    )
      reject("Unexpected service mount.");
  }
  for (const [key, name] of [
    ["postgres-data", volumes.database],
    ["attachments", volumes.files],
    ["mailpit-data", `${localProject}_mailpit-data`],
  ]) {
    const volume = config.volumes?.[key];
    if (
      volume?.name !== name ||
      volume.external ||
      volume.driver_opts ||
      (volume.driver && volume.driver !== "local")
    )
      reject("Unexpected local storage binding.");
    const observed = snapshot.volumeInspection?.filter((v) => v.Name === name);
    if (
      observed?.length !== 1 ||
      observed[0].Driver !== "local" ||
      Object.keys(observed[0].Options || {}).length ||
      observed[0].Labels?.["com.docker.compose.project"] !== localProject ||
      observed[0].Labels?.["com.docker.compose.volume"] !== key
    )
      reject("Engine volume ownership or local driver is not confirmed.");
  }
  if (
    config.services.taskdesk.image !== image ||
    config.services.migrate.image !== image
  )
    reject("Selected image does not match the plan.");
  const databaseNames = [];
  for (const serviceName of ["taskdesk", "migrate"]) {
    const vars = config.services[serviceName].environment || {};
    const key =
      serviceName === "taskdesk"
        ? "TASKDESK_DATABASE_URL"
        : "TASKDESK_MIGRATION_DATABASE_URL";
    if (
      Object.keys(vars).some(
        (k) =>
          /DATABASE_URL$/.test(k) &&
          k !== key &&
          !(serviceName === "migrate" && k === "TASKDESK_DATABASE_URL"),
      )
    )
      reject("Unexpected database credentials.");
    if (serviceName === "migrate" && vars.TASKDESK_ROLE !== "migrate")
      reject("Unexpected migration role.");
    if (
      serviceName === "taskdesk" &&
      (!["all", "web"].includes(vars.TASKDESK_ROLE || "all") ||
        (vars.TASKDESK_STORAGE_DRIVER || "filesystem") !== "filesystem")
    )
      reject("Unexpected app role or storage.");
    if (
      vars.TASKDESK_STORAGE_FILESYSTEM_ROOT !== undefined &&
      vars.TASKDESK_STORAGE_FILESYSTEM_ROOT !== "/app/data/attachments"
    )
      reject("Filesystem root must use the copied attachment volume.");
    for (const [name, value] of Object.entries(vars).filter(([k]) =>
      /DATABASE_URL$/.test(k),
    )) {
      let url;
      try {
        url = new URL(value);
      } catch {
        reject("Invalid local database configuration.");
      }
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.hostname !== "postgres" ||
        (url.port || "5432") !== "5432" ||
        url.search ||
        url.hash ||
        url.pathname === "/"
      )
        reject("Database must target the isolated Compose service.");
      const user = decodeURIComponent(url.username);
      if (
        (name === "TASKDESK_DATABASE_URL" && user !== "taskdesk_app") ||
        (name === "TASKDESK_MIGRATION_DATABASE_URL" &&
          (user !== config.services.postgres.environment?.POSTGRES_USER ||
            user === "taskdesk_app"))
      )
        reject("Unexpected local database owner.");
      databaseNames.push(url.pathname);
    }
    if (!vars[key]) reject("Missing local database configuration.");
  }
  if (new Set(databaseNames).size !== 1) reject("Database targets differ.");
  const pinnedImage = snapshot.imageInspection;
  if (
    !/^sha256:[a-f0-9]{64}$/.test(pinnedImage?.Id || "") ||
    !pinnedImage.RepoDigests?.includes(image)
  )
    reject("Pinned engine image inspection is required.");
  const runningNames = names.filter((name) => name !== "migrate");
  if (
    !Array.isArray(snapshot.containers) ||
    snapshot.containers.length !== runningNames.length
  )
    reject("Complete engine container inspection is required.");
  const networkInspection = snapshot.networkInspection;
  if (
    !networkInspection ||
    networkInspection.Name !== `${localProject}_default` ||
    !hex.test(networkInspection.Id || "") ||
    networkInspection.Driver !== "bridge" ||
    networkInspection.Scope !== "local" ||
    networkInspection.Internal !== false ||
    Object.keys(networkInspection.Options || {}).length ||
    networkInspection.Labels?.["com.docker.compose.project"] !== localProject ||
    networkInspection.Labels?.["com.docker.compose.network"] !== "default" ||
    !same(
      Object.keys(networkInspection.Containers || {}).sort(),
      snapshot.containers.map((container) => container.Id).sort(),
    )
  )
    reject("Engine network ownership or complete membership is not confirmed.");
  for (const name of runningNames) {
    const matches = snapshot.containers.filter(
      (c) => c.Config?.Labels?.["com.docker.compose.service"] === name,
    );
    const container = matches[0];
    const serviceImage =
      name === "taskdesk" ? pinnedImage : snapshot.supportingImages?.[name];
    if (
      !serviceImage ||
      !/^sha256:[a-f0-9]{64}$/.test(serviceImage.Id || "") ||
      container?.Config?.Image !== config.services[name].image ||
      container?.Image !== serviceImage.Id
    )
      reject(
        "Engine service image differs from the canonical image inspection.",
      );
    if (
      name === "taskdesk" &&
      (serviceImage.Config?.User !== "taskdesk" ||
        !same(serviceImage.Config.Entrypoint, ["./entrypoint.sh"]) ||
        (serviceImage.Config.Cmd != null &&
          !same(serviceImage.Config.Cmd, [])) ||
        serviceImage.Config.WorkingDir !== "/app")
    )
      reject("Signed application runtime contract changed.");
    if (
      matches.length !== 1 ||
      !/^[a-f0-9]{64}$/.test(container?.Id || "") ||
      container.Config?.Labels?.["com.docker.compose.project"] !==
        localProject ||
      container.State?.Running !== true ||
      container.HostConfig?.NetworkMode !== `${localProject}_default` ||
      container.HostConfig?.Privileged !== false ||
      container.HostConfig?.PublishAllPorts !== false ||
      !same(
        enginePorts(container.HostConfig.PortBindings),
        expectedPorts[name] || [],
      ) ||
      !same(
        enginePorts(container.NetworkSettings?.Ports),
        expectedPorts[name] || [],
      ) ||
      !same(Object.keys(container.NetworkSettings?.Networks || {}), [
        `${localProject}_default`,
      ])
    )
      reject(
        "Engine project, container ownership or port isolation is not confirmed.",
      );
    if (
      container.NetworkSettings.Networks[`${localProject}_default`]
        .NetworkID !== networkInspection.Id
    )
      reject("Engine service is attached to a different network.");
    if (
      ["postgres", "taskdesk", "valkey"].includes(name) &&
      container.State.Health?.Status !== "healthy"
    )
      reject("Engine service health is not confirmed.");
    if (
      name === "taskdesk" &&
      (container.Config.Image !== image || container.Image !== pinnedImage.Id)
    )
      reject("Engine application image is not confirmed.");
    const configuredEnvironment = config.services[name].environment || {};
    const actualEnvironment = container.Config.Env;
    if (
      !Array.isArray(actualEnvironment) ||
      Object.entries(configuredEnvironment).some(
        ([key, value]) =>
          actualEnvironment.filter((entry) => entry.startsWith(`${key}=`))
            .length !== 1 || !actualEnvironment.includes(`${key}=${value}`),
      ) ||
      actualEnvironment.some(
        (entry) =>
          /DATABASE_URL=/.test(entry) &&
          !Object.hasOwn(
            configuredEnvironment,
            entry.slice(0, entry.indexOf("=")),
          ),
      )
    )
      reject("Engine environment does not match the private configuration.");
    const expectedMounts = config.services[name].volumes || [];
    if (
      !Array.isArray(container.Mounts) ||
      container.Mounts.length !== expectedMounts.length ||
      expectedMounts.some(
        (expected) =>
          !container.Mounts.some(
            (actual) =>
              actual.Type === expected.type &&
              actual.Destination === expected.target &&
              actual.RW === !expected.read_only &&
              (expected.type === "volume"
                ? actual.Name === config.volumes[expected.source].name
                : actual.Source === expected.source && actual.RW === false),
          ),
      )
    )
      reject("Engine storage mounts do not match the selection.");
    assertEffectiveContainer(
      container,
      normalized.services[name],
      serviceImage,
      snapshot.postgresPaths,
    );
  }
  return normalized;
}

export function verifyBackupFiles({ directory, checksums }) {
  const expected = ["attachments.tar", "postgres.dump"];
  if (!checksums || !same(Object.keys(checksums).sort(), expected))
    reject("Backup must include exactly database and attachment checksums.");
  for (const name of expected) {
    const file = join(directory, name);
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077 ||
      !stat.size ||
      !hex.test(checksums[name] || "") ||
      hash(readFileSync(file)) !== checksums[name]
    )
      reject("Backup checksum or file integrity failed.");
  }
  if (
    readFileSync(join(directory, "postgres.dump")).subarray(0, 5).toString() !==
    "PGDMP"
  )
    reject("Backup is not a custom PostgreSQL archive.");
  return hash(JSON.stringify(checksums));
}

function assertDataProof(proof) {
  if (
    !proof ||
    !hex.test(proof.databaseFingerprint || "") ||
    !hex.test(proof.filesFingerprint || "") ||
    !Number.isInteger(proof.tableCount) ||
    proof.tableCount < 1 ||
    !Number.isInteger(proof.fileCount) ||
    proof.fileCount < 0 ||
    !hex.test(proof.migrationFingerprint || "")
  )
    reject("Database and attachment proof is incomplete.");
}
function assertRuntimeProof(proof, image, volumes) {
  if (
    proof?.project !== localProject ||
    proof.image !== image ||
    !same(proof.volumes, volumes) ||
    proof.healthy !== true ||
    proof.agentOrigin !== "https://ticketing.localhost" ||
    proof.portalOrigin !== "https://portal.localhost"
  )
    reject("Runtime image, mounts, health or origins are not confirmed.");
  assertDataProof(proof.data);
}

function assertSnapshotIdentity(snapshot, identity) {
  if (
    ["dockerEndpoint", "contextEndpoint", "daemonId"].some(
      (key) => snapshot[key] !== identity[key],
    )
  )
    reject("Selection Docker endpoint or daemon identity changed.");
}
function assertPrivateFiles(files) {
  if (
    !files ||
    !same(Object.keys(files).sort(), [
      "app.env",
      "migrate.env",
      "postgres.env",
      "proxy",
      "valkey.env",
    ]) ||
    Object.values(files).some((value) => !hex.test(value))
  )
    reject("Private configuration content fingerprints are incomplete.");
}
function assertStoppedWriters(observed, expected) {
  if (
    !Array.isArray(observed) ||
    !same(
      observed.map((value) => value.Id).sort(),
      expected.map((value) => value.Id).sort(),
    ) ||
    observed.some((value) => value.State?.Running !== false)
  )
    reject("All application writers must be stopped for frozen data proof.");
}

const inventoryListCommand = ["ps", "-a", "-q", "--no-trunc"];
const inventoryVolumeCommand = ["volume", "ls", "-q"];
const eventHistoryLimit = 256;
function daemonJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    reject("Invalid daemon-wide inventory evidence.");
  }
}
function inventoryIds(value, pattern) {
  const values = value.trim().split(/\s+/).filter(Boolean).sort();
  if (
    values.some((value) => !pattern.test(value)) ||
    new Set(values).size !== values.length
  )
    reject("Incomplete or ambiguous daemon-wide inventory.");
  return values;
}
function inspectBatch(client, command, identifiers) {
  const values = [];
  for (let index = 0; index < identifiers.length; index += 100) {
    const batch = daemonJson(
      client.command([...command, ...identifiers.slice(index, index + 100)]),
    );
    if (!Array.isArray(batch)) reject("Incomplete daemon-wide inspection.");
    values.push(...batch);
  }
  return values;
}
function inventoryProjection(inventory) {
  return {
    containers: inventory.containers
      .map((container) => ({
        Id: container.Id,
        Name: container.Name,
        Image: container.Image,
        Config: container.Config,
        HostConfig: container.HostConfig,
        Mounts: [...container.Mounts].sort((a, b) =>
          a.Destination.localeCompare(b.Destination),
        ),
        Networks: container.NetworkSettings?.Networks || {},
        state: {
          Running: container.State.Running,
          Paused: Boolean(container.State.Paused),
          Restarting: Boolean(container.State.Restarting),
          Dead: Boolean(container.State.Dead),
          Status: container.State.Status || "",
          Health: container.State.Health?.Status || "",
        },
      }))
      .sort((a, b) => a.Id.localeCompare(b.Id)),
    volumes: inventory.volumes
      .map((volume) => ({
        Name: volume.Name,
        Driver: volume.Driver,
        Mountpoint: volume.Mountpoint,
        Options: volume.Options || {},
        Labels: volume.Labels || {},
        CreatedAt: volume.CreatedAt || "",
      }))
      .sort((a, b) => a.Name.localeCompare(b.Name)),
  };
}
// The caller cannot supply a filtered list: all records come from the pinned,
// lease-guarded daemon client, including stopped containers on other networks.
export function captureDaemonInventory(client) {
  client.assertIdentity();
  const list = () => ({
    ids: inventoryIds(client.command(inventoryListCommand), /^[a-f0-9]{64}$/),
    names: inventoryIds(
      client.command(inventoryVolumeCommand),
      /^[A-Za-z0-9][A-Za-z0-9_.-]*$/,
    ),
  });
  const inspect = ({ ids, names }) => {
    const containers = inspectBatch(client, ["inspect"], ids);
    const volumes = inspectBatch(client, ["volume", "inspect"], names);
    if (
      !same(containers.map((value) => value.Id).sort(), ids) ||
      !same(volumes.map((value) => value.Name).sort(), names)
    )
      reject("Daemon inventory inspection omitted or duplicated records.");
    if (
      new Set(containers.map((container) => container.Name)).size !==
      containers.length
    )
      reject("Daemon container names are ambiguous.");
    for (const container of containers) {
      if (
        !container.Config ||
        !container.HostConfig ||
        typeof container.Name !== "string" ||
        typeof container.State?.Running !== "boolean" ||
        !Array.isArray(container.Mounts)
      )
        reject("Incomplete daemon container/mount record.");
      for (const mount of container.Mounts) {
        if (
          !["volume", "bind", "tmpfs"].includes(mount.Type) ||
          !posix.isAbsolute(mount.Destination || "") ||
          (mount.Type !== "tmpfs" &&
            (typeof mount.RW !== "boolean" ||
              !posix.isAbsolute(mount.Source || ""))) ||
          (mount.Type === "volume" && typeof mount.Name !== "string")
        )
          reject("Incomplete daemon mount source or writability evidence.");
      }
    }
    for (const volume of volumes)
      if (
        typeof volume.Driver !== "string" ||
        !posix.isAbsolute(volume.Mountpoint || "")
      )
        reject("Incomplete daemon volume source evidence.");
    return { containers, volumes };
  };
  const firstList = list();
  const first = inspect(firstList);
  const secondList = list();
  if (!same(firstList, secondList))
    reject("Daemon inventory changed during enumeration.");
  const second = inspect(secondList);
  if (
    !same(secondList, list()) ||
    !same(inventoryProjection(first), inventoryProjection(second))
  )
    reject("Daemon inventory changed during inspection.");
  client.assertIdentity();
  const projection = inventoryProjection(second);
  return {
    ...second,
    identity: client.identity,
    source: "pinned-daemon:unfiltered-ps-all-and-complete-inspect",
    evidenceHash: hash(JSON.stringify(projection)),
  };
}
function daemonTimeNanos(value) {
  const match =
    /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(
      value,
    );
  if (!match) reject("Daemon event clock is unavailable.");
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(milliseconds)) reject("Invalid daemon event clock.");
  return (
    BigInt(milliseconds) * 1000000n + BigInt((match[2] || "").padEnd(9, "0"))
  );
}
const secondsTimestamp = (nanos) =>
  `${nanos / 1000000000n}.${String(nanos % 1000000000n).padStart(9, "0")}`;
function daemonEvents(client, since, until) {
  const lines = client.command([
    "events",
    "--since",
    since,
    "--until",
    until,
    "--format",
    "{{json .}}",
  ]);
  const values = lines.trim()
    ? lines
        .trim()
        .split(/\r?\n/)
        .map((line) =>
          daemonJson(line.replace(/("timeNano"\s*:\s*)(\d+)/g, '$1"$2"')),
        )
    : [];
  if (values.length >= eventHistoryLimit)
    reject("Daemon event window may have overflowed.");
  for (const event of values)
    if (
      !/^[0-9]+$/.test(event.timeNano || "") ||
      typeof event.Type !== "string" ||
      typeof event.Action !== "string" ||
      typeof event.Actor?.ID !== "string" ||
      (event.Type === "container" && !/^[a-f0-9]{64}$/.test(event.Actor.ID))
    )
      reject("Incomplete daemon lifecycle event evidence.");
  return values;
}
function beginEventFence(client) {
  const since = client.command(["info", "--format", "{{.SystemTime}}"]).trim();
  daemonTimeNanos(since);
  client.command(["update", "--restart=no", client.id]);
  const until = client.command(["info", "--format", "{{.SystemTime}}"]).trim();
  const events = daemonEvents(client, since, until);
  const anchors = events.filter(
    (event) =>
      event.Type === "container" &&
      event.Action === "update" &&
      event.Actor.ID === client.id,
  );
  if (anchors.length !== 1)
    reject("Daemon event opening anchor is missing or ambiguous.");
  return anchors[0].timeNano;
}
function advanceEventFence(client, opening) {
  client.command(["update", "--restart=no", client.id]);
  const until = client.command(["info", "--format", "{{.SystemTime}}"]).trim();
  const untilNanos = daemonTimeNanos(until);
  const events = daemonEvents(client, secondsTimestamp(BigInt(opening)), until);
  const anchors = events.filter(
    (event) =>
      event.Type === "container" &&
      event.Action === "update" &&
      event.Actor.ID === client.id,
  );
  if (
    anchors.length !== 2 ||
    anchors[0].timeNano !== opening ||
    BigInt(anchors[1].timeNano) <= BigInt(opening) ||
    events.some(
      (event) =>
        BigInt(event.timeNano) < BigInt(opening) ||
        BigInt(event.timeNano) > untilNanos,
    )
  )
    reject("Daemon event continuity or closing anchor is not proven.");
  return { events, closing: anchors[1].timeNano };
}
function withoutRuntimeIdentity(config) {
  const result = structuredClone(config);
  for (const key of ["Hostname", "Image", "Labels"]) delete result[key];
  return result;
}
function mappedVolumeNames(value, volumes) {
  if (typeof value === "string")
    return value
      .replaceAll(volumes.database, baselineVolumes.database)
      .replaceAll(volumes.files, baselineVolumes.files);
  if (Array.isArray(value))
    return value.map((entry) => mappedVolumeNames(entry, volumes));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        mappedVolumeNames(entry, volumes),
      ]),
    );
  return value;
}
function pathOverlaps(left, right) {
  const a = posix.normalize(left);
  const b = posix.normalize(right);
  return (
    a === b ||
    a.startsWith(`${b.replace(/\/$/, "")}/`) ||
    b.startsWith(`${a.replace(/\/$/, "")}/`)
  );
}
function volumeInventoryPolicy({
  baselineImage,
  candidateImage,
  volumes,
  slot,
  client,
}) {
  const users = new Map();
  const pinnedVolumes = new Map();
  const templates = new Map();
  let initialBound = false;
  let backupComplete = false;
  let baselineStarted = false;
  const expected = new Map([
    [
      baselineVolumes.database,
      {
        generation: "baseline",
        role: "postgres",
        target: "/var/lib/postgresql",
        image: "postgres:18-alpine",
        key: "postgres-data",
      },
    ],
    [
      baselineVolumes.files,
      {
        generation: "baseline",
        role: "taskdesk",
        target: "/app/data/attachments",
        image: baselineImage,
        key: "attachments",
      },
    ],
    [
      volumes.database,
      {
        generation: "candidate",
        role: "postgres",
        target: "/var/lib/postgresql",
        image: "postgres:18-alpine",
        key: "postgres-data",
      },
    ],
    [
      volumes.files,
      {
        generation: "candidate",
        role: "taskdesk",
        target: "/app/data/attachments",
        image: candidateImage,
        key: "attachments",
      },
    ],
  ]);
  const controlled = new Set([
    "copy-slot",
    "select-candidate",
    "return-baseline",
    "start-baseline",
  ]);
  const namedMounts = (container) =>
    [...container.Mounts].sort((a, b) =>
      a.Destination.localeCompare(b.Destination),
    );
  const projection = (container, names) => ({
    config: withoutRuntimeIdentity(container.Config),
    host: mappedVolumeNames(container.HostConfig, names),
    mounts: mappedVolumeNames(namedMounts(container), names),
  });
  const inventoryMap = (inventory) =>
    new Map(inventory.containers.map((container) => [container.Id, container]));
  const matchSnapshot = (snapshot, inventory) => {
    const all = inventoryMap(inventory);
    for (const observed of snapshot.containers) {
      const actual = all.get(observed.Id);
      if (
        !actual ||
        actual.Name !== observed.Name ||
        actual.Image !== observed.Image ||
        !same(actual.Config, observed.Config) ||
        !same(actual.HostConfig, observed.HostConfig) ||
        !same(actual.Mounts, observed.Mounts) ||
        actual.State.Running !== observed.State.Running
      )
        reject(
          "Canonical snapshot is not backed by the exhaustive daemon inventory.",
        );
    }
  };
  return {
    matchSnapshot,
    bindInitial(snapshot, inventory) {
      matchSnapshot(snapshot, inventory);
      for (const role of ["postgres", "taskdesk"]) {
        const actual = snapshot.containers.find(
          (container) =>
            container.Config.Labels["com.docker.compose.service"] === role,
        );
        if (!users.has(actual.Id))
          reject(
            "Baseline volume user was not observed in the daemon inventory.",
          );
        templates.set(role, structuredClone(actual));
      }
      initialBound = true;
    },
    markBackupComplete() {
      backupComplete = true;
    },
    allowBaselineStart() {
      baselineStarted = true;
    },
    validate(inventory, phase, afterAction) {
      const allVolumes = new Map(
        inventory.volumes.map((volume) => [volume.Name, volume]),
      );
      for (const name of Object.values(baselineVolumes))
        if (!allVolumes.has(name))
          reject(
            "A protected baseline volume is missing from the daemon inventory.",
          );
      const roots = new Map();
      for (const [name, profile] of expected) {
        const volume = allVolumes.get(name);
        if (!volume) continue;
        if (
          profile.generation === "candidate" &&
          !pinnedVolumes.has(name) &&
          (!initialBound || phase !== "copy-slot" || !afterAction)
        )
          reject("A candidate volume appeared outside its owned copy action.");
        if (
          volume.Driver !== "local" ||
          Object.keys(volume.Options || {}).length ||
          !volume.CreatedAt ||
          volume.Labels?.["com.docker.compose.project"] !== localProject ||
          volume.Labels?.["com.docker.compose.volume"] !== profile.key ||
          (profile.generation === "candidate" &&
            volume.Labels?.["info.taskdesk.selection.slot"] !== slot)
        )
          reject("Protected daemon volume ownership or source is not proven.");
        const record = {
          Name: volume.Name,
          Driver: volume.Driver,
          Mountpoint: volume.Mountpoint,
          Options: volume.Options || {},
          Labels: volume.Labels || {},
          CreatedAt: volume.CreatedAt,
        };
        if (pinnedVolumes.has(name) && !same(pinnedVolumes.get(name), record))
          reject(
            "A protected volume changed identity or source during selection.",
          );
        pinnedVolumes.set(name, structuredClone(record));
        roots.set(name, volume.Mountpoint);
      }
      for (const name of pinnedVolumes.keys())
        if (!allVolumes.has(name))
          reject("A previously observed protected volume disappeared.");
      // Reserve the planned local-driver paths before slot creation too, so a
      // pre-existing bind or local-volume alias cannot wait for the new slot.
      const volumeRoot = posix.dirname(
        posix.dirname(allVolumes.get(baselineVolumes.database).Mountpoint),
      );
      for (const name of expected.keys()) {
        const intended = posix.join(volumeRoot, name, "_data");
        if (
          allVolumes.has(name) &&
          allVolumes.get(name).Mountpoint !== intended
        )
          reject("The protected local volume source layout is not provable.");
        roots.set(name, intended);
      }
      const aliases = new Map(
        inventory.volumes.map((volume) => [
          volume.Name,
          new Set(expected.has(volume.Name) ? [volume.Name] : []),
        ]),
      );
      for (let pass = 0; pass < inventory.volumes.length; pass++) {
        let changed = false;
        for (const volume of inventory.volumes) {
          const device = volume.Options?.device;
          if (typeof device !== "string" || !posix.isAbsolute(device)) continue;
          for (const [name, root] of roots)
            if (
              pathOverlaps(device, root) &&
              !aliases.get(volume.Name).has(name)
            ) {
              aliases.get(volume.Name).add(name);
              changed = true;
            }
          for (const target of inventory.volumes)
            if (pathOverlaps(device, target.Mountpoint))
              for (const name of aliases.get(target.Name))
                if (!aliases.get(volume.Name).has(name)) {
                  aliases.get(volume.Name).add(name);
                  changed = true;
                }
        }
        if (!changed) break;
      }
      const current = new Map();
      for (const container of inventory.containers) {
        const touched = new Set();
        for (const mount of container.Mounts) {
          if (mount.Type === "volume" && expected.has(mount.Name))
            touched.add(mount.Name);
          const alias =
            mount.Type === "volume" ? allVolumes.get(mount.Name) : null;
          if (mount.Type === "volume" && !alias)
            reject(
              "A mounted volume was omitted from the daemon volume inventory.",
            );
          if (
            alias &&
            (alias.Driver !== "local" ||
              (Object.keys(alias.Options || {}).length &&
                !(
                  posix.isAbsolute(alias.Options?.device || "") &&
                  (!alias.Options.type || alias.Options.type === "none") &&
                  /(?:^|,)r?bind(?:,|$)/.test(alias.Options.o || "")
                )))
          )
            reject("A mounted volume has an unproven physical-source alias.");
          if (alias)
            for (const name of aliases.get(alias.Name)) touched.add(name);
          for (const volume of inventory.volumes)
            if (mount.Source && pathOverlaps(mount.Source, volume.Mountpoint))
              for (const name of aliases.get(volume.Name)) touched.add(name);
          for (const [name, root] of roots)
            if (
              (mount.Source && pathOverlaps(mount.Source, root)) ||
              (typeof alias?.Options?.device === "string" &&
                posix.isAbsolute(alias.Options.device) &&
                pathOverlaps(alias.Options.device, root))
            )
              touched.add(name);
        }
        if (!touched.size) {
          if (users.has(container.Id))
            reject(
              "A registered volume user lost its protected mount evidence.",
            );
          continue;
        }
        if (touched.size !== 1 || container.Mounts.length !== 1)
          reject(
            "A container has overlapping or additional protected-volume access.",
          );
        const name = [...touched][0];
        const profile = expected.get(name);
        const mount = container.Mounts[0];
        if (
          mount.Type !== "volume" ||
          mount.Name !== name ||
          mount.Source !== roots.get(name) ||
          mount.Destination !== profile.target ||
          mount.RW !== true ||
          container.Config.Labels?.["com.docker.compose.project"] !==
            localProject ||
          container.Config.Labels?.["com.docker.compose.service"] !==
            profile.role ||
          container.Config.Image !== profile.image ||
          container.HostConfig.NetworkMode !== `${localProject}_default` ||
          Object.keys(container.NetworkSettings?.Networks || {}).some(
            (network) => network !== `${localProject}_default`,
          )
        )
          reject("An unauthorized container uses a protected volume.");
        const canonicalName = `/${localProject}-${profile.role}-1`;
        const known = users.get(container.Id);
        if (!known) {
          if (
            container.Name !== canonicalName ||
            (profile.generation === "baseline"
              ? initialBound
              : !initialBound ||
                !["copy-slot", "select-candidate"].includes(phase) ||
                !afterAction)
          )
            reject(
              "An unregistered container uses a protected volume, including stopped users.",
            );
          if (profile.generation === "candidate") {
            const template = templates.get(profile.role);
            if (
              !same(
                projection(container, volumes),
                projection(template, baselineVolumes),
              )
            )
              reject(
                "A new candidate volume user differs from its frozen canonical profile.",
              );
            if (
              profile.role === "postgres" &&
              container.Image !== template.Image
            )
              reject("Candidate PostgreSQL image identity changed.");
            if (profile.role === "taskdesk") {
              const image = daemonJson(
                client.command(["image", "inspect", candidateImage]),
              );
              if (
                image.length !== 1 ||
                container.Image !== image[0].Id ||
                !image[0].RepoDigests?.includes(candidateImage)
              )
                reject(
                  "Candidate volume user image is not backed by the verified digest.",
                );
            }
          }
          users.set(container.Id, {
            imageId: container.Image,
            name,
            profile,
            frozen: projection(
              container,
              profile.generation === "candidate" ? volumes : baselineVolumes,
            ),
          });
        } else if (
          known.name !== name ||
          known.imageId !== container.Image ||
          !same(
            known.frozen,
            projection(
              container,
              profile.generation === "candidate" ? volumes : baselineVolumes,
            ),
          )
        )
          reject(
            "A registered volume user changed mounts or execution configuration.",
          );
        const retainedName = `${canonicalName}-${profile.generation === "baseline" ? "retained" : "candidate"}-${slot}`;
        if (
          container.Name !== canonicalName &&
          (container.Name !== retainedName || container.State.Running)
        )
          reject(
            "A retained volume user has an unexpected name or is still running.",
          );
        if (
          profile.generation === "baseline" &&
          profile.role === "taskdesk" &&
          backupComplete &&
          !baselineStarted &&
          container.State.Running
        )
          reject(
            "A baseline application writer restarted before return proof.",
          );
        if (
          profile.generation === "candidate" &&
          profile.role === "taskdesk" &&
          phase === "copy-slot" &&
          container.State.Running
        )
          reject("The candidate application started before copy verification.");
        current.set(container.Id, {
          ...profile,
          name,
          running: container.State.Running,
        });
      }
      if (
        [...current.values()].some(
          (value) => value.generation === "candidate" && value.running,
        ) &&
        [...current.values()].some(
          (value) => value.generation === "baseline" && value.running,
        )
      )
        reject("Baseline and candidate volume writers overlap.");
      return current;
    },
    auditEvents(events, before, after, current, phase) {
      const beforeIds = inventoryMap(before || after);
      const afterIds = inventoryMap(after);
      const transitions = new Set([
        "create",
        "destroy",
        "rename",
        "start",
        "stop",
        "die",
        "kill",
        "restart",
        "pause",
        "unpause",
      ]);
      for (const event of events) {
        if (event.Type === "container") {
          if (event.Actor.ID === client.id && event.Action === "update")
            continue;
          if (
            event.Action.startsWith("health_status") &&
            (beforeIds.has(event.Actor.ID) || afterIds.has(event.Actor.ID))
          )
            continue;
          const authorized = users.get(event.Actor.ID);
          if (!authorized)
            reject(
              "Unexplained daemon-wide container activity occurred during selection.",
            );
          if (event.Action.startsWith("exec_")) continue;
          if (
            ["archive-path", "export", "copy"].includes(event.Action) &&
            ["backup", "copy-slot"].includes(phase)
          )
            continue;
          if (
            !transitions.has(event.Action) ||
            (!controlled.has(phase) &&
              !(
                phase === "backup" &&
                authorized.profile.generation === "baseline" &&
                authorized.profile.role === "taskdesk" &&
                ["stop", "die", "kill"].includes(event.Action)
              ))
          )
            reject(
              "An unexpected container lifecycle change crossed the protected action.",
            );
          if (event.Action === "create" && !afterIds.has(event.Actor.ID))
            reject(
              "A transient volume user has no complete daemon inspection proof.",
            );
          if (event.Action === "destroy" && afterIds.has(event.Actor.ID))
            reject(
              "A container destruction event disagrees with the complete inventory.",
            );
        } else if (event.Type === "volume" && expected.has(event.Actor.ID)) {
          if (
            event.Action === "create" &&
            expected.get(event.Actor.ID).generation === "candidate" &&
            phase === "copy-slot"
          )
            continue;
          if (
            ["mount", "unmount"].includes(event.Action) &&
            [
              "backup",
              "copy-slot",
              "select-candidate",
              "return-baseline",
              "start-baseline",
            ].includes(phase)
          )
            continue;
          reject("An unexpected protected-volume lifecycle event occurred.");
        }
      }
      for (const container of after.containers) {
        const previous = beforeIds.get(container.Id);
        if (!previous) {
          if (
            !current.has(container.Id) ||
            !controlled.has(phase) ||
            !events.some(
              (event) =>
                event.Type === "container" &&
                event.Actor.ID === container.Id &&
                event.Action === "create",
            )
          )
            reject("A new daemon container has no authorized lifecycle proof.");
        } else if (
          previous.State.Running !== container.State.Running &&
          !events.some(
            (event) =>
              event.Type === "container" &&
              event.Actor.ID === container.Id &&
              ["start", "stop", "die", "kill", "restart"].includes(
                event.Action,
              ),
          )
        )
          reject("Container running state changed without lifecycle evidence.");
      }
      for (const [id, container] of afterIds) {
        const lifecycle = events.filter(
          (event) => event.Type === "container" && event.Actor.ID === id,
        );
        const stateEvent = lifecycle
          .filter((event) =>
            ["start", "stop", "die", "kill", "restart"].includes(event.Action),
          )
          .at(-1);
        if (
          stateEvent &&
          container.State.Running !==
            ["start", "restart"].includes(stateEvent.Action)
        )
          reject(
            "Inventory running state does not reflect the closing lifecycle events.",
          );
        const rename = lifecycle
          .filter((event) => event.Action === "rename")
          .at(-1);
        if (
          rename &&
          rename.Actor.Attributes?.name !== container.Name.replace(/^\//, "")
        )
          reject("Inventory name does not reflect the closing rename event.");
        const pause = lifecycle
          .filter((event) => ["pause", "unpause"].includes(event.Action))
          .at(-1);
        if (
          pause &&
          Boolean(container.State.Paused) !== (pause.Action === "pause")
        )
          reject(
            "Inventory pause state does not reflect the closing lifecycle event.",
          );
      }
      for (const container of beforeIds.values())
        if (
          !afterIds.has(container.Id) &&
          (!users.has(container.Id) ||
            !controlled.has(phase) ||
            !events.some(
              (event) =>
                event.Type === "container" &&
                event.Actor.ID === container.Id &&
                event.Action === "destroy",
            ))
        )
          reject(
            "A daemon container disappeared without authorized destruction proof.",
          );
    },
  };
}

// Each callback must inspect the real runtime when a separately reviewed adapter
// is implemented. This API has no operational default and is not a deployment CLI.
export async function coordinateCandidateSelection({
  plan,
  adapter,
  verifyCandidate,
  daemonRun,
  daemonEnv,
  hostDirectory,
  directory = coordinatorDirectory,
}) {
  const methods = [
    "inspectBoundary",
    "startBaseline",
    "inspectBaseline",
    "quiesceAndBackup",
    "verifyBackupArchive",
    "createAndRestoreSlot",
    "inspectCopiedData",
    "selectCandidate",
    "inspectCandidate",
    "browserWindow",
    "returnToBaseline",
    "inspectReturnedBaseline",
  ];
  if (
    !adapter ||
    methods.some((m) => typeof adapter[m] !== "function") ||
    typeof verifyCandidate !== "function" ||
    typeof daemonRun !== "function"
  )
    reject("A separately reviewed runtime and verifier adapter is required.");
  const frozenPlan = structuredClone(plan);
  const volumes = Object.freeze(candidateVolumes(frozenPlan.slot));
  if (!releaseImage.test(frozenPlan.baselineImage || ""))
    reject("Baseline must be a signed release digest.");
  const candidateImage = frozenPlan.candidate?.image;
  if (
    !/^ghcr\.io\/thomasheinthura\/taskdesk-pr-candidate-[1-9][0-9]*-[1-9][0-9]*@sha256:[a-f0-9]{64}$/.test(
      candidateImage || "",
    )
  )
    reject("Candidate must use its dedicated run package and digest.");
  const lease = acquireProjectSelectionLease({ directory });
  const journal = join(lease.lock, "journal.jsonl");
  let sequence = 0;
  let daemonLease;
  let privateFiles;
  const record = (phase, details = {}) => {
    const fd = openSync(journal, "a", 0o600);
    try {
      appendFileSync(
        fd,
        `${JSON.stringify({ sequence: sequence++, time: new Date().toISOString(), phase, ...details })}\n`,
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    syncDirectory(lease.lock);
  };
  let inventoryPolicy;
  let eventCursor;
  let lastInventory;
  let activePhase = "preflight";
  let commandInFlight = false;
  let stopped = false;
  const readonlyDocker = (args) => {
    if (
      !(
        ["info", "inspect", "ps"].includes(args[0]) ||
        (["image", "volume", "network", "context"].includes(args[0]) &&
          ["inspect", "ls", "show"].includes(args[1]))
      )
    )
      reject("Boundary inspection attempted a Docker mutation.");
    return daemonLease.command(args);
  };
  const assertBoundary = async (phase = activePhase, afterAction = false) => {
    if (stopped)
      reject("Selection has stopped; no further Docker action is permitted.");
    daemonLease.assertIdentity();
    const inventory = captureDaemonInventory(daemonLease);
    const observed = await adapter.inspectBoundary({
      identity: daemonLease.identity,
      docker: readonlyDocker,
    });
    if (stopped) reject("Selection stopped during boundary inspection.");
    assertSnapshotIdentity(observed, daemonLease.identity);
    assertPrivateFiles(observed.privateFiles);
    if (privateFiles && !same(privateFiles, observed.privateFiles))
      reject("Private configuration content changed during selection.");
    privateFiles ??= structuredClone(observed.privateFiles);
    const current = inventoryPolicy.validate(inventory, phase, afterAction);
    const window = advanceEventFence(daemonLease, eventCursor);
    inventoryPolicy.auditEvents(
      window.events,
      lastInventory,
      inventory,
      current,
      phase,
    );
    record("daemon-volume-boundary", {
      phase,
      afterAction,
      inventoryHash: inventory.evidenceHash,
      eventHash: hash(JSON.stringify(window.events)),
      opening: eventCursor,
      closing: window.closing,
    });
    eventCursor = window.closing;
    lastInventory = inventory;
  };
  const guardedDocker = async (args) => {
    if (stopped || commandInFlight)
      reject(
        "Concurrent Docker commands cannot share a protected volume action.",
      );
    commandInFlight = true;
    try {
      await assertBoundary(activePhase, false);
      if (stopped) reject("Selection stopped before a Docker mutation.");
      const result = daemonLease.command(args);
      await assertBoundary(activePhase, true);
      return result;
    } finally {
      commandInFlight = false;
    }
  };
  const step = async (name, action) => {
    activePhase = name;
    record(`${name}:intent`);
    if (daemonLease) await assertBoundary(name, false);
    const result = await action({
      identity: daemonLease?.identity,
      docker: guardedDocker,
    });
    if (commandInFlight)
      reject("A protected Docker command was not awaited by its action.");
    if (daemonLease) await assertBoundary(name, true);
    record(`${name}:complete`, {
      resultHash: hash(JSON.stringify(result) ?? "undefined"),
    });
    return structuredClone(result);
  };
  try {
    if (existsSync(join(directory, `${frozenPlan.slot}.jsonl`)))
      reject("Candidate slot has already been used.");
    record("planned", {
      slot: frozenPlan.slot,
      candidateImage,
      baselineImage: frozenPlan.baselineImage,
      volumes,
    });
    record("acquire-daemon-lease:intent");
    daemonLease = acquireDockerDaemonLease({
      run: daemonRun,
      env: daemonEnv,
      stateFile: join(lease.lock, "daemon.json"),
      hostDirectory,
    });
    inventoryPolicy = volumeInventoryPolicy({
      baselineImage: frozenPlan.baselineImage,
      candidateImage,
      volumes,
      slot: frozenPlan.slot,
      client: daemonLease,
    });
    eventCursor = beginEventFence(daemonLease);
    await assertBoundary();
    record("daemon-lease-owned", {
      containerId: daemonLease.id,
      identity: daemonLease.identity,
      privateFiles,
    });
    // Verification succeeds by throwing on any mismatch. No boolean bypass.
    await step("verify-candidate", () =>
      verifyCandidate(structuredClone(frozenPlan.candidate)),
    );
    const initial = await step("inspect-baseline", () =>
      adapter.inspectBaseline({
        identity: daemonLease.identity,
        docker: guardedDocker,
      }),
    );
    assertSnapshotIdentity(initial, daemonLease.identity);
    assertSelectionSnapshot(initial, {
      image: frozenPlan.baselineImage,
      privateDir: frozenPlan.privateDir,
    });
    assertRuntimeProof(
      initial.runtime,
      frozenPlan.baselineImage,
      baselineVolumes,
    );
    inventoryPolicy.bindInitial(initial, lastInventory);
    const original = {
      ...structuredClone(initial),
      privateDir: frozenPlan.privateDir,
    };
    if (
      !Array.isArray(initial.existingVolumeNames) ||
      Object.values(volumes).some((v) =>
        initial.existingVolumeNames.includes(v),
      )
    )
      reject(
        "Candidate slot already exists or volume inventory is unavailable.",
      );
    const baselineWriters = initial.containers.filter(
      (value) =>
        value.Config.Labels["com.docker.compose.service"] === "taskdesk",
    );
    const backup = await step("backup", (context) =>
      adapter.quiesceAndBackup(context),
    );
    assertStoppedWriters(backup.writerState, baselineWriters);
    assertPrivateFiles(backup.privateFiles);
    if (!same(backup.privateFiles, privateFiles))
      reject(
        "Backup private configuration does not match the frozen selection.",
      );
    const backupHash = verifyBackupFiles(backup);
    assertDataProof(backup.data);
    inventoryPolicy.markBackupComplete();
    // The quiesced backup, not an earlier live snapshot, is the definitive data baseline.
    const archive = await step("verify-archive", (context) =>
      adapter.verifyBackupArchive(structuredClone(backup), context),
    );
    if (
      !Number.isInteger(archive?.databaseEntries) ||
      archive.databaseEntries < 1 ||
      archive.filesFingerprint !== backup.data.filesFingerprint ||
      archive.fileCount !== backup.data.fileCount
    )
      reject(
        "Backup archive listing and attachment manifest are not confirmed.",
      );
    record("backup-verified", { backupHash, data: backup.data });
    const created = await step("copy-slot", (context) =>
      adapter.createAndRestoreSlot({
        ...context,
        volumes,
        slot: frozenPlan.slot,
        backup: structuredClone(backup),
      }),
    );
    for (const [key, name] of Object.entries(volumes)) {
      const volume = created?.[key];
      if (
        volume?.Name !== name ||
        volume.Driver !== "local" ||
        Object.keys(volume.Options || {}).length ||
        volume.Labels?.["info.taskdesk.selection.slot"] !== frozenPlan.slot ||
        volume.Labels?.["com.docker.compose.project"] !== localProject ||
        volume.Labels?.["com.docker.compose.volume"] !==
          (key === "database" ? "postgres-data" : "attachments")
      )
        reject("Created candidate volume ownership is not confirmed.");
    }
    const copy = await step("verify-copy", (context) =>
      adapter.inspectCopiedData({ ...context, volumes }),
    );
    assertDataProof(copy);
    if (!same(copy, backup.data))
      reject("Restored database or attachments differ from the backup.");
    await step("select-candidate", (context) =>
      adapter.selectCandidate({ ...context, image: candidateImage, volumes }),
    );
    const candidate = await step("inspect-candidate", (context) =>
      adapter.inspectCandidate(context),
    );
    assertSnapshotIdentity(candidate, daemonLease.identity);
    assertSelectionSnapshot(candidate, {
      volumes,
      image: candidateImage,
      privateDir: frozenPlan.privateDir,
    });
    inventoryPolicy.matchSnapshot(candidate, lastInventory);
    assertRuntimeProof(candidate.runtime, candidateImage, volumes);
    assertSelectionDelta(candidate, original, volumes, candidateImage);
    const browser = await step("browser-window", (context) =>
      adapter.browserWindow(context),
    );
    if (browser?.passed !== true || !hex.test(browser.evidenceHash || ""))
      reject("Browser window did not produce passing evidence.");
    // Explicit return is the normal successful path. No rollback is attempted on failure.
    const prestart = await step("return-baseline", (context) =>
      adapter.returnToBaseline({
        ...context,
        image: frozenPlan.baselineImage,
        volumes: baselineVolumes,
      }),
    );
    const candidateWriters = candidate.containers.filter(
      (value) =>
        value.Config.Labels["com.docker.compose.service"] === "taskdesk",
    );
    assertStoppedWriters(prestart?.writerState, candidateWriters);
    assertDataProof(prestart.data);
    if (
      prestart.image !== frozenPlan.baselineImage ||
      !same(prestart.volumes, baselineVolumes) ||
      !same(prestart.data, backup.data)
    )
      reject(
        "Original baseline must be proven unchanged before restarting application writers.",
      );
    record("baseline-proven-before-start", { data: prestart.data });
    inventoryPolicy.allowBaselineStart();
    await step("start-baseline", (context) => adapter.startBaseline(context));
    const returned = await step("verify-return", (context) =>
      adapter.inspectReturnedBaseline(context),
    );
    assertSnapshotIdentity(returned, daemonLease.identity);
    assertSelectionSnapshot(returned, {
      image: frozenPlan.baselineImage,
      privateDir: frozenPlan.privateDir,
    });
    inventoryPolicy.matchSnapshot(returned, lastInventory);
    assertRuntimeProof(
      returned.runtime,
      frozenPlan.baselineImage,
      baselineVolumes,
    );
    assertSelectionDelta(
      returned,
      original,
      baselineVolumes,
      frozenPlan.baselineImage,
    );
    record("returned-baseline", {
      prestartData: prestart.data,
      poststartData: returned.runtime.data,
      browserEvidenceHash: browser.evidenceHash,
    });
    await assertBoundary();
    stopped = true;
    daemonLease.release();
    record("completed");
    // Preserve journal after unlocking. Completion never erases evidence.
    const saved = join(directory, `${frozenPlan.slot}.jsonl`);
    durableWrite(saved, readFileSync(journal));
    unlinkSync(journal);
    lease.release();
    return { journal: saved, volumes, returnedToBaseline: true };
  } catch {
    stopped = true;
    try {
      record("stopped-requires-inspection");
    } catch {
      /* Preserve an incomplete journal as-is. */
    }
    reject(
      "Candidate selection stopped; project lock and journal retained for inspection. No automatic retry or rollback was attempted.",
    );
  }
}
