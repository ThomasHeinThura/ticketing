import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "taskdesk-recovery-"));
  cpSync(resolve("scripts/backup.sh"), join(dir, "scripts/backup.sh"), {
    recursive: true,
  });
  cpSync(resolve("scripts/restore.sh"), join(dir, "scripts/restore.sh"));
  cpSync(resolve("scripts/lib"), join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "bin"));
  const log = join(dir, "docker.log");
  writeFileSync(
    join(dir, "bin/docker"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$RECOVERY_TEST_LOG"
DB_ID="${"d".repeat(64)}"
if [ "$1" = compose ] && [ "$4" = -p ]; then printf '%s' "$5" > "$RECOVERY_TEST_LOG.project"; fi
PROJECT="$(cat "$RECOVERY_TEST_LOG.project" 2>/dev/null || printf taskdesk)"
# PTM-08 held-barrier answers for scripts/backup.sh (the barrier is held: only
# PostgreSQL runs, no data-volume users, no networks, no client sessions).
if [ "$1" = inspect ] && [[ "$3" != *.Mounts* ]]; then
  service=taskdesk
  [ "$4" != "$DB_ID" ] || service=postgres
  case "$3" in
    *POSTGRES_DB*|*POSTGRES_USER*) printf '2 taskdesk\\n' ;;
    *.Config.Env*) ;;
    '{{.Id}}') printf '%s\\n' "$4" ;;
    '{{.Id}}|'*) printf '%s|%s|%s\\n' "$4" "$PROJECT" "$service" ;;
    *com.docker.compose.project*) printf '%s|%s\\n' "$PROJECT" "$service" ;;
    *NetworkMode*) printf 'default|0\\n' ;;
    *) exit 99 ;;
  esac
  exit 0
fi
case "$*" in
  *'ps -a -q postgres'*) printf '%s\\n' "$DB_ID"; exit 0 ;;
  'ps -q --no-trunc --filter label='*) printf '%s\\n' "$DB_ID"; exit 0 ;;
  'ps -q --no-trunc --filter volume='*) exit 0 ;;
  "exec $DB_ID sh -c"*) exit 0 ;;
  "exec $DB_ID psql"*) printf 'taskdesk|0\\n'; exit 0 ;;
esac
if [ "$1" = inspect ]; then
  if [ -n "\${RECOVERY_TEST_MOUNTS_JSON:-}" ]; then
    node -e '
      const fmt = process.argv[1];
      const mounts = JSON.parse(process.env.RECOVERY_TEST_MOUNTS_JSON);
      const acceptAppData = fmt.includes("/app/data\\"");
      const acceptAttachments = fmt.includes("/app/data/attachments\\"");
      for (const m of mounts) {
        if ((m.Destination === "/app/data" && acceptAppData) || (m.Destination === "/app/data/attachments" && acceptAttachments)) {
          process.stdout.write(m.Type + ":" + m.Name + ":" + m.Destination + "\\n");
        }
      }
    ' "$3"
    exit 0
  fi
  printf '%s\\n' "$RECOVERY_TEST_MOUNT"
  exit
fi
if [[ "$*" == *'_restore_staging_'* && "$*" == *'RENAME TO "taskdesk"'* ]] && [ "\${RECOVERY_TEST_PROMOTION_FAIL:-0}" = 1 ]; then
  exit 1
fi
case "$*" in
  *'ps -a -q taskdesk'*) printf '%s\\n' "$RECOVERY_TEST_CONTAINER" ;;
  *'exec -T taskdesk node'*) [[ "\${RECOVERY_TEST_PROBE_FAIL:-0}" != 1 ]] || exit 1 ;;
  *pg_dump*) printf 'database archive' ;;
  *'pg_restore --list'*) cat >/dev/null; printf '1; archive entry\\n' ;;
  *pg_restore*)
    cat >/dev/null
    if [ "\${RECOVERY_TEST_PG_RESTORE_FAIL:-0}" = "1" ]; then
      printf 'pg_restore: simulated archive failure\\n' >&2
      exit 1
    fi
    printf '1; archive entry\\n'
    ;;
  *'run --rm -i'*) cat >/dev/null ;;
  'run --rm '*) printf 'attachment archive' ;;
