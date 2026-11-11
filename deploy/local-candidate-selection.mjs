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
  mail: `${localProject}_mailpit-data`,
});
export const baselineNetworks = Object.freeze({
  default: `${localProject}_default`,
});
const serviceRoles = Object.freeze([
  "mailpit",
  "migrate",
  "postgres",
  "taskdesk",
  "traefik",
  "valkey",
]);
const runningServiceRoles = Object.freeze(
  serviceRoles.filter((name) => name !== "migrate"),
);
const reject = (message) => {
  throw new Error(message);
};
const same = isDeepStrictEqual;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hex = /^[a-f0-9]{64}$/;
const slotPattern = /^[a-f0-9]{32}$/;
const releaseImage =
  /^ghcr\.io\/thomasheinthura\/taskdesk@sha256:[a-f0-9]{64}$/;
const candidateImagePattern =
  /^ghcr\.io\/thomasheinthura\/taskdesk-pr-candidate-[1-9][0-9]*-[1-9][0-9]*@sha256:[a-f0-9]{64}$/;
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
  if (!slotPattern.test(slot || ""))
    reject("Candidate slot must be a new 32-character hexadecimal identifier.");
  return Object.freeze({
    database: `${localProject}_candidate-${slot}_postgres-data`,
    files: `${localProject}_candidate-${slot}_attachments`,
    mail: `${localProject}_candidate-${slot}_mailpit-data`,
  });
}
export function candidateNetworks(slot) {
  if (!slotPattern.test(slot || ""))
    reject("Candidate slot must be a new 32-character hexadecimal identifier.");
  return Object.freeze({
    backend: `${localProject}_candidate-${slot}_backend`,
    ingress: `${localProject}_candidate-${slot}_ingress`,
  });
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
function pathOverlaps(left, right) {
  const a = posix.normalize(left);
  const b = posix.normalize(right);
  return (
    a === b ||
    a.startsWith(`${b.replace(/\/$/, "")}/`) ||
    b.startsWith(`${a.replace(/\/$/, "")}/`)
  );
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
const baselineExpectedPorts = {
  postgres: ["127.0.0.1|62873|5432|tcp"],
  traefik: [
    "127.0.0.1|80|80|tcp",
    "::1|80|80|tcp",
    "127.0.0.1|443|443|tcp",
    "::1|443|443|tcp",
  ].sort(),
  mailpit: ["127.0.0.1|18025|8025|tcp", "127.0.0.1|11025|1025|tcp"].sort(),
};
const candidateExpectedPorts = {
  traefik: baselineExpectedPorts.traefik,
};
function expectedPortsFor(generation, serviceName) {
  const table =
    generation === "candidate" ? candidateExpectedPorts : baselineExpectedPorts;
  return table[serviceName] || [];
}

export function baselineGenerationProfile({ image, privateDir }) {
  if (!releaseImage.test(image || ""))
    reject("Baseline must be a signed release digest.");
  if (!privateDir || resolve(privateDir) !== privateDir)
    reject("Private configuration path must be absolute.");
  return Object.freeze({
    generation: "baseline",
    slot: null,
    image,
    privateDir,
    volumes: baselineVolumes,
    networks: baselineNetworks,
  });
}
export function candidateGenerationProfile({
  slot,
  image,
  privateDir,
  baselinePrivateDir = null,
}) {
  const volumes = candidateVolumes(slot);
  const networks = candidateNetworks(slot);
  if (!candidateImagePattern.test(image || ""))
    reject("Candidate must use its dedicated run package and digest.");
  if (!privateDir || resolve(privateDir) !== privateDir)
    reject("Candidate private configuration path must be absolute.");
  if (
    baselinePrivateDir !== null &&
    (!baselinePrivateDir ||
      resolve(baselinePrivateDir) !== baselinePrivateDir ||
      pathOverlaps(privateDir, baselinePrivateDir))
  )
    reject(
      "Candidate private configuration path must be disjoint from baseline.",
    );
  return Object.freeze({
    generation: "candidate",
    slot,
    image,
    privateDir,
    volumes,
    networks,
  });
}
function inferSlotFromVolumes(volumes) {
  const match =
    typeof volumes?.database === "string"
      ? /^taskdesk-codex-testing_candidate-([a-f0-9]{32})_postgres-data$/.exec(
          volumes.database,
        )
      : null;
  return match ? match[1] : null;
}

// A closed representation of compose.testing.yml (baseline) or
// compose.testing.yml + compose.candidate.yml (candidate). Private environment
// values are validated separately and frozen across the entire selection;
// service structure is never copied from the observed runtime into this contract.
export function canonicalSelectionConfig({
  image,
  privateDir,
  slot = null,
  volumes,
  networks,
  environment = {},
}) {
  const resolvedSlot = slot ?? inferSlotFromVolumes(volumes);
  const isCandidate = resolvedSlot !== null;
  const resolvedVolumes =
    volumes ?? (isCandidate ? candidateVolumes(resolvedSlot) : baselineVolumes);
  const resolvedNetworks =
    networks ??
    (isCandidate ? candidateNetworks(resolvedSlot) : baselineNetworks);
  if (isCandidate) {
    if (
      !same(resolvedVolumes, candidateVolumes(resolvedSlot)) ||
      !same(resolvedNetworks, candidateNetworks(resolvedSlot))
    )
      reject(
        "Candidate Compose configuration requires exact generation volume and network identities.",
      );
  } else if (
    !same(resolvedVolumes, baselineVolumes) ||
    !same(resolvedNetworks, baselineNetworks)
  ) {
    reject(
      "Baseline Compose configuration requires canonical volume and network identities.",
    );
  }
  const generation = isCandidate ? "candidate" : "baseline";
  const backendServiceNetworks = isCandidate
    ? { backend: null }
    : { default: null };
  const traefikNetworks = isCandidate
    ? { backend: null, ingress: null }
    : { default: null };
  const common = {
    restart: "unless-stopped",
    networks: backendServiceNetworks,
  };
  const hardened = {
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
  };
  const tmpfs = [
    "/tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=1770",
  ];
  const ports = (name) =>
    expectedPortsFor(generation, name).map((entry) => {
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
      ...(ports("postgres").length ? { ports: ports("postgres") } : {}),
      healthcheck: {
        test: ["CMD-SHELL", 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
        interval: "5s",
        timeout: "3s",
        retries: 20,
      },
    },
    migrate: {
      networks: backendServiceNetworks,
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
      restart: "unless-stopped",
      networks: traefikNetworks,
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
      ...(ports("mailpit").length ? { ports: ports("mailpit") } : {}),
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
  const slotLabels = isCandidate
    ? { "info.taskdesk.selection.slot": resolvedSlot }
    : null;
  for (const [name, service] of Object.entries(services)) {
    service.environment = structuredClone(environment[name] || {});
    if (slotLabels) service.labels = structuredClone(slotLabels);
  }
  services.mailpit.environment = { MP_DATABASE: "/data/mailpit.db" };
  return {
    name: localProject,
    services,
    networks: isCandidate
      ? {
          backend: {
            name: resolvedNetworks.backend,
            driver: "bridge",
            internal: true,
            labels: structuredClone(slotLabels),
          },
          ingress: {
            name: resolvedNetworks.ingress,
            driver: "bridge",
            labels: structuredClone(slotLabels),
          },
        }
      : { default: { name: resolvedNetworks.default } },
    volumes: {
      "postgres-data": {
        name: resolvedVolumes.database,
        ...(slotLabels ? { labels: structuredClone(slotLabels) } : {}),
      },
      attachments: {
        name: resolvedVolumes.files,
        ...(slotLabels ? { labels: structuredClone(slotLabels) } : {}),
      },
      "mailpit-data": {
        name: resolvedVolumes.mail,
        ...(slotLabels ? { labels: structuredClone(slotLabels) } : {}),
      },
    },
  };
}

function normalizedSelectionConfig(config, privateDir) {
  const result = structuredClone(config);
  for (const net of Object.values(result.networks || {})) {
    if (same(net?.ipam, {})) delete net.ipam;
    if (net?.internal === false) delete net.internal;
  }
  for (const [name, service] of Object.entries(result.services || {})) {
    if (service.command === null) delete service.command;
    if (service.entrypoint === null) delete service.entrypoint;
    service.environment ??= {};
    // These are presentation defaults emitted by Compose, not override fields.
    for (const binding of service.ports || [])
      if (binding.mode === "ingress") delete binding.mode;
    if (Array.isArray(service.ports) && service.ports.length === 0)
      delete service.ports;
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
    for (const netKey of Object.keys(service.networks || {}))
      if (same(service.networks[netKey], {})) service.networks[netKey] = null;
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

function assertEffectiveContainer(
  container,
  service,
  image,
  postgresPaths,
  expectedNetworkNames,
) {
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
  const serviceName = container.Config.Labels["com.docker.compose.service"];
  if (container.Name !== `/${localProject}-${serviceName}-1`)
    reject("Engine service name differs from canonical Compose.");
  for (const networkName of expectedNetworkNames) {
    const network = container.NetworkSettings?.Networks?.[networkName];
    if (!network)
      reject("Engine service is missing an expected network attachment.");
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
}

function parseDatabaseUrl(rawUrl, expectedUser) {
  let url;
  try {
    url = new URL(rawUrl);
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
  let user;
  let password;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    reject("Invalid local database credentials.");
  }
  if (user !== expectedUser || !password)
    reject("Unexpected local database owner or missing password.");
  return {
    url,
    user,
    password,
    pathname: url.pathname,
    withPassword(nextPassword) {
      const copy = new URL(url.toString());
      copy.password = nextPassword;
      return copy.toString();
    },
  };
}

function parseValkeyUrl(rawUrl, expectedPassword) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    reject("Invalid local Valkey configuration.");
  }
  let password;
  try {
    password = decodeURIComponent(url.password);
  } catch {
    reject("Invalid local Valkey credentials.");
  }
  if (
    !["redis:", "valkey:"].includes(url.protocol) ||
    url.hostname !== "valkey" ||
    (url.port || "6379") !== "6379" ||
    url.search ||
    url.hash ||
    !password ||
    password !== expectedPassword
  )
    reject("Valkey configuration must target Compose valkey with its secret.");
  return {
    password,
    withPassword(nextPassword) {
      const copy = new URL(url.toString());
      copy.password = nextPassword;
      return copy.toString();
    },
  };
}

function extractGenerationSecrets(config) {
  const services = config?.services || {};
  const pgEnv = services.postgres?.environment || {};
  const appEnv = services.taskdesk?.environment || {};
  const migrateEnv = services.migrate?.environment || {};
  const valkeyEnv = services.valkey?.environment || {};
  const pgUser = pgEnv.POSTGRES_USER;
  const pgPassword = pgEnv.POSTGRES_PASSWORD;
  if (
    typeof pgUser !== "string" ||
    !pgUser ||
    pgUser === "taskdesk_app" ||
    typeof pgEnv.POSTGRES_DB !== "string" ||
    !pgEnv.POSTGRES_DB ||
    typeof pgPassword !== "string" ||
    !pgPassword
  )
    reject("Incomplete PostgreSQL bootstrap environment.");
  const appDb = parseDatabaseUrl(appEnv.TASKDESK_DATABASE_URL, "taskdesk_app");
  if (appDb.password === pgPassword)
    reject("Application and migration database passwords must be distinct.");
  const migrateDb = parseDatabaseUrl(
    migrateEnv.TASKDESK_MIGRATION_DATABASE_URL,
    pgUser,
  );
  if (migrateDb.password !== pgPassword)
    reject(
      "Migration database password must match the PostgreSQL owner secret.",
    );
  const migrateAppDb = migrateEnv.TASKDESK_DATABASE_URL
    ? parseDatabaseUrl(migrateEnv.TASKDESK_DATABASE_URL, "taskdesk_app")
    : null;
  if (
    migrateAppDb &&
    migrateEnv.TASKDESK_DATABASE_URL !== appEnv.TASKDESK_DATABASE_URL
  )
    reject(
      "Migration fallback database URL must match the application database URL.",
    );
  const authSecret = appEnv.TASKDESK_AUTH_SECRET;
  const encryptionKey = appEnv.TASKDESK_ENCRYPTION_KEY;
  if (
    !hex.test(authSecret || "") ||
    !hex.test(encryptionKey || "") ||
    authSecret === encryptionKey ||
    Object.hasOwn(appEnv, "TASKDESK_ENCRYPTION_KEY_PREVIOUS")
  )
    reject(
      "Application auth secret and encryption key must be distinct 64-hex secrets without previous-key fallback.",
    );
  const valkeyPassword = valkeyEnv.REDISCLI_AUTH;
  if (typeof valkeyPassword !== "string" || !valkeyPassword)
    reject("Valkey authentication secret is required.");
  const appValkey =
    appEnv.TASKDESK_VALKEY_URL !== undefined
      ? parseValkeyUrl(appEnv.TASKDESK_VALKEY_URL, valkeyPassword)
      : null;
  return {
    pgPassword,
    appDb,
    migrateDb,
    migrateAppDb,
    authSecret,
    encryptionKey,
    valkeyPassword,
    appValkey,
    allValues: new Set([
      pgPassword,
      appDb.password,
      authSecret,
      encryptionKey,
      valkeyPassword,
    ]),
  };
}

function mapEnvironmentSecrets(environment, role, fromSecrets, toSecrets) {
  const next = structuredClone(environment || {});
  if (role === "postgres" && Object.hasOwn(next, "POSTGRES_PASSWORD"))
    next.POSTGRES_PASSWORD = toSecrets.pgPassword;
  if (role === "valkey" && Object.hasOwn(next, "REDISCLI_AUTH"))
    next.REDISCLI_AUTH = toSecrets.valkeyPassword;
  if (role === "taskdesk") {
    if (Object.hasOwn(next, "TASKDESK_DATABASE_URL"))
      next.TASKDESK_DATABASE_URL = fromSecrets.appDb.withPassword(
        toSecrets.appDb.password,
      );
    if (Object.hasOwn(next, "TASKDESK_AUTH_SECRET"))
      next.TASKDESK_AUTH_SECRET = toSecrets.authSecret;
    if (Object.hasOwn(next, "TASKDESK_ENCRYPTION_KEY"))
      next.TASKDESK_ENCRYPTION_KEY = toSecrets.encryptionKey;
    if (Object.hasOwn(next, "TASKDESK_VALKEY_URL") && fromSecrets.appValkey)
      next.TASKDESK_VALKEY_URL = fromSecrets.appValkey.withPassword(
        toSecrets.valkeyPassword,
      );
  }
  if (role === "migrate") {
    if (Object.hasOwn(next, "TASKDESK_MIGRATION_DATABASE_URL"))
      next.TASKDESK_MIGRATION_DATABASE_URL = fromSecrets.migrateDb.withPassword(
        toSecrets.migrateDb.password,
      );
    if (
      Object.hasOwn(next, "TASKDESK_DATABASE_URL") &&
      fromSecrets.migrateAppDb
    )
      next.TASKDESK_DATABASE_URL = fromSecrets.migrateAppDb.withPassword(
        toSecrets.appDb.password,
      );
  }
  return next;
}

function mapContainerEnvList(envList, role, fromSecrets, toSecrets) {
  const entries = {};
  for (const item of envList || []) {
    const split = item.indexOf("=");
    entries[item.slice(0, split)] = item.slice(split + 1);
  }
  const mapped = mapEnvironmentSecrets(entries, role, fromSecrets, toSecrets);
  return Object.entries(mapped)
    .map(([key, value]) => `${key}=${value}`)
    .sort();
}

function mapGenerationValue(
  value,
  {
    fromVolumes,
    toVolumes = baselineVolumes,
    fromPrivateDir,
    toPrivateDir,
    fromNetworkMode,
    toNetworkMode = baselineNetworks.default,
  },
) {
  if (typeof value === "string") {
    let result = value
      .replaceAll(fromVolumes.database, toVolumes.database)
      .replaceAll(fromVolumes.files, toVolumes.files)
      .replaceAll(fromVolumes.mail, toVolumes.mail);
    if (fromPrivateDir && toPrivateDir)
      result = result.replaceAll(
        join(fromPrivateDir, "proxy"),
        join(toPrivateDir, "proxy"),
      );
    if (fromNetworkMode && toNetworkMode && result === fromNetworkMode)
      result = toNetworkMode;
    return result;
  }
  if (Array.isArray(value))
    return value.map((entry) =>
      mapGenerationValue(entry, {
        fromVolumes,
        toVolumes,
        fromPrivateDir,
        toPrivateDir,
        fromNetworkMode,
        toNetworkMode,
      }),
    );
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        mapGenerationValue(entry, {
          fromVolumes,
          toVolumes,
          fromPrivateDir,
          toPrivateDir,
          fromNetworkMode,
          toNetworkMode,
        }),
      ]),
    );
  return value;
}

function assertSelectionDelta(snapshot, original, profile) {
  const baselineSecrets = extractGenerationSecrets(original.config);
  const currentSecrets = extractGenerationSecrets(snapshot.config);
  const isCandidate = profile.generation === "candidate";
  if (isCandidate) {
    if (
      currentSecrets.pgPassword === baselineSecrets.pgPassword ||
      currentSecrets.appDb.password === baselineSecrets.appDb.password ||
      currentSecrets.migrateDb.password ===
        baselineSecrets.migrateDb.password ||
      currentSecrets.authSecret === baselineSecrets.authSecret ||
      currentSecrets.encryptionKey === baselineSecrets.encryptionKey ||
      currentSecrets.valkeyPassword === baselineSecrets.valkeyPassword ||
      [...currentSecrets.allValues].some((secret) =>
        baselineSecrets.allValues.has(secret),
      )
    )
      reject(
        "Candidate generation must rotate all private database, auth, encryption and Valkey secrets.",
      );
    const baselineIds = new Set(original.containers.map((c) => c.Id));
    if (snapshot.containers.some((c) => baselineIds.has(c.Id)))
      reject(
        "Candidate generation cannot share any container identity with baseline.",
      );
    if (
      [
        snapshot.networkInspection?.backend?.Id,
        snapshot.networkInspection?.ingress?.Id,
      ].includes(original.networkInspection?.Id)
    )
      reject(
        "Candidate generation cannot share network identity with baseline.",
      );
  } else if (
    !same(
      snapshot.containers.map((c) => c.Id).sort(),
      original.containers.map((c) => c.Id).sort(),
    ) ||
    snapshot.networkInspection?.Id !== original.networkInspection?.Id
  ) {
    reject(
      "Returned baseline must restore the original container and network identities.",
    );
  }
  const expectedConfig = structuredClone(original.config);
  expectedConfig.services.taskdesk.image = profile.image;
  expectedConfig.services.migrate.image = profile.image;
  const slotLabels = isCandidate
    ? { "info.taskdesk.selection.slot": profile.slot }
    : null;
  for (const role of serviceRoles) {
    expectedConfig.services[role].environment = mapEnvironmentSecrets(
      expectedConfig.services[role].environment,
      role,
      baselineSecrets,
      currentSecrets,
    );
    expectedConfig.services[role].networks = isCandidate
      ? role === "traefik"
        ? { backend: null, ingress: null }
        : { backend: null }
      : { default: null };
    if (slotLabels)
      expectedConfig.services[role].labels = structuredClone(slotLabels);
  }
  if (isCandidate) {
    delete expectedConfig.services.postgres.ports;
    delete expectedConfig.services.mailpit.ports;
    expectedConfig.services.traefik.volumes[0].source = join(
      profile.privateDir,
      "proxy",
    );
    expectedConfig.networks = {
      backend: {
        name: profile.networks.backend,
        driver: "bridge",
        internal: true,
        labels: structuredClone(slotLabels),
      },
      ingress: {
        name: profile.networks.ingress,
        driver: "bridge",
        labels: structuredClone(slotLabels),
      },
    };
    expectedConfig.volumes["postgres-data"].labels =
      structuredClone(slotLabels);
    expectedConfig.volumes.attachments.labels = structuredClone(slotLabels);
    expectedConfig.volumes["mailpit-data"].labels = structuredClone(slotLabels);
  }
  expectedConfig.volumes["postgres-data"].name = profile.volumes.database;
  expectedConfig.volumes.attachments.name = profile.volumes.files;
  expectedConfig.volumes["mailpit-data"].name = profile.volumes.mail;
  if (
    !same(
      normalizedSelectionConfig(snapshot.config, profile.privateDir),
      normalizedSelectionConfig(expectedConfig, profile.privateDir),
    )
  )
    reject(
      "Selection changed configuration outside the planned generation profile.",
    );
  for (const container of snapshot.containers) {
    const role = container.Config?.Labels?.["com.docker.compose.service"];
    const expectedLabels = {
      "com.docker.compose.project": localProject,
      "com.docker.compose.service": role,
      ...(slotLabels || {}),
    };
    if (!same(container.Config?.Labels, expectedLabels))
      reject("Container labels differ from the planned generation profile.");
  }
  const containerProjection = (
    value,
    { volumes, privateDir, networkMode, secrets },
  ) =>
    value.containers
      .map((container) => {
        const role = container.Config.Labels["com.docker.compose.service"];
        const config = withoutRuntimeIdentity(container.Config);
        config.Env = mapContainerEnvList(
          config.Env,
          role,
          secrets,
          baselineSecrets,
        );
        const host = mapGenerationValue(container.HostConfig, {
          fromVolumes: volumes,
          toVolumes: baselineVolumes,
          fromPrivateDir: privateDir,
          toPrivateDir: original.privateDir,
          fromNetworkMode: networkMode,
          toNetworkMode: baselineNetworks.default,
        });
        if (
          isCandidate &&
          volumes !== baselineVolumes &&
          ["postgres", "mailpit"].includes(role)
        ) {
          if (!same(host.PortBindings || {}, {}))
            reject("Candidate backend services must not bind host ports.");
          const baselineContainer = original.containers.find(
            (c) => c.Config.Labels["com.docker.compose.service"] === role,
          );
          host.PortBindings = structuredClone(
            baselineContainer.HostConfig.PortBindings,
          );
        }
        return {
          name: role,
          config,
          host,
          mounts: mapGenerationValue(container.Mounts, {
            fromVolumes: volumes,
            toVolumes: baselineVolumes,
            fromPrivateDir: privateDir,
            toPrivateDir: original.privateDir,
          }).sort((a, b) => a.Destination.localeCompare(b.Destination)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  if (
    !same(
      containerProjection(snapshot, {
        volumes: profile.volumes,
        privateDir: profile.privateDir,
        networkMode: isCandidate
          ? profile.networks.backend
          : baselineNetworks.default,
        secrets: currentSecrets,
      }),
      containerProjection(original, {
        volumes: baselineVolumes,
        privateDir: original.privateDir,
        networkMode: baselineNetworks.default,
        secrets: baselineSecrets,
      }),
    )
  )
    reject(
      "Engine configuration changed outside the planned generation profile.",
    );
  if (!same(snapshot.supportingImages, original.supportingImages))
    reject("Supporting images changed during candidate selection.");
}

// Inputs are raw engine/config inspection evidence, not a boolean attestation.
export function assertSelectionSnapshot(
  snapshot,
  {
    slot = null,
    volumes,
    networks,
    image,
    privateDir,
    baselinePrivateDir = null,
  },
) {
  if (
    !snapshot ||
    !localSocket(snapshot.dockerEndpoint) ||
    !localSocket(snapshot.contextEndpoint)
  )
    reject("Selection requires a local Docker Unix socket.");
  const resolvedSlot = slot ?? inferSlotFromVolumes(volumes);
  const isCandidate = resolvedSlot !== null;
  const profile = isCandidate
    ? candidateGenerationProfile({
        slot: resolvedSlot,
        image,
        privateDir,
        baselinePrivateDir,
      })
    : baselineGenerationProfile({ image, privateDir });
  const resolvedVolumes = volumes ?? profile.volumes;
  const resolvedNetworks = networks ?? profile.networks;
  if (
    !same(resolvedVolumes, profile.volumes) ||
    !same(resolvedNetworks, profile.networks)
  )
    reject(
      "Selected volumes or networks do not match the generation profile contract.",
    );
  const config = snapshot.config;
  if (
    config?.name !== localProject ||
    !same(Object.keys(config.services || {}).sort(), [...serviceRoles])
  )
    reject("Unexpected local project or service set.");
  const expectedComposeSlotLabels = isCandidate
    ? { "info.taskdesk.selection.slot": resolvedSlot }
    : undefined;
  const normalized = normalizedSelectionConfig(config, privateDir);
  const canonical = normalizedSelectionConfig(
    canonicalSelectionConfig({
      image,
      privateDir,
      slot: resolvedSlot,
      volumes: resolvedVolumes,
      networks: resolvedNetworks,
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
  if (isCandidate) {
    const backend = config.networks?.backend;
    const ingress = config.networks?.ingress;
    if (
      !same(Object.keys(config.networks || {}).sort(), [
        "backend",
        "ingress",
      ]) ||
      backend?.name !== resolvedNetworks.backend ||
      backend.driver !== "bridge" ||
      backend.internal !== true ||
      !same(backend.labels, expectedComposeSlotLabels) ||
      backend.external ||
      backend.driver_opts ||
      backend.attachable ||
      ingress?.name !== resolvedNetworks.ingress ||
      ingress.driver !== "bridge" ||
      !same(ingress.labels, expectedComposeSlotLabels) ||
      ingress.internal ||
      ingress.external ||
      ingress.driver_opts ||
      ingress.attachable
    )
      reject(
        "Candidate Compose networks must define an internal bridge backend and bridge ingress.",
      );
  } else if (
    !same(Object.keys(config.networks || {}), ["default"]) ||
    config.networks.default.name !== baselineNetworks.default ||
    config.networks.default.labels ||
    config.networks.default.external ||
    config.networks.default.driver_opts ||
    config.networks.default.internal ||
    config.networks.default.attachable
  ) {
    reject("Unexpected Compose network.");
  }
  for (const [name, service] of Object.entries(config.services)) {
    if (
      service.network_mode ||
      service.privileged ||
      service.volumes_from?.length ||
      service.devices?.length ||
      service.build ||
      service.provider ||
      !same(service.labels, expectedComposeSlotLabels)
    )
      reject("Service isolation is not confirmed.");
    const expectedServiceNetworks = isCandidate
      ? name === "traefik"
        ? ["backend", "ingress"]
        : ["backend"]
      : ["default"];
    if (
      !same(Object.keys(service.networks || {}).sort(), expectedServiceNetworks)
    )
      reject("Service network membership violates the generation contract.");
    if (
      !same(
        portList(service.ports),
        expectedPortsFor(profile.generation, name),
      ) ||
      (service.ports || []).some(
        (binding) => !["127.0.0.1", "::1"].includes(binding.host_ip),
      )
    )
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
    ["postgres-data", resolvedVolumes.database],
    ["attachments", resolvedVolumes.files],
    ["mailpit-data", resolvedVolumes.mail],
  ]) {
    const volume = config.volumes?.[key];
    if (
      volume?.name !== name ||
      !same(volume.labels, expectedComposeSlotLabels) ||
      volume.external ||
      volume.driver_opts ||
      (volume.driver && volume.driver !== "local")
    )
      reject("Unexpected local storage binding.");
    const observed = snapshot.volumeInspection?.filter((v) => v.Name === name);
    const expectedVolumeLabels = {
      "com.docker.compose.project": localProject,
      "com.docker.compose.volume": key,
      ...(volume.labels || {}),
    };
    if (
      observed?.length !== 1 ||
      observed[0].Driver !== "local" ||
      Object.keys(observed[0].Options || {}).length ||
      !same(observed[0].Labels, expectedVolumeLabels) ||
      (isCandidate
        ? observed[0].Labels?.["info.taskdesk.selection.slot"] !== resolvedSlot
        : Boolean(observed[0].Labels?.["info.taskdesk.selection.slot"]))
    )
      reject("Engine volume ownership or local driver is not confirmed.");
  }
  if (
    config.services.taskdesk.image !== image ||
    config.services.migrate.image !== image
  )
    reject("Selected image does not match the plan.");
  extractGenerationSecrets(config);
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
      const parsed = parseDatabaseUrl(
        value,
        name === "TASKDESK_DATABASE_URL"
          ? "taskdesk_app"
          : config.services.postgres.environment?.POSTGRES_USER,
      );
      databaseNames.push(parsed.pathname);
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
  if (
    !Array.isArray(snapshot.containers) ||
    snapshot.containers.length !== runningServiceRoles.length ||
    new Set(snapshot.containers.map((c) => c.Id)).size !==
      runningServiceRoles.length
  )
    reject("Complete engine container inspection is required.");
  const checkNetworkRecord = (
    record,
    { expectedName, key, internal, expectedContainerIds },
  ) => {
    const expectedNetworkLabels = {
      "com.docker.compose.project": localProject,
      "com.docker.compose.network": key,
      ...(config.networks?.[key]?.labels || {}),
    };
    if (
      !record ||
      record.Name !== expectedName ||
      !hex.test(record.Id || "") ||
      record.Driver !== "bridge" ||
      record.Scope !== "local" ||
      record.Internal !== internal ||
      record.Attachable ||
      Object.keys(record.Options || {}).length ||
      !same(record.Labels, expectedNetworkLabels) ||
      (isCandidate
        ? record.Labels?.["info.taskdesk.selection.slot"] !== resolvedSlot
        : Boolean(record.Labels?.["info.taskdesk.selection.slot"])) ||
      !same(
        Object.keys(record.Containers || {}).sort(),
        [...expectedContainerIds].sort(),
      )
    )
      reject(
        "Engine network ownership or complete membership is not confirmed.",
      );
    for (const id of expectedContainerIds) {
      const container = snapshot.containers.find((c) => c.Id === id);
      if (
        !container ||
        record.Containers[id]?.Name !== container.Name.replace(/^\//, "")
      )
        reject("Engine network endpoint name does not match container.");
    }
  };
  const allRunningIds = snapshot.containers.map((container) => container.Id);
  const traefikContainer = snapshot.containers.find(
    (c) => c.Config?.Labels?.["com.docker.compose.service"] === "traefik",
  );
  if (isCandidate) {
    const netInspect = snapshot.networkInspection;
    if (
      !netInspect ||
      !same(Object.keys(netInspect).sort(), ["backend", "ingress"]) ||
      netInspect.backend?.Id === netInspect.ingress?.Id
    )
      reject(
        "Candidate engine network inspection must include distinct backend and ingress networks.",
      );
    checkNetworkRecord(netInspect.backend, {
      expectedName: resolvedNetworks.backend,
      key: "backend",
      internal: true,
      expectedContainerIds: allRunningIds,
    });
    checkNetworkRecord(netInspect.ingress, {
      expectedName: resolvedNetworks.ingress,
      key: "ingress",
      internal: false,
      expectedContainerIds: traefikContainer ? [traefikContainer.Id] : [],
    });
  } else {
    checkNetworkRecord(snapshot.networkInspection, {
      expectedName: baselineNetworks.default,
      key: "default",
      internal: false,
      expectedContainerIds: allRunningIds,
    });
  }
  for (const name of runningServiceRoles) {
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
    const expectedNetworkMode = isCandidate
      ? resolvedNetworks.backend
      : baselineNetworks.default;
    const expectedAttachedNetworks = isCandidate
      ? name === "traefik"
        ? [resolvedNetworks.backend, resolvedNetworks.ingress].sort()
        : [resolvedNetworks.backend]
      : [baselineNetworks.default];
    const expectedServicePorts = expectedPortsFor(profile.generation, name);
    const expectedContainerLabels = {
      "com.docker.compose.project": localProject,
      "com.docker.compose.service": name,
      ...(config.services[name].labels || {}),
    };
    if (
      matches.length !== 1 ||
      !/^[a-f0-9]{64}$/.test(container?.Id || "") ||
      !same(container.Config?.Labels, expectedContainerLabels) ||
      (isCandidate
        ? container.Config?.Labels?.["info.taskdesk.selection.slot"] !==
          resolvedSlot
        : Boolean(
            container.Config?.Labels?.["info.taskdesk.selection.slot"],
          )) ||
      container.State?.Running !== true ||
      container.HostConfig?.NetworkMode !== expectedNetworkMode ||
      container.HostConfig?.Privileged !== false ||
      container.HostConfig?.PublishAllPorts !== false ||
      !same(
        enginePorts(container.HostConfig.PortBindings),
        expectedServicePorts,
      ) ||
      !same(
        enginePorts(container.NetworkSettings?.Ports),
        expectedServicePorts,
      ) ||
      !same(
        Object.keys(container.NetworkSettings?.Networks || {}).sort(),
        expectedAttachedNetworks,
      )
    )
      reject(
        "Engine project, container ownership or port isolation is not confirmed.",
      );
    if (isCandidate) {
      if (
        container.NetworkSettings.Networks[resolvedNetworks.backend]
          ?.NetworkID !== snapshot.networkInspection.backend.Id ||
        (name === "traefik" &&
          container.NetworkSettings.Networks[resolvedNetworks.ingress]
            ?.NetworkID !== snapshot.networkInspection.ingress.Id)
      )
        reject("Engine service is attached to an unexpected network ID.");
    } else if (
      container.NetworkSettings.Networks[baselineNetworks.default]
        ?.NetworkID !== snapshot.networkInspection.Id
    ) {
      reject("Engine service is attached to a different network.");
    }
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
      expectedAttachedNetworks,
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
function assertRuntimeProof(proof, profile) {
  if (
    proof?.project !== localProject ||
    proof.image !== profile.image ||
    !same(proof.volumes, profile.volumes) ||
    (profile.generation === "candidate" &&
      !same(proof.networks, profile.networks)) ||
    proof.healthy !== true ||
    proof.agentOrigin !== "https://ticketing.localhost" ||
    proof.portalOrigin !== "https://portal.localhost"
  )
    reject(
      "Runtime image, mounts, networks, health or origins are not confirmed.",
    );
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
const requiredPrivateFiles = Object.freeze([
  "app.env",
  "migrate.env",
  "postgres.env",
  "proxy",
  "valkey.env",
]);
function assertPrivateFiles(files) {
  if (
    !files ||
    !same(Object.keys(files).sort(), [...requiredPrivateFiles]) ||
    Object.values(files).some((value) => !hex.test(value))
  )
    reject("Private configuration content fingerprints are incomplete.");
}
function assertDisjointPrivateFiles(baselineFiles, candidateFiles) {
  assertPrivateFiles(baselineFiles);
  assertPrivateFiles(candidateFiles);
  const baselineValues = new Set(Object.values(baselineFiles));
  for (const key of requiredPrivateFiles) {
    if (
      candidateFiles[key] === baselineFiles[key] ||
      baselineValues.has(candidateFiles[key])
    )
      reject(
        "Candidate private configuration fingerprints must be distinct from baseline.",
      );
  }
}
function assertBrowserEvidence(
  browser,
  { slot, baselinePrivateDir, candidatePrivateDir, baselineProfileDir },
) {
  if (browser?.passed !== true || !hex.test(browser.evidenceHash || ""))
    reject("Browser window did not produce passing evidence.");
  const isolation = browser.sessionIsolation;
  if (
    !isolation ||
    isolation.slot !== slot ||
    typeof baselineProfileDir !== "string" ||
    !baselineProfileDir ||
    resolve(baselineProfileDir) !== baselineProfileDir ||
    pathOverlaps(baselineProfileDir, baselinePrivateDir) ||
    pathOverlaps(baselineProfileDir, candidatePrivateDir) ||
    typeof isolation.profileDir !== "string" ||
    !isolation.profileDir ||
    resolve(isolation.profileDir) !== isolation.profileDir ||
    pathOverlaps(isolation.profileDir, baselinePrivateDir) ||
    pathOverlaps(isolation.profileDir, candidatePrivateDir) ||
    typeof isolation.baselineProfileDir !== "string" ||
    !isolation.baselineProfileDir ||
    resolve(isolation.baselineProfileDir) !== isolation.baselineProfileDir ||
    isolation.baselineProfileDir !== baselineProfileDir ||
    pathOverlaps(isolation.profileDir, baselineProfileDir) ||
    isolation.ephemeralCookieJar !== true ||
    isolation.sharedBaselineSession !== false ||
    !hex.test(isolation.cookieJarFingerprint || "") ||
    !hex.test(isolation.baselineCookieJarFingerprint || "") ||
    isolation.cookieJarFingerprint === isolation.baselineCookieJarFingerprint
  )
    reject(
      "Candidate browser profile and cookie state isolation is not proven.",
    );
  if (isolation.copiedSessionsInvalidatedByAuthSecretRotation !== false)
    reject(
      "Better Auth copied sessions must not be treated as invalidated by TASKDESK_AUTH_SECRET rotation alone.",
    );
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
const inventoryNetworkCommand = ["network", "ls", "-q", "--no-trunc"];
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
    networks: inventory.networks
      .map((network) => ({
        Id: network.Id,
        Name: network.Name,
        Driver: network.Driver,
        Scope: network.Scope,
        Internal: network.Internal,
        Attachable: Boolean(network.Attachable),
        Options: network.Options || {},
        Labels: network.Labels || {},
        Containers: Object.fromEntries(
          Object.entries(network.Containers || {}).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      }))
      .sort((a, b) => a.Id.localeCompare(b.Id)),
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
    networkIds: inventoryIds(
      client.command(inventoryNetworkCommand),
      /^[a-f0-9]{64}$/,
    ),
  });
  const inspect = ({ ids, names, networkIds }) => {
    const containers = inspectBatch(client, ["inspect"], ids);
    const volumes = inspectBatch(client, ["volume", "inspect"], names);
    const networks = inspectBatch(client, ["network", "inspect"], networkIds);
    if (
      !same(containers.map((value) => value.Id).sort(), ids) ||
      !same(volumes.map((value) => value.Name).sort(), names) ||
      !same(networks.map((value) => value.Id).sort(), networkIds)
    )
      reject("Daemon inventory inspection omitted or duplicated records.");
    if (
      new Set(containers.map((container) => container.Name)).size !==
        containers.length ||
      new Set(networks.map((network) => network.Name)).size !== networks.length
    )
      reject("Daemon container or network names are ambiguous.");
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
    for (const network of networks)
      if (
        typeof network.Name !== "string" ||
        !network.Name ||
        typeof network.Driver !== "string" ||
        typeof network.Scope !== "string" ||
        typeof network.Internal !== "boolean" ||
        !network.Containers ||
        typeof network.Containers !== "object" ||
        Array.isArray(network.Containers)
      )
        reject("Incomplete daemon network record.");
    return { containers, volumes, networks };
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
      (["container", "network"].includes(event.Type) &&
        !/^[a-f0-9]{64}$/.test(event.Actor.ID))
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
function volumeInventoryPolicy({
  baselineImage,
  candidateImage,
  baselinePrivateDir,
  candidatePrivateDir,
  volumes,
  networks,
  slot,
  client,
}) {
  const users = new Map();
  const pinnedVolumes = new Map();
  const pinnedNetworks = new Map();
  const pinnedNetworkById = new Map();
  const templates = new Map();
  let baselineSecrets = null;
  let candidateSecrets = null;
  let initialBound = false;
  let backupComplete = false;
  let candidateReturned = false;
  let baselineStarted = false;
  const phaseHistory = new Map();
  const getPhaseHistory = (phase) => {
    if (!phaseHistory.has(phase)) {
      phaseHistory.set(phase, {
        containers: new Map(),
        networks: new Map(),
      });
    }
    return phaseHistory.get(phase);
  };
  const expectedVolumes = new Map([
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
      baselineVolumes.mail,
      {
        generation: "baseline",
        role: "mailpit",
        target: "/data",
        image: "axllent/mailpit:v1.28",
        key: "mailpit-data",
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
    [
      volumes.mail,
      {
        generation: "candidate",
        role: "mailpit",
        target: "/data",
        image: "axllent/mailpit:v1.28",
        key: "mailpit-data",
      },
    ],
  ]);
  const expectedNetworks = new Map([
    [
      baselineNetworks.default,
      {
        generation: "baseline",
        key: "default",
        internal: false,
      },
    ],
    [
      networks.backend,
      {
        generation: "candidate",
        key: "backend",
        internal: true,
      },
    ],
    [
      networks.ingress,
      {
        generation: "candidate",
        key: "ingress",
        internal: false,
      },
    ],
  ]);
  const roleImages = {
    baseline: {
      postgres: "postgres:18-alpine",
      taskdesk: baselineImage,
      traefik: "traefik:v3.6.7",
      mailpit: "axllent/mailpit:v1.28",
      valkey: "valkey/valkey:9-alpine",
    },
    candidate: {
      postgres: "postgres:18-alpine",
      taskdesk: candidateImage,
      traefik: "traefik:v3.6.7",
      mailpit: "axllent/mailpit:v1.28",
      valkey: "valkey/valkey:9-alpine",
    },
  };
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
  const projection = (container, generation) => {
    const role = container.Config.Labels["com.docker.compose.service"];
    const isCand = generation === "candidate";
    const fromVolumes = isCand ? volumes : baselineVolumes;
    const fromPrivateDir = isCand ? candidatePrivateDir : baselinePrivateDir;
    const fromNetworkMode = isCand
      ? networks.backend
      : baselineNetworks.default;
    const config = withoutRuntimeIdentity(container.Config);
    if (isCand && candidateSecrets && baselineSecrets) {
      config.Env = mapContainerEnvList(
        config.Env,
        role,
        candidateSecrets,
        baselineSecrets,
      );
    } else if (Array.isArray(config.Env)) {
      config.Env = [...config.Env].sort();
    }
    const host = mapGenerationValue(container.HostConfig, {
      fromVolumes,
      toVolumes: baselineVolumes,
      fromPrivateDir,
      toPrivateDir: baselinePrivateDir,
      fromNetworkMode,
      toNetworkMode: baselineNetworks.default,
    });
    if (isCand && ["postgres", "mailpit"].includes(role)) {
      const template = templates.get(role);
      if (template && same(host.PortBindings || {}, {}))
        host.PortBindings = structuredClone(template.HostConfig.PortBindings);
    }
    return {
      config,
      host,
      mounts: mapGenerationValue(namedMounts(container), {
        fromVolumes,
        toVolumes: baselineVolumes,
        fromPrivateDir,
        toPrivateDir: baselinePrivateDir,
      }),
    };
  };
  const extractSecretsFromContainers = (containers) => {
    const envByRole = {};
    for (const container of containers) {
      const role = container.Config?.Labels?.["com.docker.compose.service"];
      if (!role) continue;
      const env = {};
      for (const entry of container.Config?.Env || []) {
        const split = entry.indexOf("=");
        if (split > 0) env[entry.slice(0, split)] = entry.slice(split + 1);
      }
      envByRole[role] = env;
    }
    if (!envByRole.postgres || !envByRole.taskdesk || !envByRole.valkey)
      return null;
    const pgPassword = envByRole.postgres.POSTGRES_PASSWORD;
    const pgUser = envByRole.postgres.POSTGRES_USER;
    const appDb = parseDatabaseUrl(
      envByRole.taskdesk.TASKDESK_DATABASE_URL,
      "taskdesk_app",
    );
    const authSecret = envByRole.taskdesk.TASKDESK_AUTH_SECRET;
    const encryptionKey = envByRole.taskdesk.TASKDESK_ENCRYPTION_KEY;
    const valkeyPassword = envByRole.valkey.REDISCLI_AUTH;
    if (
      typeof pgUser !== "string" ||
      !pgUser ||
      pgUser === "taskdesk_app" ||
      typeof pgPassword !== "string" ||
      !pgPassword ||
      appDb.password === pgPassword ||
      !hex.test(authSecret || "") ||
      !hex.test(encryptionKey || "") ||
      authSecret === encryptionKey ||
      Object.hasOwn(envByRole.taskdesk, "TASKDESK_ENCRYPTION_KEY_PREVIOUS") ||
      typeof valkeyPassword !== "string" ||
      !valkeyPassword
    )
      reject("Incomplete or unsafe service secret configuration in inventory.");
    const appValkey =
      envByRole.taskdesk.TASKDESK_VALKEY_URL !== undefined
        ? parseValkeyUrl(envByRole.taskdesk.TASKDESK_VALKEY_URL, valkeyPassword)
        : null;
    return {
      pgPassword,
      appDb,
      migrateDb: { password: pgPassword, withPassword: () => "" },
      migrateAppDb: null,
      authSecret,
      encryptionKey,
      valkeyPassword,
      appValkey,
      allValues: new Set([
        pgPassword,
        appDb.password,
        authSecret,
        encryptionKey,
        valkeyPassword,
      ]),
    };
  };
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
      baselineSecrets = extractGenerationSecrets(snapshot.config);
      for (const role of runningServiceRoles) {
        const actual = snapshot.containers.find(
          (container) =>
            container.Config.Labels["com.docker.compose.service"] === role,
        );
        if (!actual || !users.has(actual.Id))
          reject(
            "Baseline service container was not observed in the daemon inventory.",
          );
        templates.set(role, structuredClone(actual));
      }
      initialBound = true;
    },
    markBackupComplete() {
      backupComplete = true;
    },
    markCandidateReturned() {
      candidateReturned = true;
    },
    allowBaselineStart() {
      baselineStarted = true;
    },
    validate(inventory, phase, afterAction) {
      const allVolumes = new Map(
        inventory.volumes.map((volume) => [volume.Name, volume]),
      );
      for (const volume of inventory.volumes) {
        if (
          !expectedVolumes.has(volume.Name) &&
          (volume.Name.startsWith(localProject) ||
            volume.Labels?.["com.docker.compose.project"] === localProject ||
            volume.Labels?.["info.taskdesk.selection.slot"])
        )
          reject(
            "An unauthorized project or second-generation volume exists in the daemon inventory.",
          );
      }
      for (const name of Object.values(baselineVolumes))
        if (!allVolumes.has(name))
          reject(
            "A protected baseline volume is missing from the daemon inventory.",
          );
      const roots = new Map();
      for (const [name, profile] of expectedVolumes) {
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
          (profile.generation === "candidate"
            ? volume.Labels?.["info.taskdesk.selection.slot"] !== slot
            : Boolean(volume.Labels?.["info.taskdesk.selection.slot"]))
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
      for (const name of expectedVolumes.keys()) {
        const intended = posix.join(volumeRoot, name, "_data");
        if (
          allVolumes.has(name) &&
          allVolumes.get(name).Mountpoint !== intended
        )
          reject("The protected local volume source layout is not provable.");
        roots.set(name, intended);
      }
      const allNetworks = new Map(
        inventory.networks.map((network) => [network.Name, network]),
      );
      for (const network of inventory.networks) {
        if (
          !expectedNetworks.has(network.Name) &&
          (network.Name.startsWith(localProject) ||
            network.Labels?.["com.docker.compose.project"] === localProject ||
            network.Labels?.["info.taskdesk.selection.slot"])
        )
          reject(
            "An unauthorized project or second-generation network exists in the daemon inventory.",
          );
      }
      if (!allNetworks.has(baselineNetworks.default))
        reject(
          "The protected baseline network is missing from the daemon inventory.",
        );
      for (const [name, profile] of expectedNetworks) {
        const network = allNetworks.get(name);
        if (!network) {
          if (
            profile.generation === "candidate" &&
            pinnedNetworks.has(name) &&
            !(
              (phase === "return-baseline" && afterAction) ||
              candidateReturned ||
              ["start-baseline", "verify-return"].includes(phase)
            )
          )
            reject(
              "A candidate network disappeared before return to baseline.",
            );
          continue;
        }
        if (
          profile.generation === "candidate" &&
          !pinnedNetworks.has(name) &&
          (!initialBound ||
            !["copy-slot", "select-candidate"].includes(phase) ||
            !afterAction)
        )
          reject(
            "A candidate network appeared outside its authorized selection action.",
          );
        if (
          profile.generation === "candidate" &&
          candidateReturned &&
          ["start-baseline", "verify-return"].includes(phase)
        )
          reject(
            "A candidate network remained present after return to baseline.",
          );
        if (
          !hex.test(network.Id || "") ||
          network.Driver !== "bridge" ||
          network.Scope !== "local" ||
          network.Internal !== profile.internal ||
          network.Attachable ||
          Object.keys(network.Options || {}).length ||
          network.Labels?.["com.docker.compose.project"] !== localProject ||
          network.Labels?.["com.docker.compose.network"] !== profile.key ||
          (profile.generation === "candidate"
            ? network.Labels?.["info.taskdesk.selection.slot"] !== slot
            : Boolean(network.Labels?.["info.taskdesk.selection.slot"]))
        )
          reject(
            "Protected daemon network ownership or isolation is not proven.",
          );
        const record = {
          Id: network.Id,
          Name: network.Name,
          Driver: network.Driver,
          Scope: network.Scope,
          Internal: network.Internal,
          Attachable: Boolean(network.Attachable),
          Options: network.Options || {},
          Labels: network.Labels || {},
        };
        if (pinnedNetworks.has(name) && !same(pinnedNetworks.get(name), record))
          reject(
            "A protected network changed identity or options during selection.",
          );
        for (const [otherName, otherRecord] of pinnedNetworks)
          if (otherName !== name && otherRecord.Id === record.Id)
            reject("Protected networks cannot share a daemon network ID.");
        pinnedNetworks.set(name, structuredClone(record));
        pinnedNetworkById.set(record.Id, { name, ...profile });
      }
      const aliases = new Map(
        inventory.volumes.map((volume) => [
          volume.Name,
          new Set(expectedVolumes.has(volume.Name) ? [volume.Name] : []),
        ]),
      );
      for (let pass = 0; pass < inventory.volumes.length; pass++) {
        let changed = false;
        for (const volume of inventory.volumes) {
          const device = volume.Options?.device;
          if (typeof device !== "string" || !posix.isAbsolute(device)) continue;
          if (
            pathOverlaps(device, baselinePrivateDir) ||
            pathOverlaps(device, candidatePrivateDir)
          )
            reject(
              "A local volume device overlaps a protected private configuration directory.",
            );
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
      const candidateContainersInInventory = inventory.containers.filter(
        (c) =>
          c.Config?.Labels?.["com.docker.compose.project"] === localProject &&
          c.Config?.Labels?.["info.taskdesk.selection.slot"] === slot,
      );
      if (candidateContainersInInventory.length && !candidateSecrets) {
        const extracted = extractSecretsFromContainers(
          candidateContainersInInventory,
        );
        if (extracted && baselineSecrets) {
          if (
            extracted.pgPassword === baselineSecrets.pgPassword ||
            extracted.appDb.password === baselineSecrets.appDb.password ||
            extracted.authSecret === baselineSecrets.authSecret ||
            extracted.encryptionKey === baselineSecrets.encryptionKey ||
            extracted.valkeyPassword === baselineSecrets.valkeyPassword ||
            [...extracted.allValues].some((v) =>
              baselineSecrets.allValues.has(v),
            )
          )
            reject(
              "Candidate container secrets overlap baseline container secrets.",
            );
          candidateSecrets = extracted;
        }
      }
      const current = new Map();
      const roleGenerationSeen = new Set();
      for (const container of inventory.containers) {
        if (container.Id === client.id) continue;
        const touchedVolumes = new Set();
        let touchesBaselinePrivate = false;
        let touchesCandidatePrivate = false;
        for (const mount of container.Mounts) {
          if (mount.Type === "volume" && expectedVolumes.has(mount.Name))
            touchedVolumes.add(mount.Name);
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
            for (const name of aliases.get(alias.Name))
              touchedVolumes.add(name);
          for (const volume of inventory.volumes)
            if (mount.Source && pathOverlaps(mount.Source, volume.Mountpoint))
              for (const name of aliases.get(volume.Name))
                touchedVolumes.add(name);
          for (const [name, root] of roots)
            if (
              (mount.Source && pathOverlaps(mount.Source, root)) ||
              (typeof alias?.Options?.device === "string" &&
                posix.isAbsolute(alias.Options.device) &&
                pathOverlaps(alias.Options.device, root))
            )
              touchedVolumes.add(name);
          if (mount.Source && pathOverlaps(mount.Source, baselinePrivateDir))
            touchesBaselinePrivate = true;
          if (mount.Source && pathOverlaps(mount.Source, candidatePrivateDir))
            touchesCandidatePrivate = true;
        }
        const attachedNetworks = Object.keys(
          container.NetworkSettings?.Networks || {},
        );
        const touchesProtectedNetwork =
          attachedNetworks.some(
            (netName) =>
              expectedNetworks.has(netName) || netName.startsWith(localProject),
          ) ||
          expectedNetworks.has(container.HostConfig?.NetworkMode) ||
          String(container.HostConfig?.NetworkMode || "").startsWith(
            localProject,
          ) ||
          inventory.networks.some(
            (net) =>
              expectedNetworks.has(net.Name) &&
              Object.hasOwn(net.Containers || {}, container.Id),
          );
        const hasProjectIdentity =
          container.Config.Labels?.["com.docker.compose.project"] ===
            localProject ||
          Boolean(container.Config.Labels?.["info.taskdesk.selection.slot"]) ||
          container.Name.startsWith(`/${localProject}`);
        if (
          !touchedVolumes.size &&
          !touchesBaselinePrivate &&
          !touchesCandidatePrivate &&
          !touchesProtectedNetwork &&
          !hasProjectIdentity
        ) {
          if (users.has(container.Id))
            reject(
              "A registered project container lost its protected identity or mount evidence.",
            );
          continue;
        }
        const containerSlot =
          container.Config.Labels?.["info.taskdesk.selection.slot"] ?? null;
        if (containerSlot !== null && containerSlot !== slot)
          reject(
            "An unauthorized second-generation container exists in the daemon inventory.",
          );
        const generation = containerSlot === slot ? "candidate" : "baseline";
        const role = container.Config.Labels?.["com.docker.compose.service"];
        if (
          container.Config.Labels?.["com.docker.compose.project"] !==
            localProject ||
          !runningServiceRoles.includes(role) ||
          container.Config.Image !== roleImages[generation][role]
        )
          reject(
            "An unauthorized container uses a protected volume, network or private path.",
          );
        const roleKey = `${generation}:${role}`;
        if (roleGenerationSeen.has(roleKey))
          reject("Duplicate service container for the same generation.");
        roleGenerationSeen.add(roleKey);
        const genVolumes =
          generation === "candidate" ? volumes : baselineVolumes;
        const genPrivateDir =
          generation === "candidate" ? candidatePrivateDir : baselinePrivateDir;
        if (["postgres", "taskdesk", "mailpit"].includes(role)) {
          const expectedVolName =
            role === "postgres"
              ? genVolumes.database
              : role === "taskdesk"
                ? genVolumes.files
                : genVolumes.mail;
          const profile = expectedVolumes.get(expectedVolName);
          if (
            touchedVolumes.size !== 1 ||
            !touchedVolumes.has(expectedVolName) ||
            touchesBaselinePrivate ||
            touchesCandidatePrivate ||
            container.Mounts.length !== 1 ||
            container.Mounts[0].Type !== "volume" ||
            container.Mounts[0].Name !== expectedVolName ||
            container.Mounts[0].Source !== roots.get(expectedVolName) ||
            container.Mounts[0].Destination !== profile.target ||
            container.Mounts[0].RW !== true
          )
            reject("An unauthorized container uses a protected volume.");
        } else if (role === "traefik") {
          const expectedSource = join(genPrivateDir, "proxy");
          if (
            touchedVolumes.size !== 0 ||
            (generation === "baseline"
              ? !touchesBaselinePrivate || touchesCandidatePrivate
              : !touchesCandidatePrivate || touchesBaselinePrivate) ||
            container.Mounts.length !== 1 ||
            container.Mounts[0].Type !== "bind" ||
            container.Mounts[0].Source !== expectedSource ||
            container.Mounts[0].Destination !== "/config" ||
            container.Mounts[0].RW !== false
          )
            reject("Traefik proxy mount violates generation isolation.");
        } else if (role === "valkey") {
          if (
            touchedVolumes.size !== 0 ||
            touchesBaselinePrivate ||
            touchesCandidatePrivate ||
            container.Mounts.length !== 0
          )
            reject("Valkey container must not mount volumes or host paths.");
        }
        const expectedNetworkMode =
          generation === "candidate"
            ? networks.backend
            : baselineNetworks.default;
        const expectedActiveNetworks =
          generation === "candidate"
            ? role === "traefik"
              ? [networks.backend, networks.ingress].sort()
              : [networks.backend]
            : [baselineNetworks.default];
        const canonicalName = `/${localProject}-${role}-1`;
        const retainedName = `${canonicalName}-${generation === "baseline" ? "retained" : "candidate"}-${slot}`;
        const isRetainedStopped =
          container.Name === retainedName && !container.State.Running;
        if (
          container.HostConfig.NetworkMode !== expectedNetworkMode ||
          (isRetainedStopped
            ? attachedNetworks.length !== 0
            : !same([...attachedNetworks].sort(), expectedActiveNetworks))
        )
          reject(
            "An unauthorized container network mode or attachment was observed.",
          );
        for (const netName of attachedNetworks) {
          const pinnedNet = pinnedNetworks.get(netName);
          const attachment = container.NetworkSettings?.Networks?.[netName];
          if (
            !pinnedNet ||
            attachment?.NetworkID !== pinnedNet.Id ||
            (attachment.Aliases || []).some(
              (alias) =>
                alias !== role && alias !== container.Name.replace(/^\//, ""),
            ) ||
            (attachment.Links || []).length ||
            (attachment.DriverOpts && Object.keys(attachment.DriverOpts).length)
          )
            reject(
              "Container network identity, alias or routing violates the generation contract.",
            );
        }
        const expectedRolePorts = expectedPortsFor(generation, role);
        if (
          container.HostConfig.Privileged !== false ||
          container.HostConfig.PublishAllPorts !== false ||
          !same(
            enginePorts(container.HostConfig.PortBindings),
            expectedRolePorts,
          ) ||
          (container.State.Running &&
            !same(
              enginePorts(container.NetworkSettings?.Ports),
              expectedRolePorts,
            ))
        )
          reject(
            "Container host port bindings violate the generation contract.",
          );
        const primaryVolumeName =
          role === "postgres"
            ? genVolumes.database
            : role === "taskdesk"
              ? genVolumes.files
              : role === "mailpit"
                ? genVolumes.mail
                : `${generation}:${role}`;
        const known = users.get(container.Id);
        if (!known) {
          if (
            container.Name !== canonicalName ||
            (generation === "baseline"
              ? initialBound
              : !initialBound ||
                !["copy-slot", "select-candidate"].includes(phase) ||
                !afterAction)
          )
            reject(
              "An unregistered container uses a protected volume or network, including stopped users.",
            );
          if (generation === "candidate") {
            const template = templates.get(role);
            if (
              !template ||
              !candidateSecrets ||
              !same(
                projection(container, "candidate"),
                projection(template, "baseline"),
              )
            )
              reject(
                "A new candidate container differs from its frozen canonical profile.",
              );
            if (role !== "taskdesk" && container.Image !== template.Image)
              reject("Candidate supporting service image identity changed.");
            if (role === "taskdesk") {
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
            name: primaryVolumeName,
            profile: { generation, role },
            frozen: projection(container, generation),
          });
        } else if (
          known.name !== primaryVolumeName ||
          known.imageId !== container.Image ||
          !same(known.frozen, projection(container, generation))
        )
          reject(
            "A registered container changed mounts, secrets or execution configuration.",
          );
        if (container.Name !== canonicalName && !isRetainedStopped)
          reject(
            "A retained container has an unexpected name or is still running.",
          );
        if (
          generation === "baseline" &&
          role === "taskdesk" &&
          (backupComplete || (phase === "backup" && afterAction)) &&
          !baselineStarted &&
          container.State.Running
        )
          reject(
            "A baseline application writer restarted before return proof.",
          );
        if (
          generation === "baseline" &&
          ["inspect-candidate", "browser-window"].includes(phase) &&
          (container.State.Running || container.Name !== retainedName)
        )
          reject(
            "A baseline container remained active or unisolated during candidate selection.",
          );
        if (
          generation === "baseline" &&
          role === "taskdesk" &&
          phase === "return-baseline" &&
          !afterAction &&
          (container.State.Running || container.Name !== retainedName)
        )
          reject(
            "Baseline application writer was not isolated before return to baseline.",
          );
        if (
          generation === "baseline" &&
          ["verify-return"].includes(phase) &&
          (!container.State.Running || container.Name !== canonicalName)
        )
          reject(
            "Baseline service was not restored to running canonical state.",
          );
        if (
          generation === "candidate" &&
          role === "taskdesk" &&
          phase === "copy-slot" &&
          container.State.Running
        )
          reject("The candidate application started before copy verification.");
        if (
          generation === "candidate" &&
          ["inspect-candidate", "browser-window"].includes(phase) &&
          (!container.State.Running || container.Name !== canonicalName)
        )
          reject(
            "A candidate service container is not running in canonical state during candidate selection.",
          );
        if (
          generation === "candidate" &&
          candidateReturned &&
          ["start-baseline", "verify-return"].includes(phase)
        )
          reject(
            "A candidate container remained present after return to baseline.",
          );
        current.set(container.Id, {
          generation,
          role,
          name: primaryVolumeName,
          running: container.State.Running,
        });
      }
      if (
        ["inspect-candidate", "browser-window"].includes(phase) &&
        runningServiceRoles.some(
          (role) =>
            !roleGenerationSeen.has(`candidate:${role}`) ||
            !roleGenerationSeen.has(`baseline:${role}`),
        )
      )
        reject(
          "Expected baseline and candidate generation containers are incomplete during candidate selection.",
        );
      for (const [netName, netProfile] of expectedNetworks) {
        const net = allNetworks.get(netName);
        if (!net) continue;
        const expectedConnectedIds = inventory.containers
          .filter((container) =>
            Object.hasOwn(container.NetworkSettings?.Networks || {}, netName),
          )
          .map((container) => container.Id)
          .sort();
        const actualConnectedIds = Object.keys(net.Containers || {}).sort();
        if (!same(actualConnectedIds, expectedConnectedIds))
          reject(
            "Network endpoint membership disagrees with inspected container network attachments.",
          );
        for (const id of actualConnectedIds) {
          const entry = current.get(id);
          const container = inventory.containers.find((c) => c.Id === id);
          if (
            !entry ||
            entry.generation !== netProfile.generation ||
            (netProfile.key === "ingress" && entry.role !== "traefik") ||
            net.Containers[id]?.Name !== container.Name.replace(/^\//, "")
          )
            reject(
              "An unauthorized or foreign endpoint is attached to a protected network.",
            );
        }
      }
      if (
        [...current.values()].some(
          (value) => value.generation === "candidate" && value.running,
        ) &&
        [...current.values()].some(
          (value) => value.generation === "baseline" && value.running,
        )
      )
        reject("Baseline and candidate generations overlap.");
      return current;
    },
    auditEvents(events, before, after, current, phase, afterAction = false) {
      const beforeIds = inventoryMap(before || after);
      const afterIds = inventoryMap(after);
      const beforeNets = new Map(
        (before || after).networks.map((network) => [network.Id, network]),
      );
      const afterNets = new Map(
        after.networks.map((network) => [network.Id, network]),
      );
      const containerStates = new Map();
      for (const [id, c] of beforeIds) {
        containerStates.set(id, {
          exists: true,
          running: Boolean(c.State?.Running),
          paused: Boolean(c.State?.Paused),
          name: c.Name.replace(/^\//, ""),
        });
      }
      const networkStates = new Map();
      for (const [id, n] of beforeNets) {
        networkStates.set(id, {
          exists: true,
          name: n.Name,
          members: new Set(Object.keys(n.Containers || {})),
        });
      }
      const history = getPhaseHistory(phase);
      const containerHist = (id) => {
        if (!history.containers.has(id)) {
          history.containers.set(id, {
            created: 0,
            destroyed: 0,
            started: 0,
            stopped: 0,
            stopActionRank: 0,
            renamed: 0,
            paused: 0,
            unpaused: 0,
          });
        }
        return history.containers.get(id);
      };
      const netMemberHist = (netKey, containerId) => {
        const key = `${netKey}:${containerId}`;
        if (!history.networks.has(key)) {
          history.networks.set(key, { connected: 0, disconnected: 0 });
        }
        return history.networks.get(key);
      };
      const stopSequenceOrder = { kill: 1, die: 2, stop: 3 };
      const assertNoReplayedOverlap = () => {
        let baselineRunning = false;
        let candidateRunning = false;
        for (const [id, st] of containerStates) {
          if (id === client.id || !st.exists || !st.running) continue;
          const u = users.get(id);
          if (!u) continue;
          if (u.profile.generation === "baseline") baselineRunning = true;
          if (u.profile.generation === "candidate") candidateRunning = true;
        }
        if (baselineRunning && candidateRunning)
          reject("Baseline and candidate generations overlap.");
        if (phase === "select-candidate" && candidateRunning) {
          for (const [id, st] of containerStates) {
            if (id === client.id || !st.exists) continue;
            const u = users.get(id);
            if (u?.profile.generation !== "baseline") continue;
            const expectedRetained = `${localProject}-${u.profile.role}-1-retained-${slot}`;
            const defaultNetState = networkStates.get(
              pinnedNetworks.get(baselineNetworks.default)?.Id,
            );
            if (
              st.running ||
              st.name !== expectedRetained ||
              defaultNetState?.members.has(id)
            )
              reject(
                "A candidate container started before all baseline containers were stopped, disconnected and retained.",
              );
          }
        }
        if (phase === "return-baseline" && baselineRunning) {
          for (const [id, st] of containerStates) {
            if (id === client.id || !st.exists) continue;
            const u = users.get(id);
            if (u?.profile.generation !== "candidate") continue;
            reject(
              "A baseline container started before all candidate containers were destroyed.",
            );
          }
          for (const [netId, netSt] of networkStates) {
            if (!netSt.exists) continue;
            const tracked = pinnedNetworkById.get(netId);
            if (tracked?.generation === "candidate")
              reject(
                "A baseline container started before candidate networks were destroyed.",
              );
          }
        }
      };
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
      const networkTransitions = new Set([
        "create",
        "connect",
        "disconnect",
        "destroy",
        "remove",
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
            ["backup", "copy-slot"].includes(phase) &&
            afterAction
          )
            continue;
          if (!transitions.has(event.Action) || !afterAction)
            reject(
              "An unexpected container lifecycle change crossed the protected action.",
            );
          const { generation, role } = authorized.profile;
          const state = containerStates.get(event.Actor.ID) || {
            exists: false,
            running: false,
            paused: false,
            name: "",
          };
          const h = containerHist(event.Actor.ID);
          const canonicalBareName = `${localProject}-${role}-1`;
          const retainedBareName = `${canonicalBareName}-${generation === "baseline" ? "retained" : "candidate"}-${slot}`;
          if (["pause", "unpause", "restart"].includes(event.Action))
            reject(
              "An unexpected container lifecycle change crossed the protected action.",
            );
          if (event.Action === "create") {
            if (
              generation !== "candidate" ||
              !["copy-slot", "select-candidate"].includes(phase) ||
              state.exists ||
              h.created > 0 ||
              !afterIds.has(event.Actor.ID)
            )
              reject(
                "A transient volume user has no complete daemon inspection proof.",
              );
            state.exists = true;
            state.running = false;
            state.paused = false;
            state.name = event.Actor.Attributes?.name || canonicalBareName;
            containerStates.set(event.Actor.ID, state);
            h.created++;
          } else if (event.Action === "destroy") {
            if (
              generation !== "candidate" ||
              phase !== "return-baseline" ||
              !state.exists ||
              state.running ||
              h.destroyed > 0 ||
              afterIds.has(event.Actor.ID)
            )
              reject(
                "A container destruction event disagrees with the complete inventory.",
              );
            for (const netState of networkStates.values()) {
              if (netState.exists && netState.members.has(event.Actor.ID))
                reject(
                  "A container was destroyed while still attached to a protected network.",
                );
            }
            state.exists = false;
            h.destroyed++;
          } else if (event.Action === "start") {
            const startAllowed =
              generation === "candidate"
                ? role === "taskdesk"
                  ? phase === "select-candidate"
                  : ["copy-slot", "select-candidate"].includes(phase)
                : phase === "return-baseline"
                  ? role !== "taskdesk"
                  : phase === "start-baseline"
                    ? role === "taskdesk"
                    : false;
            if (
              !startAllowed ||
              !state.exists ||
              state.running ||
              h.started > 0 ||
              state.name !== canonicalBareName
            )
              reject(
                "An unexpected container lifecycle change crossed the protected action.",
              );
            state.running = true;
            h.started++;
          } else if (["stop", "die", "kill"].includes(event.Action)) {
            const stopAllowed =
              generation === "baseline"
                ? role === "taskdesk"
                  ? phase === "backup"
                  : phase === "select-candidate"
                : phase === "return-baseline" ||
                  (phase === "copy-slot" && role !== "taskdesk");
            const actionRank = stopSequenceOrder[event.Action];
            const isInitialStopEvent = state.running && h.stopped === 0;
            const isFollowupStopEvent =
              !state.running &&
              h.stopped === 1 &&
              h.stopActionRank > 0 &&
              actionRank > h.stopActionRank &&
              h.renamed === 0 &&
              h.destroyed === 0;
            if (
              !stopAllowed ||
              !state.exists ||
              (!isInitialStopEvent && !isFollowupStopEvent)
            )
              reject(
                "An unexpected container lifecycle change crossed the protected action.",
              );
            state.running = false;
            if (isInitialStopEvent) h.stopped = 1;
            h.stopActionRank = actionRank;
          } else if (event.Action === "rename") {
            const expectedNewName =
              phase === "select-candidate"
                ? retainedBareName
                : phase === "return-baseline"
                  ? canonicalBareName
                  : null;
            const expectedOldName =
              phase === "select-candidate"
                ? canonicalBareName
                : phase === "return-baseline"
                  ? retainedBareName
                  : null;
            const observedNewName = event.Actor.Attributes?.name;
            if (
              generation !== "baseline" ||
              !expectedNewName ||
              !state.exists ||
              state.running ||
              h.renamed > 0 ||
              state.name !== expectedOldName ||
              observedNewName !== expectedNewName
            )
              reject(
                "An unexpected container lifecycle change crossed the protected action.",
              );
            state.name = observedNewName;
            h.renamed++;
          }
          assertNoReplayedOverlap();
        } else if (
          event.Type === "volume" &&
          (expectedVolumes.has(event.Actor.ID) ||
            event.Actor.ID.startsWith(localProject))
        ) {
          if (!expectedVolumes.has(event.Actor.ID))
            reject(
              "An unauthorized project or second-generation volume lifecycle event occurred.",
            );
          if (
            event.Action === "create" &&
            expectedVolumes.get(event.Actor.ID).generation === "candidate" &&
            phase === "copy-slot" &&
            afterAction
          ) {
            assertNoReplayedOverlap();
            continue;
          }
          if (
            ["mount", "unmount"].includes(event.Action) &&
            [
              "backup",
              "copy-slot",
              "select-candidate",
              "return-baseline",
              "start-baseline",
            ].includes(phase) &&
            afterAction
          ) {
            assertNoReplayedOverlap();
            continue;
          }
          reject("An unexpected protected-volume lifecycle event occurred.");
        } else if (event.Type === "network") {
          const tracked =
            pinnedNetworkById.get(event.Actor.ID) ||
            beforeNets.get(event.Actor.ID) ||
            afterNets.get(event.Actor.ID);
          if (
            !tracked ||
            !expectedNetworks.has(tracked.name || tracked.Name) ||
            !networkTransitions.has(event.Action) ||
            !afterAction
          )
            reject(
              "An unauthorized or transient network lifecycle event occurred during selection.",
            );
          const netName = tracked.name || tracked.Name;
          const netProfile = expectedNetworks.get(netName);
          let netState = networkStates.get(event.Actor.ID);
          if (event.Action === "create") {
            if (
              netProfile.generation !== "candidate" ||
              !["copy-slot", "select-candidate"].includes(phase) ||
              netState?.exists ||
              !afterNets.has(event.Actor.ID)
            )
              reject(
                "An unexpected or transient network creation event occurred.",
              );
            netState = {
              exists: true,
              name: netName,
              members: new Set(),
            };
            networkStates.set(event.Actor.ID, netState);
          } else if (["destroy", "remove"].includes(event.Action)) {
            if (
              netProfile.generation !== "candidate" ||
              phase !== "return-baseline" ||
              !netState?.exists ||
              netState.members.size > 0 ||
              afterNets.has(event.Actor.ID)
            )
              reject("An unexpected network destruction event occurred.");
            netState.exists = false;
          } else if (["connect", "disconnect"].includes(event.Action)) {
            const containerId = event.Actor.Attributes?.container;
            const authorized = containerId ? users.get(containerId) : null;
            const isBackupQuiesceDisconnect =
              event.Action === "disconnect" &&
              phase === "backup" &&
              authorized?.profile.generation === "baseline" &&
              authorized?.profile.role === "taskdesk" &&
              netProfile.generation === "baseline" &&
              netProfile.key === "default";
            if (
              !authorized ||
              !netState?.exists ||
              authorized.profile.generation !== netProfile.generation ||
              (netProfile.key === "ingress" &&
                authorized.profile.role !== "traefik") ||
              (!controlled.has(phase) && !isBackupQuiesceDisconnect)
            )
              reject(
                "An unauthorized or transient endpoint connected to or disconnected from a protected network.",
              );
            const cState = containerStates.get(containerId);
            const cHist = containerHist(containerId);
            const nh = netMemberHist(netName, containerId);
            const { generation, role } = authorized.profile;
            const canonicalBareName = `${localProject}-${role}-1`;
            if (event.Action === "connect") {
              const connectAllowed =
                generation === "candidate"
                  ? ["copy-slot", "select-candidate"].includes(phase)
                  : phase === "return-baseline";
              if (
                !connectAllowed ||
                !cState?.exists ||
                cState.running ||
                cState.name !== canonicalBareName ||
                netState.members.has(containerId) ||
                nh.connected > 0 ||
                nh.disconnected > 0
              )
                reject(
                  "An unauthorized or transient endpoint connected to or disconnected from a protected network.",
                );
              netState.members.add(containerId);
              nh.connected++;
            } else {
              const disconnectAllowed =
                generation === "baseline"
                  ? phase === "select-candidate" ||
                    (isBackupQuiesceDisconnect &&
                      cState?.name === canonicalBareName &&
                      cHist.stopped === 1 &&
                      cHist.stopActionRank >= stopSequenceOrder.die &&
                      cHist.stopActionRank < stopSequenceOrder.stop)
                  : phase === "return-baseline";
              if (
                !disconnectAllowed ||
                !cState?.exists ||
                cState.running ||
                !netState.members.has(containerId) ||
                nh.disconnected > 0 ||
                nh.connected > 0
              )
                reject(
                  "An unauthorized or transient endpoint connected to or disconnected from a protected network.",
                );
              if (!isBackupQuiesceDisconnect)
                netState.members.delete(containerId);
              nh.disconnected++;
            }
          }
          assertNoReplayedOverlap();
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
        if (id === client.id) continue;
        const state = containerStates.get(id);
        if (
          !state?.exists ||
          state.running !== Boolean(container.State?.Running) ||
          state.paused !== Boolean(container.State?.Paused) ||
          state.name !== container.Name.replace(/^\//, "")
        )
          reject(
            "Inventory state does not reflect the replayed lifecycle events.",
          );
      }
      for (const [id, state] of containerStates) {
        if (id === client.id) continue;
        if (state.exists && !afterIds.has(id))
          reject(
            "A daemon container disappeared without authorized destruction proof.",
          );
      }
      for (const network of after.networks) {
        if (!beforeNets.has(network.Id)) {
          if (
            !expectedNetworks.has(network.Name) ||
            !["copy-slot", "select-candidate"].includes(phase) ||
            !events.some(
              (event) =>
                event.Type === "network" &&
                event.Actor.ID === network.Id &&
                event.Action === "create",
            )
          )
            reject("A new daemon network has no authorized lifecycle proof.");
        }
      }
      for (const network of beforeNets.values()) {
        if (!afterNets.has(network.Id)) {
          if (
            !expectedNetworks.has(network.Name) ||
            expectedNetworks.get(network.Name).generation !== "candidate" ||
            phase !== "return-baseline" ||
            !events.some(
              (event) =>
                event.Type === "network" &&
                event.Actor.ID === network.Id &&
                ["destroy", "remove"].includes(event.Action),
            )
          )
            reject(
              "A daemon network disappeared without authorized destruction proof.",
            );
        }
      }
      for (const [netId, afterNet] of afterNets) {
        if (!expectedNetworks.has(afterNet.Name)) continue;
        const netState = networkStates.get(netId);
        const afterMembers = new Set(Object.keys(afterNet.Containers || {}));
        if (
          !netState?.exists ||
          !same([...netState.members].sort(), [...afterMembers].sort())
        )
          reject(
            "Network endpoint inventory does not reflect the replayed connect/disconnect events.",
          );
      }
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
  const baselineProfile = baselineGenerationProfile({
    image: frozenPlan.baselineImage,
    privateDir: frozenPlan.privateDir,
  });
  const candidatePrivateDir =
    frozenPlan.candidate?.privateDir ?? frozenPlan.candidatePrivateDir;
  const candidateProfile = candidateGenerationProfile({
    slot: frozenPlan.slot,
    image: frozenPlan.candidate?.image,
    privateDir: candidatePrivateDir,
    baselinePrivateDir: baselineProfile.privateDir,
  });
  const volumes = candidateProfile.volumes;
  const networks = candidateProfile.networks;
  const candidateImage = candidateProfile.image;
  const lease = acquireProjectSelectionLease({ directory });
  const journal = join(lease.lock, "journal.jsonl");
  let sequence = 0;
  let daemonLease;
  let privateFiles;
  let candidatePrivateFiles;
  let baselineProfileDir;
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
    assertDisjointPrivateFiles(
      observed.privateFiles,
      observed.candidatePrivateFiles,
    );
    if (
      (privateFiles && !same(privateFiles, observed.privateFiles)) ||
      (candidatePrivateFiles &&
        !same(candidatePrivateFiles, observed.candidatePrivateFiles))
    )
      reject("Private configuration content changed during selection.");
    if (
      typeof observed.baselineProfileDir !== "string" ||
      !observed.baselineProfileDir ||
      resolve(observed.baselineProfileDir) !== observed.baselineProfileDir ||
      pathOverlaps(observed.baselineProfileDir, baselineProfile.privateDir) ||
      pathOverlaps(observed.baselineProfileDir, candidateProfile.privateDir) ||
      (frozenPlan.baselineProfileDir !== undefined &&
        observed.baselineProfileDir !== frozenPlan.baselineProfileDir) ||
      (baselineProfileDir && observed.baselineProfileDir !== baselineProfileDir)
    )
      reject(
        "Baseline browser profile directory is missing, invalid or changed during selection.",
      );
    privateFiles ??= structuredClone(observed.privateFiles);
    candidatePrivateFiles ??= structuredClone(observed.candidatePrivateFiles);
    baselineProfileDir ??= observed.baselineProfileDir;
    const current = inventoryPolicy.validate(inventory, phase, afterAction);
    const window = advanceEventFence(daemonLease, eventCursor);
    inventoryPolicy.auditEvents(
      window.events,
      lastInventory,
      inventory,
      current,
      phase,
      afterAction,
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
      baselinePrivateDir: baselineProfile.privateDir,
      candidatePrivateDir: candidateProfile.privateDir,
      volumes,
      networks,
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
      baselinePrivateDir: baselineProfile.privateDir,
      candidatePrivateDir: candidateProfile.privateDir,
      volumes,
      networks,
      slot: frozenPlan.slot,
      client: daemonLease,
    });
    eventCursor = beginEventFence(daemonLease);
    await assertBoundary();
    record("daemon-lease-owned", {
      containerId: daemonLease.id,
      identity: daemonLease.identity,
      privateFiles,
      candidatePrivateFiles,
      baselineProfileDir,
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
    if (
      initial.baselineProfileDir !== undefined &&
      initial.baselineProfileDir !== baselineProfileDir
    )
      reject(
        "Baseline snapshot browser profile directory disagrees with frozen boundary.",
      );
    assertSelectionSnapshot(initial, {
      slot: null,
      volumes: baselineVolumes,
      networks: baselineNetworks,
      image: baselineProfile.image,
      privateDir: baselineProfile.privateDir,
    });
    assertRuntimeProof(initial.runtime, baselineProfile);
    inventoryPolicy.bindInitial(initial, lastInventory);
    const original = {
      ...structuredClone(initial),
      privateDir: baselineProfile.privateDir,
    };
    if (
      !Array.isArray(initial.existingVolumeNames) ||
      Object.values(volumes).some((v) =>
        initial.existingVolumeNames.includes(v),
      ) ||
      (Array.isArray(initial.existingNetworkNames) &&
        Object.values(networks).some((n) =>
          initial.existingNetworkNames.includes(n),
        ))
    )
      reject(
        "Candidate slot already exists or volume/network inventory is unavailable.",
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
        networks,
        slot: frozenPlan.slot,
        backup: structuredClone(backup),
      }),
    );
    const volumeKeyMap = {
      database: "postgres-data",
      files: "attachments",
      mail: "mailpit-data",
    };
    for (const [key, name] of Object.entries(volumes)) {
      const volume = created?.[key];
      if (
        volume?.Name !== name ||
        volume.Driver !== "local" ||
        Object.keys(volume.Options || {}).length ||
        volume.Labels?.["info.taskdesk.selection.slot"] !== frozenPlan.slot ||
        volume.Labels?.["com.docker.compose.project"] !== localProject ||
        volume.Labels?.["com.docker.compose.volume"] !== volumeKeyMap[key]
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
      adapter.selectCandidate({
        ...context,
        slot: frozenPlan.slot,
        image: candidateImage,
        privateDir: candidateProfile.privateDir,
        volumes,
        networks,
      }),
    );
    const candidate = await step("inspect-candidate", (context) =>
      adapter.inspectCandidate(context),
    );
    assertSnapshotIdentity(candidate, daemonLease.identity);
    if (
      candidate.privateFiles !== undefined &&
      !same(candidate.privateFiles, candidatePrivateFiles)
    )
      reject(
        "Candidate snapshot private files differ from the frozen candidate configuration.",
      );
    assertSelectionSnapshot(candidate, {
      slot: frozenPlan.slot,
      volumes,
      networks,
      image: candidateImage,
      privateDir: candidateProfile.privateDir,
      baselinePrivateDir: baselineProfile.privateDir,
    });
    inventoryPolicy.matchSnapshot(candidate, lastInventory);
    assertRuntimeProof(candidate.runtime, candidateProfile);
    assertSelectionDelta(candidate, original, candidateProfile);
    const browser = await step("browser-window", (context) =>
      adapter.browserWindow({
        ...context,
        slot: frozenPlan.slot,
        volumes,
        networks,
      }),
    );
    assertBrowserEvidence(browser, {
      slot: frozenPlan.slot,
      baselinePrivateDir: baselineProfile.privateDir,
      candidatePrivateDir: candidateProfile.privateDir,
      baselineProfileDir,
    });
    // Explicit return is the normal successful path. No rollback is attempted on failure.
    const prestart = await step("return-baseline", (context) => {
      inventoryPolicy.markCandidateReturned();
      return adapter.returnToBaseline({
        ...context,
        image: baselineProfile.image,
        volumes: baselineVolumes,
        networks: baselineNetworks,
      });
    });
    const candidateWriters = candidate.containers.filter(
      (value) =>
        value.Config.Labels["com.docker.compose.service"] === "taskdesk",
    );
    assertStoppedWriters(prestart?.writerState, candidateWriters);
    assertDataProof(prestart.data);
    if (
      prestart.image !== baselineProfile.image ||
      !same(prestart.volumes, baselineVolumes) ||
      (prestart.networks !== undefined &&
        !same(prestart.networks, baselineNetworks)) ||
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
      slot: null,
      volumes: baselineVolumes,
      networks: baselineNetworks,
      image: baselineProfile.image,
      privateDir: baselineProfile.privateDir,
    });
    inventoryPolicy.matchSnapshot(returned, lastInventory);
    assertRuntimeProof(returned.runtime, baselineProfile);
    assertSelectionDelta(returned, original, baselineProfile);
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
    return { journal: saved, volumes, networks, returnedToBaseline: true };
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
