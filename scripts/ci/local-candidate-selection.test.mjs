import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  acquireDockerDaemonLease,
  acquireHostBootstrapFence,
  borrowHostBootstrapFence,
} from "../../deploy/local-candidate-daemon-lease.mjs";
import {
  acquireProjectSelectionLease,
  assertSelectionSnapshot,
  baselineGenerationProfile,
  baselineNetworks,
  baselineVolumes,
  candidateGenerationProfile,
  candidateNetworks,
  candidateVolumes,
  canonicalSelectionConfig,
  coordinateCandidateSelection,
  coordinatorDirectory,
  localProject,
  verifyBackupFiles,
} from "../../deploy/local-candidate-selection.mjs";
import { deployLocal } from "../../deploy/local-release.mjs";
import {
  emitDaemonEvent,
  fakeDaemon,
  fakeLocalRelease,
  removeFakeUserLease,
} from "./local-candidate-fake-daemon.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const baselineImage =
  "ghcr.io/thomasheinthura/taskdesk@sha256:223bd9969611370939a0b8bf4b5fcbfd575a39390a40ff98cf76508e22e6e5bc";
const image = `ghcr.io/thomasheinthura/taskdesk-pr-candidate-123-1@sha256:${"b".repeat(64)}`;
const slot = "d".repeat(32);
const baselinePrivateDir = "/private";
const candidatePrivateDir = "/private-candidate";
const schemaCatalogue = JSON.parse(
  readFileSync(
    new URL(
      "../../deploy/local-candidate-schema-catalogue.json",
      import.meta.url,
    ),
  ),
);
const reviewedSchemaHash = digest(JSON.stringify(schemaCatalogue.tables));
const preservedTables = schemaCatalogue.tables.map((entry) => {
  const name = `${entry.schema}.${entry.table}`;
  const rows = {
    "public.session": 3,
    "public.apikey": 2,
    "public.api_key": 2,
    "public.api_key_rate_limit_counter": 3,
    "public.mcp_tool_invocation": 2,
  };
  return {
    ...entry,
    rowCount: rows[name] ?? 0,
    protectedFingerprint: digest(`${name}:source protected rows`),
    excludedColumns:
      name === "public.apikey"
        ? ["enabled"]
        : name === "public.api_key"
          ? ["disabled_at", "disabled_reason"]
          : [],
  };
});
const data = {
  databaseFingerprint: digest("db"),
  filesFingerprint: digest("files"),
  migrationFingerprint: digest("migrations"),
  tableCount: schemaCatalogue.tables.length,
  fileCount: 8,
  factorState: { storedRows: 2, enabledUsers: 2 },
  preservation: {
    schemaFingerprint: reviewedSchemaHash,
    tables: preservedTables,
  },
};
const transformedData = structuredClone(data);
transformedData.databaseFingerprint = digest(
  "candidate database after credential scrub",
);
const copiedSession = transformedData.preservation.tables.find(
  (entry) => entry.schema === "public" && entry.table === "session",
);
copiedSession.rowCount = 0;
copiedSession.protectedFingerprint = digest("empty session table");
const transformedProof = {
  slot,
  volumes: candidateVolumes(slot),
  sourceDatabaseFingerprint: data.databaseFingerprint,
  data: transformedData,
  credentials: {
    sessions: 0,
    verifications: 0,
    stepUpConfirmations: 0,
    activeApiKeys: 0,
    accountProviderTokens: 0,
    invitationCredentials: 0,
    authContinuations: 0,
    scimTokens: 0,
    metricsTokens: 0,
    setupTokens: 0,
    oldKeyEnvelopes: 0,
    unreadableEnvelopes: 0,
  },
  outbound: {
    enabledIdentityConnections: 0,
    enabledScimConnections: 0,
    enabledPlugins: 0,
    activeWebhooks: 0,
    enabledAutomations: 0,
    runnableJobHandlers: 0,
    actionableOutboxEvents: 0,
    pendingNotificationDeliveries: 0,
    pendingWebhookDeliveries: 0,
    actionableAutomationRuns: 0,
    actionableInvitationDeliveries: 0,
    runnableImportRuns: 0,
  },
  mfa: {
    mode: "reencrypted",
    storedRows: 2,
    enabledUsers: 2,
    candidateReadableRows: 2,
    baselineReadableRows: 0,
  },
};
const projectionTable = (proof, table) =>
  proof.data.preservation.tables.find(
    (entry) => entry.schema === "public" && entry.table === table,
  );
const baselineEnvSecrets = {
  postgres: {
    POSTGRES_DB: "taskdesk_test",
    POSTGRES_USER: "owner",
    POSTGRES_PASSWORD: "baseline-pg-secret",
  },
  taskdesk: {
    TASKDESK_ROLE: "all",
    TASKDESK_DATABASE_URL:
      "postgres://taskdesk_app:baseline-app-secret@postgres/taskdesk_test",
    TASKDESK_AUTH_SECRET: "1".repeat(64),
    TASKDESK_ENCRYPTION_KEY: "2".repeat(64),
  },
  migrate: {
    TASKDESK_ROLE: "migrate",
    TASKDESK_MIGRATION_DATABASE_URL:
      "postgres://owner:baseline-pg-secret@postgres/taskdesk_test",
  },
  valkey: {
    REDISCLI_AUTH: "baseline-valkey-secret",
  },
};
const candidateEnvSecrets = {
  postgres: {
    POSTGRES_DB: "taskdesk_test",
    POSTGRES_USER: "owner",
    POSTGRES_PASSWORD: "candidate-pg-secret",
  },
  taskdesk: {
    TASKDESK_ROLE: "web",
    TASKDESK_DATABASE_URL:
      "postgres://taskdesk_app:candidate-app-secret@postgres/taskdesk_test",
    TASKDESK_AUTH_SECRET: "3".repeat(64),
    TASKDESK_ENCRYPTION_KEY: "4".repeat(64),
  },
  migrate: {
    TASKDESK_ROLE: "migrate",
    TASKDESK_MIGRATION_DATABASE_URL:
      "postgres://owner:candidate-pg-secret@postgres/taskdesk_test",
  },
  valkey: {
    REDISCLI_AUTH: "candidate-valkey-secret",
  },
};

