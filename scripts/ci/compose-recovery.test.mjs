import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

// Small POSIX tar fixture. Payloads remain synthetic; no Docker daemon is used.
function tar(
  entries = [
    { name: "./attachments/example.txt", content: "attachment bytes" },
  ],
) {
  const blocks = [];
  for (const {
    name,
    content = "",
    type = "0",
    link = "",
    devMajor = "",
    devMinor = "",
  } of entries) {
    const header = Buffer.alloc(512);
    const bytes = Buffer.from(content);
    Buffer.from(name).copy(header, 0, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write(link, 157, 100);
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.write(devMajor, 329, 8);
    header.write(devMinor, 337, 8);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

// BusyBox writes GNU L before a filename occupying all 100 short-name bytes.
// Directories get a slash in the expanded name. No third-party source is copied.
function busyboxTar(entries) {
  return tar(
    entries.flatMap((entry) => {
      if (Buffer.byteLength(entry.name) < 100) return [entry];
      return [
        { name: "././@LongLink", type: "L", content: `${entry.name}\0` },
        entry,
      ];
    }),
  );
}

// Matches the shapes in presign-attachment.ts and storage/shared.ts; IDs and
// contents are synthetic. Completed objects have an additional final/token path.
const applicationKey =
  "./attachments/workspace/abcdefghijklmnopqrstuvwx/work-item/bcdefghijklmnopqrstuvwxy/attachment/cdefghijklmnopqrstuvwxyz/final/defghijklmnopqrstuvwxyza-release-evidence.txt";

function checksums(directory) {
  writeFileSync(
    join(directory, "SHA256SUMS"),
    ["postgres.dump", "attachments.tar"]
      .map(
        (name) =>
          `${createHash("sha256")
            .update(readFileSync(join(directory, name)))
            .digest("hex")}  ${name}\n`,
      )
      .join(""),
  );
}

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "taskdesk-recovery-")));
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
if [ "$1" = inspect ]; then
  case "$*" in
    *State.ExitCode*) printf '%s\\n' "\${RECOVERY_HELPER_EXIT:-0}" ;;
    *) printf '%s\\n' "$RECOVERY_TEST_MOUNT" ;;
  esac
  exit
fi
case "$*" in
  *'ps -a -q taskdesk'*) printf '%s\\n' "$RECOVERY_TEST_CONTAINER" ;;
  *pg_dump*) printf 'database archive'; exit "\${RECOVERY_DUMP_EXIT:-0}" ;;
  *'pg_restore --list'*)
    cat >/dev/null
    if [ "\${RECOVERY_EMPTY_LIST:-0}" != 1 ]; then printf '1; archive entry\\n'; fi
    exit "\${RECOVERY_LIST_EXIT:-0}"
    ;;
  *'pg_restore --file=/dev/null'*)
    cat >/dev/null
    exit "\${RECOVERY_DECODE_EXIT:-0}"
    ;;
  *' stop taskdesk')
    if [ "\${RECOVERY_REPLACE_SOURCE:-0}" = 1 ]; then printf corrupt > "$RECOVERY_TEST_BACKUP/postgres.dump"; fi
    ;;
  *'pg_restore --single-transaction'*) cat > "$RECOVERY_RESTORED_DUMP" ;;
  'create '*) printf '%s\\n' "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" ;;
  'start -a -i '*) cat > "$RECOVERY_RESTORED_TAR" ;;
  'start -a '*) cat "$RECOVERY_TEST_TAR" ;;
esac
`,
    { mode: 0o700 },
  );
  const backup = join(dir, "backup");
  mkdirSync(backup);
  writeFileSync(join(backup, "postgres.dump"), "database archive");
  writeFileSync(join(backup, "attachments.tar"), tar());
  checksums(backup);
  return {
    dir,
    backup,
    output: join(dir, "completed"),
    run(script, args = [], overrides = {}) {
      writeFileSync(log, "");
      const result = spawnSync(
        "bash",
        [join(dir, "scripts", script), ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${join(dir, "bin")}:${process.env.PATH}`,
            RECOVERY_TEST_LOG: log,
            RECOVERY_TEST_BACKUP: backup,
            RECOVERY_TEST_TAR: join(backup, "attachments.tar"),
            RECOVERY_RESTORED_DUMP: join(dir, "restored.dump"),
            RECOVERY_RESTORED_TAR: join(dir, "restored.tar"),
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
      ? ["--output-dir", f.output]
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
          /compose .* stop |pg_terminate_backend|DROP DATABASE|^create /m,
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

const noMutation =
  /compose .* stop |pg_terminate_backend|DROP DATABASE|^create |^start |^rm /m;
const helper = "c".repeat(64);

for (const [label, overrides] of [
  ["listing exits nonzero after writing entries", { RECOVERY_LIST_EXIT: "1" }],
  ["empty listing", { RECOVERY_EMPTY_LIST: "1" }],
  [
    "corrupt database payload after a valid listing",
    { RECOVERY_DECODE_EXIT: "1" },
  ],
]) {
  for (const script of ["backup.sh", "restore.sh"]) {
    test(`${script} rejects ${label} before data mutation`, () => {
      const f = fixture();
      try {
        const args =
          script === "backup.sh"
            ? ["--output-dir", f.output]
            : ["--backup", f.backup, "--confirm"];
        const result = f.run(script, args, overrides);
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.calls, noMutation);
        assert.equal(existsSync(f.output), false);
        assert.equal(
          readdirSync(f.dir).some((name) => name.startsWith("completed.")),
          false,
        );
      } finally {
        f.close();
      }
    });
  }
}

