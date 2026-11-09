import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  acquireLocalReleaseLock,
  deployLocal,
} from "../../deploy/local-release.mjs";

const image = `ghcr.io/thomasheinthura/taskdesk@sha256:${"a".repeat(64)}`;
function fixture() {
  const config = {
    name: "taskdesk-codex-testing",
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
        volumes: [
          {
            type: "volume",
            source: "attachments",
            target: "/app/data/attachments",
          },
        ],
        environment: {
          TASKDESK_DATABASE_URL:
            "postgres://taskdesk_app:secret@postgres:5432/test",
        },
      },
      migrate: {
        image,
        environment: {
          TASKDESK_ROLE: "migrate",
          TASKDESK_MIGRATION_DATABASE_URL:
            "postgres://owner:secret@postgres:5432/test",
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
          {
            type: "bind",
            source: "/private/proxy",
            target: "/config",
            read_only: true,
          },
        ],
      },
    },
    volumes: Object.fromEntries(
      ["postgres-data", "attachments"].map((v) => [
        v,
        { name: `taskdesk-codex-testing_${v}` },
      ]),
    ),
  };
  const calls = [];
  const proof = { id: "d".repeat(64), exists: false, running: false, args: [] };
  const imageId = `sha256:${"b".repeat(64)}`;
  const env = {
    PATH: "/bin",
    SIT_COMPOSE_ENV: "/private/sit.env",
    SIT_PRIVATE_DIR: "/private",
  };
  const run = (bin, args) => {
    calls.push([bin, ...args]);
    const has = (x) => args.includes(x);
    let value = "";
    if (args[0] === "context" && args[1] === "show") value = "local";
    else if (args[0] === "context" && args[1] === "inspect")
      value = JSON.stringify([
        { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
      ]);
    else if (has("--environment")) value = "TASKDESK_IMAGE_TAG=v2.0.0";
    else if (args[0] === "create") {
      proof.args = args;
      proof.exists = true;
      proof.running = false;
      value = proof.id;
    } else if (args[0] === "start" && args[1] === proof.id) {
      proof.running = true;
    } else if (args[0] === "rm" && args.at(-1) === proof.id) {
      proof.exists = false;
      proof.running = false;
    } else if (args[0] === "ps") {
      value = proof.exists ? proof.id : "";
    } else if (args[0] === "inspect" && has(proof.id)) {
      const publishes = (args) =>
        args.flatMap((v, i) => (v === "--publish" ? [args[i + 1]] : []));
      const ports = {};
      for (const value of publishes(proof.args)) {
        const match = value.match(/^(\[::1\]|127\.0\.0\.1):(\d+):(\d+)\/tcp$/);
        const key = `${match[3]}/tcp`;
        ports[key] ??= [];
        ports[key].push({
          HostIp: match[1].replace(/[[\]]/g, ""),
          HostPort: match[2],
        });
      }
      const label = proof.args[proof.args.indexOf("--label") + 1].split("=");
      value = JSON.stringify([
        {
          Id: proof.id,
          Name: `/${proof.args[proof.args.indexOf("--name") + 1]}`,
          Config: {
            Labels: { [label[0]]: label[1] },
            Image: image,
            Healthcheck: { Test: ["NONE"] },
            Entrypoint: ["node"],
            Cmd: [
              "-e",
              "setInterval(() => {}, 60000); setTimeout(() => process.exit(0), 60000)",
            ],
          },
          Image: imageId,
          HostConfig: {
            NetworkMode: "bridge",
            ReadonlyRootfs: true,
            Privileged: false,
            AutoRemove: false,
            SecurityOpt: ["no-new-privileges:true"],
            PublishAllPorts: false,
            CapDrop: ["ALL"],
            PortBindings: ports,
          },
          Mounts: [],
          State: { Running: proof.running },
          NetworkSettings: {
            Networks: proof.running ? { bridge: {} } : {},
            Ports: proof.running ? ports : {},
          },
        },
      ]);
    } else if (has("run")) value = "a".repeat(64);
    else if (args[0] === "wait") value = "0";
    else if (has("config")) value = JSON.stringify(config);
    else if (has("volume")) {
      const name = args.at(-1);
      const key = name.split("_").at(-1);
      value = JSON.stringify([
        {
          Name: name,
          Labels: {
            "com.docker.compose.project": "taskdesk-codex-testing",
            "com.docker.compose.volume": key,
          },
        },
      ]);
    } else if (has("ps") && has("postgres")) value = "pgid";
    else if (has("ps") && has("valkey")) value = "cacheid";
    else if (has("ps") && has("taskdesk")) value = "appid";
    else if (args[0] === "image" && args[1] === "inspect")
      value = JSON.stringify([{ Id: imageId, Config: { Volumes: null } }]);
    else if (args[0] === "inspect" && has("pgid"))
      value = JSON.stringify([
        {
          Config: {
            Labels: { "com.docker.compose.project": "taskdesk-codex-testing" },
          },
          State: { Health: { Status: "healthy" } },
          Mounts: [
            {
              Name: "taskdesk-codex-testing_postgres-data",
              Destination: "/var/lib/postgresql",
            },
          ],
        },
      ]);
    else if (args[0] === "inspect" && has("cacheid"))
      value = JSON.stringify([
        {
          Config: {
            Labels: { "com.docker.compose.project": "taskdesk-codex-testing" },
          },
          State: { Health: { Status: "healthy" } },
        },
      ]);
    else if (args[0] === "inspect" && has("appid"))
      value = JSON.stringify([
        {
          Config: {
            Image: image,
            Labels: { "com.docker.compose.project": "taskdesk-codex-testing" },
          },
          Image: imageId,
          Mounts: [
            {
              Type: "volume",
              Name: "taskdesk-codex-testing_attachments",
              Destination: "/app/data/attachments",
            },
          ],
          HostConfig: {},
          NetworkSettings: { Ports: {} },
        },
      ]);
    return { status: 0, stdout: value };
  };
  return {
    config,
    proof,
    calls,
    env,
    run,
    exists: () => true,
    realpath: (x) => x,
    args: [],
    report: () => {},
    acquireLock: () => () => {},
  };
}
const deploy = (f) => deployLocal(f);
const mutates = (calls) =>
  calls.some(
    (c) => c.includes("pull") || c.includes("run") || c.includes("up"),
  );
