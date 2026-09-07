import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The permissions suite — route coverage, the role x route matrix, the elevated-action
 * generation and the better-auth plugin allowlist.
 *
 * It lives beside the API's other vitest projects because it imports the API's Hono app in
 * order to enumerate the **real** router. `pnpm test:permissions` at the repository root is
 * the stable entry point; see `tests/permissions/README.md` for the contract.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["../../tests/permissions/**/*.test.ts"],
    setupFiles: ["../../tests/permissions/setup.ts"],
    fileParallelism: false,
    coverage: { enabled: false },
  },
  resolve: {
    alias: {
      // The suite lives in `tests/`, outside any package, and it asserts against the
      // permissions **source** rather than a built `dist` — so a stale build can never make
      // route coverage look green.
      "@taskdesk/permissions": resolve(
        import.meta.dirname,
        "../../packages/permissions/src/index.ts",
      ),
    },
  },
});