esac
`,
    { mode: 0o700 },
  );
  writeFileSync(join(dir, "bin/sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const backup = join(dir, "backup");
  mkdirSync(backup);
  const files = {
    "postgres.dump": "database archive",
    "attachments.tar": "attachment archive",
    "attachment-mount.txt": "/app/data\n",
  };
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(backup, name), content);
  writeFileSync(
    join(backup, "SHA256SUMS"),
    Object.entries(files)
      .map(
        ([name, content]) =>
          `${createHash("sha256").update(content).digest("hex")}  ${name}\n`,
      )
      .join(""),
  );
  return {
    dir,
    backup,
    run(script, args = [], overrides = {}) {
      const result = spawnSync(
        "bash",
        [join(dir, "scripts", script), ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${join(dir, "bin")}:${process.env.PATH}`,
            RECOVERY_TEST_LOG: log,
            RECOVERY_TEST_MOUNT: "volume:drill_taskdesk-data:/app/data",
            RECOVERY_TEST_CONTAINER: "a".repeat(64),
            ...overrides,
          },
        },
      );
      return {
        ...result,
        calls: (() => {
          try {
            return readFileSync(log, "utf8");
          } catch {
            return "";
          }
        })(),
      };
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

for (const script of ["backup.sh", "restore.sh"]) {
  function args(f) {
    return script === "backup.sh"
      ? ["--output-dir", join(f.dir, "new-backup")]
      : ["--backup", f.backup, "--confirm"];
  }
  test(`${script} uses the selected project's mounted data volume`, () => {
    const f = fixture();
    try {
      const result = f.run(script, [...args(f), "--project-name", "drill"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.calls, /compose .* -p drill .*ps -a -q taskdesk/);
      assert.match(result.calls, /-v drill_taskdesk-data:\/data/);
      assert.doesNotMatch(result.calls, /-v taskdesk_taskdesk-data:/);
      for (const call of result.calls
        .split("\n")
        .filter((line) => line.startsWith("compose ")))
        assert.match(call, / -p drill /);
    } finally {
      f.close();
    }
  });
  for (const [name, overrides] of [
    ["missing container", { RECOVERY_TEST_CONTAINER: "" }],
    [
      "ambiguous containers",
      { RECOVERY_TEST_CONTAINER: `${"a".repeat(64)}\n${"b".repeat(64)}` },
    ],
    ["bind mount", { RECOVERY_TEST_MOUNT: "bind:" }],
    ["missing mount", { RECOVERY_TEST_MOUNT: "" }],
  ]) {
    test(`${script} refuses ${name} before mutating data`, () => {
      const f = fixture();
      try {
        const result = f.run(script, args(f), overrides);
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(
          result.calls,
          /compose .* stop |pg_terminate_backend|DROP DATABASE|^run /m,
        );
      } finally {
        f.close();
      }
    });
  }
  test(`${script} rejects an invalid explicit project before Docker`, () => {
    const f = fixture();
    try {
      const result = f.run(script, [...args(f), "--project-name", "-wrong"]);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, "");
    } finally {
      f.close();
    }
  });
}

test("isolated restore requires a non-default explicit project", () => {
  const f = fixture();
  try {
    for (const project of [[], ["--project-name", "taskdesk"]]) {
      const result = f.run("restore.sh", [
        "--backup",
        f.backup,
        "--confirm",
        "--mode",
        "isolated",
        ...project,
      ]);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, "");
    }
  } finally {
    f.close();
  }
});

