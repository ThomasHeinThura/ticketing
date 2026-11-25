import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { agentOrigin, ignoreHTTPSErrors } from "./release-helpers";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "release-time-cost.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: agentOrigin,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    ignoreHTTPSErrors: ignoreHTTPSErrors(agentOrigin),
    trace: "off",
  },
});
