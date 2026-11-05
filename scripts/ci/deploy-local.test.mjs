import assert from "node:assert/strict";
import { test } from "node:test";
import { deployLocal } from "../lib/deploy-local.mjs";

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
        { Endpoints: { Docker: { Host: "unix:///var/run/docker.sock" } } },
      ]);
    else if (has("--environment")) value = "TASKDESK_IMAGE_TAG=v2.0.0";
    else if (has("run")) value = "a".repeat(64);
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
      value = JSON.stringify([{ Id: imageId }]);
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
    calls,
    env,
    run,
    exists: () => true,
    realpath: (x) => x,
    args: [],
    report: () => {},
  };
}
const deploy = (f) => deployLocal(f);
const mutates = (calls) =>
  calls.some(
    (c) => c.includes("pull") || c.includes("run") || c.includes("up"),
  );

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
    first.findIndex((x) => x.includes(" pull ")) <
      first.findIndex((x) => x.includes(" run ")),
  );
  assert.ok(
    first.findIndex((x) => x.includes(" run ")) <
      first.findIndex((x) => x.includes(" up ")),
  );
  assert.equal(
    first.some((x) =>
      /seed| logs |\.env.example|setup|--remove-orphans| down |prune/.test(x),
    ),
    false,
  );
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
      f.calls.some((c) => c[1] === "rm"),
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
            { Endpoints: { Docker: { Host: "tcp://remote:2375" } } },
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
  assert.deepEqual(f.calls.filter((c) => c[1] === "rm")[0], [
    "docker",
    "rm",
    "-f",
    "a".repeat(64),
  ]);
  assert.equal(
    f.calls.some((c) => c.includes("up")),
    false,
  );
});
