import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    // `tests/mcp/` (MC-18's injection.test.ts) runs here: it needs no database.
    include: ["src/**/*.test.ts", "../../tests/mcp/**/*.test.ts"],
  },
});