const invokesSeeder = ([bin, ...args]) =>
  path.basename(bin) === "seed" ||
  args.some(
    (arg) =>
      arg === "seed" ||
      arg === "--seed" ||
      arg.startsWith("--seed=") ||
      /^seed:[\w-]+$/.test(arg) ||
      /(?:^|[\s/'"])(?:seed|seed-[\w-]+)\.(?:[cm]?js|ts)(?=$|[\s'"])/.test(arg),
  );

test("seeder command check ignores worktree paths but catches seed invocations", () => {
  assert.equal(
    invokesSeeder([
      "docker",
      "compose",
      "-f",
      "/tmp/seed-coverage-review/deploy/compose.testing.yml",
      "up",
    ]),
    false,
  );
  for (const call of [
    ["docker", "compose", "run", "seed"],
    ["docker", "compose", "run", "--seed"],
    ["docker", "compose", "run", "--seed=true"],
    ["node", "apps/api/dist/seed-sit-users.js", "--sit"],
    ["node", "apps/api/dist/seed-uat-users.js", "--uat"],
    ["node", "apps/api/dist/seed-demo.js"],
    ["node", "scripts/seed-uat.mjs"],
    ["node", "scripts/seed.ts"],
    ["node", "scripts/seed-audit-users.ts"],
    ["node", "apps/api/scripts/seed-cli.ts"],
    ["sh", "-c", "node apps/api/dist/seed-sit-users.js --sit"],
    ["pnpm", "run", "seed:demo"],
  ]) {
    assert.equal(invokesSeeder(call), true);
  }
});

test("rejects missing private preflight and all flags before commands", () => {
  for (const flag of [
    "--no-verify",
    "--no-probe",
    "--profile=s3",
    "--profile",
  ]) {
    const f = fixture();
    f.args = [flag];
    assert.throws(() => deploy(f));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  delete f.env.SIT_COMPOSE_ENV;
  assert.throws(() => deploy(f));
  assert.equal(f.calls.length, 0);
  assert.match(deployLocal({ args: ["--help"] }), /SIT_COMPOSE_ENV/);
});

test("rejects unsafe config without pull or start", () => {
  for (const change of [
    (c) => {
      c.services.taskdesk.image = "ghcr.io/thomasheinthura/taskdesk:latest";
    },
    (c) => {
      c.services.migrate.image = `${image}0`;
    },
    (c) => {
      c.name = "other";
    },
    (c) => {
      c.services.taskdesk.environment.TASKDESK_DATABASE_URL =
        "postgres://a:b@localhost:62870/x";
    },
    (c) => {
      c.services.migrate.environment.TASKDESK_MIGRATION_DATABASE_URL =
        "postgres://a:b@outside:5432/x";
    },
    (c) => {
      c.services.taskdesk.environment.TASKDESK_DATABASE_URL =
        "postgres://a:b@postgres:5432/x?host=outside";
    },
    (c) => {
      c.services.migrate.environment.TASKDESK_MIGRATION_DATABASE_URL =
        "postgres://a:b@postgres:5432/x#fragment";
    },
    (c) => {
      c.volumes.attachments.name = "legacy";
    },
    (c) => {
      c.services.traefik.volumes[0].source = "/other";
    },
  ]) {
    const f = fixture();
    change(f.config);
    assert.throws(() => deploy(f));
    assert.equal(mutates(f.calls), false);
  }
});

test("attestation failure and migration failure stop before subsequent actions", () => {
  for (const failAt of ["gh", "run"]) {
    const f = fixture();
    const base = f.run;
    f.run = (bin, args, opts) => {
      const r = base(bin, args, opts);
      return bin === failAt || args.includes(failAt)
        ? { status: 1, stderr: "secret" }
        : r;
    };
    assert.throws(
      () => deploy(f),
      (e) => !e.message.includes("secret"),
    );
    assert.equal(
      f.calls.some((c) => c.includes("up")),
      false,
    );
    if (failAt === "gh") assert.equal(mutates(f.calls), false);
  }
});

test("signed repeat release uses one canonical file, ordered commands and no setup access", () => {
  const f = fixture();
  deploy(f);
  deploy(f);
  const commands = f.calls.map((c) => c.join(" "));
  for (const call of f.calls.filter((c) => c[1] === "compose")) {
    assert.equal(call.filter((x) => x === "-f").length, 1);
    assert.match(
      call[call.indexOf("-f") + 1],
      /deploy\/compose\.testing\.yml$/,
    );
    assert.equal(
      call[call.indexOf("--project-name") + 1],
      "taskdesk-codex-testing",
    );
  }
  const first = commands.slice(0, commands.length / 2);
  assert.ok(
    first.findIndex((x) => x.startsWith("gh ")) <
      first.findIndex((x) => x.includes(" pull ")),
  );
  assert.ok(
    first.findIndex((x) => x.startsWith("cosign verify ")) <
      first.findIndex((x) => x.includes(" pull ")),
  );
  assert.ok(
    first.findIndex((x) => x.includes(" pull ")) <
      first.findIndex((x) => x.includes(" run ")),
  );
  assert.ok(
    first.findIndex((x) => x.includes(" run ")) <
      first.findIndex((x) => x.includes(" up ")),
  );
  assert.equal(
    first.some((x) =>
      / logs |\.env.example|setup|--remove-orphans| down |prune/.test(x),
    ),
    false,
  );
  assert.equal(f.calls.slice(0, f.calls.length / 2).some(invokesSeeder), false);
  assert.ok(first.some((x) => x.includes("health/ready")));
  assert.ok(first.some((x) => x.includes(" run -d --no-deps migrate")));
});

test("failed migration exit removes its exact container and never starts the app", () => {
  const f = fixture();
  const base = f.run;
  f.run = (bin, args, opts) => {
    const r = base(bin, args, opts);
    return args[0] === "wait" ? { status: 0, stdout: "1" } : r;
  };
  assert.throws(() => deploy(f), /Migration failed/);
  assert.ok(
    f.calls.some(
      (c) => c[0] === "docker" && c[1] === "rm" && c[2] === "a".repeat(64),
    ),
  );
  assert.equal(
    f.calls.some((c) => c.includes("up")),
    false,
  );
});

test("invalid migration ID and failed wait stop before app start", () => {
  for (const mode of ["invalid-id", "wait-fails", "invalid-status"]) {
    const f = fixture();
    const base = f.run;
    f.run = (bin, args, opts) => {
      const r = base(bin, args, opts);
      if (mode === "invalid-id" && args.includes("run"))
        return { status: 0, stdout: "not-an-id" };
      if (mode === "wait-fails" && args[0] === "wait") return { status: 1 };
      if (mode === "invalid-status" && args[0] === "wait")
        return { status: 0, stdout: "unknown" };
      return r;
    };
    assert.throws(() => deploy(f));
    assert.equal(
      f.calls.some((c) => c.includes("up")),
      false,
    );
    assert.equal(
      f.calls.some((c) => c[1] === "rm" && c.at(-1) === "a".repeat(64)),
      mode !== "invalid-id",
    );
    if (mode !== "invalid-id")
      assert.ok(
        f.calls.some((c) => c[1] === "stop" && c.at(-1) === "a".repeat(64)),
      );
  }
});

test("wrong running image or published port stops before probe and proxy start", () => {
  for (const mode of [
    "reference",
    "id",
    "port",
    "mount-missing",
    "mount-bind",
    "mount-wrong",
    "mount-duplicate",
  ]) {
    const f = fixture();
    const base = f.run;
    f.run = (bin, args, opts) => {
      const r = base(bin, args, opts);
      if (args[0] === "inspect" && args.includes("appid")) {
        const details = JSON.parse(r.stdout);
        if (mode === "reference") details[0].Config.Image = "other";
        if (mode === "id") details[0].Image = `sha256:${"c".repeat(64)}`;
        if (mode === "mount-missing") details[0].Mounts = [];
        if (mode === "mount-bind") details[0].Mounts[0].Type = "bind";
        if (mode === "mount-wrong") details[0].Mounts[0].Name = "other";
        if (mode === "mount-duplicate")
          details[0].Mounts.push({ ...details[0].Mounts[0] });
        if (mode === "port")
          details[0].HostConfig.PortBindings = {
            "5173/tcp": [{ HostPort: "5173" }],
          };
        return { status: 0, stdout: JSON.stringify(details) };
      }
      return r;
    };
    assert.throws(() => deploy(f));
    assert.equal(
      f.calls.some((c) => c.includes("traefik") && c.includes("up")),
      false,
    );
    assert.equal(
      f.calls.some((c) => c.some((a) => a.includes("health/ready"))),
      false,
    );
  }
});

test("roles, database users and external storage fail before verification or mutation", () => {
  for (const change of [
    (c) => {
      delete c.services.migrate.environment.TASKDESK_ROLE;
    },
    (c) => {
      c.services.migrate.environment.TASKDESK_ROLE = "all";
    },
    (c) => {
      c.services.taskdesk.environment.TASKDESK_ROLE = "migrate";
    },
    (c) => {
      c.services.taskdesk.environment.TASKDESK_ROLE = "jobs";
    },
    (c) => {
      c.services.taskdesk.environment.TASKDESK_MIGRATION_DATABASE_URL =
        "postgres://owner:pw@postgres/test";
    },
    (c) => {
      c.services.taskdesk.environment.TASKDESK_DATABASE_URL =
        "postgres://owner:pw@postgres/test";
    },
    (c) => {
      c.services.migrate.environment.TASKDESK_MIGRATION_DATABASE_URL =
        "postgres://different:pw@postgres/test";
    },
    (c) => {
      c.services.postgres.environment.POSTGRES_USER = "taskdesk_app";
    },
    (c) => {
      c.services.taskdesk.environment.TASKDESK_STORAGE_DRIVER = "s3";
    },
    (c) => {
      c.services.taskdesk.environment.DATABASE_URL =
        "postgres://owner:pw@postgres/test";
    },
    (c) => {
      c.services.taskdesk.environment.OTHER_DATABASE_URL =
        "postgres://owner:pw@postgres/test";
    },
  ]) {
    const f = fixture();
    change(f.config);
    assert.throws(() => deploy(f));
    assert.equal(
      f.calls.some((c) => c[0] === "gh" || c[0] === "cosign"),
      false,
    );
    assert.equal(mutates(f.calls), false);
  }
});

test("remote Docker endpoints and invalid tag fail before mutation", () => {
  for (const mode of ["docker-host", "context", "tag"]) {
    const f = fixture();
    const base = f.run;
    if (mode === "docker-host") f.env.DOCKER_HOST = "ssh://remote";
    f.run = (bin, args, opts) => {
      const r = base(bin, args, opts);
      if (mode === "context" && args[0] === "context" && args[1] === "inspect")
        return {
          status: 0,
          stdout: JSON.stringify([
            { Endpoints: { docker: { Host: "tcp://remote:2375" } } },
          ]),
        };
      if (mode === "tag" && args.includes("--environment"))
        return { status: 0, stdout: "TASKDESK_IMAGE_TAG=bad tag" };
      return r;
    };
    assert.throws(() => deploy(f));
    assert.equal(mutates(f.calls), false);
  }
});

test("cosign failure stops before pull and verifies exact signed tag and workflow", () => {
  const f = fixture();
  const base = f.run;
  f.run = (bin, args, opts) => {
    const r = base(bin, args, opts);
    return bin === "cosign" ? { status: 1, stderr: "private" } : r;
  };
  assert.throws(
    () => deploy(f),
    (e) => !e.message.includes("private"),
  );
  assert.equal(mutates(f.calls), false);
  const call = f.calls.find((c) => c[0] === "cosign");
  assert.ok(call.includes(image));
  assert.ok(call.includes("tag=v2.0.0"));
  assert.ok(
    call.includes(
      "https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main",
    ),
  );
});

test("wait timeout is bounded and removes only owned container", () => {
  const f = fixture();
  const base = f.run;
  let timeout;
  f.run = (bin, args, opts) => {
    const r = base(bin, args, opts);
    if (args[0] === "wait") {
      timeout = opts.timeout;
      return { error: new Error("timeout") };
    }
    return r;
  };
  assert.throws(() => deploy(f));
  assert.equal(timeout, 300000);
  assert.deepEqual(
    f.calls.find((c) => c[1] === "rm" && c.at(-1) === "a".repeat(64)),
    ["docker", "rm", "-f", "a".repeat(64)],
  );
  assert.equal(
    f.calls.some((c) => c.includes("up")),
    false,
  );
});

test("proxy port preflight rejects busy external bindings and inspect failures, accepts its own binding", () => {
  for (const mode of ["busy", "inspect-fails", "own"]) {
    const f = fixture();
    const base = f.run;
    f.run = (bin, args, opts) => {
      const r = base(bin, args, opts);
      if (args.includes("ps") && args.includes("traefik") && mode !== "busy")
        return { status: 0, stdout: "proxyid" };
      if (args[0] === "inspect" && args.includes("proxyid")) {
        if (mode === "inspect-fails") return { status: 1 };
        const bindings = Object.fromEntries(
          [80, 443].map((p) => [
            `${p}/tcp`,
            ["127.0.0.1", "::1"].map((host) => ({
              HostIp: host,
              HostPort: String(p),
            })),
          ]),
        );
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              Config: {
                Labels: {
                  "com.docker.compose.project": "taskdesk-codex-testing",
                  "com.docker.compose.service": "traefik",
                },
              },
              State: { Running: true },
              HostConfig: { PortBindings: bindings },
              NetworkSettings: { Ports: bindings },
            },
          ]),
        };
      }
      if (args[0] === "start" && args[1] === f.proof.id && mode === "busy")
        return { status: 1 };
      return r;
    };
    if (mode === "own") assert.doesNotThrow(() => deploy(f));
    else {
      assert.throws(() => deploy(f));
      assert.equal(
        f.calls.some((c) => c.includes("run") || c.includes("up")),
        false,
      );
    }
  }
});

