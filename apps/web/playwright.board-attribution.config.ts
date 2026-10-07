import { defineConfig } from "@playwright/test";
import performanceConfig from "./playwright.perf.config";

const sourceRoot = process.env.TASKDESK_G11_SOURCE_ROOT;
if (!sourceRoot) {
  throw new Error("TASKDESK_G11_SOURCE_ROOT is required for board attribution");
}

export default defineConfig({
  ...performanceConfig,
  testMatch: "**/g11-board-attribution.spec.ts",
  reporter: "list",
  retries: 0,
  fullyParallel: false,
  webServer: {
    ...performanceConfig.webServer,
    cwd: sourceRoot,
  },
});
