import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeFresh } from "../../deploy/local-fresh.mjs";
import { PROJECT } from "../../deploy/local-fresh-plan.mjs";
import { deployLocal } from "../../deploy/local-release.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(os.tmpdir(), "fresh-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, "compose.env");
  writeFileSync(envFile, "");
  const env = { SIT_COMPOSE_ENV: envFile, SIT_PRIVATE_DIR: dir };
  const lockRoot = join(dir, "locks");
  const ids = {
    db: "a".repeat(64),
    app: "b".repeat(64),
    proxy: "c".repeat(64),
    helper: "d".repeat(64),
    migration: "e".repeat(64),
    newApp: "f".repeat(64),
  };
  const labels = (service) => ({
    "com.docker.compose.project": PROJECT,
    "com.docker.compose.service": service,
  });
  const image = `ghcr.io/thomasheinthura/taskdesk@sha256:${"7".repeat(64)}`;
  const container = (id, service) => ({
    Id: id,
    Image: `sha256:${"8".repeat(64)}`,
    Config: { Image: image, Labels: labels(service) },
    HostConfig: {},
    NetworkSettings: { Networks: {}, Ports: {} },
    State: { Running: true },
    Mounts: [],
  });
  const db = container(ids.db, "postgres");
  db.HostConfig.PortBindings = {
    "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "62873" }],
  };
  const app = container(ids.app, "taskdesk");
  app.Mounts = [
    {
      Type: "volume",
      Name: `${PROJECT}_attachments`,
      Destination: "/app/data/attachments",
    },
  ];
  const containers = new Map([
    [ids.db, db],
    [ids.app, app],
    [ids.proxy, container(ids.proxy, "traefik")],
  ]);
  const volumes = new Map(
    ["postgres-data", "attachments"].map((key) => [
      `${PROJECT}_${key}`,
      {
        Name: `${PROJECT}_${key}`,
        Driver: "local",
        Mountpoint: `/var/lib/docker/volumes/${PROJECT}_${key}/_data`,
        Labels: {
          "com.docker.compose.project": PROJECT,
          "com.docker.compose.volume": key,
        },
      },
    ]),
  );
  const calls = [];
  let daemon = "daemon-1234";
  let onCall = () => {};
  let sessions = "0";
  let outsideUser = false;
  const run = (bin, args, options = {}) => {
    calls.push([bin, ...args]);
    onCall(bin, args);
    let stdout = "";
    if (bin === "docker") {
      if (args[0] === "context" && args[1] === "show") stdout = "default\n";
      else if (args[0] === "context" && args[1] === "inspect")
        stdout = JSON.stringify([
          { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
        ]);
      else if (args[0] === "info") stdout = daemon;
      else if (args[0] === "ps") {
        const filter = args.at(-1);
        stdout = filter.startsWith("volume=")
          ? outsideUser
            ? "9".repeat(64)
            : ""
          : [...containers.values()]
              .filter(
                (c) =>
                  c.Config.Labels["com.docker.compose.project"] === PROJECT,
              )
              .map((c) => c.Id)
              .join("\n");
      } else if (args[0] === "inspect")
        stdout = JSON.stringify(
          args
            .slice(1)
            .map((id) => containers.get(id))
            .filter(Boolean),
        );
      else if (args[0] === "volume" && args[1] === "ls")
        stdout = [...volumes.values()]
          .filter((v) => v.Labels["com.docker.compose.project"] === PROJECT)
          .map((v) => v.Name)
          .join("\n");
      else if (args[0] === "volume" && args[1] === "inspect")
        stdout = JSON.stringify(
          args
            .slice(2)
            .map((name) => volumes.get(name))
            .filter(Boolean),
        );
      else if (args[0] === "volume" && args[1] === "rm")
        volumes.delete(args[2]);
      else if (args[0] === "volume" && args[1] === "create") {
        const name = args.at(-1);
        const key = name.slice(PROJECT.length + 1);
        volumes.set(name, {
          Name: name,
          Driver: "local",
          Mountpoint: `/volumes/${name}`,
          Labels: {
            "com.docker.compose.project": PROJECT,
            "com.docker.compose.volume": key,
          },
        });
      } else if (args[0] === "network" && args[1] === "disconnect") {
        const networks = containers.get(args[3]).NetworkSettings.Networks;
        for (const [name, net] of Object.entries(networks))
          if (net.NetworkID === args[2]) delete networks[name];
      } else if (args[0] === "network" && args[1] === "connect") {
        const id = args.at(-2);
        containers.get(args.at(-1)).NetworkSettings.Networks.restored = {
          NetworkID: id,
          Aliases: [],
        };
      } else if (args[0] === "stop" || args[0] === "start") {
        const c = containers.get(args.at(-1));
        if (c) c.State.Running = args[0] === "start";
      } else if (args[0] === "rm") containers.delete(args.at(-1));
      else if (args[0] === "create") {
        const marker = args
          .find((a) => a.startsWith("info.taskdesk.attachment-proof="))
          .split("=")[1];
        const helper = container(ids.helper, "proof");
        helper.Config.Labels["info.taskdesk.attachment-proof"] = marker;
        helper.HostConfig.NetworkMode = "none";
        helper.HostConfig.ReadonlyRootfs = true;
        helper.State.Running = false;
        helper.Mounts = [
          {
            Type: "volume",
            Destination: "/app/data/attachments",
            Name: `${PROJECT}_attachments`,
            RW: false,
          },
        ];
        containers.set(ids.helper, helper);
        stdout = ids.helper;
      } else if (args[0] === "exec" && args.includes("writers"))
        stdout = `${sessions}\n`;
      else if (args.includes("pg_restore")) stdout = "1; entry\n";
      else if (args[0] === "compose" && args.includes("run")) {
        containers.set(ids.migration, container(ids.migration, "migrate"));
        stdout = ids.migration;
      } else if (args[0] === "compose" && args.includes("ps"))
        stdout = ids.newApp;
      else if (args[0] === "wait") stdout = "0";
    }
    if (typeof options.stdio?.[1] === "number")
      writeSync(options.stdio[1], "backup\n");
    return { status: 0, stdout };
  };
  const config = {
    name: PROJECT,
    services: {
      postgres: { environment: { POSTGRES_DB: "sit", POSTGRES_USER: "sit" } },
      taskdesk: {
        environment: {
          DISABLE_REGISTRATION: "true",
          DISABLE_PASSWORD_REGISTRATION: "true",
          DISABLE_WORKSPACE_CREATION: "true",
        },
      },
    },
  };
  const opts = {
    env,
    run,
    lockRoot,
    args: ["--confirm-wipe", PROJECT, "--confirm-daemon", "daemon-1234"],
    preflight: () => ({
      config,
      image,
      tag: "v1",
      dbName: "sit",
      prefix: ["compose"],
      composeEnv: {},
    }),
    verifyBackup: () => ({ verified: true }),
    upgrade: () => {
      containers.set(ids.newApp, container(ids.newApp, "taskdesk"));
    },
    report: () => {},
  };
  return {
    dir,
    env,
    ids,
    containers,
    volumes,
    config,
    calls,
    opts,
    setDaemon: (id) => {
      daemon = id;
    },
    onCall: (fn) => {
      onCall = fn;
    },
    setSessions: (value) => {
      sessions = value;
    },
    setOutsideUser: () => {
      outsideUser = true;
    },
  };
}
const removedOriginals = (f) =>
  f.calls.filter(
    ([bin, op, ...args]) =>
      bin === "docker" &&
      ((op === "rm" &&
        Object.values(f.ids).slice(0, 3).includes(args.at(-1))) ||
        (op === "volume" && args[0] === "rm")),
  );

