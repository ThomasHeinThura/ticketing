import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["../../tests/api/**/*.test.ts"],
    setupFiles: ["../../tests/api/setup.ts"],
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
    },
  },
  resolve: {
    alias: {
      // `tests/api/` lives outside `apps/api/` itself, so plain node_modules resolution
      // only walks up from the importing file and never reaches `apps/api/node_modules` --
      // same reasoning as `vitest.permissions.config.ts` and
      // `vitest.integration.config.ts`'s identical alias. Source, not `dist`, so a stale
      // build can never make a unit test look green (issue #8, Slice 1's
      // `resolve-identity.test.ts` is the first caller).
      "@taskdesk/permissions": resolve(
        import.meta.dirname,
        "../../packages/permissions/src/index.ts",
      ),
    },
  },
  esbuild: {
    target: "node18",
  },
});
