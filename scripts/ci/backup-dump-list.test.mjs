import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function runBackup(mode) {
  const dir = mkdtempSync(join(tmpdir(), "taskdesk-dump-list-"));
  try {
    mkdirSync(join(dir, "scripts/lib"), { recursive: true });
    mkdirSync(join(dir, "bin"));
    cpSync(resolve("scripts/backup.sh"), join(dir, "scripts/backup.sh"));
    cpSync(
      resolve("scripts/lib/compose-data-volume.sh"),
      join(dir, "scripts/lib/compose-data-volume.sh"),
    );
    for (const command of ["date", "dirname", "mkdir", "grep", "chmod"]) {
      const path = ["/bin", "/usr/bin"]
        .map((p) => join(p, command))
        .find(existsSync);
      assert.ok(path, `missing fixture command ${command}`);
      symlinkSync(path, join(dir, "bin", command));
    }
    const log = join(dir, "calls");
    writeFileSync(
      join(dir, "bin/docker"),
      `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE_LOG"
case "$*" in
  'compose -f compose.yml ps -a -q taskdesk') printf 'aaaaaaaaaaaa\\n' ;;
  'inspect --format '* ) printf 'volume:fixture-data\\n' ;;
  'compose -f compose.yml exec -T postgres pg_dump -Fc -U taskdesk taskdesk') printf 'fake dump' ;;
  'compose -f compose.yml exec -T postgres pg_restore --list')
    case "$FIXTURE_MODE" in
      partial) printf '1; fixture entry\\n'; exit 42 ;;
      empty) printf '; comment only\\n' ;;
      clean) printf '; comment\\n1; fixture entry\\n' ;;
      *) exit 99 ;;
    esac ;;
  'run --rm -v fixture-data:/data:ro alpine:3.22 tar -C /data -cf - .') printf 'fake attachment' ;;
  *) printf 'unexpected docker invocation\\n' >&2; exit 99 ;;
esac
`,
      { mode: 0o700 },
    );
    writeFileSync(
      join(dir, "bin/sha256sum"),
      `#!/bin/bash
set -eu
printf 'checksum\\n' >> "$FIXTURE_LOG"
printf 'fake-checksum  %s\\n' "$@"
`,
      { mode: 0o700 },
    );
    const output = join(dir, "output");
    const result = spawnSync(
      "/bin/bash",
      [join(dir, "scripts/backup.sh"), "--output-dir", output],
      {
        encoding: "utf8",
        env: { PATH: join(dir, "bin"), FIXTURE_LOG: log, FIXTURE_MODE: mode },
        timeout: 10000,
      },
    );
    assert.ifError(result.error);
    return {
      ...result,
      calls: existsSync(log) ? readFileSync(log, "utf8") : "",
      attachments: existsSync(join(output, "attachments.tar")),
      checksums: existsSync(join(output, "SHA256SUMS")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const mode of ["partial", "empty"]) {
  test(`refuses ${mode} dump listing before attachment archive`, () => {
    const result = runBackup(mode);
    assert.match(result.calls, /pg_restore --list/);
    assert.notEqual(result.status, 0, result.stdout);
    assert.doesNotMatch(result.calls, /(^run |^checksum)/m);
    assert.equal(result.attachments, false);
    assert.equal(result.checksums, false);
    assert.doesNotMatch(result.stdout, /Backup complete/);
  });
}

test("accepts a successful nonempty dump listing", () => {
  const result = runBackup("clean");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Backup complete: .*pg_restore entries: 1/);
  assert.match(result.calls, /^run .*fixture-data/m);
  assert.match(result.calls, /^checksum$/m);
  assert.equal(result.attachments, true);
  assert.equal(result.checksums, true);
});