test("Docker context requires the actual lowercase docker endpoint schema", () => {
  const f = fixture();
  const base = f.run;
  f.run = (bin, args, opts) => {
    const result = base(bin, args, opts);
    if (args[0] === "context" && args[1] === "inspect")
      return {
        status: 0,
        stdout: JSON.stringify([
          { Endpoints: { Docker: { Host: "unix:///var/run/docker.sock" } } },
        ]),
      };
    return result;
  };
  assert.throws(() => deploy(f));
  assert.equal(mutates(f.calls), false);
});

test("real private lock rejects concurrent releases and validates parent handoff", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "taskdesk-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, "compose.env");
  writeFileSync(envFile, "SIT_IMAGE=x\n");
  const env = { SIT_COMPOSE_ENV: envFile };
  const release = acquireLocalReleaseLock(env);
  assert.throws(() => acquireLocalReleaseLock(env), /lock exists/);
  const [pid, token] = readFileSync(`${envFile}.lock/owner`, "utf8")
    .trim()
    .split(" ");
  const modulePath = new URL("../../deploy/local-release.mjs", import.meta.url)
    .href;
  const source = `import {acquireLocalReleaseLock} from ${JSON.stringify(modulePath)}; acquireLocalReleaseLock(process.env)();`;
  const handoff = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      env: {
        ...process.env,
        SIT_COMPOSE_ENV: envFile,
        TASKDESK_LOCAL_LOCK_PID: pid,
        TASKDESK_LOCAL_LOCK_TOKEN: token,
      },
      encoding: "utf8",
    },
  );
  assert.equal(handoff.status, 0, handoff.stderr);
  assert.equal(existsSync(`${envFile}.lock/owner`), true);
  const invalid = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      env: {
        ...process.env,
        SIT_COMPOSE_ENV: envFile,
        TASKDESK_LOCAL_LOCK_PID: pid,
        TASKDESK_LOCAL_LOCK_TOKEN: "0".repeat(64),
      },
      encoding: "utf8",
    },
  );
  assert.notEqual(invalid.status, 0);
  release();
  assert.equal(existsSync(`${envFile}.lock`), false);
  writeFileSync(path.join(dir, ".sit-selection-backup.abc"), "previous");
  assert.throws(
    () => acquireLocalReleaseLock(env),
    /Unresolved private selection/,
  );
  assert.equal(existsSync(`${envFile}.lock`), false);
});

