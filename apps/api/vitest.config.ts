import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["../../tests/api/**/*.test.ts", "scripts/seed-cli.test.ts"],
    setupFiles: ["../../tests/api/setup.ts"],
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
    },
  },
  resolve: {
    alias: [
      // Tests outside apps/api resolve the API's declared adapter directly.
      {
        find: /^@hono\/node-server$/,
        replacement: resolve(
          import.meta.dirname,
          "node_modules/@hono/node-server/dist/index.mjs",
        ),
      },
      // `tests/api/` lives outside `apps/api/` itself, so plain node_modules resolution
      // only walks up from the importing file and never reaches `apps/api/node_modules` --
      // same reasoning as `vitest.permissions.config.ts` and
      // `vitest.integration.config.ts`'s identical alias. Source, not `dist`, so a stale
      // build can never make a unit test look green (issue #8, Slice 1's
      // `resolve-identity.test.ts` is the first caller).
      {
        find: "@taskdesk/permissions",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/permissions/src/index.ts",
        ),
      },
    ],
  },
  esbuild: {
    target: "node18",
  },
});