const unsafeArchives = [
  ["truncated header", Buffer.alloc(50)],
  ["no end marker", tar().subarray(0, 1024)],
  ["single end block", tar().subarray(0, 1536)],
  ["trailing hidden archive", Buffer.concat([tar(), tar()])],
  [
    "truncated payload",
    (() => {
      const valid = tar([{ name: "file", content: "x".repeat(2048) }]);
      return valid.subarray(0, 2048);
    })(),
  ],
  [
    "invalid header checksum",
    (() => {
      const valid = tar();
      valid[0] ^= 1;
      return valid;
    })(),
  ],
  [
    "invalid payload padding",
    (() => {
      const valid = tar();
      valid[1023] = 1;
      return valid;
    })(),
  ],
  ["parent traversal", tar([{ name: "./../escape" }])],
  ["absolute path", tar([{ name: "/escape" }])],
  ["backslash path", tar([{ name: "..\\escape" }])],
  ["symlink", tar([{ name: "attachments/link", type: "2", link: "/outside" }])],
  [
    "hardlink",
    tar([{ name: "attachments/link", type: "1", link: "../outside" }]),
  ],
  ["FIFO", tar([{ name: "attachments/pipe", type: "6" }])],
  ["device", tar([{ name: "attachments/device", type: "3" }])],
  [
    "PAX path override",
    tar([{ name: "PaxHeader", type: "x", content: "21 path=../escape\n" }]),
  ],
  [
    "GNU long path override",
    tar([{ name: "././@LongLink", type: "L", content: "../escape\0" }]),
  ],
  ["duplicate normalized path", tar([{ name: "./file" }, { name: "file" }])],
  ["file parent", tar([{ name: "file" }, { name: "file/child" }])],
  ["file replacing parent", tar([{ name: "file/child" }, { name: "file" }])],
  [
    "directory payload",
    tar([{ name: "directory", type: "5", content: "payload" }]),
  ],
];
for (const [label, archive] of unsafeArchives) {
  test(`restore refuses ${label} before any Docker action`, () => {
    const f = fixture();
    try {
      writeFileSync(join(f.backup, "attachments.tar"), archive);
      checksums(f.backup);
      const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"]);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, "");
    } finally {
      f.close();
    }
  });
}

for (const [label, change] of [
  [
    "missing attachment checksum",
    (f) => {
      const path = join(f.backup, "SHA256SUMS");
      writeFileSync(path, `${readFileSync(path, "utf8").split("\n")[0]}\n`);
    },
  ],
  [
    "duplicate checksum",
    (f) => {
      const path = join(f.backup, "SHA256SUMS");
      const line = readFileSync(path, "utf8").split("\n")[0];
      writeFileSync(path, `${line}\n${line}\n`);
    },
  ],
  [
    "checksum path injection",
    (f) => {
      const path = join(f.backup, "SHA256SUMS");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          "attachments.tar",
          "../attachments.tar",
        ),
      );
    },
  ],
  [
    "checksum mismatch",
    (f) => {
      writeFileSync(join(f.backup, "postgres.dump"), "corrupted");
    },
  ],
  [
    "symlinked backup member",
    (f) => {
      const path = join(f.backup, "postgres.dump");
      rmSync(path);
      symlinkSync(join(f.backup, "attachments.tar"), path);
    },
  ],
]) {
  test(`restore refuses ${label} before any Docker action`, () => {
    const f = fixture();
    try {
      change(f);
      const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"]);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, "");
    } finally {
      f.close();
    }
  });
}

test("restore consumes its verified private copy when the source changes", () => {
  const f = fixture();
  try {
    const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"], {
      RECOVERY_REPLACE_SOURCE: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(f.backup, "postgres.dump"), "utf8"),
      "corrupt",
    );
    assert.equal(
      readFileSync(join(f.dir, "restored.dump"), "utf8"),
      "database archive",
    );
    assert.deepEqual(readFileSync(join(f.dir, "restored.tar")), tar());
    assert.ok(
      result.calls.indexOf("pg_restore --file=/dev/null") <
        result.calls.indexOf("stop taskdesk"),
    );
    assert.match(result.calls, new RegExp(`^rm ${helper}$`, "m"));
  } finally {
    f.close();
  }
});

test("backup publishes only a validated private archive and refuses an existing destination", () => {
  const f = fixture();
  try {
    const result = f.run("backup.sh", ["--output-dir", f.output]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(f.output).sort(), [
      "SHA256SUMS",
      "attachments.tar",
      "postgres.dump",
    ]);
    assert.equal(statSync(f.output).mode & 0o777, 0o700);
    for (const name of readdirSync(f.output))
      assert.equal(statSync(join(f.output, name)).mode & 0o777, 0o600);
    assert.equal(
      readdirSync(f.dir).some((name) => name.startsWith("completed.")),
      false,
    );
    const sums = readFileSync(join(f.output, "SHA256SUMS"), "utf8");
    const again = f.run("backup.sh", ["--output-dir", f.output]);
    assert.notEqual(again.status, 0);
    assert.doesNotMatch(again.calls, /pg_dump|^create /m);
    assert.equal(readFileSync(join(f.output, "SHA256SUMS"), "utf8"), sums);
  } finally {
    f.close();
  }
});