test("engine proof checks all four bindings after signatures and cleans up before migration", () => {
  const f = fixture();
  const reports = [];
  f.report = (value) => reports.push(value);
  deploy(f);
  const calls = f.calls;
  const where = (fn) => calls.findIndex(fn);
  const gh = where((c) => c[0] === "gh");
  const cosign = where((c) => c[0] === "cosign");
  const pull = where((c) => c.includes("pull"));
  const create = where((c) => c[1] === "create");
  const start = where((c) => c[1] === "start" && c[2] === f.proof.id);
  const cleanup = where((c) => c[1] === "rm" && c.at(-1) === f.proof.id);
  const migration = where((c) => c.includes("run") && c.includes("migrate"));
  assert.ok(
    gh < pull &&
      cosign < pull &&
      pull < create &&
      create < start &&
      start < cleanup &&
      cleanup < migration,
  );
  const createArgs = calls[create];
  const publishes = createArgs.flatMap((value, index) =>
    value === "--publish" ? [createArgs[index + 1]] : [],
  );
  assert.deepEqual(
    publishes.sort(),
    [
      "127.0.0.1:80:80/tcp",
      "[::1]:80:80/tcp",
      "127.0.0.1:443:443/tcp",
      "[::1]:443:443/tcp",
    ].sort(),
  );
  assert.equal(createArgs[createArgs.indexOf("--network") + 1], "bridge");
  for (const forbidden of [
    "--env",
    "--env-file",
    "--volume",
    "--mount",
    "--privileged",
  ])
    assert.equal(createArgs.includes(forbidden), false);
  assert.ok(
    createArgs.includes("--read-only") &&
      createArgs.includes("--no-healthcheck"),
  );
  assert.equal(createArgs.includes("--rm"), false);
  assert.equal(
    createArgs[createArgs.indexOf("--security-opt") + 1],
    "no-new-privileges:true",
  );
  assert.match(
    reports.join("\n"),
    new RegExp(`Port proof container started: ${f.proof.id}`),
  );
  assert.match(
    reports.join("\n"),
    new RegExp(`Port proof container removed: ${f.proof.id}`),
  );
  assert.equal(f.proof.exists, false);
});

