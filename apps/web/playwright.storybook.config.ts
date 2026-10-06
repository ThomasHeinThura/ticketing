import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "storybook-visual.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  updateSnapshots: "none",
  retries: 0,
  reporter: "list",
  snapshotDir: fileURLToPath(
    new URL("../../packages/ui/src/components/", import.meta.url),
  ),
  snapshotPathTemplate: "{snapshotDir}/{arg}-{projectName}-{platform}{ext}",
  use: {
    ...devices["Desktop Chrome"],
    locale: "en-GB",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm --filter @taskdesk/ui exec storybook dev --ci --port 6006 --host 127.0.0.1",
    url: "http://127.0.0.1:6006/index.json",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
