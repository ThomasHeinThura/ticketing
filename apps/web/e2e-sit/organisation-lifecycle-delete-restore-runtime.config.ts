import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "organisation-lifecycle-delete-restore-runtime.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 12_000 },
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