test("requires explicit project and daemon confirmation and rejects removed recovery modes", (t) => {
  const f = fixture(t);
  for (const args of [
    ["--resume"],
    ["--restore-from-backup"],
    ["--confirm-wipe", "other"],
    ["--confirm-wipe", PROJECT],
    ["--confirm-wipe", PROJECT, "--confirm-daemon"],
    ["--confirm-wipe", PROJECT, "--confirm-daemon", "--dry-run"],
    ["--confirm-daemon", "daemon-1234"],
  ])
    assert.throws(() => executeFresh({ ...f.opts, args }), /confirm-wipe/);
  assert.equal(f.calls.length, 0);
});

test("defaults to preview when no confirmation is given and refuses wrong daemon before lock", (t) => {
  const f = fixture(t);
  const previewLines = [];
  executeFresh({
    ...f.opts,
    args: [],
    report: (line) => previewLines.push(line),
  });
  assert.ok(previewLines.includes("Docker daemon ID: daemon-1234"));
  assert.ok(
    previewLines.includes(
      "Docker context: default (unix:///var/run/docker.sock)",
    ),
  );
  assert.ok(previewLines.includes(`Compose project: ${PROJECT}`));
  assert.ok(
    previewLines.some(
      (line) =>
        line.startsWith("Containers: ") &&
        line.includes(f.ids.app) &&
        line.includes(f.ids.db) &&
        line.includes(f.ids.proxy),
    ),
  );
  assert.ok(
    previewLines.some(
      (line) =>
        line.startsWith("Volumes: ") &&
        line.includes(`${PROJECT}_attachments`) &&
        line.includes(`${PROJECT}_postgres-data`),
    ),
  );
  assert.ok(
    !f.calls.some(
      ([bin, op, sub]) =>
        bin === "docker" &&
        (["stop", "start", "create", "rm", "network"].includes(op) ||
          (op === "volume" && sub === "rm")),
    ),
  );

  f.calls.length = 0;
  assert.throws(
    () =>
      executeFresh({
        ...f.opts,
        args: ["--confirm-wipe", PROJECT, "--confirm-daemon", "daemon-wrong"],
      }),
    /Docker daemon ID mismatch/,
  );
  assert.ok(
    !f.calls.some(
      ([bin, op]) => bin === "docker" && !["context", "info"].includes(op),
    ),
  );
});

