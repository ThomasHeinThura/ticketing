import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withExclusiveMetricsListener } from "../e2e/helpers/mfa-csrf-app-fixture";

describe("fixture child output", () => {
  it.each([false, true])(
    "preserves exit status with discard=%s",
    async (discardChildOutput) => {
      const directory = await mkdtemp(resolve(tmpdir(), "td-output-test-"));
      try {
        await withExclusiveMetricsListener(
          async (supervisor) => {
            const child = await supervisor.spawn(
              process.execPath,
              [
                "-e",
                "process.stdout.write('stdout marker'); process.stderr.write('stderr marker'); process.exitCode = 7",
              ],
              process.env,
              "child",
              directory,
            );
            const code = await new Promise<number | null>((resolveClose) => {
              child.once("close", resolveClose);
            });
            expect(code).toBe(7);
            expect(child.exitCode).toBe(7);
          },
          { lockPath: resolve(directory, "lock"), discardChildOutput },
        );
        const files = await readdir(directory);
        if (discardChildOutput) {
          expect(files).toEqual([]);
        } else {
          expect(files.sort()).toEqual([
            "child.stderr.log",
            "child.stdout.log",
          ]);
          expect(
            await readFile(resolve(directory, "child.stdout.log"), "utf8"),
          ).toBe("stdout marker");
          expect(
            await readFile(resolve(directory, "child.stderr.log"), "utf8"),
          ).toBe("stderr marker");
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
