import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);

// Keep the production-compiler regression in the normal UI test gate too.
it("recovers failed notification contents under the app's React compiler", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        path.dirname(require.resolve("vitest/package.json")),
        "vitest.mjs",
      ),
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