function snapshot(
  selected = baselineImage,
  volumes = baselineVolumes,
  options = {},
) {
  const isCandidate =
    options.slot !== undefined
      ? options.slot !== null
      : volumes !== baselineVolumes && selected !== baselineImage;
  const activeSlot = isCandidate ? (options.slot ?? slot) : null;
  const privateDir =
    options.privateDir ??
    (isCandidate ? candidatePrivateDir : baselinePrivateDir);
  const networks =
    options.networks ??
    (isCandidate ? candidateNetworks(activeSlot) : baselineNetworks);
  const environment =
    options.environment ??
    structuredClone(isCandidate ? candidateEnvSecrets : baselineEnvSecrets);
  const config = canonicalSelectionConfig({
    image: selected,
    privateDir,
    slot: activeSlot,
    volumes,
    networks,
    environment,
  });
  const services = config.services;
  const appImage = {
    Id: `sha256:${(isCandidate ? "e" : "c").repeat(64)}`,
    RepoDigests: [selected],
    Config: {
      Env: ["NODE_ENV=production"],
      Entrypoint: ["./entrypoint.sh"],
      Cmd: null,
      User: "taskdesk",
      WorkingDir: "/app",
    },
  };
  const supportingImages = Object.fromEntries(
    ["postgres", "traefik", "mailpit", "valkey"].map((name, index) => [
      name,
      {
        Id: `sha256:${String(index + 1).repeat(64)}`,
        Config: {
          Env: [],
          Entrypoint: [`/${name}-entrypoint`],
          Cmd: null,
          User: "",
          WorkingDir: "",
        },
      },
    ]),
  );
  const volumeNames = {
    "postgres-data": volumes.database,
    attachments: volumes.files,
    "mailpit-data": volumes.mail,
  };
  supportingImages.postgres.Config.Env = [
    "PGDATA=/var/lib/postgresql/18/docker",
  ];
  const candidateContainerIds = {
    postgres: "a".repeat(64),
    taskdesk: "b".repeat(64),
    traefik: "c".repeat(64),
    mailpit: "8".repeat(64),
    valkey: "9".repeat(64),
  };
  const baselineNetworkId = "7".repeat(64);
  const candidateBackendNetId = "5".repeat(64);
  const candidateIngressNetId = "6".repeat(64);
  const containers = Object.entries(services)
    .filter(([name]) => name !== "migrate")
    .map(([name, service], index) => {
      const ports = {};
      for (const port of service.ports || []) {
        const key = `${port.target}/tcp`;
        ports[key] ||= [];
        ports[key].push({ HostIp: port.host_ip, HostPort: port.published });
      }
      const inspectedImage =
        name === "taskdesk" ? appImage : supportingImages[name];
      const attachedNetworks = isCandidate
        ? name === "traefik"
          ? {
              [networks.backend]: { NetworkID: candidateBackendNetId },
              [networks.ingress]: { NetworkID: candidateIngressNetId },
            }
          : {
              [networks.backend]: { NetworkID: candidateBackendNetId },
            }
        : {
            [baselineNetworks.default]: { NetworkID: baselineNetworkId },
          };
      return {
        Id: isCandidate
          ? candidateContainerIds[name]
          : String(index + 1).repeat(64),
        Name: `/${localProject}-${name}-1`,
        Config: {
          Image: service.image,
          Entrypoint: inspectedImage.Config.Entrypoint,
          Cmd: service.command || inspectedImage.Config.Cmd,
          User: inspectedImage.Config.User,
          WorkingDir: inspectedImage.Config.WorkingDir,
          Healthcheck: service.healthcheck
            ? {
                Test: service.healthcheck.test,
                Interval:
                  Number.parseInt(service.healthcheck.interval, 10) *
                  1000000000,
                Timeout:
                  Number.parseInt(service.healthcheck.timeout, 10) * 1000000000,
                Retries: service.healthcheck.retries,
                ...(service.healthcheck.start_period
                  ? {
                      StartPeriod:
                        Number.parseInt(service.healthcheck.start_period, 10) *
                        1000000000,
                    }
                  : {}),
              }
            : null,
          Env: [
            ...inspectedImage.Config.Env,
            ...Object.entries(service.environment || {}).map(
              ([key, value]) => `${key}=${value}`,
            ),
          ],
          Labels: {
            "com.docker.compose.project": localProject,
            "com.docker.compose.service": name,
            ...(service.labels || {}),
          },
        },
        Image: inspectedImage.Id,
        State: { Running: true, Health: { Status: "healthy" } },
        HostConfig: {
          NetworkMode: isCandidate
            ? networks.backend
            : baselineNetworks.default,
          Privileged: false,
          PublishAllPorts: false,
          PortBindings: ports,
          ReadonlyRootfs: service.read_only || false,
          CapAdd: [],
          CapDrop: service.cap_drop || [],
          SecurityOpt: service.security_opt || [],
          AutoRemove: false,
          Runtime: "runc",
          Tmpfs: Object.fromEntries(
            (service.tmpfs || []).map((entry) => {
              const split = entry.indexOf(":");
              return [entry.slice(0, split), entry.slice(split + 1)];
            }),
          ),
          PidMode: "",
          UsernsMode: "",
          UTSMode: "",
          CgroupParent: "",
          CgroupnsMode: "private",
          IpcMode: "private",
        },
        NetworkSettings: {
          Ports: structuredClone(ports),
          Networks: attachedNetworks,
        },
        Mounts: (service.volumes || []).map((m) => ({
          Type: m.type,
          Destination: m.target,
          Source:
            m.type === "volume"
              ? `/var/lib/docker/volumes/${volumeNames[m.source]}/_data`
              : m.source,
          ...(m.type === "volume"
            ? { Name: volumeNames[m.source], RW: true }
            : { Source: m.source, RW: false }),
        })),
      };
    });
  const traefikContainer = containers.find(
    (c) => c.Config.Labels["com.docker.compose.service"] === "traefik",
  );
  const networkInspection = isCandidate
    ? {
        backend: {
          Id: candidateBackendNetId,
          Name: networks.backend,
          Driver: "bridge",
          Scope: "local",
          Internal: true,
          Attachable: false,
          Options: {},
          Labels: {
            "com.docker.compose.project": localProject,
            "com.docker.compose.network": "backend",
            ...(config.networks.backend?.labels || {}),
          },
          Containers: Object.fromEntries(
            containers.map((c) => [c.Id, { Name: c.Name.slice(1) }]),
          ),
        },
        ingress: {
          Id: candidateIngressNetId,
          Name: networks.ingress,
          Driver: "bridge",
          Scope: "local",
          Internal: false,
          Attachable: false,
          Options: {},
          Labels: {
            "com.docker.compose.project": localProject,
            "com.docker.compose.network": "ingress",
            ...(config.networks.ingress?.labels || {}),
          },
          Containers: {
            [traefikContainer.Id]: { Name: traefikContainer.Name.slice(1) },
          },
        },
      }
    : {
        Id: baselineNetworkId,
        Name: baselineNetworks.default,
        Driver: "bridge",
        Scope: "local",
        Internal: false,
        Attachable: false,
        Options: {},
        Labels: {
          "com.docker.compose.project": localProject,
          "com.docker.compose.network": "default",
          ...(config.networks.default?.labels || {}),
        },
        Containers: Object.fromEntries(
          containers.map((c) => [c.Id, { Name: c.Name.slice(1) }]),
        ),
      };
  return {
    containers,
    postgresPaths: {
      dataDirectory: "/var/lib/postgresql/18/docker",
      walDirectory: "/var/lib/postgresql/18/docker/pg_wal",
    },
    networkInspection,
    volumeInspection: Object.entries(volumeNames).map(([key, name]) => ({
      Name: name,
      Driver: "local",
      Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
      CreatedAt: "2026-11-10T00:00:00Z",
      Options: {},
      Labels: {
        "com.docker.compose.project": localProject,
        "com.docker.compose.volume": key,
        ...(config.volumes[key]?.labels || {}),
      },
    })),
    imageInspection: appImage,
    supportingImages,
    dockerEndpoint: "unix:///offline-docker.sock",
    contextEndpoint: "unix:///offline-docker.sock",
    daemonId: "offline-daemon-one",
    config,
    existingVolumeNames: Object.values(baselineVolumes),
    existingNetworkNames: Object.values(baselineNetworks),
    runtime: {
      project: localProject,
      image: selected,
      volumes,
      ...(isCandidate ? { networks } : {}),
      healthy: true,
      agentOrigin: "https://ticketing.localhost",
      portalOrigin: "https://portal.localhost",
      data: structuredClone(data),
    },
  };
}
const baselineProfileDir = "/var/tmp/taskdesk-baseline-browser";
function defaultBrowserResult(activeSlot = slot) {
  return {
    passed: true,
    evidenceHash: digest("offline mocked browser evidence"),
    sessionIsolation: {
      slot: activeSlot,
      profileDir: `/var/tmp/taskdesk-candidate-browser-${activeSlot}`,
      baselineProfileDir,
      ephemeralCookieJar: true,
      sharedBaselineSession: false,
      copiedSessionsInvalidatedByAuthSecretRotation: false,
      cookieJarFingerprint: digest(`candidate-cookies-${activeSlot}`),
      baselineCookieJarFingerprint: digest("baseline-cookies"),
    },
  };
}
function fixture(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "taskdesk-candidate-offline-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backupDirectory = join(root, "backup");
  mkdirSync(backupDirectory);
  writeFileSync(
    join(backupDirectory, "postgres.dump"),
    "PGDMP offline fixture",
    { mode: 0o600 },
  );
  writeFileSync(
    join(backupDirectory, "attachments.tar"),
    "offline fixture, no runtime archive claim",
    { mode: 0o600 },
  );
  const privateFiles = Object.fromEntries(
    ["app.env", "migrate.env", "postgres.env", "proxy", "valkey.env"].map(
      (name) => [name, digest(`baseline:${name}`)],
    ),
  );
  const candidatePrivateFiles = Object.fromEntries(
    ["app.env", "migrate.env", "postgres.env", "proxy", "valkey.env"].map(
      (name) => [name, digest(`candidate:${name}`)],
    ),
  );
  const backup = {
    directory: backupDirectory,
    privateFiles,
    writerState: snapshot()
      .containers.filter(
        (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
      )
      .map((c) => ({ Id: c.Id, State: { Running: false } })),
    checksums: Object.fromEntries(
      ["postgres.dump", "attachments.tar"].map((name) => [
        name,
        digest(readFileSync(join(backupDirectory, name))),
      ]),
    ),
    data: structuredClone(data),
  };
  const calls = [];
  const volumeKeyMap = {
    database: "postgres-data",
    files: "attachments",
    mail: "mailpit-data",
  };
  const boundary = {
    dockerEndpoint: "unix:///offline-docker.sock",
    contextEndpoint: "unix:///offline-docker.sock",
    daemonId: "offline-daemon-one",
    privateFiles,
    candidatePrivateFiles,
    baselineProfileDir,
  };
  const adapter = {
    inspectBoundary: () => structuredClone(boundary),
    startBaseline: () => {
      const app = daemon.state.inventory.find(
        (container) =>
          container.Id ===
          snapshot().containers.find(
            (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
          ).Id,
      );
      app.State.Running = true;
      emitDaemonEvent(daemon.state, "container", "start", app.Id);
    },
    inspectBaseline: () => snapshot(),
    quiesceAndBackup: () => {
      const app = daemon.state.inventory.find(
        (container) =>
          container.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      app.State.Running = false;
      emitDaemonEvent(daemon.state, "container", "stop", app.Id);
      return backup;
    },
    verifyBackupArchive: () => ({
      databaseEntries: 200,
      filesFingerprint: data.filesFingerprint,
      fileCount: data.fileCount,
    }),
    createAndRestoreSlot: ({ volumes, slot: activeSlot }) => {
      const created = Object.fromEntries(
        Object.entries(volumes).map(([key, name]) => [
          key,
          {
            Name: name,
            Driver: "local",
            Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
            CreatedAt: "2026-11-10T00:00:01Z",
            Options: {},
            Labels: {
              "info.taskdesk.selection.slot": activeSlot,
              "com.docker.compose.project": localProject,
              "com.docker.compose.volume": volumeKeyMap[key],
            },
          },
        ]),
      );
      for (const volume of Object.values(created)) {
        daemon.state.volumes[volume.Name] = structuredClone(volume);
        emitDaemonEvent(daemon.state, "volume", "create", volume.Name);
      }
      return created;
    },
    inspectCopiedData: () => structuredClone(data),
    transformCopiedData: () => {
      const {
        slot: activeSlot,
        volumes,
        sourceDatabaseFingerprint,
        data: next,
      } = transformedProof;
      return structuredClone({
        slot: activeSlot,
        volumes,
        sourceDatabaseFingerprint,
        data: next,
      });
    },
    inspectBaselineData: ({ expected }) => ({
      ...structuredClone(expected),
      data: structuredClone(data),
    }),
    verifyTransformedData: () => structuredClone(transformedProof),
    selectCandidate: () => {
      const baseSnap = snapshot();
      const candSnap = snapshot(image, candidateVolumes(slot));
      const originalIds = new Set(baseSnap.containers.map((c) => c.Id));
      const originalUsers = daemon.state.inventory.filter((container) =>
        originalIds.has(container.Id),
      );
      const extra = daemon.state.inventory.filter(
        (container) =>
          container.Config.Labels["com.docker.compose.project"] !==
          localProject,
      );
      const defaultNet = daemon.state.networks[baselineNetworks.default];
      for (const original of originalUsers) {
        if (original.State.Running)
          emitDaemonEvent(daemon.state, "container", "stop", original.Id);
        original.State.Running = false;
        original.Name += `-retained-${slot}`;
        original.NetworkSettings.Networks = {};
        delete defaultNet.Containers[original.Id];
        emitDaemonEvent(daemon.state, "network", "disconnect", defaultNet.Id, {
          container: original.Id,
        });
        emitDaemonEvent(daemon.state, "container", "rename", original.Id);
      }
      for (const net of [
        candSnap.networkInspection.backend,
        candSnap.networkInspection.ingress,
      ]) {
        daemon.state.networks[net.Name] = structuredClone(net);
        emitDaemonEvent(daemon.state, "network", "create", net.Id);
      }
      daemon.state.inventory = [
        ...originalUsers,
        ...structuredClone(candSnap.containers),
        ...extra,
      ];
      for (const current of candSnap.containers) {
        emitDaemonEvent(daemon.state, "container", "create", current.Id);
        emitDaemonEvent(
          daemon.state,
          "network",
          "connect",
          candSnap.networkInspection.backend.Id,
          { container: current.Id },
        );
        if (current.Config.Labels["com.docker.compose.service"] === "traefik") {
          emitDaemonEvent(
            daemon.state,
            "network",
            "connect",
            candSnap.networkInspection.ingress.Id,
            { container: current.Id },
          );
        }
        emitDaemonEvent(daemon.state, "container", "start", current.Id);
      }
    },
    inspectCandidate: () => {
      const current = snapshot(image, candidateVolumes(slot));
      current.runtime.data = structuredClone(transformedData);
      return {
        ...current,
        privateFiles: structuredClone(candidatePrivateFiles),
      };
    },
    inspectCandidateSecurity: ({ expected }) => ({
      ...structuredClone(expected),
      data: structuredClone(transformedData),
      credentials: structuredClone(transformedProof.credentials),
      outbound: structuredClone(transformedProof.outbound),
      mfa: structuredClone(transformedProof.mfa),
    }),
    browserWindow: () => defaultBrowserResult(slot),
    returnToBaseline: () => {
      const candSnap = snapshot(image, candidateVolumes(slot));
      for (const candidate of candSnap.containers) {
        emitDaemonEvent(daemon.state, "container", "stop", candidate.Id);
        emitDaemonEvent(
          daemon.state,
          "network",
          "disconnect",
          candSnap.networkInspection.backend.Id,
          { container: candidate.Id },
        );
        if (
          candidate.Config.Labels["com.docker.compose.service"] === "traefik"
        ) {
          emitDaemonEvent(
            daemon.state,
            "network",
            "disconnect",
            candSnap.networkInspection.ingress.Id,
            { container: candidate.Id },
          );
        }
        emitDaemonEvent(daemon.state, "container", "destroy", candidate.Id);
      }
      for (const net of [
        candSnap.networkInspection.backend,
        candSnap.networkInspection.ingress,
      ]) {
        delete daemon.state.networks[net.Name];
        emitDaemonEvent(daemon.state, "network", "destroy", net.Id);
      }
      const restored = snapshot();
      daemon.state.inventory = [
        ...restored.containers,
        ...daemon.state.inventory.filter(
          (container) =>
            container.Config.Labels["com.docker.compose.project"] !==
            localProject,
        ),
      ];
      const defaultNet = daemon.state.networks[baselineNetworks.default];
      defaultNet.Containers = structuredClone(
        restored.networkInspection.Containers,
      );
      const app = daemon.state.inventory.find(
        (container) =>
          container.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      app.State.Running = false;
      for (const current of daemon.state.inventory.filter(
        (container) =>
          container.Config.Labels["com.docker.compose.project"] ===
          localProject,
      )) {
        emitDaemonEvent(daemon.state, "container", "rename", current.Id);
        emitDaemonEvent(daemon.state, "network", "connect", defaultNet.Id, {
          container: current.Id,
        });
        if (current.Config.Labels["com.docker.compose.service"] !== "taskdesk")
          emitDaemonEvent(daemon.state, "container", "start", current.Id);
      }
      return {
        image: baselineImage,
        volumes: baselineVolumes,
        networks: baselineNetworks,
        data: structuredClone(data),
        writerState: candSnap.containers
          .filter(
            (container) =>
              container.Config.Labels["com.docker.compose.service"] ===
              "taskdesk",
          )
          .map((container) => ({
            Id: container.Id,
            State: { Running: false },
          })),
      };
    },
    inspectReturnedBaseline: () => snapshot(),
  };
  for (const [name, fn] of Object.entries(adapter))
    adapter[name] = async (...args) => {
      if (name !== "inspectBoundary") calls.push(name);
      return fn(...args);
    };
  const base = snapshot();
  const candidate = snapshot(image, candidateVolumes(slot));
  const daemon = fakeDaemon({
    daemonId: "offline-daemon-one",
    lease: null,
    inventory: structuredClone(base.containers),
    volumes: Object.fromEntries(
      base.volumeInspection.map((volume) => [
        volume.Name,
        structuredClone(volume),
      ]),
    ),
    networks: {
      [base.networkInspection.Name]: structuredClone(base.networkInspection),
    },
    images: {
      [baselineImage]: base.imageInspection,
      [image]: candidate.imageInspection,
    },
  });
  return {
    daemon,
    daemonRun: daemon.run,
    hostDirectory: join(root, "host-fence"),
    daemonEnv: { PATH: process.env.PATH },
    directory: join(root, "coordinator"),
    backup,
    boundary,
    candidatePrivateFiles,
    calls,
    plan: {
      slot,
      baselineImage,
      privateDir: baselinePrivateDir,
      candidate: {
        image,
        privateDir: candidatePrivateDir,
        sourceSha: "e".repeat(40),
      },
    },
    adapter,
    verifyCandidate: async () => {
      calls.push("verifyCandidate");
    },
  };
}
const appContainer = (s) =>
  s.containers.find(
    (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
  );

test("candidate overlay selects web while canonical baseline and migration keep their roles", () => {
  const overlay = readFileSync(
    new URL("../../deploy/compose.candidate.yml", import.meta.url),
    "utf8",
  );
  assert.ok(
    overlay.includes(
      "  taskdesk:\n    environment:\n      TASKDESK_ROLE: web\n",
    ),
  );
  assert.equal(
    snapshot().config.services.taskdesk.environment.TASKDESK_ROLE,
    "all",
  );
  assert.equal(
    snapshot(image, candidateVolumes(slot)).config.services.taskdesk.environment
      .TASKDESK_ROLE,
    "web",
  );
  for (const selected of [snapshot(), snapshot(image, candidateVolumes(slot))])
    assert.equal(
      selected.config.services.migrate.environment.TASKDESK_ROLE,
      "migrate",
    );
});

test("candidate and baseline reject application role drift in Compose or engine", () => {
  const candidateProfile = {
    slot,
    volumes: candidateVolumes(slot),
    networks: candidateNetworks(slot),
    image,
    privateDir: candidatePrivateDir,
    baselinePrivateDir,
  };
  for (const role of ["all", "jobs", "migrate", undefined]) {
    const candidate = snapshot(image, candidateVolumes(slot));
    if (role === undefined)
      delete candidate.config.services.taskdesk.environment.TASKDESK_ROLE;
    else candidate.config.services.taskdesk.environment.TASKDESK_ROLE = role;
    assert.throws(() => assertSelectionSnapshot(candidate, candidateProfile));
  }
  for (const role of ["all", "jobs", undefined]) {
    const candidate = snapshot(image, candidateVolumes(slot));
    const env = appContainer(candidate).Config.Env;
    const index = env.findIndex((item) => item.startsWith("TASKDESK_ROLE="));
    if (role === undefined) env.splice(index, 1);
    else env[index] = `TASKDESK_ROLE=${role}`;
    assert.throws(() => assertSelectionSnapshot(candidate, candidateProfile));
  }
  const baseline = snapshot();
  baseline.config.services.taskdesk.environment.TASKDESK_ROLE = "web";
  assert.throws(() =>
    assertSelectionSnapshot(baseline, {
      image: baselineImage,
      privateDir: baselinePrivateDir,
    }),
  );
});

test("candidate role drift retains locks before browser and return", async (t) => {
  const f = fixture(t);
  f.adapter.inspectCandidate = async () => {
    const candidate = snapshot(image, candidateVolumes(slot));
    candidate.runtime.data = structuredClone(transformedData);
    appContainer(candidate).Config.Env = appContainer(candidate).Config.Env.map(
      (item) => (item === "TASKDESK_ROLE=web" ? "TASKDESK_ROLE=all" : item),
    );
    return {
      ...candidate,
      privateFiles: structuredClone(f.candidatePrivateFiles),
    };
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("browserWindow"), false);
  assert.equal(f.calls.includes("returnToBaseline"), false);
  assert.equal(retained(f), true);
});

test("host fence refuses stale or malformed entries and requires exact ownership to release", (t) => {
  const f = fixture(t);
  mkdirSync(f.hostDirectory, { mode: 0o700 });
  writeFileSync(join(f.hostDirectory, "owner"), "stale or malformed\n", {
    mode: 0o600,
  });
  assert.throws(() =>
    acquireHostBootstrapFence({ directory: f.hostDirectory }),
  );
  assert.throws(() =>
    borrowHostBootstrapFence({
      directory: f.hostDirectory,
      ownerPid: process.pid,
      token: "a".repeat(64),
    }),
  );
  assert.equal(
    readFileSync(join(f.hostDirectory, "owner"), "utf8"),
    "stale or malformed\n",
  );
});

test("concurrent independent processes acquire exactly one host fence with no stale-owner takeover", async (t) => {
  const f = fixture(t);
  const modulePath = new URL(
    "../../deploy/local-candidate-daemon-lease.mjs",
    import.meta.url,
  ).href;
  const program = `import {acquireHostBootstrapFence} from ${JSON.stringify(modulePath)}; try { acquireHostBootstrapFence({directory:process.argv[1]}); process.stdout.write('acquired'); } catch { process.stdout.write('blocked'); }`;
  const execute = promisify(execFile);
  const results = await Promise.all([
    execute(process.execPath, [
      "--input-type=module",
      "-e",
      program,
      f.hostDirectory,
    ]),
    execute(process.execPath, [
      "--input-type=module",
      "-e",
      program,
      f.hostDirectory,
    ]),
  ]);
  assert.deepEqual(results.map((result) => result.stdout).sort(), [
    "acquired",
    "blocked",
  ]);
  assert.throws(() =>
    acquireHostBootstrapFence({ directory: f.hostDirectory }),
  );
});

for (const service of ["postgres", "taskdesk", "mailpit"]) {
  test(`${service} engine mount must remain writable as declared by Compose`, () => {
    const s = snapshot();
    s.containers.find(
      (c) => c.Config.Labels["com.docker.compose.service"] === service,
    ).Mounts[0].RW = false;
    assert.throws(
      () =>
        assertSelectionSnapshot(s, {
          image: baselineImage,
          privateDir: baselinePrivateDir,
        }),
      /mount/,
    );
  });
}

test("a candidate mount writability change blocks the browser and return", async (t) => {
  const f = fixture(t);
  f.adapter.inspectCandidate = async () => {
    const s = snapshot(image, candidateVolumes(slot));
    appContainer(s).Mounts[0].RW = false;
    return s;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("browserWindow"), false);
});

test("a returned baseline mount writability change retains all selection locks", async (t) => {
  const f = fixture(t);
  f.adapter.inspectReturnedBaseline = async () => {
    const s = snapshot();
    appContainer(s).Mounts[0].RW = false;
    return s;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.ok(existsSync(f.hostDirectory));
  assert.ok(f.daemon.state.lease);
});

test("a direct signature denial before mutation releases its host and project leases", (t) => {
  const f = fixture(t);
  const envFile = join(f.directory, "..", "signature-denial.env");
  writeFileSync(envFile, "SIT_IMAGE=offline-fixture\n");
  const runtime = fakeLocalRelease(f.daemon, snapshot(), {
    failAt: "signature",
  });
  assert.throws(
    () =>
      deployLocal({
        args: [],
        env: {
          ...f.daemonEnv,
          SIT_COMPOSE_ENV: envFile,
          SIT_PRIVATE_DIR: baselinePrivateDir,
        },
        exists: () => true,
        realpath: (value) => value,
        run: runtime.run,
        hostDirectory: f.hostDirectory,
        report: () => {},
      }),
    /signature verification/,
  );
  assert.equal(existsSync(f.hostDirectory), false);
  assert.equal(existsSync(join(coordinatorDirectory, "active")), false);
  assert.equal(f.daemon.state.lease, null);
});

for (const appState of ["stopped", "absent"]) {
  test(`direct local-release recovers with an ${appState} app and initialized PG/Valkey`, (t) => {
    const f = fixture(t);
    f.daemon.state.appRunning = false;
    if (appState === "absent") f.daemon.state.appExists = false;
    const envFile = join(f.directory, "..", "recovery.env");
    writeFileSync(envFile, "SIT_IMAGE=offline-fixture\n");
    const runtime = fakeLocalRelease(f.daemon, snapshot());
    const result = deployLocal({
      args: [],
      env: {
        ...f.daemonEnv,
        SIT_COMPOSE_ENV: envFile,
        SIT_PRIVATE_DIR: baselinePrivateDir,
      },
      exists: () => true,
      realpath: (value) => value,
      run: runtime.run,
      hostDirectory: f.hostDirectory,
      report: () => {},
    });
    assert.match(result, /Proxy started/);
    assert.equal(existsSync(f.hostDirectory), false);
    assert.equal(existsSync(join(coordinatorDirectory, "active")), false);
    assert.equal(f.daemon.state.lease, null);
    if (appState === "absent")
      assert.equal(
        f.daemon.calls.some(({ args }) => args[0] === "create"),
        false,
      );
  });
}

test("no-app recovery never bypasses a competing named selector lease", (t) => {
  const f = fixture(t);
  const first = acquireDockerDaemonLease({
    run: f.daemon.run,
    env: f.daemonEnv,
    hostDirectory: join(f.directory, "..", "other-host-fence"),
  });
  f.daemon.state.appExists = false;
  try {
    assert.throws(() =>
      acquireDockerDaemonLease({
        run: f.daemon.run,
        env: f.daemonEnv,
        hostDirectory: f.hostDirectory,
        allowAppDown: true,
      }),
    );
    assert.equal(
      f.daemon.state.lease.Config.Labels["info.taskdesk.selection.lease"],
      first.token,
    );
    assert.equal(existsSync(f.hostDirectory), false);
  } finally {
    first.release();
  }
});

for (const failAt of [
  "pull",
  "migration",
  "application",
  "readiness",
  "proxy",
]) {
  test(`direct local-release ${failAt} failure retains host/daemon/project evidence and blocks retry`, (t) => {
    const f = fixture(t);
    const envFile = join(f.directory, "..", "failing-release.env");
    writeFileSync(envFile, "SIT_IMAGE=offline-fixture\n");
    const runtime = fakeLocalRelease(f.daemon, snapshot(), { failAt });
    const options = {
      args: [],
      env: {
        ...f.daemonEnv,
        SIT_COMPOSE_ENV: envFile,
        SIT_PRIVATE_DIR: baselinePrivateDir,
      },
      exists: () => true,
      realpath: (value) => value,
      run: runtime.run,
      hostDirectory: f.hostDirectory,
      report: () => {},
    };
    try {
      assert.throws(() => deployLocal(options), /locks are retained/);
      assert.ok(existsSync(f.hostDirectory));
      assert.ok(
        existsSync(join(coordinatorDirectory, "active/daemon.json.mutation")),
      );
      assert.ok(f.daemon.state.lease);
      const count = runtime.calls.length;
      const other = join(f.directory, "..", "different-release.env");
      writeFileSync(other, "SIT_IMAGE=offline-fixture\n");
      assert.throws(
        () =>
          deployLocal({
            ...options,
            env: { ...options.env, SIT_COMPOSE_ENV: other },
          }),
        /lock exists/,
      );
      assert.equal(runtime.calls.length, count);
    } finally {
      removeFakeUserLease(
        join(coordinatorDirectory, "active"),
        envFile,
        f.daemon,
      );
    }
  });
}

test("engine-only healthcheck command override is denied in the initial snapshot", () => {
  const s = snapshot();
  appContainer(s).Config.Healthcheck.Test = [
    "CMD",
    "node",
    "-e",
    "process.exit(0)",
  ];
  assert.throws(
    () =>
      assertSelectionSnapshot(s, {
        image: baselineImage,
        privateDir: baselinePrivateDir,
      }),
    /healthcheck/,
  );
});

test("engine-only healthcheck timing override is denied", () => {
  const s = snapshot();
  appContainer(s).Config.Healthcheck.Interval = 1;
  assert.throws(
    () =>
      assertSelectionSnapshot(s, {
        image: baselineImage,
        privateDir: baselinePrivateDir,
      }),
    /healthcheck/,
  );
});

test("supporting image healthcheck is inherited when Compose leaves it unset", () => {
  const s = snapshot();
  const healthcheck = {
    Test: ["CMD", "/mailpit", "ready"],
    Interval: 5000000000,
    Timeout: 3000000000,
    Retries: 3,
  };
  s.supportingImages.mailpit.Config.Healthcheck = healthcheck;
  s.containers.find(
    (c) => c.Config.Labels["com.docker.compose.service"] === "mailpit",
  ).Config.Healthcheck = structuredClone(healthcheck);
  assert.doesNotThrow(() =>
    assertSelectionSnapshot(s, {
      image: baselineImage,
      privateDir: baselinePrivateDir,
    }),
  );
});

test("captured Compose 5.6.1 shape accepts the reviewed baseline digest without override fields", () => {
  const captured = JSON.parse(
    readFileSync(
      new URL("./local-candidate-compose-real.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  // The offline Compose capture predates the reviewed signed release. Re-pin
  // only its application images; preserve the captured service shape.
  for (const role of ["taskdesk", "migrate"])
    captured.config.services[role].image = baselineImage;
  captured.config.services.taskdesk.environment.TASKDESK_ROLE = "all";
  captured.candidateConfig.services.taskdesk.environment.TASKDESK_ROLE = "web";
  assert.equal(captured.composeVersion, "5.6.1");
  assert.equal(captured.config.services.taskdesk.command, null);
  assert.deepEqual(captured.config.networks.default.ipam, {});
  const s = snapshot();
  s.config = captured.config;
  for (const container of s.containers) {
    const name = container.Config.Labels["com.docker.compose.service"];
    const inspected =
      name === "taskdesk" ? s.imageInspection : s.supportingImages[name];
    container.Config.Env = [
      ...inspected.Config.Env,
      ...Object.entries(s.config.services[name].environment || {}).map(
        ([key, value]) => `${key}=${value}`,
      ),
    ];
  }
  assert.doesNotThrow(() =>
    assertSelectionSnapshot(s, {
      image: baselineImage,
      privateDir: baselinePrivateDir,
    }),
  );
  s.config.services.taskdesk.entrypoint = [];
  assert.throws(() =>
    assertSelectionSnapshot(s, {
      image: baselineImage,
      privateDir: baselinePrivateDir,
    }),
  );

  const cand = snapshot(image, candidateVolumes(slot));
  cand.config = captured.candidateConfig;
  for (const container of cand.containers) {
    const name = container.Config.Labels["com.docker.compose.service"];
    const inspected =
      name === "taskdesk" ? cand.imageInspection : cand.supportingImages[name];
    container.Config.Env = [
      ...inspected.Config.Env,
      ...Object.entries(cand.config.services[name].environment || {}).map(
        ([key, value]) => `${key}=${value}`,
      ),
    ];
  }
  assert.doesNotThrow(() =>
    assertSelectionSnapshot(cand, {
      slot,
      volumes: candidateVolumes(slot),
      networks: candidateNetworks(slot),
      image,
      privateDir: candidatePrivateDir,
      baselinePrivateDir,
    }),
  );
  cand.config.networks.backend.internal = false;
  assert.throws(() =>
    assertSelectionSnapshot(cand, {
      slot,
      volumes: candidateVolumes(slot),
      networks: candidateNetworks(slot),
      image,
      privateDir: candidatePrivateDir,
      baselinePrivateDir,
    }),
  );
});

for (const key of ["PGDATA", "POSTGRES_INITDB_WALDIR"]) {
  for (const value of [
    "/tmp/postgres",
    "relative/data",
    "/var/lib/postgresql/../outside",
    "/var/lib/postgresql/18/../../outside",
    "/var/lib/postgresql-other/data",
  ]) {
    for (const origin of ["configured", "inherited"]) {
      test(`${origin} ${key} rejects off-volume or traversing path ${value}`, () => {
        const s = snapshot();
        const container = s.containers.find(
          (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
        );
        if (origin === "configured")
          s.config.services.postgres.environment[key] = value;
        else {
          s.supportingImages.postgres.Config.Env =
            s.supportingImages.postgres.Config.Env.filter(
              (entry) => !entry.startsWith(`${key}=`),
            );
          s.supportingImages.postgres.Config.Env.push(`${key}=${value}`);
        }
        container.Config.Env = container.Config.Env.filter(
          (entry) => !entry.startsWith(`${key}=`),
        );
        container.Config.Env.push(`${key}=${value}`);
        assert.throws(() =>
          assertSelectionSnapshot(s, {
            image: baselineImage,
            privateDir: baselinePrivateDir,
          }),
        );
      });
    }
  }
}

test("data and WAL directories inside the selected PostgreSQL volume are allowed", () => {
  const s = snapshot();
  s.config.services.postgres.environment.POSTGRES_INITDB_WALDIR =
    "/var/lib/postgresql/wal";
  s.containers
    .find((c) => c.Config.Labels["com.docker.compose.service"] === "postgres")
    .Config.Env.push("POSTGRES_INITDB_WALDIR=/var/lib/postgresql/wal");
  assert.doesNotThrow(() =>
    assertSelectionSnapshot(s, {
      image: baselineImage,
      privateDir: baselinePrivateDir,
    }),
  );
});

test("resolved PostgreSQL data and WAL paths reject symlink or server-config escapes", () => {
  for (const field of ["dataDirectory", "walDirectory"]) {
    const s = snapshot();
    s.postgresPaths[field] = "/tmp/off-volume-postgres";
    assert.throws(() =>
      assertSelectionSnapshot(s, {
        image: baselineImage,
        privateDir: baselinePrivateDir,
      }),
    );
  }
});

for (const args of [
  "--waldir=/tmp/off-volume",
  "-X /tmp/off-volume",
  "--pgdata=/tmp/off-volume",
  "-D /tmp/off-volume",
]) {
  for (const origin of ["configured", "inherited"]) {
    test(`${origin} initdb path override ${args} is rejected before backup or slot creation`, async (t) => {
      const f = fixture(t);
      f.adapter.inspectBaseline = async () => {
        const s = snapshot();
        if (origin === "configured")
          s.config.services.postgres.environment.POSTGRES_INITDB_ARGS = args;
        else
          s.supportingImages.postgres.Config.Env.push(
            `POSTGRES_INITDB_ARGS=${args}`,
          );
        s.containers
          .find(
            (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
          )
          .Config.Env.push(`POSTGRES_INITDB_ARGS=${args}`);
        return s;
      };
      await assert.rejects(coordinateCandidateSelection(f), /retained/);
      assert.equal(f.calls.includes("quiesceAndBackup"), false);
      assert.equal(f.calls.includes("createAndRestoreSlot"), false);
    });
  }
}

test("distinct OS-user filesystem locks cannot overlap the same fake daemon lease", (t) => {
  const f = fixture(t);
  const userA = acquireProjectSelectionLease({
    directory: join(f.directory, "user-a"),
  });
  const userB = acquireProjectSelectionLease({
    directory: join(f.directory, "user-b"),
  });
  try {
    const first = acquireDockerDaemonLease({
      run: f.daemon.run,
      env: f.daemonEnv,
      hostDirectory: f.hostDirectory,
    });
    const token =
      f.daemon.state.lease.Config.Labels["info.taskdesk.selection.lease"];
    assert.throws(() =>
      acquireDockerDaemonLease({
        run: f.daemon.run,
        env: f.daemonEnv,
        hostDirectory: f.hostDirectory,
      }),
    );
    assert.equal(
      f.daemon.state.lease.Config.Labels["info.taskdesk.selection.lease"],
      token,
    );
    first.release();
    assert.equal(f.daemon.state.lease, null);
  } finally {
    userB.release();
    userA.release();
  }
});

test("uncertain atomic create retains its intent and is never retried or reclaimed", (t) => {
  const f = fixture(t);
  const stateFile = join(f.directory, "..", "uncertain-lease.json");
  const run = (bin, args, options) => {
    const result = f.daemon.run(bin, args, options);
    return args[0] === "create" ? { status: 1, stdout: "" } : result;
  };
  assert.throws(() =>
    acquireDockerDaemonLease({
      run,
      env: f.daemonEnv,
      stateFile,
      hostDirectory: f.hostDirectory,
    }),
  );
  assert.ok(f.daemon.state.lease);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).phase, "creating");
  assert.equal(existsSync(`${stateFile}.owned`), false);
  assert.throws(() =>
    acquireDockerDaemonLease({
      run: f.daemon.run,
      env: f.daemonEnv,
      hostDirectory: f.hostDirectory,
      stateFile,
    }),
  );
  assert.equal(
    f.daemon.calls.filter(({ args }) => args[0] === "create").length,
    1,
  );
  assert.equal(
    f.daemon.calls.some(({ args }) => args[0] === "rm"),
    false,
  );
});

test("pinned daemon command rejects explicit endpoint overrides", (t) => {
  const f = fixture(t);
  const lease = acquireDockerDaemonLease({
    run: f.daemon.run,
    env: f.daemonEnv,
    hostDirectory: f.hostDirectory,
  });
  try {
    for (const args of [
      ["--host", "unix:///other.sock", "ps"],
      ["ps", "--host=unix:///other.sock"],
      ["--context", "other", "ps"],
    ])
      assert.throws(() => lease.command(args));
    assert.ok(
      f.daemon.calls.every(
        ({ host, args }) =>
          args[0] === "context" || host === "unix:///offline-docker.sock",
      ),
    );
  } finally {
    lease.release();
  }
});

test("backup proof rejects an application writer that is still running", async (t) => {
  const f = fixture(t);
  f.backup.writerState[0].State.Running = true;
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("createAndRestoreSlot"), false);
});

test("default local-release cannot pass a lease held behind another user's filesystem lock", (t) => {
  const f = fixture(t);
  const envFile = join(f.directory, "..", "release.env");
  writeFileSync(envFile, "SIT_IMAGE=offline-fixture\n");
  const first = acquireDockerDaemonLease({
    run: f.daemon.run,
    env: f.daemonEnv,
    hostDirectory: f.hostDirectory,
  });
  try {
    assert.throws(() =>
      deployLocal({
        args: [],
        env: {
          ...f.daemonEnv,
          SIT_COMPOSE_ENV: envFile,
          SIT_PRIVATE_DIR: join(f.directory, ".."),
        },
        run: f.daemon.run,
        hostDirectory: f.hostDirectory,
      }),
    );
    assert.equal(
      f.daemon.state.lease.Config.Labels["info.taskdesk.selection.lease"],
      first.token,
    );
    assert.equal(
      f.daemon.calls.some(
        ({ args }) =>
          args.includes("config") ||
          args.includes("pull") ||
          args.includes("up"),
      ),
      false,
    );
  } finally {
    removeFakeUserLease(join(coordinatorDirectory, "active"), envFile);
    first.release();
  }
});

for (const stage of ["candidate", "return"]) {
  for (const field of ["dockerEndpoint", "contextEndpoint", "daemonId"]) {
    test(`${stage} ${field} drift stops before browser or unlock`, async (t) => {
      const f = fixture(t);
      const method =
        stage === "candidate" ? "inspectCandidate" : "inspectReturnedBaseline";
      f.adapter[method] = async () => {
        const s = snapshot(
          stage === "candidate" ? image : baselineImage,
          stage === "candidate" ? candidateVolumes(slot) : baselineVolumes,
        );
        s[field] =
          field === "daemonId" ? "other-daemon" : "unix:///other-daemon.sock";
        return s;
      };
      await assert.rejects(coordinateCandidateSelection(f), /retained/);
      assert.ok(f.daemon.state.lease);
      if (stage === "candidate")
        assert.equal(f.calls.includes("browserWindow"), false);
    });
  }
}

test("daemon identity change during an action blocks the next action", async (t) => {
  const f = fixture(t);
  f.adapter.selectCandidate = async () => {
    f.daemon.state.daemonId = "other-daemon";
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("inspectCandidate"), false);
  assert.ok(f.daemon.state.lease);
});

for (const target of ["baseline", "candidate"]) {
  test(`${target} private configuration content changes stop before the next action`, async (t) => {
    const f = fixture(t);
    f.adapter.selectCandidate = async () => {
      if (target === "baseline")
        f.backup.privateFiles["app.env"] = digest("changed private file");
      else
        f.candidatePrivateFiles["app.env"] = digest(
          "changed candidate private file",
        );
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("inspectCandidate"), false);
  });
}

test("quiesced backup is the definitive baseline despite earlier live writes", async (t) => {
  const f = fixture(t);
  f.adapter.inspectBaseline = async () => {
    const s = snapshot();
    s.runtime.data.databaseFingerprint = digest("earlier live state");
    return s;
  };
  await coordinateCandidateSelection(f);
});

test("baseline is proven before start and post-start writes do not invalidate that proof", async (t) => {
  const f = fixture(t);
  const inspect = f.adapter.inspectReturnedBaseline;
  f.adapter.inspectReturnedBaseline = async () => {
    const s = await inspect();
    s.runtime.data.databaseFingerprint = digest("boot-time scheduler writes");
    return s;
  };
  await coordinateCandidateSelection(f);
  assert.ok(
    f.calls.indexOf("returnToBaseline") < f.calls.indexOf("startBaseline"),
  );
  assert.ok(
    f.calls.indexOf("startBaseline") <
      f.calls.indexOf("inspectReturnedBaseline"),
  );
});

for (const [name, mutate] of [
  [
    "compose extra_hosts cannot reroute postgres",
    (s) => {
      s.config.services.taskdesk.extra_hosts = ["postgres:203.0.113.1"];
    },
  ],
  [
    "compose DNS override is denied",
    (s) => {
      s.config.services.taskdesk.dns = ["203.0.113.53"];
    },
  ],
  [
    "compose links are denied",
    (s) => {
      s.config.services.taskdesk.links = ["mailpit:postgres"];
    },
  ],
  [
    "compose postgres network alias is denied",
    (s) => {
      s.config.services.taskdesk.networks.default = { aliases: ["postgres"] };
    },
  ],
  [
    "engine extra_hosts cannot reroute postgres",
    (s) => {
      appContainer(s).HostConfig.ExtraHosts = ["postgres:203.0.113.1"];
    },
  ],
  [
    "engine DNS override is denied",
    (s) => {
      appContainer(s).HostConfig.Dns = ["203.0.113.53"];
    },
  ],
  [
    "engine links are denied",
    (s) => {
      appContainer(s).HostConfig.Links = ["/external:/postgres"];
    },
  ],
  [
    "engine postgres alias is denied",
    (s) => {
      appContainer(s).NetworkSettings.Networks[
        `${localProject}_default`
      ].Aliases = ["postgres"];
    },
  ],
  [
    "foreign network members are denied",
    (s) => {
      s.networkInspection.Containers["f".repeat(64)] = {
        Name: "foreign-postgres",
      };
    },
  ],
  [
    "compose entrypoint override is denied",
    (s) => {
      s.config.services.taskdesk.entrypoint = ["sh"];
    },
  ],
  [
    "compose command override is denied",
    (s) => {
      s.config.services.migrate.command = ["sh", "-c", "exit 0"];
    },
  ],
  [
    "compose root user is denied",
    (s) => {
      s.config.services.taskdesk.user = "0";
    },
  ],
  [
    "compose SYS_ADMIN is denied",
    (s) => {
      s.config.services.taskdesk.cap_add = ["SYS_ADMIN"];
    },
  ],
  [
    "compose writable rootfs is denied",
    (s) => {
      s.config.services.taskdesk.read_only = false;
    },
  ],
  [
    "compose unconfined seccomp is denied",
    (s) => {
      s.config.services.taskdesk.security_opt = ["seccomp=unconfined"];
    },
  ],
  [
    "engine entrypoint override is denied",
    (s) => {
      appContainer(s).Config.Entrypoint = ["sh"];
    },
  ],
  [
    "engine command override is denied",
    (s) => {
      appContainer(s).Config.Cmd = ["sh", "-c", "exit 0"];
    },
  ],
  [
    "engine root user is denied",
    (s) => {
      appContainer(s).Config.User = "0";
    },
  ],
  [
    "engine SYS_ADMIN is denied",
    (s) => {
      appContainer(s).HostConfig.CapAdd = ["SYS_ADMIN"];
    },
  ],
  [
    "engine writable rootfs is denied",
    (s) => {
      appContainer(s).HostConfig.ReadonlyRootfs = false;
    },
  ],
  [
    "engine tmpfs cannot shadow the copied attachments",
    (s) => {
      appContainer(s).HostConfig.Tmpfs["/app/data/attachments"] = "rw";
    },
  ],
  [
    "engine unconfined seccomp is denied",
    (s) => {
      appContainer(s).HostConfig.SecurityOpt = ["seccomp=unconfined"];
    },
  ],
  [
    "arbitrary supporting image is denied",
    (s) => {
      s.config.services.postgres.image = "untrusted/postgres:18";
      s.containers[0].Config.Image = "untrusted/postgres:18";
    },
  ],
  [
    "compose off-mount filesystem root is denied",
    (s) => {
      s.config.services.taskdesk.environment.TASKDESK_STORAGE_FILESYSTEM_ROOT =
        "/tmp/attachments";
      appContainer(s).Config.Env.push(
        "TASKDESK_STORAGE_FILESYSTEM_ROOT=/tmp/attachments",
      );
    },
  ],
  [
    "engine-only s3 driver is denied",
    (s) => {
      appContainer(s).Config.Env.push("TASKDESK_STORAGE_DRIVER=s3");
    },
  ],
  [
    "image-inherited s3 driver is denied",
    (s) => {
      s.imageInspection.Config.Env.push("TASKDESK_STORAGE_DRIVER=s3");
      appContainer(s).Config.Env.push("TASKDESK_STORAGE_DRIVER=s3");
    },
  ],
  [
    "engine-only off-mount filesystem root is denied",
    (s) => {
      appContainer(s).Config.Env.push(
        "TASKDESK_STORAGE_FILESYSTEM_ROOT=/tmp/attachments",
      );
    },
  ],
]) {
  test(name, () => {
    const s = snapshot();
    mutate(s);
    assert.throws(() =>
      assertSelectionSnapshot(s, {
        image: baselineImage,
        privateDir: baselinePrivateDir,
      }),
    );
  });
}

test("candidate private environment drift is denied even when Compose and engine agree", async (t) => {
  const f = fixture(t);
  f.adapter.inspectCandidate = async () => {
    const s = snapshot(image, candidateVolumes(slot));
    s.config.services.taskdesk.environment.TASKDESK_LOCALE = "en";
    appContainer(s).Config.Env.push("TASKDESK_LOCALE=en");
    // This is individually canonical and must still fail the frozen baseline delta.
    assert.doesNotThrow(() =>
      assertSelectionSnapshot(s, {
        slot,
        volumes: candidateVolumes(slot),
        networks: candidateNetworks(slot),
        image,
        privateDir: candidatePrivateDir,
        baselinePrivateDir,
      }),
    );
    return s;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("browserWindow"), false);
  assert.equal(f.calls.includes("returnToBaseline"), false);
});

test("unknown engine configuration drift is denied by the frozen baseline comparison", async (t) => {
  const f = fixture(t);
  f.adapter.inspectCandidate = async () => {
    const s = snapshot(image, candidateVolumes(slot));
    appContainer(s).HostConfig.LogConfig = { Type: "none", Config: {} };
    return s;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("browserWindow"), false);
});
const retained = (f) => existsSync(join(f.directory, "active", "owner"));

test("slots cannot overlap canonical storage or networks and reject arbitrary names", () => {
  const volumes = candidateVolumes(slot);
  const networks = candidateNetworks(slot);
  assert.equal(
    new Set([...Object.values(volumes), ...Object.values(baselineVolumes)])
      .size,
    6,
  );
  assert.equal(
    new Set([...Object.values(networks), ...Object.values(baselineNetworks)])
      .size,
    3,
  );
  for (const invalid of [
    "baseline",
    "../escape",
    "",
    "f".repeat(31),
    "F".repeat(32),
  ]) {
    assert.throws(() => candidateVolumes(invalid));
    assert.throws(() => candidateNetworks(invalid));
  }
});

test("generation profiles reject overlapping private directories and invalid images", () => {
  assert.doesNotThrow(() =>
    baselineGenerationProfile({
      image: baselineImage,
      privateDir: baselinePrivateDir,
    }),
  );
  assert.doesNotThrow(() =>
    candidateGenerationProfile({
      slot,
      image,
      privateDir: candidatePrivateDir,
      baselinePrivateDir,
    }),
  );
  for (const badPrivate of [
    baselinePrivateDir,
    `${baselinePrivateDir}/nested`,
    "/",
    "relative/path",
  ]) {
    assert.throws(() =>
      candidateGenerationProfile({
        slot,
        image,
        privateDir: badPrivate,
        baselinePrivateDir,
      }),
    );
  }
});

test("fixed project lease excludes different env files and worktrees", (t) => {
  const f = fixture(t);
  const first = acquireProjectSelectionLease({ directory: f.directory });
  assert.throws(
    () => acquireProjectSelectionLease({ directory: f.directory }),
    /lock exists/,
  );
  first.release();
  acquireProjectSelectionLease({ directory: f.directory }).release();
});

test("linked coordinator root is refused", (t) => {
  const f = fixture(t);
  const real = join(f.directory, "..", "real");
  mkdirSync(real, { mode: 0o700 });
  symlinkSync(real, f.directory);
  assert.throws(
    () => acquireProjectSelectionLease({ directory: f.directory }),
    /real directory/,
  );
});

test("canonical offline snapshot validates only exact project, endpoint, ports and mounts", () => {
  assert.doesNotThrow(() =>
    assertSelectionSnapshot(snapshot(), {
      image: baselineImage,
      privateDir: baselinePrivateDir,
    }),
  );
  for (const change of [
    (s) => {
      s.dockerEndpoint = "ssh://remote";
    },
    (s) => {
      s.contextEndpoint = "tcp://localhost:2375";
    },
    (s) => {
      s.config.name = "taskdesk";
    },
    (s) => {
      s.config.services.postgres.ports[0].published = "62870";
    },
    (s) => {
      s.config.services.postgres.ports[0].host_ip = "0.0.0.0";
    },
    (s) => {
      s.config.services.traefik.ports[0].published = "8080";
    },
    (s) => {
      s.config.services.taskdesk.ports = [
        { host_ip: "127.0.0.1", published: "5173", target: 5173 },
      ];
    },
    (s) => {
      s.config.services.taskdesk.volumes.push({
        type: "bind",
        source: "/",
        target: "/host",
      });
    },
    (s) => {
      s.config.services.taskdesk.environment.TASKDESK_DATABASE_URL =
        "postgres://taskdesk_app:baseline-app-secret@localhost:62870/live";
    },
    (s) => {
      s.config.services.taskdesk.environment.TASKDESK_DATABASE_URL +=
        "?host=outside";
    },
    (s) => {
      s.config.volumes["postgres-data"].driver_opts = { device: "/live" };
    },
    (s) => {
      s.config.services.taskdesk.network_mode = "host";
    },
    (s) => {
      s.config.services.traefik.volumes[0].read_only = false;
    },
    (s) => {
      s.config.services.other = {};
    },
    (s) => {
      s.containers[0].Config.Labels["com.docker.compose.project"] = "other";
    },
    (s) => {
      s.containers[0].Mounts[0].Name = candidateVolumes(slot).database;
    },
    (s) => {
      s.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
      ).Image = `sha256:${"8".repeat(64)}`;
    },
    (s) => {
      s.containers
        .find(
          (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
        )
        .Config.Env.push(
          "TASKDESK_DATABASE_URL=postgres://taskdesk_app:secret@outside/live",
        );
    },
    (s) => {
      s.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
      ).HostConfig.PortBindings["5432/tcp"][0].HostPort = "62870";
    },
    (s) => {
      delete s.containers;
    },
  ]) {
    const s = snapshot();
    change(s);
    assert.throws(() =>
      assertSelectionSnapshot(s, {
        image: baselineImage,
        privateDir: baselinePrivateDir,
      }),
    );
  }
});

test("candidate snapshot enforces internal backend, Traefik-only ingress, no backend host ports, and candidate Mailpit volume", () => {
  const baseValid = () => snapshot(image, candidateVolumes(slot));
  assert.doesNotThrow(() =>
    assertSelectionSnapshot(baseValid(), {
      slot,
      volumes: candidateVolumes(slot),
      networks: candidateNetworks(slot),
      image,
      privateDir: candidatePrivateDir,
      baselinePrivateDir,
    }),
  );
  for (const [label, mutate] of [
    [
      "compose backend internal false",
      (s) => {
        s.config.networks.backend.internal = false;
      },
    ],
    [
      "engine backend internal false",
      (s) => {
        s.networkInspection.backend.Internal = false;
      },
    ],
    [
      "compose ingress internal true",
      (s) => {
        s.config.networks.ingress.internal = true;
      },
    ],
    [
      "engine ingress internal true",
      (s) => {
        s.networkInspection.ingress.Internal = true;
      },
    ],
    [
      "taskdesk joins candidate ingress in compose",
      (s) => {
        s.config.services.taskdesk.networks.ingress = null;
      },
    ],
    [
      "taskdesk joins candidate ingress in engine",
      (s) => {
        const app = appContainer(s);
        app.NetworkSettings.Networks[candidateNetworks(slot).ingress] = {
          NetworkID: s.networkInspection.ingress.Id,
        };
        s.networkInspection.ingress.Containers[app.Id] = {
          Name: app.Name.slice(1),
        };
      },
    ],
    [
      "postgres joins candidate ingress in engine",
      (s) => {
        const pg = s.containers.find(
          (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
        );
        pg.NetworkSettings.Networks[candidateNetworks(slot).ingress] = {
          NetworkID: s.networkInspection.ingress.Id,
        };
        s.networkInspection.ingress.Containers[pg.Id] = {
          Name: pg.Name.slice(1),
        };
      },
    ],
    [
      "valkey joins candidate ingress in engine",
      (s) => {
        const vk = s.containers.find(
          (c) => c.Config.Labels["com.docker.compose.service"] === "valkey",
        );
        vk.NetworkSettings.Networks[candidateNetworks(slot).ingress] = {
          NetworkID: s.networkInspection.ingress.Id,
        };
        s.networkInspection.ingress.Containers[vk.Id] = {
          Name: vk.Name.slice(1),
        };
      },
    ],
    [
      "mailpit joins candidate ingress in engine",
      (s) => {
        const mp = s.containers.find(
          (c) => c.Config.Labels["com.docker.compose.service"] === "mailpit",
        );
        mp.NetworkSettings.Networks[candidateNetworks(slot).ingress] = {
          NetworkID: s.networkInspection.ingress.Id,
        };
        s.networkInspection.ingress.Containers[mp.Id] = {
          Name: mp.Name.slice(1),
        };
      },
    ],
    [
      "candidate postgres host port binding in compose",
      (s) => {
        s.config.services.postgres.ports = [
          {
            host_ip: "127.0.0.1",
            published: "62873",
            target: 5432,
            protocol: "tcp",
          },
        ];
      },
    ],
    [
      "candidate postgres host port binding in engine",
      (s) => {
        const pg = s.containers.find(
          (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
        );
        pg.HostConfig.PortBindings = {
          "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "62873" }],
        };
      },
    ],
    [
      "candidate mailpit host port binding in engine",
      (s) => {
        const mp = s.containers.find(
          (c) => c.Config.Labels["com.docker.compose.service"] === "mailpit",
        );
        mp.HostConfig.PortBindings = {
          "8025/tcp": [{ HostIp: "127.0.0.1", HostPort: "18025" }],
        };
      },
    ],
    [
      "candidate traefik wildcard host binding",
      (s) => {
        s.config.services.traefik.ports[0].host_ip = "0.0.0.0";
      },
    ],
    [
      "candidate mailpit-data reuses baseline mailpit volume",
      (s) => {
        s.config.volumes["mailpit-data"].name = baselineVolumes.mail;
      },
    ],
    [
      "candidate backend network reuses baseline default network name",
      (s) => {
        s.config.networks.backend.name = baselineNetworks.default;
      },
    ],
    [
      "candidate traefikingress alias spoofing postgres",
      (s) => {
        const tr = s.containers.find(
          (c) => c.Config.Labels["com.docker.compose.service"] === "traefik",
        );
        tr.NetworkSettings.Networks[candidateNetworks(slot).ingress].Aliases = [
          "postgres",
        ];
      },
    ],
  ]) {
    const s = baseValid();
    mutate(s);
    assert.throws(
      () =>
        assertSelectionSnapshot(s, {
          slot,
          volumes: candidateVolumes(slot),
          networks: candidateNetworks(slot),
          image,
          privateDir: candidatePrivateDir,
          baselinePrivateDir,
        }),
      undefined,
      label,
    );
  }
});

test("corrupt or linked backups fail integrity before restore", (t) => {
  const f = fixture(t);
  assert.match(verifyBackupFiles(f.backup), /^[a-f0-9]{64}$/);
  writeFileSync(join(f.backup.directory, "postgres.dump"), "corruption");
  assert.throws(() => verifyBackupFiles(f.backup), /integrity/);
  rmSync(join(f.backup.directory, "postgres.dump"));
  symlinkSync(
    join(f.backup.directory, "attachments.tar"),
    join(f.backup.directory, "postgres.dump"),
  );
  assert.throws(() => verifyBackupFiles(f.backup), /integrity/);
});

test("complete mocked cycle retains durable journal and proves return before unlocking", async (t) => {
  const f = fixture(t);
  const result = await coordinateCandidateSelection(f);
  assert.equal(result.returnedToBaseline, true);
  assert.deepEqual(result.volumes, candidateVolumes(slot));
  assert.deepEqual(result.networks, candidateNetworks(slot));
  assert.equal(retained(f), false);
  assert.equal(f.calls[0], "verifyCandidate");
  assert.ok(f.daemon.calls.some(({ args }) => args[0] === "create"));
  const events = readFileSync(result.journal, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(events.at(-1).phase, "completed");
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, i) => i),
  );
  assert.ok(
    events.findIndex((e) => e.phase === "backup-verified") <
      events.findIndex((e) => e.phase === "copy-slot:intent"),
  );
  assert.ok(
    events.findIndex((e) => e.phase === "verify-copy:complete") <
      events.findIndex((e) => e.phase === "transform-copy:intent"),
  );
  assert.ok(
    events.findIndex((e) => e.phase === "transformed-copy-verified") <
      events.findIndex((e) => e.phase === "select-candidate:intent"),
  );
  assert.ok(
    events.findIndex((e) => e.phase === "transform-copy:complete") <
      events.findIndex(
        (e) => e.phase === "verify-baseline-after-transform:intent",
      ),
  );
  assert.ok(
    events.findIndex(
      (e) => e.phase === "verify-candidate-after-start:complete",
    ) < events.findIndex((e) => e.phase === "browser-window:intent"),
  );
});

for (const method of [
  "transformCopiedData",
  "inspectBaselineData",
  "verifyTransformedData",
  "inspectCandidateSecurity",
]) {
  test(`missing ${method} callback cannot activate candidate`, async (t) => {
    const f = fixture(t);
    delete f.adapter[method];
    await assert.rejects(
      coordinateCandidateSelection(f),
      /separately reviewed/,
    );
    assert.equal(retained(f), false);
    assert.deepEqual(f.calls, []);
  });
}

for (const [name, change] of [
  [
    "wrong source",
    (proof) => {
      proof.sourceDatabaseFingerprint = digest("other");
    },
  ],
  [
    "baseline volume",
    (proof) => {
      proof.volumes = baselineVolumes;
    },
  ],
  [
    "changed attachment",
    (proof) => {
      proof.data.filesFingerprint = digest("other");
    },
  ],
  [
    "changed migration state",
    (proof) => {
      proof.data.migrationFingerprint = digest("other");
    },
  ],
  [
    "receipt disagreement",
    (proof) => {
      proof.data.databaseFingerprint = digest("other");
    },
  ],
  [
    "lost business row",
    (proof) => {
      projectionTable(proof, "mcp_tool_invocation").rowCount -= 1;
    },
  ],
  [
    "changed protected business column",
    (proof) => {
      projectionTable(proof, "mcp_tool_invocation").protectedFingerprint =
        digest("other");
    },
  ],
  [
    "incomplete table catalogue",
    (proof) => {
      proof.data.preservation.tables.pop();
    },
  ],
  [
    "unreviewed excluded business column",
    (proof) => {
      projectionTable(proof, "mcp_tool_invocation").excludedColumns = [
        "invocation_id",
      ];
    },
  ],
  [
    "added transient credential row",
    (proof) => {
      projectionTable(proof, "session").rowCount = 4;
    },
  ],
  [
    "deleted API key parent row",
    (proof) => {
      projectionTable(proof, "apikey").rowCount = 1;
    },
  ],
  [
    "deleted API key extension row",
    (proof) => {
      projectionTable(proof, "api_key").rowCount = 1;
    },
  ],
  [
    "deleted API key child metadata",
    (proof) => {
      projectionTable(proof, "api_key_rate_limit_counter").rowCount = 2;
    },
  ],
  [
    "live session",
    (proof) => {
      proof.credentials.sessions = 1;
    },
  ],
  [
    "missing credential counter",
    (proof) => {
      delete proof.credentials.activeApiKeys;
    },
  ],
  [
    "active copied API key",
    (proof) => {
      proof.credentials.activeApiKeys = 1;
    },
  ],
  [
    "pending delivery",
    (proof) => {
      proof.outbound.pendingWebhookDeliveries = 1;
    },
  ],
  [
    "default runnable job",
    (proof) => {
      proof.outbound.runnableJobHandlers = 1;
    },
  ],
  [
    "unreadable MFA",
    (proof) => {
      proof.mfa.storedRows = 1;
    },
  ],
  [
    "lost MFA-enabled user",
    (proof) => {
      proof.mfa.enabledUsers = 1;
    },
  ],
  [
    "MFA reset mode",
    (proof) => {
      proof.mfa.mode = "reset";
    },
  ],
]) {
  test(`transformed copy verification rejects ${name} before candidate start`, async (t) => {
    const f = fixture(t);
    const verify = f.adapter.verifyTransformedData;
    f.adapter.verifyTransformedData = async (...args) => {
      const proof = await verify(...args);
      change(proof);
      return proof;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("selectCandidate"), false);
    assert.equal(retained(f), true);
  });
}

test("unreviewed baseline image is rejected before lease or adapter work", async (t) => {
  const f = fixture(t);
  f.plan.baselineImage = `ghcr.io/thomasheinthura/taskdesk@sha256:${"a".repeat(64)}`;
  await assert.rejects(
    coordinateCandidateSelection(f),
    /reviewed baseline image/,
  );
  assert.equal(retained(f), false);
  assert.deepEqual(f.calls, []);
});

test("unknown source physical column blocks before transformation", async (t) => {
  const f = fixture(t);
  f.backup.data = structuredClone(data);
  f.backup.data.preservation.tables
    .find((entry) => entry.schema === "public" && entry.table === "account")
    .columns.push("unreviewed_column");
  f.adapter.inspectCopiedData = async () => structuredClone(f.backup.data);
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("transformCopiedData"), false);
});

test("unknown target physical column blocks even when receipt agrees", async (t) => {
  const f = fixture(t);
  const transform = f.adapter.transformCopiedData;
  f.adapter.transformCopiedData = async (...args) => {
    const receipt = await transform(...args);
    receipt.data.preservation.tables
      .find((entry) => entry.schema === "public" && entry.table === "account")
      .columns.push("unreviewed_column");
    return receipt;
  };
  const verify = f.adapter.verifyTransformedData;
  f.adapter.verifyTransformedData = async (...args) => {
    const proof = await verify(...args);
    proof.data.preservation.tables
      .find((entry) => entry.schema === "public" && entry.table === "account")
      .columns.push("unreviewed_column");
    return proof;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("selectCandidate"), false);
});

for (const [name, change] of [
  [
    "database identity",
    (proof) => {
      proof.databaseName = "native_test";
    },
  ],
  [
    "baseline volume",
    (proof) => {
      proof.volume = candidateVolumes(slot).database;
    },
  ],
  [
    "baseline data",
    (proof) => {
      proof.data.databaseFingerprint = digest("changed baseline");
    },
  ],
]) {
  test(`fresh baseline inspection rejects changed ${name} before candidate verification`, async (t) => {
    const f = fixture(t);
    const inspect = f.adapter.inspectBaselineData;
    f.adapter.inspectBaselineData = async (...args) => {
      const proof = await inspect(...args);
      change(proof);
      return proof;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("verifyTransformedData"), false);
    assert.equal(f.calls.includes("selectCandidate"), false);
  });
}

for (const [name, change] of [
  [
    "candidate database identity",
    (proof) => {
      proof.databaseName = "native_test";
    },
  ],
  [
    "candidate data identity",
    (proof) => {
      proof.data.databaseFingerprint = digest("stale inspection");
    },
  ],
  [
    "live session",
    (proof) => {
      proof.credentials.sessions = 1;
    },
  ],
  [
    "runnable outbound job",
    (proof) => {
      proof.outbound.runnableJobHandlers = 1;
    },
  ],
  [
    "changed MFA enrollment",
    (proof) => {
      proof.mfa.storedRows = 1;
    },
  ],
]) {
  test(`post-start security inspection rejects ${name} before browser`, async (t) => {
    const f = fixture(t);
    const inspect = f.adapter.inspectCandidateSecurity;
    f.adapter.inspectCandidateSecurity = async (...args) => {
      const proof = await inspect(...args);
      change(proof);
      return proof;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("browserWindow"), false);
  });
}

test("transform receipt disagreement stops before independent verification", async (t) => {
  const f = fixture(t);
  const transform = f.adapter.transformCopiedData;
  f.adapter.transformCopiedData = async (...args) => {
    const receipt = await transform(...args);
    receipt.data.fileCount += 1;
    return receipt;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("verifyTransformedData"), false);
  assert.equal(f.calls.includes("selectCandidate"), false);
});

test("transform may not start candidate application before verification", async (t) => {
  const f = fixture(t);
  const transform = f.adapter.transformCopiedData;
  f.adapter.transformCopiedData = async (...args) => {
    await f.adapter.selectCandidate();
    return transform(...args);
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("verifyTransformedData"), false);
});

test("baseline PostgreSQL exec event during candidate transform fails closed", async (t) => {
  const f = fixture(t);
  const transform = f.adapter.transformCopiedData;
  f.adapter.transformCopiedData = async (...args) => {
    const baselinePostgres = f.daemon.state.inventory.find(
      (container) =>
        container.Config.Labels["com.docker.compose.service"] === "postgres",
    );
    emitDaemonEvent(
      f.daemon.state,
      "container",
      "exec_start",
      baselinePostgres.Id,
    );
    return transform(...args);
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("verifyTransformedData"), false);
  assert.equal(f.calls.includes("selectCandidate"), false);
});

test("verified reencrypted MFA is accepted before candidate selection", async (t) => {
  const f = fixture(t);
  const verify = f.adapter.verifyTransformedData;
  f.adapter.verifyTransformedData = async (...args) => {
    const proof = await verify(...args);
    proof.mfa = {
      mode: "reencrypted",
      storedRows: 2,
      enabledUsers: 2,
      candidateReadableRows: 2,
      baselineReadableRows: 0,
    };
    return proof;
  };
  const result = await coordinateCandidateSelection(f);
  assert.equal(result.returnedToBaseline, true);
});

test("missing operational adapter cannot activate candidate", async (t) => {
  const f = fixture(t);
  delete f.adapter;
  await assert.rejects(coordinateCandidateSelection(f), /separately reviewed/);
  assert.equal(retained(f), false);
  assert.deepEqual(f.calls, []);
});

test("verification failure occurs before backup and never enters release verifier", async (t) => {
  const f = fixture(t);
  f.verifyCandidate = async () => {
    throw new Error("private verifier output");
  };
  await assert.rejects(
    coordinateCandidateSelection(f),
    (e) => !e.message.includes("private verifier output"),
  );
  assert.equal(retained(f), true);
  assert.deepEqual(f.calls, []);
});

for (const mode of [
  "existing-slot",
  "existing-network",
  "corrupt-backup",
  "bad-archive",
  "wrong-ownership",
  "different-copy",
  "browser-failed",
  "wrong-return-mount",
  "changed-return-data",
  "wrong-daemon-lease",
  "wrong-daemon-removal",
]) {
  test(`${mode} retains journal and prevents automatic retry or rollback`, async (t) => {
    const f = fixture(t);
    if (mode === "existing-slot")
      f.adapter.inspectBaseline = async () => ({
        ...snapshot(),
        existingVolumeNames: Object.values(candidateVolumes(slot)),
      });
    if (mode === "existing-network")
      f.adapter.inspectBaseline = async () => ({
        ...snapshot(),
        existingNetworkNames: Object.values(candidateNetworks(slot)),
      });
    if (mode === "corrupt-backup")
      writeFileSync(join(f.backup.directory, "attachments.tar"), "changed");
    if (mode === "bad-archive")
      f.adapter.verifyBackupArchive = async () => ({ databaseEntries: 0 });
    if (mode === "wrong-ownership")
      f.adapter.createAndRestoreSlot = async () => ({
        database: { Name: baselineVolumes.database },
      });
    if (mode === "different-copy")
      f.adapter.inspectCopiedData = async () => ({
        ...data,
        databaseFingerprint: digest("different"),
      });
    if (mode === "browser-failed")
      f.adapter.browserWindow = async () => ({ passed: false });
    if (mode === "wrong-return-mount")
      f.adapter.inspectReturnedBaseline = async () =>
        snapshot(baselineImage, candidateVolumes(slot));
    if (mode === "changed-return-data")
      f.adapter.returnToBaseline = async () => ({
        image: baselineImage,
        volumes: baselineVolumes,
        networks: baselineNetworks,
        data: { ...data, migrationFingerprint: digest("changed") },
        writerState: f.backup.writerState,
      });
    if (mode === "wrong-daemon-lease")
      f.daemonRun = (bin, args, options) => {
        const result = f.daemon.run(bin, args, options);
        if (args[0] === "inspect" && args[1] === "d".repeat(64)) {
          const values = JSON.parse(result.stdout);
          values[0].HostConfig.NetworkMode = "bridge";
          return { status: 0, stdout: JSON.stringify(values) };
        }
        return result;
      };
    if (mode === "wrong-daemon-removal")
      f.daemonRun = (bin, args, options) =>
        args[0] === "rm"
          ? { status: 1, stdout: "" }
          : f.daemon.run(bin, args, options);
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(retained(f), true);
    const before = f.calls.length;
    await assert.rejects(coordinateCandidateSelection(f), /lock exists/);
    assert.equal(f.calls.length, before);
    if (
      ![
        "wrong-return-mount",
        "changed-return-data",
        "wrong-daemon-removal",
      ].includes(mode)
    )
      assert.equal(f.calls.includes("returnToBaseline"), false);
  });
}

for (const secretCase of [
  "POSTGRES_PASSWORD",
  "TASKDESK_DATABASE_URL",
  "TASKDESK_AUTH_SECRET",
  "TASKDESK_ENCRYPTION_KEY",
  "REDISCLI_AUTH",
  "TASKDESK_ENCRYPTION_KEY_PREVIOUS",
]) {
  test(`candidate secret reuse or fallback for ${secretCase} is denied before browser`, async (t) => {
    const f = fixture(t);
    f.adapter.inspectCandidate = async () => {
      const env = structuredClone(candidateEnvSecrets);
      if (secretCase === "POSTGRES_PASSWORD") {
        env.postgres.POSTGRES_PASSWORD =
          baselineEnvSecrets.postgres.POSTGRES_PASSWORD;
        env.migrate.TASKDESK_MIGRATION_DATABASE_URL =
          baselineEnvSecrets.migrate.TASKDESK_MIGRATION_DATABASE_URL;
      } else if (secretCase === "TASKDESK_DATABASE_URL") {
        env.taskdesk.TASKDESK_DATABASE_URL =
          baselineEnvSecrets.taskdesk.TASKDESK_DATABASE_URL;
      } else if (secretCase === "TASKDESK_AUTH_SECRET") {
        env.taskdesk.TASKDESK_AUTH_SECRET =
          baselineEnvSecrets.taskdesk.TASKDESK_AUTH_SECRET;
      } else if (secretCase === "TASKDESK_ENCRYPTION_KEY") {
        env.taskdesk.TASKDESK_ENCRYPTION_KEY =
          baselineEnvSecrets.taskdesk.TASKDESK_ENCRYPTION_KEY;
      } else if (secretCase === "REDISCLI_AUTH") {
        env.valkey.REDISCLI_AUTH = baselineEnvSecrets.valkey.REDISCLI_AUTH;
      } else if (secretCase === "TASKDESK_ENCRYPTION_KEY_PREVIOUS") {
        env.taskdesk.TASKDESK_ENCRYPTION_KEY_PREVIOUS =
          baselineEnvSecrets.taskdesk.TASKDESK_ENCRYPTION_KEY;
      }
      return snapshot(image, candidateVolumes(slot), { environment: env });
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("browserWindow"), false);
    assert.equal(retained(f), true);
  });
}

for (const fileKey of [
  "app.env",
  "migrate.env",
  "postgres.env",
  "proxy",
  "valkey.env",
]) {
  test(`candidate private file fingerprint sharing ${fileKey} with baseline is denied`, async (t) => {
    const f = fixture(t);
    f.candidatePrivateFiles[fileKey] = f.backup.privateFiles[fileKey];
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("quiesceAndBackup"), false);
    assert.equal(retained(f), true);
  });
}

for (const role of ["postgres", "taskdesk", "traefik", "mailpit", "valkey"]) {
  test(`candidate sharing ${role} container identity with baseline is denied`, async (t) => {
    const f = fixture(t);
    f.adapter.inspectCandidate = async () => {
      const s = snapshot(image, candidateVolumes(slot));
      const baseRole = snapshot().containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === role,
      );
      const candRole = s.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === role,
      );
      delete s.networkInspection.backend.Containers[candRole.Id];
      s.networkInspection.backend.Containers[baseRole.Id] = {
        Name: candRole.Name.slice(1),
      };
      if (role === "traefik") {
        delete s.networkInspection.ingress.Containers[candRole.Id];
        s.networkInspection.ingress.Containers[baseRole.Id] = {
          Name: candRole.Name.slice(1),
        };
      }
      candRole.Id = baseRole.Id;
      return s;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("browserWindow"), false);
  });

  test(`simultaneous running baseline and candidate ${role} containers are denied`, async (t) => {
    const f = fixture(t);
    const select = f.adapter.selectCandidate;
    f.adapter.selectCandidate = async (context) => {
      await select(context);
      const retainedBase = f.daemon.state.inventory.find(
        (c) =>
          c.Config.Labels["com.docker.compose.service"] === role &&
          !c.Config.Labels["info.taskdesk.selection.slot"],
      );
      retainedBase.State.Running = true;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("inspectCandidate"), false);
    assert.equal(f.calls.includes("browserWindow"), false);
  });
}

for (const browserMutation of [
  [
    "missing sessionIsolation",
    (b) => {
      delete b.sessionIsolation;
    },
  ],
  [
    "mismatched slot",
    (b) => {
      b.sessionIsolation.slot = "f".repeat(32);
    },
  ],
  [
    "profileDir overlaps baselinePrivateDir",
    (b) => {
      b.sessionIsolation.profileDir = `${baselinePrivateDir}/browser`;
    },
  ],
  [
    "profileDir overlaps candidatePrivateDir",
    (b) => {
      b.sessionIsolation.profileDir = `${candidatePrivateDir}/browser`;
    },
  ],
  [
    "profileDir overlaps baselineProfileDir",
    (b) => {
      b.sessionIsolation.profileDir = `${b.sessionIsolation.baselineProfileDir}/nested`;
    },
  ],
  [
    "non-ephemeral cookie jar",
    (b) => {
      b.sessionIsolation.ephemeralCookieJar = false;
    },
  ],
  [
    "shared baseline session",
    (b) => {
      b.sessionIsolation.sharedBaselineSession = true;
    },
  ],
  [
    "identical cookie jar fingerprint",
    (b) => {
      b.sessionIsolation.cookieJarFingerprint =
        b.sessionIsolation.baselineCookieJarFingerprint;
    },
  ],
  [
    "treating Better Auth copied sessions as invalidated by TASKDESK_AUTH_SECRET rotation",
    (b) => {
      b.sessionIsolation.copiedSessionsInvalidatedByAuthSecretRotation = true;
    },
  ],
]) {
  test(`browser window rejects ${browserMutation[0]} before return to baseline`, async (t) => {
    const f = fixture(t);
    f.adapter.browserWindow = async () => {
      const b = defaultBrowserResult(slot);
      browserMutation[1](b);
      return b;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("returnToBaseline"), false);
    assert.equal(retained(f), true);
  });
}

test("interrupted journal cannot be stolen even when owner is no longer alive", async (t) => {
  const f = fixture(t);
  const lease = acquireProjectSelectionLease({ directory: f.directory });
  writeFileSync(join(lease.lock, "owner"), `999999 ${"c".repeat(64)}\n`);
  writeFileSync(
    join(lease.lock, "journal.jsonl"),
    '{"phase":"copy-slot:intent"}\n',
  );
  await assert.rejects(coordinateCandidateSelection(f), /lock exists/);
  assert.deepEqual(f.calls, []);
});

test("completed slot identifiers cannot be reused", async (t) => {
  const f = fixture(t);
  await coordinateCandidateSelection(f);
  const before = f.calls.length;
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.length, before);
  assert.equal(retained(f), true);
});

test("browser window holds the project lease until baseline proof completes", async (t) => {
  const f = fixture(t);
  f.adapter.browserWindow = async () => {
    assert.throws(
      () => acquireProjectSelectionLease({ directory: f.directory }),
      /lock exists/,
    );
    return defaultBrowserResult(slot);
  };
  await coordinateCandidateSelection(f);
  assert.equal(retained(f), false);
});

function foreignVolumeUser(name, { running = true, writable = true } = {}) {
  return {
    Id: "f".repeat(64),
    Name: "/unrelated-volume-user",
    Image: `sha256:${"e".repeat(64)}`,
    Config: {
      Image: "unrelated-image:offline",
      Labels: {
        "com.docker.compose.project": "unrelated-project",
        "com.docker.compose.service": "writer",
      },
    },
    HostConfig: { NetworkMode: "unrelated-network" },
    NetworkSettings: { Networks: { "unrelated-network": {} } },
    State: { Running: running },
    Mounts: [
      {
        Type: "volume",
        Name: name,
        Source: `/var/lib/docker/volumes/${name}/_data`,
        Destination: "/unrelated-data",
        RW: writable,
      },
    ],
  };
}
function addForeign(f, container, transient = false) {
  f.daemon.state.inventory.push(container);
  emitDaemonEvent(f.daemon.state, "container", "create", container.Id);
  if (container.State.Running)
    emitDaemonEvent(f.daemon.state, "container", "start", container.Id);
  emitDaemonEvent(
    f.daemon.state,
    "volume",
    "mount",
    container.Mounts[0]?.Name || "unrelated-bind",
  );
  if (transient) {
    emitDaemonEvent(f.daemon.state, "container", "die", container.Id);
    emitDaemonEvent(f.daemon.state, "container", "destroy", container.Id);
    f.daemon.state.inventory = f.daemon.state.inventory.filter(
      (value) => value.Id !== container.Id,
    );
  }
}

for (const name of Object.values(baselineVolumes)) {
  for (const running of [true, false]) {
    for (const writable of [true, false]) {
      test(`daemon inventory denies other-network baseline mount ${name} running=${running} writable=${writable}`, async (t) => {
        const f = fixture(t);
        f.daemon.state.inventory.push(
          foreignVolumeUser(name, { running, writable }),
        );
        await assert.rejects(coordinateCandidateSelection(f), /retained/);
        assert.equal(f.calls.includes("quiesceAndBackup"), false);
        assert.equal(f.calls.includes("verifyCandidate"), false);
        assert.equal(retained(f), true);
      });
    }
  }
}

for (const source of [
  `/var/lib/docker/volumes/${baselineVolumes.files}/_data`,
  `/var/lib/docker/volumes/${baselineVolumes.mail}/_data`,
  "/var/lib/docker/volumes",
  `/var/lib/docker/volumes/${baselineVolumes.files}/_data/nested`,
  `${baselinePrivateDir}/proxy`,
  `${candidatePrivateDir}/proxy`,
]) {
  test(`daemon inventory denies stopped read-only bind overlap ${source}`, async (t) => {
    const f = fixture(t);
    const container = foreignVolumeUser(baselineVolumes.files, {
      running: false,
      writable: false,
    });
    container.Mounts[0].Type = "bind";
    delete container.Mounts[0].Name;
    container.Mounts[0].Source = source;
    f.daemon.state.inventory.push(container);
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("quiesceAndBackup"), false);
  });
}

for (const planned of [false, true]) {
  test(`daemon inventory rejects transitive local-volume aliases to ${planned ? "planned candidate" : "baseline"} paths`, async (t) => {
    const f = fixture(t);
    const target = planned
      ? candidateVolumes(slot).files
      : baselineVolumes.files;
    for (const [name, device] of [
      ["offline-alias-one", `/var/lib/docker/volumes/${target}/_data`],
      ["offline-alias-two", "/var/lib/docker/volumes/offline-alias-one/_data"],
    ])
      f.daemon.state.volumes[name] = {
        Name: name,
        Driver: "local",
        Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
        Options: { type: "none", o: "bind", device },
        Labels: {},
      };
    f.daemon.state.inventory.push(
      foreignVolumeUser("offline-alias-two", { running: false }),
    );
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("quiesceAndBackup"), false);
  });
}

