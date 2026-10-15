import { defineConfig } from "@playwright/test";
import { PRIVATE_FULLRUNNER_PROJECT_NAME } from "./e2e/helpers/hosted-drag-fullrunner-evidence.mjs";
import performanceConfig from "./playwright.perf.config";

export default defineConfig({
  ...performanceConfig,
  outputDir: "./test-results/hosted-drag-fullrunner/playwright-output",
  reporter: [["./e2e/helpers/hosted-drag-fullrunner-reporter.mjs"]],
  projects: [
    {
      name: PRIVATE_FULLRUNNER_PROJECT_NAME,
      use: performanceConfig.use,
    },
  ],
});
