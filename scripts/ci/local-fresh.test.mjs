import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeFresh } from "../../deploy/local-fresh.mjs";
import { PROJECT } from "../../deploy/local-fresh-plan.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(os.tmpdir(), "fresh-plan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, "compose.env");
  writeFileSync(envFile, "");
  const env = { SIT_COMPOSE_ENV: envFile, SIT_PRIVATE_DIR: dir };
  const pg = "a".repeat(64);
  const app = "b".repeat(64);
  const labels = (service) => ({
    "com.docker.compose.project": PROJECT,
    "com.docker.compose.service": service,
  });
  const containers = [
    {
      Id: pg,
      Config: { Labels: labels("postgres") },
      HostConfig: {},
      State: { Running: true },
    },
    {
      Id: app,
      Config: { Labels: labels("taskdesk") },
      HostConfig: {},
      State: { Running: true },
      Mounts: [
        {
          Type: "volume",
          Name: `${PROJECT}_attachments`,
          Destination: "/app/data/attachments",
        },
      ],
    },
  ];
  const volumes = ["postgres-data", "attachments"].map((v) => ({
    Name: `${PROJECT}_${v}`,
    Labels: {
      "com.docker.compose.project": PROJECT,
      "com.docker.compose.volume": v,
    },
  }));
  const calls = [];
  const run = (bin, args) => {
    calls.push([bin, ...args]);
    let stdout = "";
    if (args[0] === "ps") stdout = `${pg}\n${app}\n`;
    else if (args[0] === "inspect") stdout = JSON.stringify(containers);
    else if (args[0] === "volume" && args[1] === "ls")
      stdout = `${volumes.map((v) => v.Name).join("\n")}\n`;
    else if (args[0] === "volume" && args[1] === "inspect")
      stdout = JSON.stringify(volumes);
    return { status: 0, stdout };
  };
  const preflight = () => ({
    config: {
      name: PROJECT,
      services: {
        postgres: { environment: { POSTGRES_USER: "sit", POSTGRES_DB: "sit" } },
        taskdesk: {
          environment: {
            DISABLE_REGISTRATION: "true",
            DISABLE_PASSWORD_REGISTRATION: "true",
            DISABLE_WORKSPACE_CREATION: "true",
          },
        },
      },
    },
    image: `ghcr.io/thomasheinthura/taskdesk@sha256:${"a".repeat(64)}`,
    tag: "v2.0.0",
    dbName: "sit",
    prefix: ["compose"],
    composeEnv: {},
  });
  return {
    env,
    run,
    calls,
    preflight,
    previewUpgrade: () => [["docker", "inspect", "<new-application-id>"]],
    lock: () => () => {},
    report: () => {},
  };
}
test("dry run only queries Docker and prints the plan", (t) => {
  const f = fixture(t);
  const lines = [];
  executeFresh({
    ...f,
    args: ["--confirm-wipe", PROJECT, "--dry-run"],
    report: (line) => lines.push(line),
  });
  assert.ok(lines.some((line) => line.includes("postgres.dump")));
  assert.ok(lines.some((line) => line.includes("release-smoke.mjs")));
  assert.ok(
    f.calls.every(
      ([bin, op, sub]) =>
        bin === "docker" &&
        (op === "ps" ||
          op === "inspect" ||
          (op === "volume" && ["ls", "inspect"].includes(sub))),
    ),
  );
});
test("failed backup listing prevents all removal", (t) => {
  const f = fixture(t);
  assert.throws(
    () => executeFresh({ ...f, args: ["--confirm-wipe", PROJECT] }),
    /listing is empty/,
  );
  assert.ok(
    !f.calls.some(
      ([bin, op, sub]) =>
        bin === "docker" &&
        (op === "stop" || op === "rm" || (op === "volume" && sub === "rm")),
    ),
  );
});
test("refuses without confirmation before any query", (t) => {
  const f = fixture(t);
  assert.throws(
    () => executeFresh({ ...f, args: ["--dry-run"] }),
    /confirm-wipe/,
  );
  assert.equal(f.calls.length, 0);
});

test("backup checksums are verified before removal is attempted", async (t) => {
  const { writeSync } = await import("node:fs");
  const f = fixture(t);
  const original = f.run;
  f.run = (bin, args, options) => {
    if (bin === "docker" && args[0] === "stop") {
      f.calls.push([bin, ...args]);
      return { status: 1, stdout: "" };
    }
    if (bin === "docker" && args.includes("pg_restore")) {
      f.calls.push([bin, ...args]);
      return { status: 0, stdout: "1; archive entry\n" };
    }
    if (options?.stdio && typeof options.stdio[1] === "number")
      writeSync(options.stdio[1], "backup data\n");
    return original(bin, args, options);
  };
  assert.throws(
    () => executeFresh({ ...f, args: ["--confirm-wipe", PROJECT] }),
    /docker stop failed/,
  );
  const verification = f.calls.findIndex(
    ([bin, ...args]) => bin === "shasum" && args.includes("-c"),
  );
  const removal = f.calls.findIndex(
    ([bin, op]) => bin === "docker" && op === "stop",
  );
  assert.ok(verification >= 0 && removal > verification);
});