test("only unowned ports are bound and a fully owned proxy needs no probe", () => {
  for (const ownedCount of [2, 4]) {
    const f = fixture();
    const base = f.run;
    f.run = (bin, args, opts) => {
      const result = base(bin, args, opts);
      if (args.includes("ps") && args.includes("traefik"))
        return { status: 0, stdout: "proxyid" };
      if (args[0] === "inspect" && args.includes("proxyid")) {
        const all = f.config.services.traefik.ports.slice(0, ownedCount);
        const bindings = {};
        for (const e of all) {
          const key = `${e.target}/tcp`;
          bindings[key] ??= [];
          bindings[key].push({ HostIp: e.host_ip, HostPort: e.published });
        }
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              Config: {
                Labels: {
                  "com.docker.compose.project": "taskdesk-codex-testing",
                  "com.docker.compose.service": "traefik",
                },
              },
              State: { Running: true },
              HostConfig: { PortBindings: bindings },
              NetworkSettings: { Ports: bindings },
            },
          ]),
        };
      }
      return result;
    };
    deploy(f);
    const create = f.calls.find((c) => c[1] === "create");
    if (ownedCount === 4) assert.equal(create, undefined);
    else {
      const pubs = create.flatMap((v, i) =>
        v === "--publish" ? [create[i + 1]] : [],
      );
      assert.deepEqual(
        pubs.sort(),
        ["127.0.0.1:443:443/tcp", "[::1]:443:443/tcp"].sort(),
      );
    }
  }
});