test("daemon inventory rejects canonical-label spoofing by another stopped volume user", async (t) => {
  const f = fixture(t);
  const container = structuredClone(appContainer(snapshot()));
  container.Id = "f".repeat(64);
  container.Name = "/spoofed-taskdesk";
  container.State.Running = false;
  f.daemon.state.inventory.push(container);
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("quiesceAndBackup"), false);
});

test("stable unrelated other-network containers with separate local volumes remain allowed", async (t) => {
  const f = fixture(t);
  const name = "unrelated-local-volume";
  f.daemon.state.volumes[name] = {
    Name: name,
    Driver: "local",
    Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
    Options: {},
    Labels: {},
  };
  f.daemon.state.networks["unrelated-network"] = {
    Id: "0".repeat(64),
    Name: "unrelated-network",
    Driver: "bridge",
    Scope: "local",
    Internal: false,
    Options: {},
    Labels: {},
    Containers: {
      ["f".repeat(64)]: { Name: "unrelated-volume-user" },
    },
  };
  f.daemon.state.inventory.push(foreignVolumeUser(name));
  await coordinateCandidateSelection(f);
  assert.equal(retained(f), false);
  assert.equal(
    f.daemon.state.inventory.some((c) => c.Id === "f".repeat(64)),
    true,
  );
});

