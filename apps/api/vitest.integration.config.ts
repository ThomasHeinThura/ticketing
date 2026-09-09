import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["../../tests/api-integration/**/*.test.ts"],
    setupFiles: ["../../tests/api-integration/setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    coverage: {
      enabled: false,
    },
  },
  esbuild: {
    target: "node18",
  },
  resolve: {
    alias: {
      "@taskdesk/email": resolve(
        __dirname,
        "../../tests/api-integration/mocks/email.ts",
      ),
      // `tests/api-integration/helpers/fixtures.ts` lives in `tests/`,
      // outside any package, same as `tests/permissions/` -- see that
      // suite's own `vitest.permissions.config.ts` alias for why this
      // points at source rather than relying on plain node_modules
      // resolution (which would only work by accident of apps/api's own
      // dependency graph, not because anything in `tests/` actually
      // depends on this package).
      "@taskdesk/permissions": resolve(
        __dirname,
        "../../packages/permissions/src/index.ts",
      ),
    },
  },
});
