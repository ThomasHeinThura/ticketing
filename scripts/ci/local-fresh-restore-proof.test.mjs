import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  validateArchiveLists,
  verifyRestoreProof,
} from "../../deploy/local-fresh-restore-proof.mjs";

function fixture(t, mode = "success") {
  const dir = mkdtempSync(join(os.tmpdir(), "sit-restore-proof-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dump = join(dir, "dump");
  const counts = join(dir, "counts");
  writeFileSync(dump, "archive");
  writeFileSync(counts, "counts\n");
  const proofId = "b".repeat(64);
  const calls = [];
  let createArgs;
  const cmd = (bin, args) => {
    calls.push([bin, ...args]);
    if (bin === "tar" && args[0] === "-tf") return "./\n./file\n";
    if (bin === "tar" && args[0] === "-tvf") return "drwx folder\n-rw file\n";
    if (bin === "node" || (bin === "docker" && args.includes("node")))
      return mode === "hash" && bin === "node" ? "different" : "manifest";
    if (bin === "docker" && args[0] === "create") {
      createArgs = args;
      return proofId;
    }
    if (bin === "docker" && args[0] === "inspect")
      return JSON.stringify([
        {
          Id: proofId,
          Name: `/${createArgs[createArgs.indexOf("--name") + 1]}`,
          Config: {
            Labels: {
              "com.docker.compose.project": "taskdesk-codex-testing",
              "info.taskdesk.restore-proof":
                createArgs[createArgs.indexOf("--label") + 1].split("=")[1],
            },
            Image: `sha256:${"c".repeat(64)}`,
          },
          HostConfig: {
            NetworkMode: "none",
            PublishAllPorts: false,
            Tmpfs: { "/var/lib/postgresql": "rw,nosuid,nodev" },
          },
          Mounts: [],
        },
      ]);
    if (bin === "docker" && args.includes("pg_restore") && mode === "restore")
      throw new Error("restore failed");
    if (bin === "docker" && args.includes("psql"))
      return mode === "counts" ? "wrong\n" : "counts\n";
    if (bin === "docker" && args[0] === "rm" && mode === "cleanup")
      throw new Error("cleanup failed");
    return "";
  };
  return {
    cmd,
    databaseId: "a".repeat(64),
    databaseImage: `sha256:${"c".repeat(64)}`,
    appId: "d".repeat(64),
    dump,
    counts,
    countSql: "SQL",
    attachments: join(dir, "attachments.tar"),
    backupDir: dir,
    calls,
    proofId,
    pause: () => {},
    validateArchive: () => {},
  };
}

test("restore proof uses isolated container and removes only its exact id", (t) => {
  const f = fixture(t);
  verifyRestoreProof(f);
  assert.ok(
    f.calls.some(
      ([bin, op, ...args]) =>
        bin === "docker" &&
        op === "create" &&
        args.includes("none") &&
        args.includes("--tmpfs"),
    ),
  );
  assert.deepEqual(
    f.calls.filter(([bin, op]) => bin === "docker" && op === "rm"),
    [["docker", "rm", "-f", "-v", f.proofId]],
  );
  assert.deepEqual(readdirSync(f.backupDir).sort(), ["counts", "dump"]);
});
for (const mode of ["hash", "restore", "counts", "cleanup"])
  test(`restore proof rejects ${mode} failure`, (t) => {
    const f = fixture(t, mode);
    assert.throws(() => verifyRestoreProof(f));
    if (mode !== "hash")
      assert.ok(
        f.calls.some(
          ([bin, op, , , id]) =>
            bin === "docker" && op === "rm" && id === f.proofId,
        ),
      );
  });
test("archive refuses traversal, links and ambiguous listings", () => {
  assert.throws(() => validateArchiveLists("../escape\n", "-rw file\n"));
  assert.throws(() => validateArchiveLists("link\n", "lrwx link\n"));
  assert.throws(() => validateArchiveLists("a\nb\n", "-rw file\n"));
});

test("structural tar validation rejects traversal, links and broken headers", async (t) => {
  const { validateTarFile } = await import(
    "../../deploy/local-fresh-restore-proof.mjs"
  );
  const dir = mkdtempSync(join(os.tmpdir(), "sit-tar-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "test.tar");
  const make = (name, type = "0") => {
    const header = Buffer.alloc(512);
    header.write(name, 0, "utf8");
    header.write("00000000000\0", 124, "ascii");
    header.fill(32, 148, 156);
    header.write(type, 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    const sum = header.reduce((n, value) => n + value, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    return Buffer.concat([header, Buffer.alloc(1024)]);
  };
  writeFileSync(file, make("./safe"));
  assert.doesNotThrow(() => validateTarFile(file));
  writeFileSync(file, make("../escape"));
  assert.throws(() => validateTarFile(file));
  writeFileSync(file, make("link", "2"));
  assert.throws(() => validateTarFile(file));
  const corrupt = make("safe");
  corrupt[20] = 1;
  writeFileSync(file, corrupt);
  assert.throws(() => validateTarFile(file));
});