test("each absent or incorrect configured or live binding fails closed and cleans exact probe ID", () => {
  for (const kind of ["configured", "live"])
    for (const target of [80, 443])
      for (const host of ["127.0.0.1", "::1"]) {
        const f = fixture();
        const base = f.run;
        f.run = (bin, args, opts) => {
          const r = base(bin, args, opts);
          if (
            args[0] === "inspect" &&
            args.includes(f.proof.id) &&
            f.proof.running
          ) {
            const c = JSON.parse(r.stdout);
            const fields =
              kind === "live"
                ? c[0].NetworkSettings.Ports
                : c[0].HostConfig.PortBindings;
            fields[`${target}/tcp`] = fields[`${target}/tcp`].filter(
              (x) => x.HostIp !== host,
            );
            return { status: 0, stdout: JSON.stringify(c) };
          }
          return r;
        };
        assert.throws(() => deploy(f));
        assert.equal(f.proof.exists, false);
        assert.ok(
          f.calls.some((c) => c[1] === "rm" && c.at(-1) === f.proof.id),
        );
        assert.equal(
          f.calls.some((c) => c.includes("run") || c.includes("up")),
          false,
        );
      }
});

test("probe rejects unsafe image, wrong network, stopped state, inspect and cleanup errors", () => {
  for (const mode of [
    "image-volume",
    "network-none",
    "live-network-missing",
    "stopped",
    "inspect",
    "start",
    "cleanup",
    "cleanup-list",
    "privileged",
    "env",
    "mount",
    "healthcheck",
    "security-opt",
    "auto-remove",
  ]) {
    const f = fixture();
    const base = f.run;
    f.run = (bin, args, opts) => {
      if (
        mode === "cleanup" &&
        args[0] === "rm" &&
        args.at(-1) === f.proof.id
      ) {
        f.calls.push([bin, ...args]);
        return { status: 1 };
      }
      const r = base(bin, args, opts);
      if (
        mode === "image-volume" &&
        args[0] === "image" &&
        args[1] === "inspect"
      )
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              Id: `sha256:${"b".repeat(64)}`,
              Config: { Volumes: { "/data": {} } },
            },
          ]),
        };
      if (mode === "start" && args[0] === "start" && args[1] === f.proof.id)
        return { status: 1 };
      if (
        mode === "cleanup-list" &&
        args[0] === "ps" &&
        args.some((a) => a === `id=${f.proof.id}`)
      )
        return { status: 0, stdout: f.proof.id };
      if (args[0] === "inspect" && args.includes(f.proof.id)) {
        if (mode === "inspect") return { status: 1 };
        const c = JSON.parse(r.stdout);
        if (mode === "network-none") c[0].HostConfig.NetworkMode = "none";
        if (mode === "privileged") c[0].HostConfig.Privileged = true;
        if (mode === "env") c[0].Config.Env = ["SECRET=value"];
        if (mode === "mount") c[0].Mounts = [{ Type: "volume" }];
        if (mode === "healthcheck")
          c[0].Config.Healthcheck = { Test: ["CMD", "node", "app"] };
        if (mode === "security-opt") c[0].HostConfig.SecurityOpt = [];
        if (mode === "auto-remove") c[0].HostConfig.AutoRemove = true;
        if (mode === "live-network-missing" && f.proof.running)
          c[0].NetworkSettings.Networks = {};
        if (mode === "stopped" && f.proof.running) c[0].State.Running = false;
        return { status: 0, stdout: JSON.stringify(c) };
      }
      return r;
    };
    assert.throws(() => deploy(f), `expected ${mode} to fail`);
    assert.equal(
      f.calls.some((c) => c.includes("run") || c.includes("up")),
      false,
    );
    if (mode === "image-volume")
      assert.equal(
        f.calls.some((c) => c[1] === "create"),
        false,
      );
    if (!["image-volume", "cleanup", "inspect"].includes(mode))
      assert.ok(f.calls.some((c) => c[1] === "rm" && c.at(-1) === f.proof.id));
  }
});

