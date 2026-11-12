import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["../../tests/api-integration/uat-seed.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 180000,
    testTimeout: 180000,
  },
  resolve: {
    alias: {
      "@taskdesk/permissions": resolve(
        import.meta.dirname,
        "../../packages/permissions/src/index.ts",
      ),
    },
  },
});
