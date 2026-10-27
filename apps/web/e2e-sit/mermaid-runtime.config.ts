import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "mermaid-runtime.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "https://ticketing.localhost",
    locale: "en-US",
    timezoneId: "Asia/Yangon",
    colorScheme: "light",
    reducedMotion: "reduce",
    ignoreHTTPSErrors: false,
    trace: "off",
  },
});
