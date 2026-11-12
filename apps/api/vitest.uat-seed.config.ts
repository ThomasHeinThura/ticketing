import { defineConfig, mergeConfig } from "vitest/config";
import integration from "./vitest.integration.config";
export default mergeConfig(
  integration,
  defineConfig({
    test: { include: ["../../tests/api-integration/uat-seed.test.ts"] },
  }),
);