test("stops application before dumping and completes after proof", (t) => {
  const f = fixture(t);
  executeFresh(f.opts);
  const stop = f.calls.findIndex(
    ([bin, op]) => bin === "docker" && op === "stop",
  );
  const dump = f.calls.findIndex(
    ([bin, op, ...args]) =>
      bin === "docker" && op === "exec" && args.includes("dump"),
  );
  const firstRemoval = f.calls.findIndex(
    ([bin, op, ...args]) =>
      bin === "docker" && op === "rm" && args.at(-1) === f.ids.app,
  );
  const checksums = f.calls.findIndex(
    ([bin, ...args]) => bin === "shasum" && args.includes("-c"),
  );
  assert.ok(
    stop >= 0 && stop < dump && dump < checksums && checksums < firstRemoval,
  );
  assert.equal(removedOriginals(f).length, 5);
});

test("proof failure restarts stopped application and removes no original resources", (t) => {
  const f = fixture(t);
  f.opts.verifyBackup = () => {
    throw new Error("proof failed");
  };
  assert.throws(() => executeFresh(f.opts), /proof failed/);
  assert.equal(removedOriginals(f).length, 0);
  assert.equal(f.containers.get(f.ids.app).State.Running, true);
  assert.equal(f.containers.get(f.ids.proxy).State.Running, true);
});

test("label mismatch before removal refuses the foreign container", (t) => {
  const f = fixture(t);
  f.opts.verifyBackup = () => {
    f.containers.get(f.ids.app).Config.Labels["com.docker.compose.project"] =
      "foreign";
    return { verified: true };
  };
  assert.throws(() => executeFresh(f.opts), /project inventory|ownership/);
  assert.equal(removedOriginals(f).length, 0);
});

test("daemon change during run refuses further destructive commands", (t) => {
  const f = fixture(t);
  f.opts.verifyBackup = () => {
    f.setDaemon("daemon-5678");
    return { verified: true };
  };
  assert.throws(() => executeFresh(f.opts), /daemon or context changed/);
  assert.equal(removedOriginals(f).length, 0);
});

test("same daemon and project lock blocks a second invocation with a different env file", (t) => {
  const f = fixture(t);
  const second = join(f.dir, "second.env");
  writeFileSync(second, "");
  let checked = false;
  f.opts.verifyBackup = () => {
    assert.throws(
      () =>
        executeFresh({ ...f.opts, env: { ...f.env, SIT_COMPOSE_ENV: second } }),
      /already held/,
    );
    checked = true;
    throw new Error("finish test");
  };
  assert.throws(() => executeFresh(f.opts), /finish test/);
  assert.equal(checked, true);
});

test("untrusted disk files cannot select removal targets", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, "fresh-backups"));
  const foreign = "9".repeat(64);
  writeFileSync(
    join(f.dir, "fresh-backups", "journal.json"),
    JSON.stringify({ containers: [foreign], volumes: ["foreign"] }),
  );
  executeFresh(f.opts);
  assert.ok(
    !f.calls.some((call) => call.includes(foreign) || call.includes("foreign")),
  );
});

