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
  baselineVolumes,
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
const baselineImage = `ghcr.io/thomasheinthura/taskdesk@sha256:${"a".repeat(64)}`;
const image = `ghcr.io/thomasheinthura/taskdesk-pr-candidate-123-1@sha256:${"b".repeat(64)}`;
const slot = "d".repeat(32);
const data = {
  databaseFingerprint: digest("db"),
  filesFingerprint: digest("files"),
  migrationFingerprint: digest("migrations"),
  tableCount: 184,
  fileCount: 8,
};
function snapshot(selected = baselineImage, volumes = baselineVolumes) {
  const config = canonicalSelectionConfig({
    image: selected,
    privateDir: "/private",
    volumes,
    environment: {
      postgres: { POSTGRES_USER: "owner" },
      taskdesk: {
        TASKDESK_DATABASE_URL: "postgres://taskdesk_app@postgres/test",
      },
      migrate: {
        TASKDESK_ROLE: "migrate",
        TASKDESK_MIGRATION_DATABASE_URL: "postgres://owner@postgres/test",
      },
    },
  });
  const services = config.services;
  const appImage = {
    Id: `sha256:${"c".repeat(64)}`,
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
    "mailpit-data": `${localProject}_mailpit-data`,
  };
  for (const service of Object.values(services))
    service.networks = { default: null };
  supportingImages.postgres.Config.Env = [
    "PGDATA=/var/lib/postgresql/18/docker",
  ];
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
      return {
        Id:
          selected !== baselineImage && name === "postgres"
            ? "a".repeat(64)
            : selected !== baselineImage && name === "taskdesk"
              ? "b".repeat(64)
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
          },
        },
        Image: inspectedImage.Id,
        State: { Running: true, Health: { Status: "healthy" } },
        HostConfig: {
          NetworkMode: `${localProject}_default`,
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
          Networks: {
            [`${localProject}_default`]: { NetworkID: "7".repeat(64) },
          },
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
  return {
    containers,
    postgresPaths: {
      dataDirectory: "/var/lib/postgresql/18/docker",
      walDirectory: "/var/lib/postgresql/18/docker/pg_wal",
    },
    networkInspection: {
      Id: "7".repeat(64),
      Name: `${localProject}_default`,
      Driver: "bridge",
      Scope: "local",
      Internal: false,
      Options: {},
      Labels: {
        "com.docker.compose.project": localProject,
        "com.docker.compose.network": "default",
      },
      Containers: Object.fromEntries(
        containers.map((c) => [c.Id, { Name: c.Name.slice(1) }]),
      ),
    },
    volumeInspection: Object.entries(volumeNames).map(([key, name]) => ({
      Name: name,
      Driver: "local",
      Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
      CreatedAt: "2026-11-10T00:00:00Z",
      Options: {},
      Labels: {
        "com.docker.compose.project": localProject,
        "com.docker.compose.volume": key,
      },
    })),
    imageInspection: appImage,
    supportingImages,
    dockerEndpoint: "unix:///offline-docker.sock",
    contextEndpoint: "unix:///offline-docker.sock",
    daemonId: "offline-daemon-one",
    config,
    existingVolumeNames: Object.values(baselineVolumes),
    runtime: {
      project: localProject,
      image: selected,
      volumes,
      healthy: true,
      agentOrigin: "https://ticketing.localhost",
      portalOrigin: "https://portal.localhost",
      data: structuredClone(data),
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
      (name) => [name, digest(name)],
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
  const adapter = {
    inspectBoundary: () => ({
      dockerEndpoint: "unix:///offline-docker.sock",
      contextEndpoint: "unix:///offline-docker.sock",
      daemonId: "offline-daemon-one",
      privateFiles,
    }),
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
    createAndRestoreSlot: ({ volumes, slot }) => {
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
              "info.taskdesk.selection.slot": slot,
              "com.docker.compose.project": localProject,
              "com.docker.compose.volume":
                key === "database" ? "postgres-data" : "attachments",
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
    selectCandidate: () => {
      const originalIds = new Set(
        snapshot()
          .containers.filter((container) =>
            ["postgres", "taskdesk"].includes(
              container.Config.Labels["com.docker.compose.service"],
            ),
          )
          .map((container) => container.Id),
      );
      const originalUsers = daemon.state.inventory.filter((container) =>
        originalIds.has(container.Id),
      );
      const extra = daemon.state.inventory.filter(
        (container) =>
          container.Config.Labels["com.docker.compose.project"] !==
          localProject,
      );
      for (const original of originalUsers) {
        if (original.State.Running)
          emitDaemonEvent(daemon.state, "container", "stop", original.Id);
        original.State.Running = false;
        original.Name += `-retained-${slot}`;
        original.NetworkSettings.Networks = {};
        emitDaemonEvent(daemon.state, "container", "rename", original.Id);
      }
      const candidate = snapshot(image, candidateVolumes(slot)).containers;
      daemon.state.inventory = [...originalUsers, ...candidate, ...extra];
      for (const current of candidate.filter((container) =>
        ["postgres", "taskdesk"].includes(
          container.Config.Labels["com.docker.compose.service"],
        ),
      )) {
        emitDaemonEvent(daemon.state, "container", "create", current.Id);
        emitDaemonEvent(daemon.state, "container", "start", current.Id);
      }
    },
    inspectCandidate: () => snapshot(image, candidateVolumes(slot)),
    browserWindow: () => ({
      passed: true,
      evidenceHash: digest("offline mocked browser evidence"),
    }),
    returnToBaseline: () => {
      const candidateUsers = snapshot(
        image,
        candidateVolumes(slot),
      ).containers.filter((container) =>
        ["postgres", "taskdesk"].includes(
          container.Config.Labels["com.docker.compose.service"],
        ),
      );
      for (const candidate of candidateUsers) {
        emitDaemonEvent(daemon.state, "container", "stop", candidate.Id);
        emitDaemonEvent(daemon.state, "container", "destroy", candidate.Id);
      }
      daemon.state.inventory = [
        ...snapshot().containers,
        ...daemon.state.inventory.filter(
          (container) =>
            container.Config.Labels["com.docker.compose.project"] !==
            localProject,
        ),
      ];
      const app = daemon.state.inventory.find(
        (container) =>
          container.Config.Labels["com.docker.compose.service"] === "taskdesk",
      );
      app.State.Running = false;
      for (const current of daemon.state.inventory.filter((container) =>
        ["postgres", "taskdesk"].includes(
          container.Config.Labels["com.docker.compose.service"],
        ),
      ))
        emitDaemonEvent(daemon.state, "container", "rename", current.Id);
      emitDaemonEvent(
        daemon.state,
        "container",
        "start",
        daemon.state.inventory.find(
          (container) =>
            container.Config.Labels["com.docker.compose.service"] ===
            "postgres",
        ).Id,
      );
      return {
        image: baselineImage,
        volumes: baselineVolumes,
        data: structuredClone(data),
        writerState: candidateUsers
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
    calls,
    plan: {
      slot,
      baselineImage,
      privateDir: "/private",
      candidate: { image, sourceSha: "e".repeat(40) },
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
          privateDir: "/private",
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
          SIT_PRIVATE_DIR: "/private",
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
        SIT_PRIVATE_DIR: "/private",
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
        SIT_PRIVATE_DIR: "/private",
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
        privateDir: "/private",
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
        privateDir: "/private",
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
      privateDir: "/private",
    }),
  );
});

test("independently captured Compose 5.6.1 JSON passes without accepting override fields", () => {
  const captured = JSON.parse(
    readFileSync(
      new URL("./local-candidate-compose-real.fixture.json", import.meta.url),
      "utf8",
    ),
  );
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
      privateDir: "/private",
    }),
  );
  s.config.services.taskdesk.entrypoint = [];
  assert.throws(() =>
    assertSelectionSnapshot(s, {
      image: baselineImage,
      privateDir: "/private",
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
            privateDir: "/private",
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
      privateDir: "/private",
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
        privateDir: "/private",
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

test("private configuration content changes stop before the next action", async (t) => {
  const f = fixture(t);
  f.adapter.selectCandidate = async () => {
    f.backup.privateFiles["app.env"] = digest("changed private file");
  };
  await assert.rejects(coordinateCandidateSelection(f), /retained/);
  assert.equal(f.calls.includes("inspectCandidate"), false);
});

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
        privateDir: "/private",
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
        image,
        volumes: candidateVolumes(slot),
        privateDir: "/private",
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

test("slots cannot overlap canonical storage and reject arbitrary names", () => {
  const volumes = candidateVolumes(slot);
  assert.equal(
    new Set([...Object.values(volumes), ...Object.values(baselineVolumes)])
      .size,
    4,
  );
  for (const invalid of [
    "baseline",
    "../escape",
    "",
    "f".repeat(31),
    "F".repeat(32),
  ])
    assert.throws(() => candidateVolumes(invalid));
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
      privateDir: "/private",
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
        "postgres://taskdesk_app@localhost:62870/live";
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
          "TASKDESK_DATABASE_URL=postgres://taskdesk_app@outside/live",
        );
    },
    (s) => {
      s.containers[0].HostConfig.PortBindings["5432/tcp"][0].HostPort = "62870";
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
        privateDir: "/private",
      }),
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
    return { passed: true, evidenceHash: digest("browser fixture") };
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
    container.Mounts[0].Name || "unrelated-bind",
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
  "/var/lib/docker/volumes",
  `/var/lib/docker/volumes/${baselineVolumes.files}/_data/nested`,
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

for (const fault of [
  "missing-mounts",
  "omitted-record",
  "duplicate-record",
  "list-race",
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
      const result = f.daemon.run(bin, args, options);
      if (args[0] === "inspect" && args.length > 2) {
        const values = JSON.parse(result.stdout);
        if (fault === "missing-mounts") delete values[0].Mounts;
        if (fault === "omitted-record") values.pop();
        if (fault === "duplicate-record") values.push(values[0]);
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
        return { passed: true, evidenceHash: digest("overflow fixture") };
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
    return { passed: true, evidenceHash: digest("unreachable") };
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
    return { passed: true, evidenceHash: digest("guarded read") };
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
