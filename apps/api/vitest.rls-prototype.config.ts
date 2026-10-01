import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["../../tests/rls-prototype/**/*.test.ts"],
    globalSetup: ["../../tests/rls-prototype/global-setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 180_000,
    testTimeout: 180_000,
    coverage: { enabled: false },
  },
  resolve: {
    alias: {
      "@taskdesk/api-schema": resolve(
        import.meta.dirname,
        "src/database/schema.ts",
      ),
    },
  },
});