test("open switches refuse before removal", (t) => {
  const f = fixture(t);
  f.config.services.taskdesk.environment.DISABLE_REGISTRATION = "false";
  assert.throws(() => executeFresh(f.opts), /DISABLE_REGISTRATION/);
  assert.equal(removedOriginals(f).length, 0);
});

test("outside volume users and protected native port prevent removal", (t) => {
  const f = fixture(t);
  f.setOutsideUser();
  assert.throws(() => executeFresh(f.opts), /outside container/);
  assert.equal(removedOriginals(f).length, 0);
  const other = fixture(t);
  other.containers.get(other.ids.app).HostConfig.PortBindings = {
    "5432/tcp": [{ HostPort: "62870" }],
  };
  assert.throws(() => executeFresh(other.opts), /ownership or port/);
  assert.equal(removedOriginals(other).length, 0);
});
test("database is isolated before snapshot and reconnected on proof failure", (t) => {
  const f = fixture(t);
  const network = "1".repeat(64);
  f.containers.get(f.ids.db).NetworkSettings.Networks.sit = {
    NetworkID: network,
    Aliases: ["postgres"],
  };
  f.opts.verifyBackup = () => {
    throw new Error("proof failed");
  };
  assert.throws(() => executeFresh(f.opts), /proof failed/);
  const disconnect = f.calls.findIndex(
    ([bin, op, sub]) =>
      bin === "docker" && op === "network" && sub === "disconnect",
  );
  const dump = f.calls.findIndex(
    ([bin, op, ...args]) =>
      bin === "docker" && op === "exec" && args.includes("dump"),
  );
  const connect = f.calls.findIndex(
    ([bin, op, sub]) =>
      bin === "docker" && op === "network" && sub === "connect",
  );
  assert.ok(disconnect >= 0 && disconnect < dump && connect > dump);
  assert.equal(f.containers.get(f.ids.app).State.Running, true);
  assert.equal(removedOriginals(f).length, 0);
});
test("client sessions prevent snapshot and restart stopped containers", (t) => {
  const f = fixture(t);
  f.setSessions("1");
  assert.throws(() => executeFresh(f.opts), /client sessions/);
  assert.ok(
    !f.calls.some(
      ([bin, op, ...args]) =>
        bin === "docker" && op === "exec" && args.includes("dump"),
    ),
  );
  assert.equal(f.containers.get(f.ids.app).State.Running, true);
  assert.equal(removedOriginals(f).length, 0);
});
test("backup checksum failure prevents removal and restarts the app", (t) => {
  const f = fixture(t);
  f.onCall((bin, args) => {
    if (bin === "shasum" && args.includes("-c"))
      throw new Error("checksum failed");
  });
  assert.throws(() => executeFresh(f.opts), /checksum failed/);
  assert.equal(removedOriginals(f).length, 0);
  assert.equal(f.containers.get(f.ids.app).State.Running, true);
});
test("dry run performs no Docker changes", (t) => {
  const f = fixture(t);
  executeFresh({ ...f.opts, args: [...f.opts.args, "--dry-run"] });
  assert.ok(
    !f.calls.some(
      ([bin, op, sub]) =>
        bin === "docker" &&
        (["stop", "start", "create", "rm"].includes(op) ||
          (op === "volume" && sub === "rm")),
    ),
  );
});

test("database interface isolation failure restarts application before the dump", (t) => {
  const f = fixture(t);
  f.onCall((bin, args) => {
    if (bin === "docker" && args.some((arg) => arg.includes("/sys/class/net")))
      throw new Error("network interface still present");
  });
  assert.throws(() => executeFresh(f.opts), /network interface still present/);
  assert.equal(f.containers.get(f.ids.app).State.Running, true);
  assert.equal(removedOriginals(f).length, 0);
  assert.ok(
    !f.calls.some(
      ([bin, op, ...args]) =>
        bin === "docker" && op === "exec" && args.includes("dump"),
    ),
  );
});