for (const name of Object.values(candidateVolumes(slot))) {
  test(`daemon inventory rejects foreign newly created candidate mount ${name}`, async (t) => {
    const f = fixture(t);
    const copy = f.adapter.createAndRestoreSlot;
    f.adapter.createAndRestoreSlot = async (context) => {
      const result = await copy(context);
      addForeign(
        f,
        foreignVolumeUser(name, { running: false, writable: false }),
      );
      return result;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("inspectCopiedData"), false);
    assert.equal(f.calls.includes("selectCandidate"), false);
  });
}

for (const transient of [false, true]) {
  for (const phase of [
    "quiesceAndBackup",
    "browserWindow",
    "returnToBaseline",
  ]) {
    test(`daemon event window denies ${transient ? "transient" : "persistent"} foreign mounts during ${phase}`, async (t) => {
      const f = fixture(t);
      const action = f.adapter[phase];
      f.adapter[phase] = async (context) => {
        const result = await action(context);
        addForeign(f, foreignVolumeUser(baselineVolumes.files), transient);
        return result;
      };
      await assert.rejects(coordinateCandidateSelection(f), /retained/);
      const next = {
        quiesceAndBackup: "verifyBackupArchive",
        browserWindow: "returnToBaseline",
        returnToBaseline: "startBaseline",
      }[phase];
      assert.equal(f.calls.includes(next), false);
      assert.equal(retained(f), true);
    });
  }
}