for (const [label, overrides] of [
  ["failed dump", { RECOVERY_DUMP_EXIT: "1" }],
  ["failed tar helper", { RECOVERY_HELPER_EXIT: "1" }],
]) {
  test(`backup leaves no published or partial backup after ${label}`, () => {
    const f = fixture();
    try {
      const result = f.run("backup.sh", ["--output-dir", f.output], overrides);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(f.output), false);
      assert.equal(
        readdirSync(f.dir).some((name) => name.startsWith("completed.")),
        false,
      );
      if (overrides.RECOVERY_HELPER_EXIT)
        assert.match(result.calls, new RegExp(`^rm -f ${helper}$`, "m"));
    } finally {
      f.close();
    }
  });
}

test("backup rejects malformed tar output without publishing", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.backup, "attachments.tar"), "not a tar archive");
    const result = f.run("backup.sh", ["--output-dir", f.output]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(f.output), false);
    assert.match(result.calls, new RegExp(`^rm ${helper}$`, "m"));
  } finally {
    f.close();
  }
});

test("backup refuses a concurrent destination lock without replacing it", () => {
  const f = fixture();
  try {
    mkdirSync(`${f.output}.lock`);
    const result = f.run("backup.sh", ["--output-dir", f.output]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(`${f.output}.lock`), true);
    assert.doesNotMatch(result.calls, /pg_dump|^create /m);
  } finally {
    f.close();
  }
});

test("failed restore tar helper is removed by ID and application stays stopped", () => {
  const f = fixture();
  try {
    const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"], {
      RECOVERY_HELPER_EXIT: "1",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.calls, new RegExp(`^rm -f ${helper}$`, "m"));
    assert.doesNotMatch(result.calls, /run --rm migrate|up -d/);
  } finally {
    f.close();
  }
});

test("both tar helpers have no network and remove only their captured container ID", () => {
  const f = fixture();
  try {
    for (const [script, args] of [
      ["backup.sh", ["--output-dir", f.output]],
      ["restore.sh", ["--backup", f.backup, "--confirm"]],
    ]) {
      const result = f.run(script, args);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.calls, /^create --network none /m);
      assert.match(result.calls, new RegExp(`^rm ${helper}$`, "m"));
      assert.doesNotMatch(result.calls, /prune|^rm .*taskdesk|down --volumes/m);
    }
  } finally {
    f.close();
  }
});

test("valid root directories, Unicode paths, and empty attachment volumes remain restorable", () => {
  const f = fixture();
  try {
    for (const entries of [
      [],
      [
        { name: "./", type: "5" },
        { name: "./attachments/", type: "5" },
        { name: "./attachments/မြန်မာ.txt", content: "bytes" },
      ],
    ]) {
      writeFileSync(join(f.backup, "attachments.tar"), tar(entries));
      checksums(f.backup);
      const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"]);
      assert.equal(result.status, 0, result.stderr);
    }
  } finally {
    f.close();
  }
});

for (const type of ["0", "\0"]) {
  for (const content of [
    "",
    tar([{ name: "hidden-link", type: "2", link: "/outside" }]).subarray(
      0,
      512,
    ),
  ]) {
    test(`restore refuses trailing-slash regular type ${JSON.stringify(type)} with ${content.length} payload bytes`, () => {
      const f = fixture();
      try {
        writeFileSync(
          join(f.backup, "attachments.tar"),
          tar([{ name: "directory/", type, content }]),
        );
        checksums(f.backup);
        const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"]);
        assert.notEqual(result.status, 0);
        assert.equal(result.calls, "");
      } finally {
        f.close();
      }
    });
  }
}

const longRecord = (content) => ({ name: "././@LongLink", type: "L", content });
for (const [label, entries] of [
  [
    "regular file naming a directory dot entry",
    [{ name: "directory/.", content: "bytes" }],
  ],
  [
    "zero-length regular with a hardlink target",
    [{ name: "file", link: "/outside" }],
  ],
  [
    "nonempty regular with a link target",
    [{ name: "file", content: "bytes", link: "existing" }],
  ],
  [
    "NUL-type regular with a link target",
    [{ name: "file", type: "\0", link: "/outside" }],
  ],
  [
    "directory with a link target",
    [{ name: "directory", type: "5", link: "/outside" }],
  ],
  ["invalid device major", [{ name: "file", devMajor: "invalid" }]],
  [
    "invalid device minor",
    [{ name: "file", devMajor: "0000000", devMinor: "invalid" }],
  ],
  ["minor metadata with absent major", [{ name: "file", devMinor: "invalid" }]],
  ["unexpected device major", [{ name: "file", devMajor: "0000001" }]],
  [
    "unexpected device minor",
    [{ name: "file", devMajor: "0000000", devMinor: "0000001" }],
  ],
  ["long-name traversal", [longRecord("../outside\0"), { name: "safe" }]],
  ["absolute long name", [longRecord("/outside\0"), { name: "safe" }]],
  [
    "long regular name ending in slash",
    [longRecord(`${applicationKey}/\0`), { name: "safe", content: "bytes" }],
  ],
  [
    "duplicate expanded name",
    [
      longRecord(`${applicationKey}\0`),
      { name: "one" },
      longRecord(`${applicationKey}\0`),
      { name: "two" },
    ],
  ],
  [
    "long name replacing file parent",
    [
      { name: "parent" },
      longRecord(`parent/${applicationKey}\0`),
      { name: "safe" },
    ],
  ],
  [
    "long-name record with link target",
    [
      { ...longRecord(`${applicationKey}\0`), link: "/outside" },
      { name: "safe" },
    ],
  ],
  [
    "long-name record with malformed device fields",
    [
      { ...longRecord(`${applicationKey}\0`), devMajor: "invalid" },
      { name: "safe" },
    ],
  ],
  [
    "chained long-name records",
    [longRecord("one\0"), longRecord("two\0"), { name: "safe" }],
  ],
  ["orphan long-name record", [longRecord(`${applicationKey}\0`)]],
  ["empty long-name record", [longRecord("\0"), { name: "safe" }]],
  ["unterminated long name", [longRecord(applicationKey), { name: "safe" }]],
  [
    "embedded NUL in long name",
    [longRecord("safe\0../outside\0"), { name: "safe" }],
  ],
  [
    "oversized long-name payload",
    [longRecord(`${"a".repeat(4095)}\0`), { name: "safe" }],
  ],
  [
    "long name followed by GNU K",
    [
      longRecord(`${applicationKey}\0`),
      { name: "././@LongLink", type: "K", content: "/outside\0" },
      { name: "safe" },
    ],
  ],
  [
    "long name followed by PAX",
    [
      longRecord(`${applicationKey}\0`),
      { name: "PaxHeader", type: "x", content: "21 path=../escape\n" },
      { name: "safe" },
    ],
  ],
  [
    "long name followed by symlink",
    [
      longRecord(`${applicationKey}\0`),
      { name: "safe", type: "2", link: "/outside" },
    ],
  ],
]) {
  test(`restore refuses ${label} before any Docker action`, () => {
    const f = fixture();
    try {
      writeFileSync(join(f.backup, "attachments.tar"), tar(entries));
      checksums(f.backup);
      const result = f.run("restore.sh", ["--backup", f.backup, "--confirm"]);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, "");
    } finally {
      f.close();
    }
  });
}

