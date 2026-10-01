import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/seed-cli.test.ts", "scripts/seed-postgres.test.ts"],
    globalSetup: ["scripts/seed-test-global-setup.ts"],
    setupFiles: ["scripts/seed-test-setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@taskdesk/permissions": resolve(
        appRoot,
        "../../packages/permissions/src/index.ts",
      ),
    },
  },
});