test("release helper preview traces full port proof and subsequent command arguments", async (t) => {
  const { mkdirSync } = await import("node:fs");
  const { previewLocalRelease } = await import(
    "../../deploy/local-release-preview.mjs"
  );
  const f = fixture(t);
  const image = `ghcr.io/thomasheinthura/taskdesk@sha256:${"a".repeat(64)}`;
  const proxy = join(f.env.SIT_PRIVATE_DIR, "proxy");
  mkdirSync(proxy);
  const config = {
    name: PROJECT,
    services: {
      postgres: {
        environment: { POSTGRES_USER: "owner" },
        volumes: [
          {
            type: "volume",
            source: "postgres-data",
            target: "/var/lib/postgresql",
          },
        ],
      },
      taskdesk: {
        image,
        environment: {
          TASKDESK_DATABASE_URL:
            "postgres://taskdesk_app:secret@postgres:5432/sit",
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
        image,
        environment: {
          TASKDESK_ROLE: "migrate",
          TASKDESK_MIGRATION_DATABASE_URL:
            "postgres://owner:secret@postgres:5432/sit",
        },
      },
      traefik: {
        ports: [80, 443].flatMap((target) =>
          ["127.0.0.1", "::1"].map((host_ip) => ({
            target,
            published: String(target),
            host_ip,
            protocol: "tcp",
          })),
        ),
        volumes: [
          { type: "bind", source: proxy, target: "/config", read_only: true },
        ],
      },
    },
    volumes: Object.fromEntries(
      ["postgres-data", "attachments"].map((v) => [
        v,
        { name: `${PROJECT}_${v}` },
      ]),
    ),
  };
  const commands = previewLocalRelease({
    env: f.env,
    config,
    image,
    tag: "v2.0.0",
  });
  const proof = commands.find(
    ([bin, op]) => bin === "docker" && op === "create",
  );
  assert.ok(proof.includes("--security-opt"));
  assert.equal(proof.filter((v) => v === "--publish").length, 4);
  assert.ok(proof.includes(image));
  assert.ok(
    commands.some(
      (c) => c.includes("<new-port-proof-id>") && c.includes("inspect"),
    ),
  );
  assert.ok(
    commands.some(
      (c) => c.includes("<new-release-migration-id>") && c.includes("wait"),
    ),
  );
  assert.ok(
    commands.some((c) => c.includes("--no-deps") && c.includes("taskdesk")),
  );
});

test("open registration override is restricted to dry run", (t) => {
  const f = fixture(t);
  delete f.config.services.taskdesk.environment.DISABLE_REGISTRATION;
  const lines = [];
  executeFresh({
    ...f.opts,
    args: [...f.opts.args, "--dry-run", "--dry-run-allow-open-registration"],
    report: (line) => lines.push(line),
  });
  assert.ok(lines.some((line) => line.includes("WARNING: DRY RUN ONLY")));
  assert.throws(
    () =>
      executeFresh({
        ...f.opts,
        args: [...f.opts.args, "--dry-run-allow-open-registration"],
      }),
    /confirm-wipe/,
  );
});
test("unverified restore receipt never authorizes removal", (t) => {
  const f = fixture(t);
  f.opts.verifyBackup = () => ({});
  assert.throws(() => executeFresh(f.opts), /Restore proof must complete/);
  assert.equal(removedOriginals(f).length, 0);
  assert.equal(f.containers.get(f.ids.app).State.Running, true);
});
test("volume ownership changes are refused", (t) => {
  const f = fixture(t);
  f.opts.verifyBackup = () => {
    f.volumes.get(`${PROJECT}_attachments`).Labels[
      "com.docker.compose.project"
    ] = "foreign";
    return { verified: true };
  };
  assert.throws(() => executeFresh(f.opts), /inventory|ownership/);
  assert.equal(removedOriginals(f).length, 0);
});

test("normal local upgrade shares the daemon and project lock", (t) => {
  const f = fixture(t);
  let checked = false;
  f.opts.verifyBackup = () => {
    assert.throws(
      () =>
        deployLocal({
          args: [],
          env: f.env,
          run: f.opts.run,
          lockRoot: f.opts.lockRoot,
        }),
      /already held/,
    );
    checked = true;
    throw new Error("finish test");
  };
  assert.throws(() => executeFresh(f.opts), /finish test/);
  assert.equal(checked, true);
});

test("removal failure stops the one-shot without using saved recovery targets", (t) => {
  const f = fixture(t);
  let failed = false;
  f.onCall((bin, args) => {
    if (
      !failed &&
      bin === "docker" &&
      args[0] === "rm" &&
      args.at(-1) === f.ids.app
    ) {
      failed = true;
      throw new Error("removal failed");
    }
  });
  assert.throws(() => executeFresh(f.opts), /removal failed/);
  assert.equal(failed, true);
  assert.ok(
    !f.calls.some(
      ([bin, op, sub]) => bin === "docker" && op === "volume" && sub === "rm",
    ),
  );
});