for (const transient of [false, true]) {
  for (const [phase, netKey] of [
    ["quiesceAndBackup", "default"],
    ["browserWindow", "backend"],
    ["browserWindow", "ingress"],
    ["returnToBaseline", "default"],
  ]) {
    test(`daemon network inventory and event fence deny ${transient ? "vanished" : "persistent"} foreign endpoint on ${netKey} during ${phase}`, async (t) => {
      const f = fixture(t);
      const action = f.adapter[phase];
      f.adapter[phase] = async (context) => {
        const result = await action(context);
        const netName =
          netKey === "default"
            ? baselineNetworks.default
            : candidateNetworks(slot)[netKey];
        const net = f.daemon.state.networks[netName];
        const foreignId = "f".repeat(64);
        emitDaemonEvent(f.daemon.state, "network", "connect", net.Id, {
          container: foreignId,
        });
        if (transient) {
          emitDaemonEvent(f.daemon.state, "network", "disconnect", net.Id, {
            container: foreignId,
          });
        } else {
          net.Containers[foreignId] = { Name: "foreign-endpoint" };
        }
        return result;
      };
      await assert.rejects(coordinateCandidateSelection(f), /retained/);
      const next = {
        quiesceAndBackup: "verifyBackupArchive",
        browserWindow: "returnToBaseline",
        returnToBaseline: "startBaseline",
      }[phase];
      assert.equal(f.calls.includes(next), false);
      assert.equal(retained(f), true);
    });
  }
}

