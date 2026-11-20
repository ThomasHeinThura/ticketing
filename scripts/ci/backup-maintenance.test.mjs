// Offline tests for scripts/backup-maintenance.sh (PTM-08). A stateful fake
// `docker` models containers, networks and aliases; scripts/backup.sh is a stub.
// No real Docker, database or network is used.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
const VALKEY = "b".repeat(64);
const MIGRATE = "c".repeat(64);
const FOREIGN = "e".repeat(64);
const N1 = "1".repeat(64);
const N2 = "2".repeat(64);
const SECRET = "never-print-this-password";

// The fake docker CLI. Rules in state.rules inject failures by matching the
// joined argv; effects: fail | print-then-fail | apply-then-fail | override.
const FAKE_DOCKER = String.raw`
import { readFileSync, writeFileSync, appendFileSync, readdirSync, renameSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
const statePath = process.env.FAKE_STATE;
const s = JSON.parse(readFileSync(statePath, "utf8"));
const argv = process.argv.slice(2);
const joined = argv.join(" ");
appendFileSync(process.env.FAKE_LOG, joined + "\n");
const save = () => writeFileSync(statePath, JSON.stringify(s));
let rule;
for (const r of s.rules) {
  if (!joined.includes(r.match)) continue;
  r.count = (r.count || 0) + 1;
  const hit = r.from !== undefined ? r.count >= r.from : r.nth !== undefined ? r.count === r.nth : true;
  if (hit) { rule = r; break; }
}
const find = (ref) => Object.keys(s.containers).find((id) => id === ref || id.startsWith(ref));
const out = [];
let code = 0;
function handle() {
  if (argv[0] === "compose") {
    const p = argv[argv.indexOf("-p") + 1];
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
    if (fmt.includes("join $n.Aliases")) {
      for (const [nid, aliases] of Object.entries(c.networks)) out.push(nid + " " + aliases.join(","));
      return;
    }
    if (fmt.includes("$n.NetworkID")) { for (const nid of Object.keys(c.networks)) out.push(nid); return; }
    if (fmt.includes("oneoff")) { out.push([id, c.project, c.service, c.oneoff ?? "False"].join("|")); return; }
    if (fmt.startsWith("{{.Id}}|")) { out.push([id, c.project, c.service].join("|")); return; }
    if (fmt.includes("com.docker.compose.project")) { out.push(c.project + "|" + c.service); return; }
    if (fmt === "{{.State.Running}}|{{.HostConfig.NetworkMode}}") { out.push(c.running + "|" + (c.mode || "default")); return; }
    if (fmt === "{{.HostConfig.NetworkMode}}|{{len .NetworkSettings.Networks}}") { out.push((c.mode || "default") + "|" + Object.keys(c.networks).length); return; }
    if (fmt === "{{.State.Running}}") { out.push(String(c.running)); return; }
    if (fmt === "{{.Id}}") { out.push(id); return; }
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
  if (argv[0] === "stop") { s.containers[find(argv[1])].running = false; out.push(argv[1]); return; }
  if (argv[0] === "start") { for (const ref of argv.slice(1)) s.containers[find(ref)].running = true; return; }
  if (argv[0] === "network" && argv[1] === "disconnect") {
    if (process.env.FAKE_SWAP_POINT) {
      let attempted = "";
      try { attempted = readFileSync("./attempted", "utf8"); } catch {}
      if (!attempted.split("\n").includes(argv[2])) { code = 1; return; }
      appendFileSync(process.env.FAKE_LOG, "evidence-before-disconnect " + argv[2] + "\n");
    }
    const c = s.containers[find(argv[3])];
    if (!c.networks[argv[2]]) { code = 1; return; }
    delete c.networks[argv[2]]; return;
  }
  if (argv[0] === "network" && argv[1] === "connect") {
    const aliases = [];
    for (let i = 2; i < argv.length - 2; i += 2) aliases.push(argv[i + 1]);
    const c = s.containers[find(argv[argv.length - 1])];
    c.networks[argv[argv.length - 2]] = s.aliasMutation && (!s.aliasMutationNetwork || s.aliasMutationNetwork === argv[argv.length - 2]) ? s.aliasMutation : s.reverseAliases ? aliases.reverse() : aliases;
    return;
  }
  if (argv[0] === "exec") {
    const id = find(argv[1]);
    const rest = argv.slice(2).join(" ");
    if (rest.startsWith("psql")) {
      const db = argv[argv.indexOf("-d") + 1];
      // A witness filtered to the current database misses other databases' clients.
      const sql = argv[argv.indexOf("-c") + 1];
      const others = sql.includes("datname = current_database()") ? 0 : s.otherDbClients || 0;
      out.push(db + "|" + ((s.clients || 0) + others)); return;
    }
    if (rest.includes("node:dns")) {
      const pg = s.containers[Object.keys(s.containers).find((k) => s.containers[k].service === "postgres")];
      code = s.containers[id].running && Object.values(pg.networks).some((a) => a.includes("postgres")) ? 0 : 1; return;
    }
    if (rest.includes("fetch(")) { code = s.containers[id].running && !s.readyFails ? 0 : 1; return; }
    code = 98; return;
  }
  code = 97;
}
const effect = rule?.effect;
if (effect === "fail") {
  if (rule.output) process.stdout.write(rule.output + "\n");
  process.exit(rule.code ?? 1);
}
if (effect === "override") { process.stdout.write(rule.output + "\n"); save(); process.exit(0); }
handle();
if (effect === "side") {
  // A state change right after a successful command (e.g. a writer exits after the health check).
  if (rule.stop) s.containers[rule.stop].running = false;
  if (rule.dropNetwork) for (const c of Object.values(s.containers)) if (c.service === "postgres") delete c.networks[rule.dropNetwork];
}
if (process.env.FAKE_SWAP_POINT && joined.includes(process.env.FAKE_SWAP_POINT) && !existsSync(process.env.FAKE_SWAP_DONE)) {
  const root = process.env.FAKE_RECORD_ROOT;
  const name = readdirSync(root).find((item) => item.startsWith(".maintenance-drill-"));
  const original = join(root, name);
  renameSync(original, original + ".moved");
  symlinkSync(process.env.FAKE_PROTECTED, original);
  writeFileSync(process.env.FAKE_SWAP_DONE, "done");
}
save();
if (out.length) process.stdout.write(out.join("\n") + "\n");
if (effect === "print-then-fail" || effect === "apply-then-fail") process.exit(rule.code ?? 1);
process.exit(code);
`;

