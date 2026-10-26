import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "organisation-lifecycle-runtime.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "https://ticketing.localhost",
    ignoreHTTPSErrors: false,
    locale: "en-US",
    timezoneId: "Asia/Yangon",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "off",
  },
});