test("daemon network event fence denies transient candidate service connection to ingress network", async (t) => {
  const f = fixture(t);
  f.adapter.browserWindow = async () => {
    const ingressNet = f.daemon.state.networks[candidateNetworks(slot).ingress];
    const candAppId = "b".repeat(64);
    emitDaemonEvent(f.daemon.state, "network", "connect", ingressNet.Id, {
      container: candAppId,
    });
    emitDaemonEvent(f.daemon.state, "network", "disconnect", ingressNet.Id, {
      container: candAppId,
    });
    return defaultBrowserResult(slot);
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("returnToBaseline"), false);
});

for (const secondGenKind of ["volume", "network", "container"]) {
  test(`daemon inventory rejects simultaneous second candidate generation ${secondGenKind}`, async (t) => {
    const f = fixture(t);
    const secondSlot = "e".repeat(32);
    if (secondGenKind === "volume") {
      const secondVol = candidateVolumes(secondSlot).database;
      f.daemon.state.volumes[secondVol] = {
        Name: secondVol,
        Driver: "local",
        Mountpoint: `/var/lib/docker/volumes/${secondVol}/_data`,
        CreatedAt: "2026-11-10T00:00:02Z",
        Options: {},
        Labels: {
          "com.docker.compose.project": localProject,
          "com.docker.compose.volume": "postgres-data",
          "info.taskdesk.selection.slot": secondSlot,
        },
      };
    } else if (secondGenKind === "network") {
      const secondNet = candidateNetworks(secondSlot).backend;
      f.daemon.state.networks[secondNet] = {
        Id: "0".repeat(64),
        Name: secondNet,
        Driver: "bridge",
        Scope: "local",
        Internal: true,
        Options: {},
        Labels: {
          "com.docker.compose.project": localProject,
          "com.docker.compose.network": "backend",
          "info.taskdesk.selection.slot": secondSlot,
        },
        Containers: {},
      };
    } else {
      const secondContainer = structuredClone(
        snapshot(image, candidateVolumes(secondSlot), { slot: secondSlot })
          .containers[0],
      );
      secondContainer.Id = "0".repeat(64);
      secondContainer.Name = `/${localProject}-postgres-second`;
      secondContainer.Mounts = [];
      secondContainer.NetworkSettings.Networks = {};
      f.daemon.state.inventory.push(secondContainer);
    }
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("quiesceAndBackup"), false);
  });
}

test("candidate networks remaining after returnToBaseline fail closed before baseline restart", async (t) => {
  const f = fixture(t);
  const ret = f.adapter.returnToBaseline;
  f.adapter.returnToBaseline = async (context) => {
    const result = await ret(context);
    const candSnap = snapshot(image, candidateVolumes(slot));
    f.daemon.state.networks[candSnap.networkInspection.backend.Name] =
      structuredClone(candSnap.networkInspection.backend);
    f.daemon.state.networks[
      candSnap.networkInspection.backend.Name
    ].Containers = {};
    return result;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("startBaseline"), false);
});