test("backup and restore accept BusyBox long names for pending and completed application keys", () => {
  const f = fixture();
  try {
    const directory = applicationKey.slice(0, applicationKey.lastIndexOf("/"));
    const archive = busyboxTar([
      { name: "./", type: "5" },
      { name: `${directory}/`, type: "5" },
      { name: applicationKey, content: "completed attachment bytes" },
      {
        name: applicationKey.replace(/final\/[^/]+$/, "pending-upload.txt"),
        content: "pending bytes",
      },
      // The first 100 bytes end in the middle of the UTF-8 filename.
      {
        name: `./attachments/${"a".repeat(85)}မြန်မာ.txt`,
        content: "Unicode filename bytes",
      },
      { name: "x".repeat(100), content: "100-byte boundary" },
      { name: "zero-device-fields", devMajor: "0000000", devMinor: "0000000" },
    ]);
    writeFileSync(join(f.backup, "attachments.tar"), archive);
    checksums(f.backup);
    const backup = f.run("backup.sh", ["--output-dir", f.output]);
    assert.equal(backup.status, 0, backup.stderr);
    assert.deepEqual(readFileSync(join(f.output, "attachments.tar")), archive);
    const restored = f.run("restore.sh", ["--backup", f.output, "--confirm"]);
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(readFileSync(join(f.dir, "restored.tar")), archive);
  } finally {
    f.close();
  }
});

