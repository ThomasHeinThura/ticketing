// Offline tests for scripts/backup.sh: the PTM-07 dump-listing regression and the
// PTM-08 verify-only barrier, pinned target and exclusive output. A stateful fake
// `docker` models the held barrier; no real Docker, database or network is used.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const APP = "a".repeat(64);
const DB = "d".repeat(64);
const SECRET = "never-print-this-password";

const FAKE_DOCKER = String.raw`
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const statePath = process.env.FAKE_STATE;
const s = JSON.parse(readFileSync(statePath, "utf8"));
const argv = process.argv.slice(2);
const joined = argv.join(" ");
appendFileSync(process.env.FAKE_LOG, joined + "\n");
let rule;
for (const r of s.rules) {
  if (!joined.includes(r.match)) continue;
  r.count = (r.count || 0) + 1;
  const hit = r.from !== undefined ? r.count >= r.from : r.nth !== undefined ? r.count === r.nth : true;
  if (hit) { rule = r; break; }
}
writeFileSync(statePath, JSON.stringify(s));
const find = (ref) => Object.keys(s.containers).find((id) => id === ref || id.startsWith(ref));
const out = [];
let code = 0;
function handle() {
  if (argv[0] === "compose") {
    const p = argv.includes("-p") ? argv[argv.indexOf("-p") + 1] : "taskdesk";
    const svc = argv[argv.length - 1];
    for (const [id, c] of Object.entries(s.containers))
      if (c.project === p && c.service === svc) out.push(id.slice(0, 12));
    return;
  }
  if (argv[0] === "inspect") {
    const fmt = argv[2];
    const id = find(argv[3]);
    if (!id) { code = 1; return; }
    const c = s.containers[id];
    if (fmt.includes(".Mounts")) {
      for (const m of c.mounts || [])
        if (m.Destination === "/app/data" || m.Destination === "/app/data/attachments") out.push(m.Type + ":" + m.Name + ":" + m.Destination);
      return;
    }
    if (fmt.includes(".Config.Env")) {
      const key = /eq \(index \$kv 0\) "([A-Z_]+)"/.exec(fmt)[1];
      for (const e of c.env || []) {
        const parts = e.split("=");
        if (parts[0] === key) out.push(parts.length + " " + parts[1]);
      }
      return;
    }
    if (fmt.startsWith("{{.Id}}|")) { out.push([id, c.project, c.service].join("|")); return; }
    if (fmt.includes("com.docker.compose.project")) { out.push(c.project + "|" + c.service); return; }
    if (fmt === "{{.HostConfig.NetworkMode}}|{{len .NetworkSettings.Networks}}") { out.push((c.mode || "default") + "|" + c.networks); return; }
    if (fmt === "{{.Id}}") { out.push(id); return; }
    if (fmt === "{{.Image}}") { out.push("sha256:helper"); return; }
    code = 99; return;
  }
  if (argv[0] === "ps") {
    const filter = argv[argv.indexOf("--filter") + 1];
    for (const [id, c] of Object.entries(s.containers)) {
      if (!c.running) continue;
      if (filter.startsWith("label=com.docker.compose.project=") && c.project === filter.split("=")[2]) out.push(id);
      if (filter.startsWith("volume=") && (c.mounts || []).some((m) => m.Name === filter.slice(7))) out.push(id);
    }
    return;
  }
  if (argv[0] === "exec") {
    const rest = argv.slice(argv[1] === "-i" ? 3 : 2).join(" ");
    if (rest.startsWith("sh -c")) { code = s.containers[DB_ID()].networks === 0 && !s.extraIface ? 0 : 1; return; }
    if (rest.startsWith("psql")) {
      // A witness filtered to the current database misses other databases' clients.
      const sql = argv[argv.indexOf("-c") + 1];
      const others = sql.includes("datname = current_database()") ? 0 : s.otherDbClients || 0;
      out.push(argv[argv.indexOf("-d") + 1] + "|" + ((s.clients || 0) + others)); return;
    }
    if (rest.startsWith("pg_dump")) { process.stdout.write("fake dump"); return; }
    if (rest.startsWith("pg_restore --list")) {
      readFileSync(0);
      if (s.list === "partial") { process.stdout.write("1; fixture entry\n"); code = 42; return; }
      if (s.list === "empty") { process.stdout.write("; comment only\n"); return; }
      process.stdout.write("; comment\n1; fixture entry\n"); return;
    }
    code = 98; return;
  }
  if (argv[0] === "run") { process.stdout.write("fake attachment"); return; }
  code = 97;
}
function DB_ID() { return Object.keys(s.containers).find((k) => s.containers[k].service === "postgres"); }
const effect = rule?.effect;
if (effect === "fail") { if (rule.output) process.stdout.write(rule.output + "\n"); process.exit(rule.code ?? 1); }
if (effect === "override") { process.stdout.write(rule.output + "\n"); process.exit(0); }
if (effect === "mutate") { Object.assign(s, rule.state); for (const r of s.rules) if (r === rule) r.effect = "done"; writeFileSync(statePath, JSON.stringify(s)); }
if (effect === "sleep" || effect === "sleep-then-fail") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, rule.ms);
if (effect === "sleep-then-fail") process.exit(rule.code ?? 1);
handle();
if (out.length) process.stdout.write(out.join("\n") + "\n");
if (effect === "print-then-fail") process.exit(rule.code ?? 1);
process.exit(code);
`;