for (const fault of [
  "missing-mounts",
  "omitted-record",
  "duplicate-record",
  "list-race",
  "missing-networks",
  "omitted-network",
  "duplicate-network",
]) {
  test(`daemon inventory fails closed on ${fault}`, async (t) => {
    const f = fixture(t);
    let lists = 0;
    f.daemonRun = (bin, args, options) => {
      if (args[0] === "ps" && !args.includes("--filter")) {
        lists++;
        if (fault === "list-race" && lists === 2)
          f.daemon.state.inventory.push(
            foreignVolumeUser(baselineVolumes.files),
          );
      }
      if (
        fault === "missing-networks" &&
        args[0] === "network" &&
        args[1] === "ls"
      )
        return { status: 1, stdout: "" };
      const result = f.daemon.run(bin, args, options);
      if (args[0] === "inspect" && args.length > 2) {
        const values = JSON.parse(result.stdout);
        if (fault === "missing-mounts") delete values[0].Mounts;
        if (fault === "omitted-record") values.pop();
        if (fault === "duplicate-record") values.push(values[0]);
        return { status: 0, stdout: JSON.stringify(values) };
      }
      if (args[0] === "network" && args[1] === "inspect") {
        const values = JSON.parse(result.stdout);
        if (fault === "omitted-network") values.pop();
        if (fault === "duplicate-network") values.push(values[0]);
        return { status: 0, stdout: JSON.stringify(values) };
      }
      return result;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("quiesceAndBackup"), false);
  });
}

for (const fault of [
  "failed-update",
  "missing-opening",
  "missing-closing",
  "overflow",
]) {
  test(`daemon event window fails closed on ${fault}`, async (t) => {
    const f = fixture(t);
    let reads = 0;
    f.daemonRun = (bin, args, options) => {
      if (fault === "failed-update" && args[0] === "update")
        return { status: 1, stdout: "" };
      const result = f.daemon.run(bin, args, options);
      if (args[0] === "events") {
        reads++;
        if (fault === "missing-opening" && reads === 1)
          return { status: 0, stdout: "" };
        if (fault === "missing-closing" && reads === 2)
          return {
            status: 0,
            stdout: result.stdout.split("\n").slice(0, 1).join("\n"),
          };
      }
      return result;
    };
    if (fault === "overflow")
      f.adapter.browserWindow = async () => {
        for (let i = 0; i < 300; i++)
          emitDaemonEvent(f.daemon.state, "image", "pull", `offline-${i}`);
        return defaultBrowserResult(slot);
      };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("returnToBaseline"), false);
    assert.equal(retained(f), true);
  });
}

test("each awaited Docker call checks daemon-wide mounts before dispatch", async (t) => {
  const f = fixture(t);
  f.adapter.browserWindow = async (context) => {
    addForeign(f, foreignVolumeUser(baselineVolumes.files));
    await context.docker(["exec", "never-dispatched", "true"]);
    return defaultBrowserResult(slot);
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(
    f.daemon.calls.some(({ args }) => args[0] === "exec"),
    false,
  );
  assert.equal(f.calls.includes("returnToBaseline"), false);
});

test("a known protected-volume user cannot lose its mount inspection evidence", async (t) => {
  const f = fixture(t);
  const backup = f.adapter.quiesceAndBackup;
  f.adapter.quiesceAndBackup = async (context) => {
    const result = await backup(context);
    f.daemon.state.inventory.find(
      (container) => container.Id === appContainer(snapshot()).Id,
    ).Mounts = [];
    return result;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("verifyBackupArchive"), false);
});

test("awaited guarded Docker inspection keeps continuous event and inventory proof", async (t) => {
  const f = fixture(t);
  f.adapter.browserWindow = async (context) => {
    const result = await context.docker(["inspect", "b".repeat(64)]);
    assert.equal(JSON.parse(result)[0].Id, "b".repeat(64));
    return defaultBrowserResult(slot);
  };
  await coordinateCandidateSelection(f);
  assert.equal(retained(f), false);
});

test("boundary inspection receives no Docker mutation authority", async (t) => {
  const f = fixture(t);
  f.adapter.inspectBoundary = async (context) => {
    context.docker(["create", "never-dispatched"]);
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(
    f.daemon.calls.some(({ args }) => args.includes("never-dispatched")),
    false,
  );
  assert.equal(f.calls.includes("quiesceAndBackup"), false);
});

for (const [label, injectViolation] of [
  [
    "baseline postgres stop-start-stop during select-candidate",
    (f, baseSnap, defaultNet) => {
      const pg = baseSnap.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
      );
      emitDaemonEvent(f.daemon.state, "container", "stop", pg.Id);
      emitDaemonEvent(f.daemon.state, "container", "start", pg.Id);
      emitDaemonEvent(f.daemon.state, "container", "stop", pg.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: pg.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "rename", pg.Id, {
        name: `${pg.Name.slice(1)}-retained-${slot}`,
      });
    },
  ],
  [
    "baseline postgres disconnect-connect-disconnect during select-candidate",
    (f, baseSnap, defaultNet) => {
      const pg = baseSnap.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
      );
      emitDaemonEvent(f.daemon.state, "container", "stop", pg.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: pg.Id,
      });
      emitDaemonEvent(f.daemon.state, "network", "connect", defaultNet.Id, {
        container: pg.Id,
      });
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: pg.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "rename", pg.Id, {
        name: `${pg.Name.slice(1)}-retained-${slot}`,
      });
    },
  ],
  [
    "baseline postgres disconnect while still running before stop during select-candidate",
    (f, baseSnap, defaultNet) => {
      const pg = baseSnap.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
      );
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: pg.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "stop", pg.Id);
      emitDaemonEvent(f.daemon.state, "container", "rename", pg.Id, {
        name: `${pg.Name.slice(1)}-retained-${slot}`,
      });
    },
  ],
  [
    "baseline taskdesk start-stop during select-candidate",
    (f, baseSnap, defaultNet) => {
      const app = baseSnap.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      emitDaemonEvent(f.daemon.state, "container", "start", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "rename", app.Id, {
        name: `${app.Name.slice(1)}-retained-${slot}`,
      });
    },
  ],
  [
    "baseline taskdesk stop during select-candidate after already quiesced in backup",
    (f, baseSnap, defaultNet) => {
      const app = baseSnap.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "rename", app.Id, {
        name: `${app.Name.slice(1)}-retained-${slot}`,
      });
    },
  ],
  [
    "baseline taskdesk disconnect-connect-disconnect during select-candidate",
    (f, baseSnap, defaultNet) => {
      const app = baseSnap.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "network", "connect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "rename", app.Id, {
        name: `${app.Name.slice(1)}-retained-${slot}`,
      });
    },
  ],
]) {
  test(`lifecycle event replay rejects ${label} even when final snapshot looks stopped and detached`, async (t) => {
    const f = fixture(t);
    f.adapter.selectCandidate = async () => {
      const baseSnap = snapshot();
      const candSnap = snapshot(image, candidateVolumes(slot));
      const originalIds = new Set(baseSnap.containers.map((c) => c.Id));
      const originalUsers = f.daemon.state.inventory.filter((container) =>
        originalIds.has(container.Id),
      );
      const defaultNet = f.daemon.state.networks[baselineNetworks.default];
      const targetRole = label.includes("postgres") ? "postgres" : "taskdesk";
      for (const original of originalUsers) {
        const role = original.Config.Labels["com.docker.compose.service"];
        if (role === targetRole) {
          original.State.Running = false;
          original.Name += `-retained-${slot}`;
          original.NetworkSettings.Networks = {};
          delete defaultNet.Containers[original.Id];
          injectViolation(f, baseSnap, defaultNet);
          continue;
        }
        if (original.State.Running)
          emitDaemonEvent(f.daemon.state, "container", "stop", original.Id);
        original.State.Running = false;
        original.Name += `-retained-${slot}`;
        original.NetworkSettings.Networks = {};
        delete defaultNet.Containers[original.Id];
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "disconnect",
          defaultNet.Id,
          {
            container: original.Id,
          },
        );
        emitDaemonEvent(f.daemon.state, "container", "rename", original.Id);
      }
      for (const net of [
        candSnap.networkInspection.backend,
        candSnap.networkInspection.ingress,
      ]) {
        f.daemon.state.networks[net.Name] = structuredClone(net);
        emitDaemonEvent(f.daemon.state, "network", "create", net.Id);
      }
      f.daemon.state.inventory = [
        ...originalUsers,
        ...structuredClone(candSnap.containers),
      ];
      for (const current of candSnap.containers) {
        emitDaemonEvent(f.daemon.state, "container", "create", current.Id);
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "connect",
          candSnap.networkInspection.backend.Id,
          { container: current.Id },
        );
        if (current.Config.Labels["com.docker.compose.service"] === "traefik") {
          emitDaemonEvent(
            f.daemon.state,
            "network",
            "connect",
            candSnap.networkInspection.ingress.Id,
            { container: current.Id },
          );
        }
        emitDaemonEvent(f.daemon.state, "container", "start", current.Id);
      }
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("inspectCandidate"), false);
    assert.equal(f.calls.includes("browserWindow"), false);
    assert.equal(retained(f), true);
  });
}

test("lifecycle event replay rejects baseline taskdesk transient start-stop during return-baseline", async (t) => {
  const f = fixture(t);
  const ret = f.adapter.returnToBaseline;
  f.adapter.returnToBaseline = async (context) => {
    const result = await ret(context);
    const app = snapshot().containers.find(
      (c) => c.Config.Labels["com.docker.compose.service"] === "taskdesk",
    );
    emitDaemonEvent(f.daemon.state, "container", "start", app.Id);
    emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    return result;
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("startBaseline"), false);
  assert.equal(retained(f), true);
});

test("real compose.candidate.yml and captured Compose 5.6.1 config derive runtime slot labels and fail closed if slot label is omitted", async (t) => {
  const overlayText = readFileSync(
    new URL("../../deploy/compose.candidate.yml", import.meta.url),
    "utf8",
  );
  const slotMatches = overlayText.match(
    /info\.taskdesk\.selection\.slot:\s*\$\{SIT_CANDIDATE_SLOT:\?Set SIT_CANDIDATE_SLOT to the candidate slot\}/g,
  );
  assert.equal(slotMatches?.length, 11);
  const captured = JSON.parse(
    readFileSync(
      new URL("./local-candidate-compose-real.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  captured.candidateConfig.services.taskdesk.environment.TASKDESK_ROLE = "web";
  const deriveRuntimeSnapshotFromConfig = (candidateConfig) => {
    const base = snapshot(image, candidateVolumes(slot));
    base.config = structuredClone(candidateConfig);
    for (const container of base.containers) {
      const name = container.Config.Labels["com.docker.compose.service"];
      const service = base.config.services[name];
      const inspected =
        name === "taskdesk"
          ? base.imageInspection
          : base.supportingImages[name];
      container.Config.Env = [
        ...inspected.Config.Env,
        ...Object.entries(service.environment || {}).map(
          ([key, value]) => `${key}=${value}`,
        ),
      ];
      container.Config.Labels = {
        "com.docker.compose.project": localProject,
        "com.docker.compose.service": name,
        ...(service.labels || {}),
      };
    }
    for (const netKey of ["backend", "ingress"]) {
      base.networkInspection[netKey].Labels = {
        "com.docker.compose.project": localProject,
        "com.docker.compose.network": netKey,
        ...(base.config.networks[netKey]?.labels || {}),
      };
    }
    base.volumeInspection = base.volumeInspection.map((vol) => {
      const key = vol.Labels["com.docker.compose.volume"];
      return {
        ...vol,
        Labels: {
          "com.docker.compose.project": localProject,
          "com.docker.compose.volume": key,
          ...(base.config.volumes[key]?.labels || {}),
        },
      };
    });
    return base;
  };
  const validDerived = deriveRuntimeSnapshotFromConfig(
    captured.candidateConfig,
  );
  assert.doesNotThrow(() =>
    assertSelectionSnapshot(validDerived, {
      slot,
      volumes: candidateVolumes(slot),
      networks: candidateNetworks(slot),
      image,
      privateDir: candidatePrivateDir,
      baselinePrivateDir,
    }),
  );

  for (const mutate of [
    (cfg) => {
      delete cfg.services.taskdesk.labels;
    },
    (cfg) => {
      delete cfg.services.postgres.labels["info.taskdesk.selection.slot"];
    },
    (cfg) => {
      delete cfg.volumes["postgres-data"].labels;
    },
    (cfg) => {
      delete cfg.networks.backend.labels;
    },
    (cfg) => {
      cfg.networks.ingress.labels["info.taskdesk.selection.slot"] = "f".repeat(
        32,
      );
    },
  ]) {
    const brokenConfig = structuredClone(captured.candidateConfig);
    mutate(brokenConfig);
    const derived = deriveRuntimeSnapshotFromConfig(brokenConfig);
    assert.throws(() =>
      assertSelectionSnapshot(derived, {
        slot,
        volumes: candidateVolumes(slot),
        networks: candidateNetworks(slot),
        image,
        privateDir: candidatePrivateDir,
        baselinePrivateDir,
      }),
    );
  }

  const f = fixture(t);
  f.adapter.selectCandidate = async () => {
    const baseSnap = snapshot();
    const brokenConfig = structuredClone(captured.candidateConfig);
    delete brokenConfig.services.taskdesk.labels;
    const candSnap = deriveRuntimeSnapshotFromConfig(brokenConfig);
    const originalIds = new Set(baseSnap.containers.map((c) => c.Id));
    const originalUsers = f.daemon.state.inventory.filter((container) =>
      originalIds.has(container.Id),
    );
    const defaultNet = f.daemon.state.networks[baselineNetworks.default];
    for (const original of originalUsers) {
      if (original.State.Running)
        emitDaemonEvent(f.daemon.state, "container", "stop", original.Id);
      original.State.Running = false;
      original.Name += `-retained-${slot}`;
      original.NetworkSettings.Networks = {};
      delete defaultNet.Containers[original.Id];
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: original.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "rename", original.Id);
    }
    for (const net of [
      candSnap.networkInspection.backend,
      candSnap.networkInspection.ingress,
    ]) {
      f.daemon.state.networks[net.Name] = structuredClone(net);
      emitDaemonEvent(f.daemon.state, "network", "create", net.Id);
    }
    f.daemon.state.inventory = [
      ...originalUsers,
      ...structuredClone(candSnap.containers),
    ];
    for (const current of candSnap.containers) {
      emitDaemonEvent(f.daemon.state, "container", "create", current.Id);
      emitDaemonEvent(
        f.daemon.state,
        "network",
        "connect",
        candSnap.networkInspection.backend.Id,
        { container: current.Id },
      );
      if (current.Config.Labels["com.docker.compose.service"] === "traefik") {
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "connect",
          candSnap.networkInspection.ingress.Id,
          { container: current.Id },
        );
      }
      emitDaemonEvent(f.daemon.state, "container", "start", current.Id);
    }
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("inspectCandidate"), false);
});

for (const [label, mutate] of [
  [
    "missing baselineProfileDir and candidate profileDir equal to baselineProfileDir",
    (b) => {
      delete b.sessionIsolation.baselineProfileDir;
      b.sessionIsolation.profileDir = baselineProfileDir;
    },
  ],
  [
    "missing baselineProfileDir with distinct candidate profileDir",
    (b) => {
      delete b.sessionIsolation.baselineProfileDir;
    },
  ],
  [
    "spoofed baselineProfileDir while candidate profileDir reuses frozen baselineProfileDir",
    (b) => {
      b.sessionIsolation.baselineProfileDir =
        "/var/tmp/spoofed-baseline-browser";
      b.sessionIsolation.profileDir = baselineProfileDir;
    },
  ],
  [
    "candidate profileDir equals frozen baselineProfileDir",
    (b) => {
      b.sessionIsolation.profileDir = baselineProfileDir;
    },
  ],
]) {
  test(`browser isolation rejects ${label}`, async (t) => {
    const f = fixture(t);
    f.adapter.browserWindow = async () => {
      const b = defaultBrowserResult(slot);
      mutate(b);
      return b;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("returnToBaseline"), false);
    assert.equal(retained(f), true);
  });
}

for (const badBoundaryProfile of [
  undefined,
  "",
  "relative/browser-profile",
  `${baselinePrivateDir}/browser`,
  `${candidatePrivateDir}/browser`,
]) {
  test(`boundary inspection rejects invalid baselineProfileDir ${String(badBoundaryProfile)} before backup`, async (t) => {
    const f = fixture(t);
    f.boundary.baselineProfileDir = badBoundaryProfile;
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("quiesceAndBackup"), false);
    assert.equal(retained(f), true);
  });
}

test("boundary baselineProfileDir drift during selection stops before the next action", async (t) => {
  const f = fixture(t);
  f.adapter.selectCandidate = async () => {
    f.boundary.baselineProfileDir = "/var/tmp/changed-baseline-browser";
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("inspectCandidate"), false);
  assert.equal(retained(f), true);
});

