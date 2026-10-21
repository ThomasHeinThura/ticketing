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
if [ "$1" = inspect ]; then printf '%s\\n' "$RECOVERY_TEST_MOUNT"; exit; fi
case "$*" in
  *'ps -a -q taskdesk'*) printf '%s\\n' "$RECOVERY_TEST_CONTAINER" ;;
  *pg_dump*) printf 'database archive' ;;
  *pg_restore*) cat >/dev/null; printf '1; archive entry\\n' ;;
  *'run --rm -i'*) cat >/dev/null ;;
  'run --rm '*) printf 'attachment archive' ;;
esac
`,
    { mode: 0o700 },
  );
  const backup = join(dir, "backup");
  mkdirSync(backup);
  const files = {
    "postgres.dump": "database archive",
    "attachments.tar": "attachment archive",
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
            RECOVERY_TEST_MOUNT: "volume:drill_taskdesk-data",
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
      ? ["--output-dir", f.backup]
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