function publishWithInjection(f, injection) {
  const preload = join(f.dir, "inject.mjs");
  writeFileSync(
    preload,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const target = ${JSON.stringify(f.output)};
${injection}
syncBuiltinESMExports();`,
  );
  return spawnSync(
    "node",
    [
      "--import",
      preload,
      join(f.dir, "scripts/lib/recovery-archive.mjs"),
      "publish",
      f.backup,
      f.output,
    ],
    { encoding: "utf8" },
  );
}

test("publication cannot replace a destination introduced at the reservation boundary", () => {
  const f = fixture();
  try {
    const result = publishWithInjection(
      f,
      `const original = fs.mkdirSync;
fs.mkdirSync = (path, options) => {
  if (path === target) { original(path, options); fs.writeFileSync(path + '/other-owner', 'preserve'); }
  return original(path, options);
};`,
    );
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(f.output), ["other-owner"]);
    assert.equal(
      readFileSync(join(f.output, "other-owner"), "utf8"),
      "preserve",
    );
    assert.deepEqual(readdirSync(f.backup).sort(), [
      "SHA256SUMS",
      "attachments.tar",
      "postgres.dump",
    ]);
  } finally {
    f.close();
  }
});

for (const failedMember of ["postgres.dump", "attachments.tar", "SHA256SUMS"]) {
  test(`publication interrupted at ${failedMember} is incomplete and cannot be restored`, () => {
    const f = fixture();
    try {
      const result = publishWithInjection(
        f,
        `const original = fs.linkSync;
fs.linkSync = (source, destination) => {
  if (destination === target + '/' + ${JSON.stringify(failedMember)}) throw new Error('simulated interruption');
  return original(source, destination);
};`,
      );
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(f.output, "SHA256SUMS")), false);
      const restore = f.run("restore.sh", ["--backup", f.output, "--confirm"]);
      assert.notEqual(restore.status, 0);
      assert.equal(restore.calls, "");
      assert.equal(statSync(f.output).mode & 0o777, 0o700);
    } finally {
      f.close();
    }
  });
}

function canonicalFixture() {
  const f = fixture();
  const project = "taskdesk-codex-testing";
  const composeFile = join(f.dir, "deploy/compose.testing.yml");
  mkdirSync(join(f.dir, "deploy"));
  cpSync(resolve("deploy/compose.testing.yml"), composeFile);
  const privateDir = join(f.dir, "private");
  mkdirSync(privateDir, { mode: 0o700 });
  for (const name of ["postgres", "app", "migrate", "valkey"])
    writeFileSync(
      join(privateDir, `${name}.env`),
      "# synthetic private fixture\n",
      { mode: 0o600 },
    );
  const envFile = join(privateDir, "compose.env");
  writeFileSync(
    envFile,
    `SIT_PRIVATE_DIR=${privateDir}\nSIT_IMAGE=synthetic:release\n`,
    { mode: 0o600 },
  );
  const database = "canonical_fixture";
  const user = "fixture_owner";
  const databaseUrl = `postgres://fixture_app:private-marker@postgres:5432/${database}`;
  const model = {
    config: {
      name: project,
      services: {
        taskdesk: {
          image: "synthetic:release",
          environment: { TASKDESK_DATABASE_URL: databaseUrl },
          volumes: [
            {
              type: "volume",
              source: "attachments",
              target: "/app/data/attachments",
            },
          ],
        },
        postgres: {
          environment: { POSTGRES_DB: database, POSTGRES_USER: user },
          volumes: [
            {
              type: "volume",
              source: "postgres-data",
              target: "/var/lib/postgresql",
            },
          ],
        },
      },
      volumes: {
        attachments: { name: `${project}_attachments` },
        "postgres-data": { name: `${project}_postgres-data` },
      },
    },
    containers: {},
    volumes: {},
    daemonId: "synthetic-daemon",
    configuredImageId: `sha256:${"d".repeat(64)}`,
    runningDatabase: {
      database,
      user,
      dataDirectory: "/var/lib/postgresql/18/docker",
      systemIdentifier: "987654321",
    },
  };
  for (const [service, id, key, destination, env] of [
    [
      "taskdesk",
      "a".repeat(64),
      "attachments",
      "/app/data/attachments",
      [`TASKDESK_DATABASE_URL=${databaseUrl}`],
    ],
    [
      "postgres",
      "b".repeat(64),
      "postgres-data",
      "/var/lib/postgresql",
      [
        `POSTGRES_DB=${database}`,
        `POSTGRES_USER=${user}`,
        "PGDATA=/var/lib/postgresql/18/docker",
      ],
    ],
  ]) {
    model.containers[service] = {
      Id: id,
      Image: `sha256:${"d".repeat(64)}`,
      State: { Running: true },
      Config: {
        Env: env,
        Labels: {
          "com.docker.compose.project": project,
          "com.docker.compose.service": service,
          "com.docker.compose.project.config_files": composeFile,
          "com.docker.compose.oneoff": "False",
        },
      },
      Mounts: [
        {
          Type: "volume",
          Name: `${project}_${key}`,
          Destination: destination,
          RW: true,
          Source: `/synthetic/volumes/${project}_${key}/_data`,
        },
      ],
    };
    model.volumes[`${project}_${key}`] = {
      Name: `${project}_${key}`,
      Driver: "local",
      Mountpoint: `/synthetic/volumes/${project}_${key}/_data`,
      CreatedAt: "2026-11-10T00:00:00Z",
      Options: {},
      Labels: {
        "com.docker.compose.project": project,
        "com.docker.compose.volume": key,
      },
    };
  }
  const modelPath = join(f.dir, "model.json");
  const save = () => writeFileSync(modelPath, JSON.stringify(model));
  save();
  writeFileSync(
    join(f.dir, "bin/docker"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const model = JSON.parse(fs.readFileSync(${JSON.stringify(modelPath)}));
fs.appendFileSync(${JSON.stringify(join(f.dir, "docker.log"))}, args.join(' ') + '\\n');
const out = value => process.stdout.write(typeof value === 'string' ? value + '\\n' : JSON.stringify(value));
if (args[0] === 'context') out(args[1] === 'show' ? 'desktop' : [{Endpoints:{docker:{Host:'unix:///synthetic/docker.sock'}}}]);
else if (args[0] === 'info') out(model.daemonId);
else if (args[0] === 'volume') out([model.volumes[args[2]]]);
else if (args[0] === 'image') out([{ Id: model.configuredImageId }]);
else if (args[0] === 'exec') {
  if (args[2] !== model.containers.postgres.Id || args[3] !== 'env' || args[4] !== '-i') process.exit(92);
  if (args.includes('psql') || args.includes('pg_dump')) {
    if (args[args.indexOf('-h')+1] !== '/var/run/postgresql' || args[args.indexOf('-p')+1] !== '5432') process.exit(93);
  }
  if (args.includes('psql')) out(model.runningDatabase);
  else if (args.includes('pg_dump')) process.stdout.write('database archive');
  else if (args.includes('--list')) out('1; archive entry');
  else if (!args.includes('--file=/dev/null')) process.exit(94);
}
else if (args[0] === 'inspect') {
  if (args.includes('--format')) out('0');
  else if (args[1] === 'c'.repeat(64)) out([{Id: args[1], HostConfig:{NetworkMode:'none', VolumesFrom:['a'.repeat(64)+':ro']}, Mounts: [{...model.containers.taskdesk.Mounts[0], RW: model.race === 'writable-helper', Name: model.race === 'wrong-helper-mount' ? 'other' : model.containers.taskdesk.Mounts[0].Name}]}]);
  else out(Object.values(model.containers).filter(item => item.Id === args[1]));
} else if (args[0] === 'compose') {
  if (args.filter(x => x === '-f').length !== 1 || args[args.indexOf('-f')+1] !== ${JSON.stringify(composeFile)} || args[args.indexOf('--env-file')+1] !== ${JSON.stringify(envFile)} || args[args.indexOf('-p')+1] !== ${JSON.stringify(project)}) process.exit(87);
  if (args.includes('config')) out(model.config);
  else if (args.includes('ps')) out(model.containers[args.at(-1)]?.Id || '');
  else if (args.includes('psql')) out(model.runningDatabase);
  else if (args.includes('pg_dump')) process.stdout.write('database archive');
  else if (args.includes('--list')) out('1; archive entry');
  else if (args.includes('--file=/dev/null')) {}
  else process.exit(88);
} else if (args[0] === 'create') {
  if (args.includes('--volumes-from') && (process.env.DOCKER_HOST !== 'unix:///synthetic/docker.sock' || process.env.DOCKER_CONTEXT)) process.exit(95);
  if (model.race === 'remove-source-at-create') {
    delete model.volumes['taskdesk-codex-testing_attachments'];
    delete model.containers.taskdesk;
    fs.writeFileSync(${JSON.stringify(modelPath)}, JSON.stringify(model));
    if (args.includes('--volumes-from')) process.exit(91);
  }
  out('c'.repeat(64));
} else if (args[0] === 'start') {
  if (model.race === 'replace-after-read') {
    model.volumes['taskdesk-codex-testing_attachments'].Labels['com.docker.compose.project'] = 'replacement';
    fs.writeFileSync(${JSON.stringify(modelPath)}, JSON.stringify(model));
  }
  process.stdout.write(fs.readFileSync(${JSON.stringify(join(f.backup, "attachments.tar"))}));
}
else if (args[0] !== 'rm') process.exit(89);
`,
    { mode: 0o700 },
  );
  return {
    ...f,
    model,
    save,
    envFile,
    privateDir,
    args: ["--target", "local-sit", "--env-file", envFile],
  };
}

const mutations =
  /compose .* stop |pg_terminate_backend|DROP DATABASE|^create |pg_dump|pg_restore --single-transaction/m;
for (const [label, change] of [
  [
    "wrong running database",
    (f) => {
      f.model.runningDatabase.database = "other";
    },
  ],
  [
    "wrong running data directory",
    (f) => {
      f.model.runningDatabase.dataDirectory = "/other";
    },
  ],
  [
    "wrong project",
    (f) => {
      f.model.config.name = "another-project";
    },
  ],
  [
    "wrong container project",
    (f) => {
      f.model.containers.taskdesk.Config.Labels["com.docker.compose.project"] =
        "another-project";
    },
  ],
  [
    "wrong database service",
    (f) => {
      f.model.containers.postgres.Config.Labels["com.docker.compose.service"] =
        "taskdesk";
    },
  ],
  [
    "extra Compose overlay",
    (f) => {
      f.model.containers.taskdesk.Config.Labels[
        "com.docker.compose.project.config_files"
      ] += ",private-overlay.yml";
    },
  ],
  [
    "missing postgres container",
    (f) => {
      f.model.containers.postgres.Id = "";
    },
  ],
  [
    "wrong attachment volume",
    (f) => {
      f.model.containers.taskdesk.Mounts[0].Name = "production_attachments";
    },
  ],
  [
    "legacy attachment layout",
    (f) => {
      f.model.containers.taskdesk.Mounts[0].Destination = "/app/data";
    },
  ],
  [
    "nested attachment mount",
    (f) => {
      f.model.containers.taskdesk.Mounts.push({
        Type: "bind",
        Destination: "/app/data/attachments/nested",
      });
    },
  ],
  [
    "wrong postgres mount",
    (f) => {
      f.model.containers.postgres.Mounts[0].Destination =
        "/var/lib/postgresql/data";
    },
  ],
  [
    "bind mount",
    (f) => {
      f.model.containers.postgres.Mounts[0].Type = "bind";
    },
  ],
  [
    "foreign volume label",
    (f) => {
      f.model.volumes["taskdesk-codex-testing_attachments"].Labels[
        "com.docker.compose.project"
      ] = "foreign";
    },
  ],
  [
    "external volume",
    (f) => {
      f.model.config.volumes.attachments.external = true;
    },
  ],
  [
    "volume driver options",
    (f) => {
      f.model.volumes["taskdesk-codex-testing_attachments"].Options = {
        device: "/live",
      };
    },
  ],
  [
    "wrong initialized database",
    (f) => {
      f.model.containers.postgres.Config.Env[0] = "POSTGRES_DB=other";
    },
  ],
  [
    "unsafe database identifier",
    (f) => {
      f.model.config.services.postgres.environment.POSTGRES_DB = "bad'name";
      f.model.containers.postgres.Config.Env[0] = "POSTGRES_DB=bad'name";
    },
  ],
  [
    "wrong postgres data directory",
    (f) => {
      f.model.containers.postgres.Config.Env[2] = "PGDATA=/other";
    },
  ],
  [
    "different app database",
    (f) => {
      const value = "postgres://app:private-marker@postgres:5432/other";
      f.model.config.services.taskdesk.environment.TASKDESK_DATABASE_URL =
        value;
      f.model.containers.taskdesk.Config.Env[0] = `TASKDESK_DATABASE_URL=${value}`;
    },
  ],
  [
    "external database host",
    (f) => {
      const value =
        "postgres://app:private-marker@external:5432/canonical_fixture";
      f.model.config.services.taskdesk.environment.TASKDESK_DATABASE_URL =
        value;
      f.model.containers.taskdesk.Config.Env[0] = `TASKDESK_DATABASE_URL=${value}`;
    },
  ],
  [
    "different storage root",
    (f) => {
      f.model.containers.taskdesk.Config.Env.push(
        "TASKDESK_STORAGE_FILESYSTEM_ROOT=/other",
      );
    },
  ],
]) {
  test(`canonical backup refuses ${label} before dump or helper mutation`, () => {
    const f = canonicalFixture();
    try {
      change(f);
      f.save();
      const result = f.run("backup.sh", [...f.args, "--output-dir", f.output]);
      assert.notEqual(result.status, 0, result.stdout);
      assert.doesNotMatch(result.calls, mutations);
      assert.doesNotMatch(result.stderr + result.stdout, /private-marker/);
      assert.equal(existsSync(f.output), false);
    } finally {
      f.close();
    }
  });
}

test("canonical backup binds identity and attachment-root layout; both restore modes refuse mutation", () => {
  const f = canonicalFixture();
  try {
    writeFileSync(join(f.dir, ".env"), `touch '${join(f.dir, "executed")}'\n`);
    const result = f.run("backup.sh", [...f.args, "--output-dir", f.output], {
      SIT_PRIVATE_DIR: "/wrong",
      COMPOSE_FILE: "/wrong",
      POSTGRES_DB: "wrong",
      POSTGRES_USER: "wrong",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(f.dir, "executed")), false);
    assert.match(
      result.calls,
      /pg_dump -h \/var\/run\/postgresql -p 5432 -Fc -U fixture_owner canonical_fixture/,
    );
    assert.match(
      result.calls,
      new RegExp(`--volumes-from ${"a".repeat(64)}:ro`),
    );
    assert.doesNotMatch(result.calls, /-v taskdesk-codex-testing_attachments:/);
    const identity = JSON.parse(
      readFileSync(join(f.output, "source-identity.json")),
    );
    assert.equal(identity.layout, "attachments-root-v1");
    assert.equal(identity.consistency, "unfenced");
    assert.equal(
      statSync(join(f.output, "source-identity.json")).mode & 0o777,
      0o600,
    );
    assert.match(
      readFileSync(join(f.output, "SHA256SUMS"), "utf8"),
      /source-identity.json/,
    );
    assert.doesNotMatch(
      readFileSync(join(f.output, "source-identity.json"), "utf8"),
      /private-marker/,
    );
    const restore = f.run("restore.sh", [
      ...f.args,
      "--backup",
      f.output,
      "--confirm",
    ]);
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr, /writer fencing/);
    assert.doesNotMatch(restore.calls, mutations);
    // A canonical archive cannot fall through to the legacy destructive path.
    const legacy = f.run("restore.sh", ["--backup", f.output, "--confirm"]);
    assert.notEqual(legacy.status, 0);
    assert.equal(legacy.calls, "");
    assert.match(legacy.stderr, /identity-bearing backups/);
  } finally {
    f.close();
  }
});

for (const field of [
  "daemonId",
  "project",
  "layout",
  "database",
  "attachments",
  "services",
]) {
  test(`canonical restore refuses source manifest ${field} mismatch`, () => {
    const f = canonicalFixture();
    try {
      assert.equal(
        f.run("backup.sh", [...f.args, "--output-dir", f.output]).status,
        0,
      );
      const manifestPath = join(f.output, "source-identity.json");
      const manifest = JSON.parse(readFileSync(manifestPath));
      manifest[field] = "mismatched";
      writeFileSync(manifestPath, JSON.stringify(manifest));
      const sums = ["postgres.dump", "attachments.tar", "source-identity.json"]
        .map(
          (name) =>
            `${createHash("sha256")
              .update(readFileSync(join(f.output, name)))
              .digest("hex")}  ${name}\n`,
        )
        .join("");
      writeFileSync(join(f.output, "SHA256SUMS"), sums);
      const result = f.run("restore.sh", [
        ...f.args,
        "--backup",
        f.output,
        "--confirm",
      ]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /source identity does not match/);
      assert.doesNotMatch(result.calls, mutations);
    } finally {
      f.close();
    }
  });
}

for (const target of ["technexus-sit", "technexus-uat", "unknown"]) {
  test(`both scripts refuse unsupported ${target} before Docker`, () => {
    const f = fixture();
    try {
      for (const script of ["backup.sh", "restore.sh"]) {
        const args =
          script === "backup.sh"
            ? ["--output-dir", f.output]
            : ["--backup", f.backup, "--confirm"];
        const result = f.run(script, [...args, "--target", target]);
        assert.notEqual(result.status, 0);
        assert.equal(result.calls, "");
      }
    } finally {
      f.close();
    }
  });
}

test("canonical restore refuses legacy archives before Docker", () => {
  const f = canonicalFixture();
  try {
    const result = f.run("restore.sh", [
      ...f.args,
      "--backup",
      f.backup,
      "--confirm",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum-bound source identity/);
    assert.equal(result.calls, "");
  } finally {
    f.close();
  }
});

for (const [label, content] of [
  [
    "shell expansion",
    "SIT_PRIVATE_DIR=$(touch /tmp/forbidden)\nSIT_IMAGE=test\n",
  ],
  ["shell command", "touch /tmp/forbidden\n"],
  ["executable path override", "PATH=/wrong\n"],
]) {
  test(`canonical backup refuses ${label} in private configuration`, () => {
    const f = canonicalFixture();
    try {
      writeFileSync(f.envFile, content);
      const result = f.run("backup.sh", [...f.args, "--output-dir", f.output]);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, "");
    } finally {
      f.close();
    }
  });
}

for (const [label, change] of [
  ["world-readable env file", (f) => chmodSync(f.envFile, 0o644)],
  [
    "world-readable service file",
    (f) => chmodSync(join(f.privateDir, "app.env"), 0o644),
  ],
  ["public private directory", (f) => chmodSync(f.privateDir, 0o755)],
  [
    "symlinked env file",
    (f) => {
      const content = readFileSync(f.envFile);
      rmSync(f.envFile);
      writeFileSync(join(f.privateDir, "real.env"), content, { mode: 0o600 });
      symlinkSync(join(f.privateDir, "real.env"), f.envFile);
    },
  ],
]) {
  test(`canonical backup refuses ${label} before Docker`, () => {
    const f = canonicalFixture();
    try {
      change(f);
      const result = f.run("backup.sh", [...f.args, "--output-dir", f.output]);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, "");
    } finally {
      f.close();
    }
  });
}

test("manifest checksum mismatch is refused before target inspection", () => {
  const f = canonicalFixture();
  try {
    assert.equal(
      f.run("backup.sh", [...f.args, "--output-dir", f.output]).status,
      0,
    );
    writeFileSync(join(f.output, "source-identity.json"), "{}");
    const result = f.run("restore.sh", [
      ...f.args,
      "--backup",
      f.output,
      "--confirm",
    ]);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
  } finally {
    f.close();
  }
});

for (const script of ["backup.sh", "restore.sh"]) {
  test(`${script} refuses legacy selection of canonical project before Docker`, () => {
    const f = fixture();
    try {
      const args =
        script === "backup.sh"
          ? ["--output-dir", f.output]
          : ["--backup", f.backup, "--confirm"];
      const result = f.run(script, [
        ...args,
        "--project-name",
        "taskdesk-codex-testing",
      ]);
      assert.notEqual(result.status, 0);
      assert.equal(result.calls, "");
    } finally {
      f.close();
    }
  });
}

for (const failedMember of ["source-identity.json", "SHA256SUMS"]) {
  test(`identity-bearing publication interrupted at ${failedMember} remains unrestorable`, () => {
    const f = fixture();
    try {
      const identity = JSON.stringify({
        target: "local-sit",
        layout: "attachments-root-v1",
      });
      writeFileSync(join(f.backup, "source-identity.json"), identity);
      writeFileSync(
        join(f.backup, "SHA256SUMS"),
        readFileSync(join(f.backup, "SHA256SUMS"), "utf8") +
          `${createHash("sha256").update(identity).digest("hex")}  source-identity.json\n`,
      );
      const result = publishWithInjection(
        f,
        `const original = fs.linkSync;
fs.linkSync = (source, destination) => {
  if (destination === target + '/' + ${JSON.stringify(failedMember)}) throw new Error('simulated interruption');
  return original(source, destination);
};`,
      );
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(f.output, "SHA256SUMS")), false);
      const restore = f.run("restore.sh", ["--backup", f.output, "--confirm"]);
      assert.notEqual(restore.status, 0);
      assert.equal(restore.calls, "");
    } finally {
      f.close();
    }
  });
}

for (const [key, value] of [
  ["PGHOST", "external"],
  ["PGHOSTADDR", "192.0.2.1"],
  ["PGPORT", "6543"],
  ["PGSERVICE", "external"],
]) {
  test(`review regression: refuses inherited ${key} before SQL or dump`, () => {
    const f = canonicalFixture();
    try {
      f.model.containers.postgres.Config.Env.push(`${key}=${value}`);
      f.save();
      const result = f.run("backup.sh", [...f.args, "--output-dir", f.output]);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.calls, /psql|pg_dump|^create /m);
      assert.equal(existsSync(f.output), false);
    } finally {
      f.close();
    }
  });
}
for (const race of ["remove-source-at-create", "replace-after-read"]) {
  test(`review regression: refuses ${race} without publication`, () => {
    const f = canonicalFixture();
    try {
      f.model.race = race;
      f.save();
      const result = f.run("backup.sh", [...f.args, "--output-dir", f.output]);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(f.output), false);
    } finally {
      f.close();
    }
  });
}
test("review regression: refuses configured image different from running image", () => {
  const f = canonicalFixture();
  try {
    f.model.configuredImageId = `sha256:${"e".repeat(64)}`;
    f.save();
    const result = f.run("backup.sh", [...f.args, "--output-dir", f.output]);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.calls, /pg_dump|^create /m);
  } finally {
    f.close();
  }
});

for (const race of ["wrong-helper-mount", "writable-helper"]) {
  test(`review regression: refuses ${race} and removes the captured helper before starting it`, () => {
    const f = canonicalFixture();
    try {
      f.model.race = race;
      f.save();
      const result = f.run("backup.sh", [...f.args, "--output-dir", f.output]);
      assert.notEqual(result.status, 0);
      assert.match(
        result.calls,
        new RegExp(`--volumes-from ${"a".repeat(64)}:ro`),
      );
      assert.match(result.calls, new RegExp(`rm -f ${"c".repeat(64)}`));
      assert.doesNotMatch(result.calls, /^start /m);
      assert.equal(existsSync(f.output), false);
    } finally {
      f.close();
    }
  });
}
for (const key of ["PGSERVICEFILE", "PGOPTIONS", "PGDATABASE"]) {
  test(`review regression: refuses configured ${key} before SQL or dump`, () => {
    const f = canonicalFixture();
    try {
      f.model.config.services.postgres.environment[key] = "unexpected";
      f.save();
      const result = f.run("backup.sh", [...f.args, "--output-dir", f.output]);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.calls, /psql|pg_dump|^create /m);
    } finally {
      f.close();
    }
  });
}