test("isolated restore selects only the scratch overlay", () => {
  const f = fixture();
  try {
    const result = f.run("restore.sh", [
      "--backup",
      f.backup,
      "--confirm",
      "--mode",
      "isolated",
      "--project-name",
      "drill",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /-f deploy\/compose.restore-drill.yml/);
    assert.doesNotMatch(
      result.calls,
      /compose.local.yml|compose.prod.yml|compose.traefik.yml/,
    );
  } finally {
    f.close();
  }
});

for (const mode of ["sit", "uat"]) {
  test(`restore selects the ${mode} overlay`, () => {
    const f = fixture();
    try {
      const result = f.run("restore.sh", [
        "--backup",
        f.backup,
        "--confirm",
        "--mode",
        mode,
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.calls.includes(`-f deploy/compose.${mode}.yml`));
    } finally {
      f.close();
    }
  });
}

test("scratch network blocks egress and proxy discovery without publishing ports", () => {
  const overlay = readFileSync(
    resolve("deploy/compose.restore-drill.yml"),
    "utf8",
  );
  assert.match(
    overlay,
    /networks:\s+taskdesk:\s+name: [^\n]+\s+internal: true\s*$/,
  );
  assert.match(overlay, /traefik.enable: "false"/);
  assert.doesNotMatch(overlay, /ports:|external: true|network_mode:/);
});

test("restore.sh restores into staging DB first and leaves live DB intact when pg_restore fails (DO-2)", () => {
  const f = fixture();
  try {
    const failed = f.run("restore.sh", ["--backup", f.backup, "--confirm"], {
      RECOVERY_TEST_PG_RESTORE_FAIL: "1",
    });
    assert.notEqual(failed.status, 0);
    assert.match(failed.calls, /createdb .* taskdesk_restore_staging_/);
    assert.match(failed.calls, /pg_restore .* -d taskdesk_restore_staging_/);
    assert.doesNotMatch(failed.calls, /DROP DATABASE IF EXISTS "taskdesk"/);
    assert.doesNotMatch(failed.calls, /RENAME TO "taskdesk"/);
    assert.match(failed.calls, /up -d --wait taskdesk/);
    assert.match(
      failed.calls,
      /DROP DATABASE IF EXISTS "taskdesk_restore_staging_/,
    );
  } finally {
    f.close();
  }
});

test("restore.sh swaps staging DB over live DB only after pg_restore exits 0 (DO-2)", () => {
  const f = fixture();
  try {
    const ok = f.run("restore.sh", ["--backup", f.backup, "--confirm"]);
    assert.equal(ok.status, 0, ok.stderr);
    const createdbIdx = ok.calls.indexOf("createdb ");
    const pgRestoreIdx = ok.calls.indexOf(
      "pg_restore --single-transaction --no-owner",
    );
    const recoveryIdx = ok.calls.indexOf(
      'ALTER DATABASE "taskdesk" RENAME TO "taskdesk_restore_recovery_',
    );
    const renameIdx = ok.calls.indexOf('RENAME TO "taskdesk"');
    const dropRecoveryIdx = ok.calls.indexOf(
      'DROP DATABASE "taskdesk_restore_recovery_',
    );
    assert.ok(createdbIdx > 0);
    assert.ok(pgRestoreIdx > createdbIdx);
    assert.ok(recoveryIdx > pgRestoreIdx);
    assert.ok(renameIdx > recoveryIdx);
    assert.ok(dropRecoveryIdx > renameIdx);
    assert.match(
      ok.calls,
      /psql --single-transaction .*ALTER DATABASE "taskdesk" RENAME TO .*ALTER DATABASE "taskdesk_restore_staging_/,
    );
    assert.doesNotMatch(ok.calls, /DROP DATABASE IF EXISTS "taskdesk"/);
  } finally {
    f.close();
  }
});

test("resolve_compose_data_volume supports both /app/data and /app/data/attachments and rejects dual mounts (DO-7)", () => {
  for (const destination of ["/app/data", "/app/data/attachments"]) {
    const f = fixture();
    try {
      const result = f.run(
        "backup.sh",
        ["--output-dir", join(f.dir, "new-backup")],
        {
          RECOVERY_TEST_MOUNTS_JSON: JSON.stringify([
            {
              Type: "volume",
              Name: "sit_attachments_vol",
              Destination: destination,
            },
          ]),
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.calls, /-v sit_attachments_vol:\/data/);
    } finally {
      f.close();
    }
  }

  const ambiguous = fixture();
  try {
    const result = ambiguous.run(
      "backup.sh",
      ["--output-dir", join(ambiguous.dir, "new-backup")],
      {
        RECOVERY_TEST_MOUNTS_JSON: JSON.stringify([
          { Type: "volume", Name: "vol_a", Destination: "/app/data" },
          {
            Type: "volume",
            Name: "vol_b",
            Destination: "/app/data/attachments",
          },
        ]),
      },
    );
    assert.notEqual(result.status, 0);
  } finally {
    ambiguous.close();
  }
});

test("restore promotion failure rolls back both renames and preserves staging", () => {
  const f = fixture();
  try {
    const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"], {
      RECOVERY_TEST_PROMOTION_FAIL: "1",
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.calls,
      /psql --single-transaction .*ALTER DATABASE "taskdesk" RENAME TO .*ALTER DATABASE "taskdesk_restore_staging_/,
    );
    assert.doesNotMatch(result.calls, /DROP DATABASE/);
    assert.doesNotMatch(result.calls, /run --rm -i|up -d/);
  } finally {
    f.close();
  }
});

test("failed readiness retains recovery database and attachment undo", () => {
  const f = fixture();
  try {
    const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"], {
      RECOVERY_TEST_PROBE_FAIL: "1",
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /recovery database: taskdesk_restore_recovery_\d+/,
    );
    assert.doesNotMatch(
      result.calls,
      /DROP DATABASE "taskdesk_restore_recovery_/,
    );
    assert.match(result.calls, /restore-undo-/);
    assert.doesNotMatch(result.calls, /rm -f \/data\/\.restore-undo-/);
  } finally {
    f.close();
  }
});

test("real tar extraction cannot replace the exclusive undo archive", () => {
  const f = fixture();
  try {
    const data = join(f.dir, "data");
    const old = join(f.dir, "old");
    mkdirSync(data);
    mkdirSync(join(old, ".restore-undo-123"), { recursive: true });
    writeFileSync(join(data, "file"), "current");
    writeFileSync(join(old, "file"), "backup");
    writeFileSync(
      join(old, ".restore-undo-123", "attachments.tar"),
      "older undo",
    );
    const archive = join(f.dir, "input.tar");
    assert.equal(spawnSync("tar", ["-cf", archive, "-C", old, "."]).status, 0);
    const source = readFileSync(resolve("scripts/restore.sh"), "utf8");
    const command = source
      .match(/sh -c '([^']*mkdir "\/data\/\$undo"[^']*)' sh "\$UNDO_DIR"/)[1]
      .replaceAll("/data", data)
      .replace(" && chown -R 10001:10001 " + data, "");
    const result = spawnSync("sh", ["-c", command, "sh", ".restore-undo-123"], {
      input: readFileSync(archive),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(data, "file"), "utf8"), "backup");
    const undo = join(data, ".restore-undo-123", "attachments.tar");
    const contents = spawnSync("tar", ["-xOf", undo, "./file"], {
      encoding: "utf8",
    });
    assert.equal(contents.status, 0, contents.stderr);
    assert.equal(contents.stdout, "current");
  } finally {
    f.close();
  }
});

test("legacy mount must be explicit, match the target, and never override metadata", () => {
  const f = fixture();
  try {
    const args = ["--backup", f.backup, "--confirm"];
    const recorded = f.run("restore.sh", [
      ...args,
      "--legacy-source-mount",
      "/app/data",
    ]);
    assert.notEqual(recorded.status, 0);
    assert.match(recorded.stderr, /only when metadata is absent/);
    rmSync(join(f.backup, "attachment-mount.txt"));
    const sums = readFileSync(join(f.backup, "SHA256SUMS"), "utf8")
      .split("\n")
      .filter((line) => !line.endsWith("  attachment-mount.txt"))
      .join("\n");
    writeFileSync(join(f.backup, "SHA256SUMS"), sums);
    for (const extra of [
      [],
      ["--legacy-source-mount", "/app/data/attachments"],
      ["--legacy-source-mount", "/invalid"],
    ]) {
      const failed = f.run("restore.sh", [...args, ...extra]);
      assert.notEqual(failed.status, 0);
      assert.doesNotMatch(
        failed.calls,
        /compose .* stop |pg_terminate_backend|DROP DATABASE|run --rm -i/,
      );
    }
    const ok = f.run("restore.sh", [
      ...args,
      "--legacy-source-mount",
      "/app/data",
    ]);
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    f.close();
  }
});

test("backup mount metadata prevents restoring to a different mount", () => {
  for (const destination of ["/app/data", "/app/data/attachments"]) {
    const f = fixture();
    try {
      const mount = (d) =>
        JSON.stringify([
          { Type: "volume", Name: "test_volume", Destination: d },
        ]);
      const backupDir = join(f.dir, "new-backup");
      const backup = f.run("backup.sh", ["--output-dir", backupDir], {
        RECOVERY_TEST_MOUNTS_JSON: mount(destination),
      });
      assert.equal(backup.status, 0, backup.stderr);
      assert.equal(
        readFileSync(join(backupDir, "attachment-mount.txt"), "utf8"),
        `${destination}\n`,
      );
      const other =
        destination === "/app/data" ? "/app/data/attachments" : "/app/data";
      const result = f.run("restore.sh", ["--backup", backupDir, "--confirm"], {
        RECOVERY_TEST_MOUNTS_JSON: mount(other),
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /mount mismatch/);
      assert.doesNotMatch(
        result.calls,
        /compose .* stop |pg_terminate_backend|DROP DATABASE|run --rm -i/,
      );
    } finally {
      f.close();
    }
  }
});