function heldState() {
  return {
    rules: [],
    clients: 0,
    list: "clean",
    containers: {
      [APP]: {
        project: "taskdesk",
        service: "taskdesk",
        running: false,
        env: [`TASKDESK_AUTH_SECRET=${SECRET}`],
        mounts: [
          { Type: "volume", Name: "fixture-data", Destination: "/app/data" },
        ],
        networks: 1,
      },
      [DB]: {
        project: "taskdesk",
        service: "postgres",
        running: true,
        env: [
          "POSTGRES_DB=taskdesk",
          "POSTGRES_USER=taskdesk",
          `POSTGRES_PASSWORD=${SECRET}`,
        ],
        mounts: [],
        networks: 0,
      },
    },
  };
}

function fixture(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "taskdesk-dump-list-"));
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "bin"));
  cpSync(resolve("scripts/backup.sh"), join(dir, "scripts/backup.sh"));
  cpSync(
    resolve("scripts/lib/compose-data-volume.sh"),
    join(dir, "scripts/lib/compose-data-volume.sh"),
  );
  for (const command of [
    "date",
    "dirname",
    "mkdir",
    "chmod",
    "mv",
    "rm",
    "rmdir",
    "cat",
  ]) {
    const path = ["/bin", "/usr/bin"]
      .map((p) => join(p, command))
      .find(existsSync);
    assert.ok(path, `missing fixture command ${command}`);
    symlinkSync(path, join(dir, "bin", command));
  }
  writeFileSync(join(dir, "fake-docker.mjs"), FAKE_DOCKER);
  writeFileSync(
    join(dir, "bin/docker"),
    `#!/bin/bash\nexec "${process.execPath}" "${join(dir, "fake-docker.mjs")}" "$@"\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(dir, "bin/sha256sum"),
    `#!/bin/bash
set -eu
printf 'checksum\\n' >> "$FAKE_LOG"
[ -z "\${FAKE_SUM_FAIL:-}" ] || { printf 'partial-checksum  postgres.dump\\n'; exit 1; }
printf 'fake-checksum  %s\\n' "$@"
`,
    { mode: 0o700 },
  );
  const state = heldState();
  mutate(state);
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify(state));
  const log = join(dir, "calls");
  const output = join(dir, "output");
  const env = (extra) => ({
    PATH: join(dir, "bin"),
    FAKE_LOG: log,
    FAKE_STATE: statePath,
    ...extra,
  });
  return {
    dir,
    output,
    run(args = ["--output-dir", output], extra = {}) {
      const result = spawnSync(
        "/bin/bash",
        [join(dir, "scripts/backup.sh"), ...args],
        {
          encoding: "utf8",
          env: env(extra),
          timeout: 20000,
        },
      );
      assert.ifError(result.error);
      return {
        ...result,
        calls: existsSync(log) ? readFileSync(log, "utf8") : "",
      };
    },
    spawn(args = ["--output-dir", output], extra = {}) {
      return spawn("/bin/bash", [join(dir, "scripts/backup.sh"), ...args], {
        env: env(extra),
      });
    },
    calls: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function assertRefused(f, r, { reserved = false, reason } = {}) {
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, reason ?? /xx (refusing backup|pg_restore --list)/);

  assert.doesNotMatch(r.stdout, /Backup complete/);
  assert.equal(existsSync(join(f.output, "SHA256SUMS")), false);
  if (!reserved)
    assert.equal(
      existsSync(f.output),
      false,
      "no output directory may be left",
    );
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
}

// --- PTM-07 regression (retained) -------------------------------------------

for (const mode of ["partial", "empty"]) {
  test(`refuses ${mode} dump listing before attachment archive`, () => {
    const f = fixture((s) => {
      s.list = mode;
    });
    try {
      const result = f.run();
      assert.match(result.calls, /pg_restore --list/);
      assert.notEqual(result.status, 0, result.stdout);
      assert.doesNotMatch(result.calls, /(^run |^checksum)/m);
      assertRefused(f, result);
    } finally {
      f.close();
    }
  });
}

test("accepts a successful nonempty dump listing", () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Backup complete: .*pg_restore entries: 1/);
    assert.match(result.calls, /^run .*fixture-data/m);
    assert.match(result.calls, /^checksum$/m);
    assert.ok(existsSync(join(f.output, "attachments.tar")));
    assert.ok(existsSync(join(f.output, "SHA256SUMS")));
    assert.equal(
      readFileSync(join(f.output, "attachment-mount.txt"), "utf8"),
      "/app/data\n",
    );
    assert.match(
      readFileSync(join(f.output, "SHA256SUMS"), "utf8"),
      /attachment-mount\.txt/,
    );
  } finally {
    f.close();
  }
});

// --- PTM-08 positive ---------------------------------------------------------

test("P1: verifies the held barrier around dump, list, archive and checksum publication", () => {
  const f = fixture();
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    const calls = r.calls;
    const witnesses = [
      ...calls.matchAll(/^exec d+ psql -X -Atq -U taskdesk -d taskdesk -c /gm),
    ].map((m) => m.index);
    assert.equal(witnesses.length, 3, "B0, B1 and B2");
    const dump = calls.indexOf(`exec ${DB} pg_dump -Fc -U taskdesk taskdesk`);
    const list = calls.indexOf(`exec -i ${DB} pg_restore --list`);
    const tar = calls.indexOf(
      "run --rm --network none -v fixture-data:/data:ro --entrypoint tar sha256:helper -C /data -cf - .",
    );
    const sum = calls.indexOf("checksum");
    assert.ok(
      witnesses[0] < dump &&
        dump < list &&
        list < witnesses[1] &&
        witnesses[1] < tar,
    );
    assert.ok(tar < sum && sum < witnesses[2]);
    for (const name of [
      "postgres.dump",
      "attachments.tar",
      "attachment-mount.txt",
      "SHA256SUMS",
    ])
      assert.equal(statSync(join(f.output, name)).mode & 0o777, 0o600, name);
    assert.equal(existsSync(join(f.output, ".SHA256SUMS.partial")), false);
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
  } finally {
    f.close();
  }
});

for (const driver of [undefined, "", "filesystem", " FileSystem "]) {
  test(`P2: storage driver ${JSON.stringify(driver)} is accepted`, () => {
    const f = fixture((s) => {
      if (driver !== undefined)
        s.containers[APP].env.push(`TASKDESK_STORAGE_DRIVER=${driver}`);
    });
    try {
      const r = f.run();
      assert.equal(r.status, 0, r.stderr);
    } finally {
      f.close();
    }
  });
}

test("W8: hyphenated database and user names are accepted and passed unsplit", () => {
  const f = fixture((s) => {
    s.containers[DB].env = [
      "POSTGRES_DB=taskdesk-prod",
      "POSTGRES_USER=task-desk",
    ];
  });
  try {
    const r = f.run(undefined, {
      POSTGRES_DB: "taskdesk-prod",
      POSTGRES_USER: "task-desk",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.calls,
      new RegExp(`exec ${DB} pg_dump -Fc -U task-desk taskdesk-prod`),
    );
  } finally {
    f.close();
  }
});

// --- PTM-08 barrier refusals (no output before reservation) ------------------

for (const [name, mutate] of [
  [
    "N1 application running",
    (s) => {
      s.containers[APP].running = true;
    },
  ],
  [
    "N2 another project service running",
    (s) => {
      s.containers["b".repeat(64)] = {
        project: "taskdesk",
        service: "valkey",
        running: true,
        env: [],
        mounts: [],
        networks: 0,
      };
    },
  ],
  [
    "N3 database still attached to a network",
    (s) => {
      s.containers[DB].networks = 1;
    },
  ],
  [
    "N4 non-loopback interface inside the database",
    (s) => {
      s.extraIface = true;
    },
  ],
  [
    "N5 host network mode",
    (s) => {
      s.containers[DB].mode = "host";
    },
  ],
  [
    "N5 container network mode",
    (s) => {
      s.containers[DB].mode = "container:x";
    },
  ],
  [
    "N6 an active client session",
    (s) => {
      s.clients = 1;
    },
  ],
  [
    "R5 H1 an active transaction on another database",
    (s) => {
      s.otherDbClients = 1;
    },
  ],
  [
    "N6 non-numeric session check",
    (s) =>
      s.rules.push({ match: "psql", effect: "override", output: "taskdesk|x" }),
  ],
  [
    "N6 failed session check",
    (s) => s.rules.push({ match: "psql", effect: "fail" }),
  ],
  [
    "N7 a running container mounts the volume",
    (s) => {
      s.containers["e".repeat(64)] = {
        project: "other",
        service: "jobs",
        running: true,
        env: [],
        mounts: [
          { Type: "volume", Name: "fixture-data", Destination: "/app/data" },
        ],
        networks: 0,
      };
    },
  ],
  [
    "N10 S3 driver",
    (s) => s.containers[APP].env.push("TASKDESK_STORAGE_DRIVER=s3"),
  ],
  [
    "N10 mixed-case S3 driver",
    (s) => s.containers[APP].env.push("TASKDESK_STORAGE_DRIVER= S3 "),
  ],
  [
    "N10 unknown driver",
    (s) => s.containers[APP].env.push("TASKDESK_STORAGE_DRIVER=minio"),
  ],
  [
    "N10 driver inspect failure",
    (s) => s.rules.push({ match: "TASKDESK_STORAGE_DRIVER", effect: "fail" }),
  ],
  [
    "W1 container database differs from host",
    (s) => {
      s.containers[DB].env = ["POSTGRES_DB=prod", "POSTGRES_USER=taskdesk"];
    },
  ],
  [
    "W2 container user differs from host",
    (s) => {
      s.containers[DB].env = ["POSTGRES_DB=taskdesk", "POSTGRES_USER=other"];
    },
  ],
  [
    "W3 POSTGRES_DB missing in the container",
    (s) => {
      s.containers[DB].env = ["POSTGRES_USER=taskdesk"];
    },
  ],
  [
    "W4 duplicate POSTGRES_DB",
    (s) => {
      s.containers[DB].env = [
        "POSTGRES_DB=taskdesk",
        "POSTGRES_DB=taskdesk",
        "POSTGRES_USER=taskdesk",
      ];
    },
  ],
  [
    "W5 value containing =",
    (s) => {
      s.containers[DB].env = [
        "POSTGRES_DB=task=desk",
        "POSTGRES_USER=taskdesk",
      ];
    },
  ],
  [
    "W5 invalid characters",
    (s) => {
      s.containers[DB].env = [
        "POSTGRES_DB=task desk",
        "POSTGRES_USER=taskdesk",
      ];
    },
  ],
  [
    "W6 witness names another database",
    (s) =>
      s.rules.push({ match: "psql", effect: "override", output: "other|0" }),
  ],
  [
    "W7 env template error",
    (s) => s.rules.push({ match: "POSTGRES_DB", effect: "fail" }),
  ],
]) {
  test(`refuses before any output: ${name}`, () => {
    const f = fixture(mutate);
    try {
      const r = f.run();
      assertRefused(f, r);
      assert.doesNotMatch(r.calls, /pg_dump|^run /m);
    } finally {
      f.close();
    }
  });
}

// --- B-H1: valid-looking output with a nonzero status is never trusted ---------

for (const [name, rule] of [
  [
    "container ID",
    { match: "inspect --format {{.Id}} ", effect: "print-then-fail" },
  ],
  [
    "labels",
    { match: 'com.docker.compose.service"}} ', effect: "print-then-fail" },
  ],
  ["database env", { match: "POSTGRES_DB", effect: "print-then-fail" }],
  [
    "identity",
    { match: "inspect --format {{.Id}}|", effect: "print-then-fail" },
  ],
  [
    "project inventory",
    { match: "--filter label=", effect: "print-then-fail" },
  ],
  ["volume users", { match: "--filter volume=", effect: "print-then-fail" }],
  [
    "network count",
    { match: "len .NetworkSettings.Networks", effect: "print-then-fail" },
  ],
  ["interface check", { match: "sh -c", effect: "print-then-fail" }],
  ["session witness", { match: "psql", effect: "print-then-fail" }],
]) {
  test(`B-H1: ${name} output with a nonzero exit is refused`, () => {
    const f = fixture((s) => s.rules.push(rule));
    try {
      const r = f.run();
      assertRefused(f, r);
    } finally {
      f.close();
    }
  });
}

for (const [name, rule] of [
  ["B1 session witness", { match: "psql", from: 2, effect: "print-then-fail" }],
  ["B2 session witness", { match: "psql", from: 3, effect: "print-then-fail" }],
  [
    "B1 writer started (N7/N8 interleaving)",
    {
      match: "--filter label=",
      from: 2,
      effect: "override",
      output: `${APP}\n${DB}`,
    },
  ],
  [
    "B2 database reattached (N8)",
    {
      match: "len .NetworkSettings.Networks",
      from: 3,
      effect: "override",
      output: "default|1",
    },
  ],
  [
    "B1 identity changed (N9)",
    {
      match: "inspect --format {{.Id}}|",
      from: 3,
      effect: "override",
      output: `${"f".repeat(64)}|taskdesk|taskdesk`,
    },
  ],
  ["pg_dump failure (N13)", { match: "pg_dump", effect: "fail" }],
  ["tar failure (N13)", { match: "run --rm", effect: "fail" }],
]) {
  test(`refuses after reservation and removes only its own files: ${name}`, () => {
    const f = fixture((s) => s.rules.push(rule));
    try {
      const r = f.run();
      assertRefused(f, r);
    } finally {
      f.close();
    }
  });
}

test("N16: a failing checksum never publishes SHA256SUMS", () => {
  const f = fixture();
  try {
    const r = f.run(undefined, { FAKE_SUM_FAIL: "1" });
    assertRefused(f, r);
  } finally {
    f.close();
  }
});

// --- Exclusive output (N11, N12) ---------------------------------------------

test("N11: an existing complete backup at the target is refused and left unchanged", () => {
  const f = fixture();
  try {
    mkdirSync(f.output);
    const files = {
      "postgres.dump": "old dump",
      "attachments.tar": "old tar",
      SHA256SUMS: "old sums",
    };
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(f.output, name), content);
    const r = f.run();
    assert.notEqual(r.status, 0);
    for (const [name, content] of Object.entries(files))
      assert.equal(readFileSync(join(f.output, name), "utf8"), content);
    assert.deepEqual(readdirSync(f.output).sort(), Object.keys(files).sort());
    assert.doesNotMatch(r.calls, /pg_dump/);
  } finally {
    f.close();
  }
});

for (const [name, prepare] of [
  ["an empty directory", (f) => mkdirSync(f.output)],
  ["a file", (f) => writeFileSync(f.output, "keep")],
  [
    "a symlink to a directory",
    (f) => {
      mkdirSync(join(f.dir, "elsewhere"));
      symlinkSync(join(f.dir, "elsewhere"), f.output);
    },
  ],
  ["a dangling symlink", (f) => symlinkSync(join(f.dir, "missing"), f.output)],
]) {
  test(`N11: an output target that is ${name} is refused untouched`, () => {
    const f = fixture();
    try {
      prepare(f);
      const r = f.run();
      assert.notEqual(r.status, 0);
      assert.doesNotMatch(r.calls, /pg_dump/);
      if (name === "a file")
        assert.equal(readFileSync(f.output, "utf8"), "keep");
      if (name === "a symlink to a directory")
        assert.deepEqual(readdirSync(join(f.dir, "elsewhere")), []);
    } finally {
      f.close();
    }
  });
}

test("N12: a concurrent run with the same target refuses without touching the first", async () => {
  const f = fixture((s) =>
    s.rules.push({ match: "pg_dump", nth: 1, effect: "sleep", ms: 1500 }),
  );
  try {
    const first = f.spawn();
    let firstErr = "";
    first.stderr.on("data", (d) => (firstErr += d));
    for (let i = 0; i < 200 && !f.calls().includes("pg_dump"); i++)
      await new Promise((r) => setTimeout(r, 20));
    const second = f.run();
    assert.notEqual(second.status, 0);
    assert.match(
      second.stderr,
      /output directory exists or cannot be reserved/,
    );
    const status = await new Promise((r) =>
      first.on("exit", (code) => r(code)),
    );
    assert.equal(status, 0, firstErr);
    assert.ok(existsSync(join(f.output, "SHA256SUMS")));
  } finally {
    f.close();
  }
});

test("N13: SIGTERM during the dump removes this run's files", async () => {
  const f = fixture((s) =>
    s.rules.push({ match: "pg_dump", nth: 1, effect: "sleep", ms: 1500 }),
  );
  try {
    const child = f.spawn();
    for (let i = 0; i < 200 && !f.calls().includes("pg_dump"); i++)
      await new Promise((r) => setTimeout(r, 20));
    child.kill("SIGTERM");
    const status = await new Promise((r) =>
      child.on("exit", (code) => r(code)),
    );
    assert.notEqual(status, 0);
    assert.equal(existsSync(f.output), false);
  } finally {
    f.close();
  }
});

test("N15: unknown flags and invalid identifiers fail before Docker", () => {
  for (const args of [
    ["--quiesced"],
    ["--release-from", "x"],
    ["--backup", "../x"],
    ["--backup", "."],
    ["--backup", ""],
    ["--output-dir", "x/.."],
  ]) {
    const f = fixture();
    try {
      const r = f.run(args);
      assert.notEqual(r.status, 0, args.join(" "));
      assert.equal(r.calls, "");
    } finally {
      f.close();
    }
  }
});

// --- R5 H2: a path swapped after reservation cannot redirect writes or cleanup ---

const OLD_FILES = {
  "postgres.dump": "older dump bytes",
  "attachments.tar": "older attachment bytes",
  SHA256SUMS: "older checksums",
};

function olderArchive(f) {
  const old = join(f.dir, "older-backup");
  mkdirSync(old);
  for (const [name, content] of Object.entries(OLD_FILES))
    writeFileSync(join(old, name), content);
  return () => {
    assert.deepEqual(readdirSync(old).sort(), Object.keys(OLD_FILES).sort());
    for (const [name, content] of Object.entries(OLD_FILES))
      assert.equal(readFileSync(join(old, name), "utf8"), content, name);
  };
}

test("R5 H2: a swap between mkdir and use is refused without touching the older archive", () => {
  const f = fixture();
  try {
    const unchanged = olderArchive(f);
    rmSync(join(f.dir, "bin/mkdir"));
    writeFileSync(
      join(f.dir, "bin/mkdir"),
      `#!/bin/bash
/bin/mkdir "$@" || exit $?
last="\${@: -1}"
if [ "$last" = "$SWAP_TARGET" ]; then /bin/mv "$last" "$last.moved" && /bin/ln -s "$SWAP_TO" "$last"; fi
`,
      { mode: 0o700 },
    );
    const r = f.run(undefined, {
      SWAP_TARGET: f.output,
      SWAP_TO: join(f.dir, "older-backup"),
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /replaced before use; nothing was written/);
    assert.doesNotMatch(r.calls, /pg_dump/);
    unchanged();
  } finally {
    f.close();
  }
});

async function swapDuringDump(f, onSwapped) {
  const child = f.spawn();
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  for (let i = 0; i < 200 && !f.calls().includes("pg_dump"); i++)
    await new Promise((r) => setTimeout(r, 20));
  renameSync(f.output, `${f.output}.moved`);
  symlinkSync(join(f.dir, "older-backup"), f.output);
  onSwapped(child);
  const status = await new Promise((r) => child.on("exit", (code) => r(code)));
  return { status, stderr };
}

for (const [name, rule, onSwapped, expectOk] of [
  [
    "a failing dump",
    { match: "pg_dump", nth: 1, effect: "sleep-then-fail", ms: 1200 },
    () => {},
    false,
  ],
  [
    "SIGTERM",
    { match: "pg_dump", nth: 1, effect: "sleep", ms: 1200 },
    (c) => c.kill("SIGTERM"),
    false,
  ],
  [
    "a successful run",
    { match: "pg_dump", nth: 1, effect: "sleep", ms: 1200 },
    () => {},
    true,
  ],
]) {
  test(`R5 H2: a swap after reservation with ${name} leaves the older archive byte-identical`, async () => {
    const f = fixture((s) => s.rules.push(rule));
    try {
      const unchanged = olderArchive(f);
      const { status, stderr } = await swapDuringDump(f, onSwapped);
      unchanged();
      const moved = `${f.output}.moved`;
      if (expectOk) {
        assert.equal(status, 0, stderr);
        assert.ok(existsSync(join(moved, "SHA256SUMS")));
      } else {
        assert.notEqual(status, 0);
        assert.equal(existsSync(join(moved, "postgres.dump")), false);
        assert.match(stderr, /reserved backup directory was moved/);
      }
    } finally {
      f.close();
    }
  });
}
