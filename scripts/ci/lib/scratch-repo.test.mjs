import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { copyTrackedCheckerSources } from "./scratch-repo.mjs";

test("scratch checker copy snapshots tracked bytes and ignores any transient filename", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "checker-source-"));
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "checker-copy-"));
  const checker = path.join(sourceRoot, "scripts/ci/check-example.mjs");
  const checkerBytes = Buffer.from("export const checker = 'stable';\r\n");
  try {
    await mkdir(path.dirname(checker), { recursive: true });
    await writeFile(checker, checkerBytes);
    await writeFile(
      path.join(sourceRoot, "scripts/ci/check-example.test.mjs"),
      "test only",
    );
    await mkdir(path.join(sourceRoot, "scripts/ci/probes"));
    await writeFile(
      path.join(sourceRoot, "scripts/ci/probes/example.mjs"),
      "probe only",
    );
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: sourceRoot });
    execFileSync("git", ["config", "user.email", "ci@example.invalid"], {
      cwd: sourceRoot,
    });
    execFileSync("git", ["config", "user.name", "CI"], { cwd: sourceRoot });
    execFileSync("git", ["add", "scripts/ci"], { cwd: sourceRoot });
    execFileSync("git", ["commit", "-qm", "tracked checker snapshot"], {
      cwd: sourceRoot,
    });

    const transientPaths = [
      "scripts/ci/contrast-alias-surface-123.tsx",
      "scripts/ci/.contrast-button-123.test.tsx",
    ];
    await Promise.all(
      transientPaths.map((file) =>
        writeFile(path.join(sourceRoot, file), "temporary fixture"),
      ),
    );

    const copied = copyTrackedCheckerSources(sourceRoot, targetRoot);
    assert.deepEqual(copied, ["scripts/ci/check-example.mjs"]);
    assert.deepEqual(
      await readFile(path.join(targetRoot, "scripts/ci/check-example.mjs")),
      checkerBytes,
    );
    for (const file of [
      ...transientPaths,
      "scripts/ci/check-example.test.mjs",
      "scripts/ci/probes/example.mjs",
    ]) {
      await assert.rejects(readFile(path.join(targetRoot, file)), {
        code: "ENOENT",
      });
    }
  } finally {
    await Promise.all([
      rm(sourceRoot, { recursive: true, force: true }),
      rm(targetRoot, { recursive: true, force: true }),
    ]);
  }
});