test("uncertain create recovers only a uniquely marked, inspected full ID", () => {
  for (const mode of [
    "created-error",
    "invalid-id",
    "lookup-fails",
    "ambiguous",
    "wrong-owner",
  ]) {
    const f = fixture();
    const base = f.run;
    f.run = (bin, args, opts) => {
      const r = base(bin, args, opts);
      if (args[0] === "create")
        return mode === "invalid-id"
          ? { status: 0, stdout: "bad" }
          : { status: 1 };
      if (
        args[0] === "ps" &&
        args.some((a) => a.startsWith("label=info.taskdesk.local-port-proof="))
      ) {
        if (mode === "lookup-fails") return { status: 1 };
        if (mode === "ambiguous")
          return { status: 0, stdout: `${f.proof.id}\n${"e".repeat(64)}` };
      }
      if (
        mode === "wrong-owner" &&
        args[0] === "inspect" &&
        args.includes(f.proof.id)
      ) {
        const c = JSON.parse(r.stdout);
        c[0].Name = "/other";
        return { status: 0, stdout: JSON.stringify(c) };
      }
      return r;
    };
    assert.throws(() => deploy(f));
    const removed = f.calls.some(
      (c) => c[1] === "rm" && c.at(-1) === f.proof.id,
    );
    assert.equal(removed, ["created-error", "invalid-id"].includes(mode));
    assert.equal(
      f.calls.some((c) => c.includes("run") || c.includes("up")),
      false,
    );
  }
});

