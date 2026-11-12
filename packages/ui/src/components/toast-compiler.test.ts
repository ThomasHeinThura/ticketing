import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

// Keep the production-compiler regression in the normal UI test gate too.
it("recovers failed notification contents under the app's React compiler", () => {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "src/components/toast-recovery.test.tsx",
      "--config",
      "vitest.compiler.config.ts",
    ],
    {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}, 40_000);