function baseState() {
  return {
    rules: [],
    clients: 0,
    containers: {
      [APP]: {
        project: "drill",
        service: "taskdesk",
        running: true,
        env: ["TASKDESK_ROLE=all", `TASKDESK_AUTH_SECRET=${SECRET}`],
        mounts: [
          {
            Type: "volume",
            Name: "drill_taskdesk-data",
            Destination: "/app/data",
          },
        ],
        networks: { [N1]: ["drill-taskdesk-1", "taskdesk"] },
      },
      [DB]: {
        project: "drill",
        service: "postgres",
        running: true,
        env: [
          "POSTGRES_DB=taskdesk",
          "POSTGRES_USER=taskdesk",
          `POSTGRES_PASSWORD=${SECRET}`,
        ],
        mounts: [],
        networks: {
          [N1]: ["drill-postgres-1", "postgres"],
          [N2]: ["postgres"],
        },
      },
      [VALKEY]: {
        project: "drill",
        service: "valkey",
        running: true,
        env: [],
        mounts: [],
        networks: { [N1]: ["valkey"] },
      },
    },
  };
}

const FORBIDDEN =
  /^compose .* (up|run|restart|start|stop|create)( |$)|^restart |^pull |migrate|pg_terminate_backend|^run /m;

function fixture(mutate = () => {}) {
  mkdirSync(resolve(".cache"), { recursive: true });
  const dir = mkdtempSync(join(resolve(".cache"), "backup-maintenance-test-"));
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "bin"));
  cpSync(
    resolve("scripts/backup-maintenance.sh"),
    join(dir, "scripts/backup-maintenance.sh"),
  );
  cpSync(
    resolve("scripts/lib/compose-data-volume.sh"),
    join(dir, "scripts/lib/compose-data-volume.sh"),
  );
  writeFileSync(join(dir, "fake-docker.mjs"), FAKE_DOCKER);
  writeFileSync(
    join(dir, "bin/docker"),
    `#!/bin/bash\nexec "${process.execPath}" "${join(dir, "fake-docker.mjs")}" "$@"\n`,
    { mode: 0o700 },
  );
  writeFileSync(join(dir, "bin/sleep"), "#!/bin/bash\nexit 0\n", {
    mode: 0o700,
  });
  // Stub backup.sh: records its argv and the barrier state it saw.
  writeFileSync(
    join(dir, "scripts/backup.sh"),
    `#!/bin/bash
printf 'backup.sh %s\\n' "$*" >> "$FAKE_LOG"
while [ "$#" -gt 0 ]; do
  case "$1" in --output-dir) output="$2"; shift 2 ;; --backup) backup="$2"; shift 2 ;; *) shift ;; esac
done
if [ -n "\${output:-}" ]; then
  while [ "\${output%/}" != "$output" ] && [ "$output" != "/" ]; do output="\${output%/}"; done
  case "\${output##*/}" in ""|.|..) exit 1 ;; esac
  printf 'normalized-output=%s\\n' "$output" >> "$FAKE_LOG"
fi
if [ -n "\${STUB_RESERVE:-}" ]; then
  target="\${output:-\${TASKDESK_BACKUP_ROOT:-$(dirname "$0")/../backups}/$backup}"
  mkdir -p -- "$(dirname -- "$target")" || exit 1
  mkdir -- "$target" || exit 1
  printf 'reserved-output=%s\\n' "$target" >> "$FAKE_LOG"
fi
"${process.execPath}" -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FAKE_STATE, "utf8"));
const db = Object.values(s.containers).find((c) => c.service === "postgres");
const running = Object.entries(s.containers).filter(([, c]) => c.running && c.service !== "postgres").map(([id]) => id);
require("fs").appendFileSync(process.env.FAKE_LOG, "barrier-seen networks=" + Object.keys(db.networks).length + " writers=" + running.length + "\\n");
'
[ -z "\${STUB_SLEEP:-}" ] || /bin/sleep "$STUB_SLEEP"
# Simulate an unwritable outcome path for this run's record.
[ -z "\${STUB_BLOCK_OUTCOME:-}" ] || mkdir outcome
exit "\${STUB_STATUS:-0}"
`,
    { mode: 0o700 },
  );
  const state = baseState();
  mutate(state);
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify(state));
  const log = join(dir, "calls");
  const env = (extra = {}) => ({
    PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
    HOME: dir,
    TMPDIR: tmpdir(),
    FAKE_STATE: statePath,
    FAKE_LOG: log,
    ...extra,
  });
  const args = ["--project-name", "drill", "--backup", "ptm08-test"];
  return {
    dir,
    run(
      extra = {},
      argv = args,
      cwd = undefined,
      script = join(dir, "scripts/backup-maintenance.sh"),
    ) {
      const r = spawnSync("/bin/bash", [script, ...argv], {
        encoding: "utf8",
        cwd,
        env: env(extra),
        timeout: 30000,
      });
      assert.ifError(r.error);
      return r;
    },
    spawn(extra = {}) {
      return spawn(
        "/bin/bash",
        [join(dir, "scripts/backup-maintenance.sh"), ...args],
        {
          env: env(extra),
        },
      );
    },
    state: () => JSON.parse(readFileSync(statePath, "utf8")),
    calls: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
    record() {
      const root = join(dir, "backups");
      if (!existsSync(root)) return undefined;
      const name = readdirSync(root).find((n) =>
        n.startsWith(".maintenance-drill-"),
      );
      return name && join(root, name);
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const mutations = (calls) =>
  calls
    .split("\n")
    .filter((l) => /^(stop|start|network (dis)?connect) /.test(l));

function assertCommon(f, r) {
  assert.doesNotMatch(f.calls(), FORBIDDEN);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
  const rec = f.record();
  if (rec)
    for (const name of readdirSync(rec))
      assert.doesNotMatch(
        readFileSync(join(rec, name), "utf8"),
        new RegExp(SECRET),
      );
}

function assertRestored(f) {
  const s = f.state();
  assert.deepEqual(
    s.containers[DB].networks,
    baseState().containers[DB].networks,
  );
  assert.equal(s.containers[APP].running, true);
  assert.equal(s.containers[VALKEY].running, true);
}

function outcome(f) {
  return readFileSync(join(f.record(), "outcome"), "utf8");
}

test("M-P1: holds, backs up, restores exact aliases and running writers, keeps the record", () => {
  const f = fixture();
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    const calls = f.calls();
    assert.match(calls, /barrier-seen networks=0 writers=0/);
    assert.match(calls, /backup\.sh --project-name drill --backup ptm08-test/);
    const order = [
      `stop ${APP}`,
      `stop ${VALKEY}`,
      `exec ${DB} psql`,
      `network disconnect ${N1} ${DB}`,
      `network disconnect ${N2} ${DB}`,
      "backup.sh ",
      `network connect --alias drill-postgres-1 --alias postgres ${N1} ${DB}`,
      `network connect --alias postgres ${N2} ${DB}`,
      `start ${APP} ${VALKEY}`,
      "node:dns",
      "fetch(",
    ].map((needle) => calls.indexOf(needle));
    for (let i = 1; i < order.length; i++) {
      assert.ok(
        order[i - 1] >= 0 && order[i] > order[i - 1],
        `order ${i}: ${order}`,
      );
    }
    assertRestored(f);
    const rec = f.record();
    assert.equal(statSync(rec).mode & 0o777, 0o700);
    for (const name of readdirSync(rec))
      assert.equal(statSync(join(rec, name)).mode & 0o777, 0o600, name);
    assert.match(outcome(f), /^backup=published\nrelease=verified\n/);
    assert.match(outcome(f), new RegExp(`writer ${VALKEY} running=true`));
    assert.deepEqual(
      readFileSync(join(rec, "attempted"), "utf8").trim().split("\n"),
      [N1, N2],
    );
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-P2: hyphenated database and user names are passed unsplit", () => {
  const f = fixture((s) => {
    s.containers[DB].env = [
      "POSTGRES_DB=taskdesk-prod",
      "POSTGRES_USER=task-desk",
    ];
  });
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(f.calls(), /psql -X -Atq -U task-desk -d taskdesk-prod -c /);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-P3: a pre-stopped app stays stopped without DNS or readiness checks", () => {
  const f = fixture((s) => {
    s.containers[APP].running = false;
  });
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    const calls = f.calls();
    assert.doesNotMatch(calls, new RegExp(`(stop|start) .*${APP}`));
    assert.doesNotMatch(calls, /node:dns|fetch\(/);
    assert.equal(f.state().containers[APP].running, false);
    assert.equal(f.state().containers[VALKEY].running, true);
    assert.match(outcome(f), new RegExp(`app ${APP} running=false`));
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-H1: a drain check that prints DB|0 and exits 42 never disconnects", () => {
  const f = fixture((s) => {
    s.rules.push({ match: "psql", effect: "print-then-fail", code: 42 });
  });
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.doesNotMatch(f.calls(), /network disconnect|backup\.sh/);
    assertRestored(f);
    assert.match(outcome(f), /^backup=not-run\nrelease=verified\n/);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

for (const [name, rule] of [
  [
    "project inventory",
    { match: "ps -q --no-trunc --filter label=", effect: "print-then-fail" },
  ],
  [
    "data-volume users",
    { match: "ps -q --no-trunc --filter volume=", effect: "print-then-fail" },
  ],
  ["network record", { match: "join $n.Aliases", effect: "print-then-fail" }],
  ["database env", { match: "POSTGRES_DB", effect: "print-then-fail" }],
  [
    "database state",
    {
      match: "{{.State.Running}}|{{.HostConfig.NetworkMode}}",
      effect: "print-then-fail",
    },
  ],
]) {
  test(`M-H1b: valid-looking output with a nonzero exit (${name}) mutates nothing`, () => {
    const f = fixture((s) => s.rules.push(rule));
    try {
      const r = f.run();
      assert.equal(r.status, 1, r.stderr);
      assert.deepEqual(mutations(f.calls()), []);
      assert.match(outcome(f), /^backup=not-run\nrelease=not-needed\n/);
      assertCommon(f, r);
    } finally {
      f.close();
    }
  });
}

test("M-F1: a failed second disconnect skips the backup and reconnects the first network", () => {
  const f = fixture((s) =>
    s.rules.push({ match: `network disconnect ${N2}`, effect: "fail" }),
  );
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    const calls = f.calls();
    assert.doesNotMatch(calls, /backup\.sh/);
    assert.match(
      calls,
      new RegExp(
        `network connect --alias drill-postgres-1 --alias postgres ${N1}`,
      ),
    );
    assert.doesNotMatch(calls, new RegExp(`network connect .* ${N2} `));
    assertRestored(f);
    assert.match(outcome(f), /release=verified/);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-F2: a disconnect that reports failure but did disconnect is reconciled", () => {
  const f = fixture((s) =>
    s.rules.push({
      match: `network disconnect ${N1}`,
      effect: "apply-then-fail",
    }),
  );
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.match(
      f.calls(),
      new RegExp(
        `network connect --alias drill-postgres-1 --alias postgres ${N1}`,
      ),
    );
    assertRestored(f);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-F3: a refused backup still releases the barrier", () => {
  const f = fixture();
  try {
    const r = f.run({ STUB_STATUS: "1" });
    assert.equal(r.status, 1, r.stderr);
    assertRestored(f);
    assert.match(outcome(f), /^backup=failed-or-refused\nrelease=verified\n/);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

for (const [name, mutate] of [
  [
    "running migrate",
    (s) => {
      s.containers[MIGRATE] = {
        project: "drill",
        service: "migrate",
        running: true,
        env: [],
        mounts: [],
        networks: {},
      };
    },
  ],
  [
    "unknown service",
    (s) => {
      s.containers[MIGRATE] = {
        project: "drill",
        service: "worker",
        running: true,
        env: [],
        mounts: [],
        networks: {},
      };
    },
  ],
  [
    "one-off container",
    (s) => {
      s.containers[MIGRATE] = {
        project: "drill",
        service: "taskdesk",
        oneoff: "True",
        running: true,
        env: [],
        mounts: [],
        networks: {},
      };
    },
  ],
]) {
  test(`M-F4: ${name} is refused before any mutation`, () => {
    const f = fixture(mutate);
    try {
      const r = f.run();
      assert.equal(r.status, 1, r.stderr);
      assert.deepEqual(mutations(f.calls()), []);
      assertCommon(f, r);
    } finally {
      f.close();
    }
  });
}

test("M-F5: a failed docker ps inventory mutates nothing", () => {
  const f = fixture((s) =>
    s.rules.push({ match: "ps -q --no-trunc --filter label=", effect: "fail" }),
  );
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(mutations(f.calls()), []);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

for (const [name, networks] of [
  ["alias with a space", { [N1]: ["postgres", "bad alias"] }],
  ["glob alias", { [N1]: ["postgres", "*"] }],
  ["empty alias list", { [N1]: [] }],
  ["empty alias entry", { [N1]: ["postgres", ""] }],
  ["over-long alias", { [N1]: ["postgres", "x".repeat(129)] }],
  ["no postgres alias", { [N1]: ["drill-postgres-1"] }],
  ["duplicate alias", { [N1]: ["postgres", "postgres"] }],
  ["already isolated", {}],
]) {
  test(`M-F6: malformed network record (${name}) is refused before any mutation`, () => {
    const f = fixture((s) => {
      s.containers[DB].networks = networks;
    });
    try {
      const r = f.run();
      assert.equal(r.status, 1, r.stderr);
      assert.deepEqual(mutations(f.calls()), []);
      assertCommon(f, r);
    } finally {
      f.close();
    }
  });
}

test("M-F6: a duplicate network ID in the record is refused before any mutation", () => {
  const f = fixture((s) =>
    s.rules.push({
      match: "join $n.Aliases",
      effect: "override",
      output: `${N1} postgres\n${N1} postgres`,
    }),
  );
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(mutations(f.calls()), []);
  } finally {
    f.close();
  }
});

for (const [name, mutate] of [
  [
    "active client",
    (s) => {
      s.clients = 1;
    },
  ],
  [
    "different database",
    (s) =>
      s.rules.push({ match: "psql", effect: "override", output: "other|0" }),
  ],
]) {
  test(`M-F7: drain refusal (${name}) restarts writers without disconnecting`, () => {
    const f = fixture(mutate);
    try {
      const r = f.run();
      assert.equal(r.status, 1, r.stderr);
      assert.doesNotMatch(f.calls(), /network disconnect/);
      assertRestored(f);
      assertCommon(f, r);
    } finally {
      f.close();
    }
  });
}

test("M-F8: a failed reconnect leaves writers stopped and reports release failed", () => {
  const f = fixture((s) =>
    s.rules.push({ match: "network connect", effect: "fail" }),
  );
  try {
    const r = f.run();
    assert.equal(r.status, 2, r.stderr);
    assert.doesNotMatch(f.calls(), /^start /m);
    assert.equal(f.state().containers[APP].running, false);
    assert.match(outcome(f), /^backup=published\nrelease=failed\n/);
    assert.match(outcome(f), new RegExp(`writer ${APP} running=false`));
    assert.match(r.stderr, /separately reviewed/);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-F9: an alias set that differs after reconnect is a failed release", () => {
  const f = fixture((s) => {
    s.aliasMutation = ["postgres", "unexpected"];
  });
  try {
    const r = f.run();
    assert.equal(r.status, 2, r.stderr);
    assert.doesNotMatch(f.calls(), /^start /m);
    assert.equal(f.state().containers[VALKEY].running, false);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-F10: failed readiness stops the writers again and reports release failed", () => {
  const f = fixture((s) => {
    s.readyFails = true;
  });
  try {
    const r = f.run();
    assert.equal(r.status, 2, r.stderr);
    assert.equal(f.state().containers[APP].running, false);
    assert.equal(f.state().containers[VALKEY].running, false);
    assert.match(outcome(f), /release=failed/);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-F11: a changed database identity at release connects and starts nothing", () => {
  const f = fixture((s) =>
    s.rules.push({
      match: `inspect --format {{.Id}} ${DB}`,
      effect: "override",
      output: "f".repeat(64),
    }),
  );
  try {
    const r = f.run();
    assert.equal(r.status, 2, r.stderr);
    assert.doesNotMatch(f.calls(), /network connect|^start /m);
    assert.match(outcome(f), /release=failed/);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-F12: SIGTERM during the backup still releases", async () => {
  const f = fixture();
  try {
    const child = f.spawn({ STUB_SLEEP: "1" });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    for (let i = 0; i < 200 && !f.calls().includes("backup.sh "); i++)
      await new Promise((r) => setTimeout(r, 25));
    child.kill("SIGTERM");
    const status = await new Promise((r) =>
      child.on("exit", (code) => r(code)),
    );
    assert.equal(status, 143, stderr);
    assertRestored(f);
    assert.match(outcome(f), /release=verified/);
  } finally {
    f.close();
  }
});

test("M-F13: a failed second stop restarts the recorded writers", () => {
  const f = fixture((s) =>
    s.rules.push({ match: `stop ${VALKEY}`, effect: "fail" }),
  );
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.doesNotMatch(f.calls(), /network disconnect/);
    assertRestored(f);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-M1a: the record is never deleted, even beside a foreign file", () => {
  const f = fixture();
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    const rec = f.record();
    writeFileSync(join(rec, "operator-note"), "kept");
    assert.ok(existsSync(join(rec, "outcome")));
    assert.ok(existsSync(join(rec, "operator-note")));
    assert.ok(existsSync(join(rec, "ids")));
  } finally {
    f.close();
  }
});

test("M-M1b: an inspect failure after a partial stop reports unknown, never 'all stopped'", () => {
  const f = fixture((s) => {
    s.rules.push({ match: `stop ${VALKEY}`, effect: "fail" });
    s.rules.push({
      match: `inspect --format ${"{{.Id}}|"}`,
      from: 5,
      effect: "fail",
    });
  });
  try {
    const r = f.run();
    assert.equal(r.status, 2, r.stderr);
    assert.doesNotMatch(f.calls(), /network connect|^start /m);
    assert.match(outcome(f), /release=unknown/);
    assert.doesNotMatch(r.stderr, /writers left stopped/);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-M1c (R5 M2): an unwritable outcome fails with exit 3 and keeps the backup and release facts", () => {
  const f = fixture();
  try {
    const r = f.run({ STUB_BLOCK_OUTCOME: "1" });
    assert.equal(r.status, 3, r.stderr);
    assert.match(
      r.stderr,
      /evidence failure: the outcome record could not be written/,
    );
    assert.match(r.stderr, /^backup=published$/m);
    assert.match(r.stderr, /^release=verified$/m);
    assert.doesNotMatch(r.stderr, /evidence record:|release failed/);
    assertRestored(f);
  } finally {
    f.close();
  }
});

test("M-M1c2: a failed release still exits 2 when the outcome is also unwritable", () => {
  const f = fixture((s) =>
    s.rules.push({ match: "network connect", effect: "fail" }),
  );
  try {
    const r = f.run({ STUB_BLOCK_OUTCOME: "1" });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /evidence failure/);
    assert.match(r.stderr, /^release=failed$/m);
  } finally {
    f.close();
  }
});

test("R5 H1: an active transaction on another database refuses before disconnect", () => {
  const f = fixture((s) => {
    s.otherDbClients = 1;
  });
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.doesNotMatch(f.calls(), /network disconnect|backup\.sh/);
    assert.match(
      f.calls(),
      /psql .*-c SELECT current_database\(\) \|\| '\|' \|\| count\(\*\) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid\(\)/,
    );
    assertRestored(f);
    assert.match(outcome(f), /^backup=not-run\nrelease=verified\n/);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("R5 H1: a nonzero target drain with a pre-stopped app restores exactly the prior state", () => {
  const f = fixture((s) => {
    s.clients = 2;
    s.containers[APP].running = false;
  });
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.doesNotMatch(f.calls(), /network disconnect/);
    const st = f.state();
    assert.equal(st.containers[APP].running, false);
    assert.equal(st.containers[VALKEY].running, true);
    assert.deepEqual(
      st.containers[DB].networks,
      baseState().containers[DB].networks,
    );
  } finally {
    f.close();
  }
});

for (const [name, side] of [
  ["a writer exits after the health check", { stop: VALKEY }],
  ["the application exits after the health check", { stop: APP }],
  ["a database network disappears after the health check", { dropNetwork: N2 }],
]) {
  test(`R5 M1: release is not verified when ${name}`, () => {
    const f = fixture((s) =>
      s.rules.push({ match: "fetch(", effect: "side", ...side }),
    );
    try {
      const r = f.run();
      assert.equal(r.status, 2, r.stderr);
      assert.match(outcome(f), /^backup=published\nrelease=failed\n/);
      assertCommon(f, r);
    } finally {
      f.close();
    }
  });
}

test("R7 final observation never reports verified with a stopped recorded writer", () => {
  const f = fixture((s) =>
    s.rules.push({
      match: `{{.State.Running}} ${APP}`,
      nth: 5,
      effect: "side",
      stop: VALKEY,
    }),
  );
  try {
    const r = f.run();
    const report = outcome(f);
    assert.equal(r.status, 0, r.stderr);
    assert.match(report, /^release=verified$/m);
    assert.ok(report.includes(`writer ${VALKEY} running=true`), report);
  } finally {
    f.close();
  }
});

test("R7 relative output path is resolved from the caller's directory", () => {
  const f = fixture();
  try {
    const r = f.run({}, [
      "--project-name",
      "drill",
      "--output-dir",
      "relative-output",
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      f
        .calls()
        .includes(
          `backup.sh --project-name drill --output-dir ${resolve("relative-output")}`,
        ),
    );
  } finally {
    f.close();
  }
});

test("M-M2: a container outside the project mounting the data volume is refused untouched", () => {
  const f = fixture((s) => {
    s.containers[FOREIGN] = {
      project: "other",
      service: "jobs",
      running: true,
      env: [],
      mounts: [
        {
          Type: "volume",
          Name: "drill_taskdesk-data",
          Destination: "/app/data",
        },
      ],
      networks: {},
    };
  });
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(mutations(f.calls()), []);
    assert.equal(f.state().containers[FOREIGN].running, true);
    assertCommon(f, r);
  } finally {
    f.close();
  }
});

test("M-X1: --release-from and other unknown flags are usage errors before Docker", () => {
  for (const argv of [
    ["--release-from", "/x"],
    ["--project-name", "drill", "--backup", "a", "--quiesced"],
    ["--project-name", "drill"],
    ["--project-name", "drill", "--backup", "a", "--output-dir", "/x"],
  ]) {
    const f = fixture();
    try {
      const r = f.run({}, argv);
      assert.equal(r.status, 1, r.stderr);
      assert.equal(f.calls(), "");
    } finally {
      f.close();
    }
  }
});

for (const [name, argv] of [
  ["invalid backup identifier", ["--backup", "../bad"]],
  ["empty backup identifier", ["--backup", ""]],
  ["missing backup identifier", ["--backup"]],
  ["missing target", []],
  ["empty output directory", ["--output-dir", ""]],
  ["missing output directory", ["--output-dir"]],
]) {
  test(`R8 rejects ${name} before any Docker operation`, () => {
    const f = fixture();
    try {
      const r = f.run({}, ["--project-name", "drill", ...argv]);
      assert.equal(r.status, 1, r.stderr);
      assert.equal(f.calls(), "");
    } finally {
      f.close();
    }
  });
}

test("R8 duplicate restored aliases cannot hide a missing alias", () => {
  const f = fixture((s) => {
    s.aliasMutation = ["postgres", "postgres"];
    s.aliasMutationNetwork = N1;
  });
  try {
    const r = f.run();
    assert.equal(r.status, 2, r.stderr);
    assert.match(outcome(f), /^release=failed$/m);
    assert.doesNotMatch(outcome(f), /^release=verified$/m);
  } finally {
    f.close();
  }
});

test("R8 reordered restored aliases remain valid", () => {
  const f = fixture((s) => {
    s.reverseAliases = true;
  });
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(outcome(f), /^release=verified$/m);
  } finally {
    f.close();
  }
});

for (const value of [
  "/",
  "////",
  ".",
  "..",
  "./",
  "../",
  "nested/.",
  "nested/../",
  "nested/.///",
  "nested/..///",
]) {
  test(`R9 invalid output ${value} refuses before any side effect`, () => {
    const f = fixture();
    try {
      const r = f.run({}, ["--project-name", "drill", "--output-dir", value]);
      assert.equal(r.status, 1, r.stderr);
      assert.equal(f.calls(), "");
      assert.equal(f.record(), undefined);
    } finally {
      f.close();
    }
  });
}

test("R9 duplicate and mixed targets refuse before any side effect", () => {
  for (const argv of [
    ["--backup", "one", "--backup", "two"],
    ["--output-dir", "one", "--output-dir", "two"],
    ["--backup", "one", "--output-dir", "two"],
  ]) {
    const f = fixture();
    try {
      const r = f.run({}, ["--project-name", "drill", ...argv]);
      assert.equal(r.status, 1, r.stderr);
      assert.equal(f.calls(), "");
      assert.equal(f.record(), undefined);
    } finally {
      f.close();
    }
  }
});

test("R9 existing backup identifier refuses without modifying the archive", () => {
  const f = fixture();
  const archive = join(f.dir, "backups", "ptm08-test");
  mkdirSync(archive, { recursive: true });
  writeFileSync(join(archive, "sentinel"), "untouched");
  try {
    const r = f.run();
    assert.equal(r.status, 1, r.stderr);
    assert.equal(f.calls(), "");
    assert.equal(f.record(), undefined);
    assert.equal(readFileSync(join(archive, "sentinel"), "utf8"), "untouched");
  } finally {
    f.close();
  }
});

test("R10 record root cannot become the output target", () => {
  const f = fixture();
  const target = join(f.dir, "fresh-root");
  try {
    const r = f.run({ STUB_RESERVE: "1", TASKDESK_BACKUP_ROOT: target }, [
      "--project-name",
      "drill",
      "--output-dir",
      target,
    ]);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(f.calls(), "");
  } finally {
    f.close();
  }
});

test("R10 missing prefix before traversal refuses without touching an archive", () => {
  const f = fixture();
  const archive = join(f.dir, "existing-archive");
  mkdirSync(archive);
  writeFileSync(join(archive, "sentinel"), "untouched");
  const target = `${f.dir}/new-component/../existing-archive`;
  try {
    const r = f.run({ STUB_RESERVE: "1" }, [
      "--project-name",
      "drill",
      "--output-dir",
      target,
    ]);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(f.calls(), "");
    assert.equal(existsSync(join(f.dir, "new-component")), false);
    assert.equal(readFileSync(join(archive, "sentinel"), "utf8"), "untouched");
  } finally {
    f.close();
  }
});

test("R10 traversal after a newline in a missing prefix refuses", () => {
  const f = fixture();
  const archive = join(f.dir, "existing-archive");
  mkdirSync(archive);
  writeFileSync(join(archive, "sentinel"), "untouched");
  try {
    const r = f.run({ STUB_RESERVE: "1" }, [
      "--project-name",
      "drill",
      "--output-dir",
      `${f.dir}/line\nmissing/../existing-archive`,
    ]);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(f.calls(), "");
    assert.equal(readFileSync(join(archive, "sentinel"), "utf8"), "untouched");
  } finally {
    f.close();
  }
});

for (const [name, character] of [
  ["newline", "\n"],
  ["carriage return", "\r"],
  ["tab", "\t"],
  ["DEL", "\x7f"],
]) {
  for (const which of ["output", "record root"]) {
    test(`R11 ${which} rejects ${name} before creating anything`, () => {
      const f = fixture();
      const archive = join(f.dir, "existing-archive");
      mkdirSync(archive);
      writeFileSync(join(archive, "sentinel"), "untouched");
      const parent = `${f.dir}/missing${character}`;
      const root = which === "record root" ? parent : join(f.dir, "backups");
      const target =
        which === "output" ? `${parent}/archive` : join(f.dir, "archive");
      try {
        const r = f.run({ STUB_RESERVE: "1", TASKDESK_BACKUP_ROOT: root }, [
          "--project-name",
          "drill",
          "--output-dir",
          target,
        ]);
        assert.equal(r.status, 1, r.stderr);
        assert.equal(f.calls(), "");
        assert.equal(existsSync(parent), false);
        assert.equal(existsSync(root), false);
        assert.equal(
          readFileSync(join(archive, "sentinel"), "utf8"),
          "untouched",
        );
      } finally {
        f.close();
      }
    });
  }
}

for (const which of ["output", "record root"]) {
  test(`R11 ${which} rejects a physical symlink path ending in newline`, () => {
    const f = fixture();
    const physical = `${f.dir}/physical\n`;
    const link = join(f.dir, "link");
    mkdirSync(physical);
    symlinkSync(physical, link);
    const root =
      which === "record root" ? `${link}/root` : join(f.dir, "backups");
    const target =
      which === "output" ? `${link}/archive` : join(f.dir, "archive");
    try {
      const r = f.run({ STUB_RESERVE: "1", TASKDESK_BACKUP_ROOT: root }, [
        "--project-name",
        "drill",
        "--output-dir",
        target,
      ]);
      assert.equal(r.status, 1, r.stderr);
      assert.equal(f.calls(), "");
      assert.equal(existsSync(root), false);
      assert.deepEqual(readdirSync(physical), []);
    } finally {
      f.close();
    }
  });
}

test("R11 rejects control characters in physical invocation and source directories", () => {
  const f = fixture();
  const physical = `${f.dir}/physical\n`;
  const link = join(f.dir, "source-link");
  mkdirSync(physical);
  cpSync(join(f.dir, "scripts"), join(physical, "scripts"), {
    recursive: true,
  });
  symlinkSync(physical, link);
  try {
    const args = ["--project-name", "drill", "--backup", "ptm08-test"];
    for (const r of [
      f.run({}, args, physical),
      f.run({}, args, undefined, join(link, "scripts/backup-maintenance.sh")),
    ]) {
      assert.equal(r.status, 1, r.stderr);
      assert.equal(f.calls(), "");
      assert.equal(f.record(), undefined);
    }
  } finally {
    f.close();
  }
});

test("R10 record evidence namespace cannot become an archive", () => {
  const f = fixture();
  writeFileSync(
    join(f.dir, "bin/date"),
    "#!/bin/bash\nprintf '20000101T000000Z\\n'\n",
    { mode: 0o700 },
  );
  const target = join(
    f.dir,
    "backups",
    ".maintenance-drill-20000101T000000Z",
    "ids",
  );
  try {
    const r = f.run({ STUB_RESERVE: "1" }, [
      "--project-name",
      "drill",
      "--output-dir",
      target,
    ]);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(f.calls(), "");
    assert.equal(existsSync(target), false);
  } finally {
    f.close();
  }
});

test("R10 existing traversal preserves physical symlink destination", () => {
  const f = fixture();
  mkdirSync(join(f.dir, "real", "child"), { recursive: true });
  symlinkSync(join(f.dir, "real", "child"), join(f.dir, "link"));
  const target = `${f.dir}/link/../archive with spaces///`;
  try {
    const r = f.run({ STUB_RESERVE: "1" }, [
      "--project-name",
      "drill",
      "--output-dir",
      target,
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(f.dir, "real", "archive with spaces")));
    assert.equal(existsSync(join(f.dir, "archive with spaces")), false);
    assert.ok(
      f.calls().includes(`reserved-output=${target.replace(/\/+$/, "")}\n`),
    );
  } finally {
    f.close();
  }
});

test("R10 child reservation accepts absolute and relative output with spaces and trailing slashes", () => {
  for (const relative of [false, true]) {
    const f = fixture();
    const expected = join(f.dir, "archive with spaces");
    const target = relative
      ? `${f.dir.slice(resolve(".").length + 1)}/../${f.dir.split("/").at(-1)}/archive with spaces///`
      : `${expected}///`;
    try {
      const r = f.run({ STUB_RESERVE: "1" }, [
        "--project-name",
        "drill",
        "--output-dir",
        target,
      ]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(expected));
    } finally {
      f.close();
    }
  }
});

for (const kind of [
  "existing directory",
  "existing file",
  "dangling symlink",
  "invalid parent",
]) {
  test(`R9 ${kind} refuses before any side effect`, () => {
    const f = fixture();
    const path = join(f.dir, "occupied");
    if (kind === "existing directory") mkdirSync(path);
    else if (kind === "dangling symlink")
      symlinkSync(join(f.dir, "missing"), path);
    else writeFileSync(path, "untouched");
    const target =
      kind === "invalid parent" ? join(path, "nested", "archive") : path;
    try {
      const r = f.run({}, ["--project-name", "drill", "--output-dir", target]);
      assert.equal(r.status, 1, r.stderr);
      assert.equal(f.calls(), "");
      assert.equal(f.record(), undefined);
      if (kind === "existing file" || kind === "invalid parent")
        assert.equal(readFileSync(path, "utf8"), "untouched");
    } finally {
      f.close();
    }
  });
}

test("R9 valid absolute, relative and spaced paths retain normalized child targets", () => {
  for (const relative of [false, true]) {
    const f = fixture();
    try {
      const expected = `${f.dir}/${relative ? "archive-two" : "archive one"}`;
      const target = relative
        ? `${expected.slice(resolve(".").length + 1)}/`
        : `${expected}///`;
      const r = f.run({}, ["--project-name", "drill", "--output-dir", target]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(f.calls().includes(`normalized-output=${expected}\n`));
    } finally {
      f.close();
    }
  }
});

test("M-X2: a record root under TMPDIR or an OS temp directory is refused before Docker", () => {
  const f = fixture();
  const temp = mkdtempSync(join(tmpdir(), "backup-maintenance-root-"));
  try {
    const r = f.run({ TASKDESK_BACKUP_ROOT: temp });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(f.calls(), "");
    assert.match(r.stderr, /temp/i);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    f.close();
  }
});

for (const [stage, match] of [
  ["ids", "join $n.Aliases"],
  ["attempted", "psql -X"],
  ["outcome", "fetch("],
]) {
  test(`R7 record remains anchored after swap before ${stage}`, () => {
    const f = fixture();
    const protectedDir = join(f.dir, "protected");
    mkdirSync(protectedDir);
    const names = ["ids", "running", "networks", "attempted", "outcome"];
    for (const name of names)
      writeFileSync(join(protectedDir, name), `older-${name}`);
    try {
      const r = f.run({
        FAKE_SWAP_POINT: match,
        FAKE_SWAP_DONE: join(f.dir, "swap-done"),
        FAKE_RECORD_ROOT: join(f.dir, "backups"),
        FAKE_PROTECTED: protectedDir,
      });
      assert.ok(existsSync(join(f.dir, "swap-done")));
      for (const name of names)
        assert.equal(
          readFileSync(join(protectedDir, name), "utf8"),
          `older-${name}`,
        );
      const moved = join(
        f.dir,
        "backups",
        readdirSync(join(f.dir, "backups")).find((name) =>
          name.endsWith(".moved"),
        ),
      );
      const disconnected = mutations(f.calls()).filter((line) =>
        line.startsWith("network disconnect "),
      );
      assert.equal(disconnected.length, 2, r.stderr);
      const attempted = existsSync(join(moved, "attempted"))
        ? readFileSync(join(moved, "attempted"), "utf8").split("\n")
        : [];
      for (const call of disconnected)
        assert.ok(attempted.includes(call.split(" ")[2]), r.stderr);
      for (const call of disconnected)
        assert.match(
          f.calls(),
          new RegExp(`evidence-before-disconnect ${call.split(" ")[2]}`),
        );
      assert.ok(existsSync(join(moved, "outcome")), r.stderr);
    } finally {
      f.close();
    }
  });
}