for (const [label, delayMode] of [
  [
    "candidate taskdesk starts while baseline mailpit is still running before delayed baseline mailpit stop/disconnect/rename",
    "running",
  ],
  [
    "candidate taskdesk starts while stopped baseline mailpit is still connected and unrenamed before delayed disconnect/rename",
    "connected-unrenamed",
  ],
]) {
  test(`lifecycle event replay rejects cross-generation overlap between events when ${label}`, async (t) => {
    const f = fixture(t);
    f.adapter.selectCandidate = async () => {
      const baseSnap = snapshot();
      const candSnap = snapshot(image, candidateVolumes(slot));
      const originalIds = new Set(baseSnap.containers.map((c) => c.Id));
      const originalUsers = f.daemon.state.inventory.filter((container) =>
        originalIds.has(container.Id),
      );
      const defaultNet = f.daemon.state.networks[baselineNetworks.default];
      let delayedMailpit = null;
      for (const original of originalUsers) {
        const role = original.Config.Labels["com.docker.compose.service"];
        if (role === "mailpit") {
          delayedMailpit = original;
          if (delayMode === "connected-unrenamed") {
            emitDaemonEvent(f.daemon.state, "container", "stop", original.Id);
          }
          continue;
        }
        if (original.State.Running)
          emitDaemonEvent(f.daemon.state, "container", "stop", original.Id);
        original.State.Running = false;
        original.Name += `-retained-${slot}`;
        original.NetworkSettings.Networks = {};
        delete defaultNet.Containers[original.Id];
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "disconnect",
          defaultNet.Id,
          {
            container: original.Id,
          },
        );
        emitDaemonEvent(f.daemon.state, "container", "rename", original.Id);
      }
      for (const net of [
        candSnap.networkInspection.backend,
        candSnap.networkInspection.ingress,
      ]) {
        f.daemon.state.networks[net.Name] = structuredClone(net);
        emitDaemonEvent(f.daemon.state, "network", "create", net.Id);
      }
      f.daemon.state.inventory = [
        ...originalUsers,
        ...structuredClone(candSnap.containers),
      ];
      for (const current of candSnap.containers) {
        emitDaemonEvent(f.daemon.state, "container", "create", current.Id);
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "connect",
          candSnap.networkInspection.backend.Id,
          { container: current.Id },
        );
        if (current.Config.Labels["com.docker.compose.service"] === "traefik") {
          emitDaemonEvent(
            f.daemon.state,
            "network",
            "connect",
            candSnap.networkInspection.ingress.Id,
            { container: current.Id },
          );
        }
        emitDaemonEvent(f.daemon.state, "container", "start", current.Id);
      }
      if (delayMode === "running") {
        emitDaemonEvent(f.daemon.state, "container", "stop", delayedMailpit.Id);
      }
      delayedMailpit.State.Running = false;
      delayedMailpit.Name += `-retained-${slot}`;
      delayedMailpit.NetworkSettings.Networks = {};
      delete defaultNet.Containers[delayedMailpit.Id];
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: delayedMailpit.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "rename", delayedMailpit.Id);
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("inspectCandidate"), false);
    assert.equal(f.calls.includes("browserWindow"), false);
    assert.equal(retained(f), true);
  });
}

test("lifecycle event replay rejects cross-generation overlap during return-baseline when baseline starts before candidate is destroyed", async (t) => {
  const f = fixture(t);
  f.adapter.returnToBaseline = async () => {
    const candSnap = snapshot(image, candidateVolumes(slot));
    const restored = snapshot();
    const defaultNet = f.daemon.state.networks[baselineNetworks.default];
    const delayedCandidate = candSnap.containers.find(
      (c) => c.Config.Labels["com.docker.compose.service"] === "mailpit",
    );
    for (const candidate of candSnap.containers) {
      if (candidate.Id === delayedCandidate.Id) continue;
      emitDaemonEvent(f.daemon.state, "container", "stop", candidate.Id);
      emitDaemonEvent(
        f.daemon.state,
        "network",
        "disconnect",
        candSnap.networkInspection.backend.Id,
        { container: candidate.Id },
      );
      if (candidate.Config.Labels["com.docker.compose.service"] === "traefik") {
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "disconnect",
          candSnap.networkInspection.ingress.Id,
          { container: candidate.Id },
        );
      }
      emitDaemonEvent(f.daemon.state, "container", "destroy", candidate.Id);
    }
    f.daemon.state.inventory = [...restored.containers];
    defaultNet.Containers = structuredClone(
      restored.networkInspection.Containers,
    );
    const app = f.daemon.state.inventory.find(
      (container) =>
        container.Config.Labels["com.docker.compose.service"] === "taskdesk",
    );
    app.State.Running = false;
    for (const current of f.daemon.state.inventory) {
      emitDaemonEvent(f.daemon.state, "container", "rename", current.Id);
      emitDaemonEvent(f.daemon.state, "network", "connect", defaultNet.Id, {
        container: current.Id,
      });
      if (current.Config.Labels["com.docker.compose.service"] !== "taskdesk")
        emitDaemonEvent(f.daemon.state, "container", "start", current.Id);
    }
    emitDaemonEvent(f.daemon.state, "container", "stop", delayedCandidate.Id);
    emitDaemonEvent(
      f.daemon.state,
      "network",
      "disconnect",
      candSnap.networkInspection.backend.Id,
      { container: delayedCandidate.Id },
    );
    emitDaemonEvent(
      f.daemon.state,
      "container",
      "destroy",
      delayedCandidate.Id,
    );
    for (const net of [
      candSnap.networkInspection.backend,
      candSnap.networkInspection.ingress,
    ]) {
      delete f.daemon.state.networks[net.Name];
      emitDaemonEvent(f.daemon.state, "network", "destroy", net.Id);
    }
    return {
      image: baselineImage,
      volumes: baselineVolumes,
      networks: baselineNetworks,
      data: structuredClone(data),
      writerState: candSnap.containers
        .filter(
          (container) =>
            container.Config.Labels["com.docker.compose.service"] ===
            "taskdesk",
        )
        .map((container) => ({
          Id: container.Id,
          State: { Running: false },
        })),
    };
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("startBaseline"), false);
  assert.equal(retained(f), true);
});

for (const stopSeq of [
  ["kill", "die", "stop"],
  ["die", "stop"],
  ["kill", "die"],
]) {
  test(`lifecycle event replay accepts normal Docker ${stopSeq.join(" -> ")} sequence across backup, select-candidate, and return-baseline`, async (t) => {
    const f = fixture(t);
    f.adapter.quiesceAndBackup = async () => {
      const app = f.daemon.state.inventory.find(
        (container) =>
          container.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      app.State.Running = false;
      for (const action of stopSeq)
        emitDaemonEvent(f.daemon.state, "container", action, app.Id);
      return f.backup;
    };
    f.adapter.selectCandidate = async () => {
      const baseSnap = snapshot();
      const candSnap = snapshot(image, candidateVolumes(slot));
      const originalIds = new Set(baseSnap.containers.map((c) => c.Id));
      const originalUsers = f.daemon.state.inventory.filter((container) =>
        originalIds.has(container.Id),
      );
      const defaultNet = f.daemon.state.networks[baselineNetworks.default];
      for (const original of originalUsers) {
        if (original.State.Running) {
          for (const action of stopSeq)
            emitDaemonEvent(f.daemon.state, "container", action, original.Id);
        }
        original.State.Running = false;
        original.Name += `-retained-${slot}`;
        original.NetworkSettings.Networks = {};
        delete defaultNet.Containers[original.Id];
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "disconnect",
          defaultNet.Id,
          {
            container: original.Id,
          },
        );
        emitDaemonEvent(f.daemon.state, "container", "rename", original.Id);
      }
      for (const net of [
        candSnap.networkInspection.backend,
        candSnap.networkInspection.ingress,
      ]) {
        f.daemon.state.networks[net.Name] = structuredClone(net);
        emitDaemonEvent(f.daemon.state, "network", "create", net.Id);
      }
      f.daemon.state.inventory = [
        ...originalUsers,
        ...structuredClone(candSnap.containers),
      ];
      for (const current of candSnap.containers) {
        emitDaemonEvent(f.daemon.state, "container", "create", current.Id);
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "connect",
          candSnap.networkInspection.backend.Id,
          { container: current.Id },
        );
        if (current.Config.Labels["com.docker.compose.service"] === "traefik") {
          emitDaemonEvent(
            f.daemon.state,
            "network",
            "connect",
            candSnap.networkInspection.ingress.Id,
            { container: current.Id },
          );
        }
        emitDaemonEvent(f.daemon.state, "container", "start", current.Id);
      }
    };
    f.adapter.returnToBaseline = async () => {
      const candSnap = snapshot(image, candidateVolumes(slot));
      for (const candidate of candSnap.containers) {
        for (const action of stopSeq)
          emitDaemonEvent(f.daemon.state, "container", action, candidate.Id);
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "disconnect",
          candSnap.networkInspection.backend.Id,
          { container: candidate.Id },
        );
        if (
          candidate.Config.Labels["com.docker.compose.service"] === "traefik"
        ) {
          emitDaemonEvent(
            f.daemon.state,
            "network",
            "disconnect",
            candSnap.networkInspection.ingress.Id,
            { container: candidate.Id },
          );
        }
        emitDaemonEvent(f.daemon.state, "container", "destroy", candidate.Id);
      }
      for (const net of [
        candSnap.networkInspection.backend,
        candSnap.networkInspection.ingress,
      ]) {
        delete f.daemon.state.networks[net.Name];
        emitDaemonEvent(f.daemon.state, "network", "destroy", net.Id);
      }
      const restored = snapshot();
      f.daemon.state.inventory = [...restored.containers];
      const defaultNet = f.daemon.state.networks[baselineNetworks.default];
      defaultNet.Containers = structuredClone(
        restored.networkInspection.Containers,
      );
      const app = f.daemon.state.inventory.find(
        (container) =>
          container.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      app.State.Running = false;
      for (const current of f.daemon.state.inventory) {
        emitDaemonEvent(f.daemon.state, "container", "rename", current.Id);
        emitDaemonEvent(f.daemon.state, "network", "connect", defaultNet.Id, {
          container: current.Id,
        });
        if (current.Config.Labels["com.docker.compose.service"] !== "taskdesk")
          emitDaemonEvent(f.daemon.state, "container", "start", current.Id);
      }
      return {
        image: baselineImage,
        volumes: baselineVolumes,
        networks: baselineNetworks,
        data: structuredClone(data),
        writerState: candSnap.containers
          .filter(
            (container) =>
              container.Config.Labels["com.docker.compose.service"] ===
              "taskdesk",
          )
          .map((container) => ({
            Id: container.Id,
            State: { Running: false },
          })),
      };
    };
    const result = await coordinateCandidateSelection(f);
    assert.equal(result.returnedToBaseline, true);
    assert.equal(retained(f), false);
  });
}

for (const badStopSeq of [
  ["stop", "kill"],
  ["stop", "die"],
  ["die", "kill"],
  ["stop", "stop"],
  ["die", "die"],
  ["kill", "kill"],
]) {
  test(`lifecycle event replay rejects reversed or duplicate ${badStopSeq.join(" -> ")} stop sequence`, async (t) => {
    const f = fixture(t);
    f.adapter.quiesceAndBackup = async () => {
      const app = f.daemon.state.inventory.find(
        (container) =>
          container.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      app.State.Running = false;
      for (const action of badStopSeq)
        emitDaemonEvent(f.daemon.state, "container", action, app.Id);
      return f.backup;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("verifyBackupArchive"), false);
    assert.equal(retained(f), true);
  });
}

test("lifecycle event replay accepts canonical app kill -> die -> network disconnect -> stop during backup quiescence", async (t) => {
  const f = fixture(t);
  f.adapter.quiesceAndBackup = async () => {
    const app = f.daemon.state.inventory.find(
      (container) =>
        container.Config.Labels["com.docker.compose.service"] === "taskdesk",
    );
    const defaultNet = f.daemon.state.networks[baselineNetworks.default];
    app.State.Running = false;
    emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
    emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
    emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
      container: app.Id,
    });
    emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    return f.backup;
  };
  f.adapter.selectCandidate = async () => {
    const baseSnap = snapshot();
    const candSnap = snapshot(image, candidateVolumes(slot));
    const originalIds = new Set(baseSnap.containers.map((c) => c.Id));
    const originalUsers = f.daemon.state.inventory.filter((container) =>
      originalIds.has(container.Id),
    );
    const defaultNet = f.daemon.state.networks[baselineNetworks.default];
    for (const original of originalUsers) {
      if (original.State.Running) {
        for (const action of ["kill", "die"])
          emitDaemonEvent(f.daemon.state, "container", action, original.Id);
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "disconnect",
          defaultNet.Id,
          {
            container: original.Id,
          },
        );
        emitDaemonEvent(f.daemon.state, "container", "stop", original.Id);
      } else {
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "disconnect",
          defaultNet.Id,
          {
            container: original.Id,
          },
        );
      }
      original.State.Running = false;
      original.Name += `-retained-${slot}`;
      original.NetworkSettings.Networks = {};
      delete defaultNet.Containers[original.Id];
      emitDaemonEvent(f.daemon.state, "container", "rename", original.Id);
    }
    for (const net of [
      candSnap.networkInspection.backend,
      candSnap.networkInspection.ingress,
    ]) {
      f.daemon.state.networks[net.Name] = structuredClone(net);
      emitDaemonEvent(f.daemon.state, "network", "create", net.Id);
    }
    f.daemon.state.inventory = [
      ...originalUsers,
      ...structuredClone(candSnap.containers),
    ];
    for (const current of candSnap.containers) {
      emitDaemonEvent(f.daemon.state, "container", "create", current.Id);
      emitDaemonEvent(
        f.daemon.state,
        "network",
        "connect",
        candSnap.networkInspection.backend.Id,
        { container: current.Id },
      );
      if (current.Config.Labels["com.docker.compose.service"] === "traefik") {
        emitDaemonEvent(
          f.daemon.state,
          "network",
          "connect",
          candSnap.networkInspection.ingress.Id,
          { container: current.Id },
        );
      }
      emitDaemonEvent(f.daemon.state, "container", "start", current.Id);
    }
  };
  const result = await coordinateCandidateSelection(f);
  assert.equal(result.returnedToBaseline, true);
  assert.equal(retained(f), false);
});

for (const [label, injectTamperedBackupStream] of [
  [
    "network disconnect before kill while still running",
    (f, app, defaultNet) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    },
  ],
  [
    "network disconnect after kill before die",
    (f, app, defaultNet) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    },
  ],
  [
    "network disconnect after stop",
    (f, app, defaultNet) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
    },
  ],
  [
    "duplicate network disconnect during kill -> die -> stop",
    (f, app, defaultNet) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    },
  ],
  [
    "network disconnect followed by connect during backup",
    (f, app, defaultNet) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "network", "connect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    },
  ],
  [
    "non-taskdesk baseline postgres network disconnect during backup",
    (f, app, defaultNet, pg) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: pg.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    },
  ],
  [
    "foreign endpoint network disconnect during backup",
    (f, app, defaultNet) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: "f".repeat(64),
      });
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    },
  ],
  [
    "candidate endpoint network disconnect during backup",
    (f, app, defaultNet) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: "b".repeat(64),
      });
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    },
  ],
  [
    "app restart after kill -> die -> network disconnect -> stop during backup",
    (f, app, defaultNet) => {
      app.State.Running = false;
      emitDaemonEvent(f.daemon.state, "container", "kill", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "die", app.Id);
      emitDaemonEvent(f.daemon.state, "network", "disconnect", defaultNet.Id, {
        container: app.Id,
      });
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "start", app.Id);
      emitDaemonEvent(f.daemon.state, "container", "stop", app.Id);
    },
  ],
]) {
  test(`lifecycle event replay rejects tampered backup quiescence stream: ${label}`, async (t) => {
    const f = fixture(t);
    f.adapter.quiesceAndBackup = async () => {
      const app = f.daemon.state.inventory.find(
        (container) =>
          container.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      const pg = f.daemon.state.inventory.find(
        (container) =>
          container.Config.Labels["com.docker.compose.service"] === "postgres",
      );
      const defaultNet = f.daemon.state.networks[baselineNetworks.default];
      injectTamperedBackupStream(f, app, defaultNet, pg);
      return f.backup;
    };
    await assert.rejects(coordinateCandidateSelection(f), /retained/);
    assert.equal(f.calls.includes("verifyBackupArchive"), false);
    assert.equal(retained(f), true);
  });
}