test("unconfirmed probe ownership is never removed, including a failed second inspection", () => {
  for (const mode of [
    "id",
    "name",
    "label",
    "reference",
    "image-id",
    "second-inspect-fails",
  ]) {
    const f = fixture();
    const base = f.run;
    f.run = (bin, args, opts) => {
      const result = base(bin, args, opts);
      if (args[0] === "inspect" && args.includes(f.proof.id)) {
        if (mode === "second-inspect-fails" && f.proof.running)
          return { status: 1 };
        if (mode !== "second-inspect-fails") {
          const data = JSON.parse(result.stdout);
          const c = data[0];
          if (mode === "id") c.Id = "e".repeat(64);
          if (mode === "name") c.Name = "/foreign";
          if (mode === "label") c.Config.Labels = {};
          if (mode === "reference") c.Config.Image = "foreign";
          if (mode === "image-id") c.Image = `sha256:${"c".repeat(64)}`;
          return { status: 0, stdout: JSON.stringify(data) };
        }
      }
      return result;
    };
    assert.throws(() => deploy(f), /ownership is uncertain/i);
    assert.equal(
      f.calls.some((c) => c[1] === "rm" && c.at(-1) === f.proof.id),
      false,
    );
    assert.equal(
      f.calls.some((c) => c.includes("run") || c.includes("up")),
      false,
    );
  }
});

test("an owned probe that exits early is removed and blocks migration", () => {
  const f = fixture();
  const base = f.run;
  f.run = (bin, args, opts) => {
    const result = base(bin, args, opts);
    if (args[0] === "start" && args[1] === f.proof.id) f.proof.running = false;
    return result;
  };
  assert.throws(() => deploy(f), /network or state/);
  assert.equal(f.proof.exists, false);
  assert.ok(f.calls.some((c) => c[1] === "rm" && c.at(-1) === f.proof.id));
  assert.ok(
    f.calls.some((c) => c[1] === "ps" && c.includes(`id=${f.proof.id}`)),
  );
  assert.equal(
    f.calls.some((c) => c.includes("run") || c.includes("up")),
    false,
  );
});