test("successful mocked install runs backup, removal, migration, seed and smoke in order", async (t) => {
  const { writeSync } = await import("node:fs");
  const f = fixture(t);
  const original = f.run;
  const migration = "c".repeat(64);
  const app = "d".repeat(64);
  f.run = (bin, args, options) => {
    if (bin === "docker" && args.includes("pg_restore")) {
      f.calls.push([bin, ...args]);
      return { status: 0, stdout: "1; archive entry\n" };
    }
    if (bin === "docker" && args[0] === "wait") {
      f.calls.push([bin, ...args]);
      return { status: 0, stdout: "0\n" };
    }
    if (bin === "docker" && args[0] === "compose" && args.includes("run")) {
      f.calls.push([bin, ...args]);
      return { status: 0, stdout: `${migration}\n` };
    }
    if (bin === "docker" && args[0] === "compose" && args.includes("ps")) {
      f.calls.push([bin, ...args]);
      return { status: 0, stdout: `${app}\n` };
    }
    if (options?.stdio && typeof options.stdio[1] === "number")
      writeSync(options.stdio[1], "data\n");
    return original(bin, args, options);
  };
  f.upgrade = () => f.calls.push(["upgrade"]);
  executeFresh({ ...f, args: ["--confirm-wipe", PROJECT] });
  const position = (predicate) => f.calls.findIndex(predicate);
  const verify = position(
    ([bin, ...args]) => bin === "shasum" && args.includes("-c"),
  );
  const remove = position(([bin, op]) => bin === "docker" && op === "stop");
  const migrated = position(([bin, op]) => bin === "docker" && op === "wait");
  const upgraded = position(([bin]) => bin === "upgrade");
  const seed = position(
    ([bin, ...args]) =>
      bin === "docker" && args.includes("apps/api/dist/seed-sit-users.js"),
  );
  const smoke = position(
    ([bin, ...args]) =>
      bin === "node" && args.includes("scripts/sit/release-smoke.mjs"),
  );
  assert.ok(
    verify >= 0 &&
      verify < remove &&
      remove < migrated &&
      migrated < upgraded &&
      upgraded < seed &&
      seed < smoke,
  );
});

test("missing closed registration switch aborts before inventory", (t) => {
  const f = fixture(t);
  const original = f.preflight;
  f.preflight = () => {
    const result = original();
    delete result.config.services.taskdesk.environment.DISABLE_REGISTRATION;
    return result;
  };
  assert.throws(
    () =>
      executeFresh({ ...f, args: ["--confirm-wipe", PROJECT, "--dry-run"] }),
    /DISABLE_REGISTRATION=true/,
  );
  assert.equal(f.calls.length, 0);
});
test("a volume referenced by an outside container aborts", (t) => {
  const f = fixture(t);
  const original = f.run;
  f.run = (bin, args, options) => {
    if (
      bin === "docker" &&
      args[0] === "ps" &&
      args.some((a) => a.startsWith("volume="))
    )
      return { status: 0, stdout: `${"e".repeat(64)}\n` };
    return original(bin, args, options);
  };
  assert.throws(
    () =>
      executeFresh({ ...f, args: ["--confirm-wipe", PROJECT, "--dry-run"] }),
    /outside container/,
  );
});

test("open registration override is dry-run only and warns while preserving masked resource plan", (t) => {
  const f = fixture(t);
  const pre = f.preflight;
  f.preflight = () => {
    const result = pre();
    delete result.config.services.taskdesk.environment.DISABLE_REGISTRATION;
    return result;
  };
  const lines = [];
  executeFresh({
    ...f,
    args: [
      "--confirm-wipe",
      PROJECT,
      "--dry-run",
      "--dry-run-allow-open-registration",
    ],
    report: (line) => lines.push(line),
  });
  const output = lines.join("\n");
  assert.match(output, /WARNING: DRY RUN ONLY/);
  assert.match(output, /DISABLE_REGISTRATION=true/);
  assert.ok(output.includes(`${PROJECT}_attachments`));
  assert.ok(output.includes("a".repeat(64)));
  assert.ok(output.includes("ghcr.io/thomasheinthura/taskdesk@sha256:"));
  assert.ok(output.includes("v2.0.0"));
  assert.ok(!output.includes(f.env.SIT_PRIVATE_DIR));
  assert.ok(!output.includes(f.env.SIT_COMPOSE_ENV));
  assert.ok(
    f.calls.every(
      ([bin, op, sub]) =>
        bin === "docker" &&
        (op === "ps" ||
          op === "inspect" ||
          (op === "volume" && ["ls", "inspect"].includes(sub))),
    ),
  );
  assert.throws(
    () =>
      executeFresh({
        ...f,
        args: ["--confirm-wipe", PROJECT, "--dry-run-allow-open-registration"],
      }),
    /confirm-wipe/,
  );
  assert.throws(
    () => executeFresh({ ...f, args: ["--confirm-wipe", PROJECT] }),
    /DISABLE_REGISTRATION=true/,
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
