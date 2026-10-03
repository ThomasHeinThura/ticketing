import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  webServer: [
    base.webServer!,
    {
      command: "pnpm dev:portal --host 127.0.0.1 --port 4179 --strictPort",
      url: "http://127.0.0.1:4179/",
      reuseExistingServer: false,
      env: {},
    },
  ],
  fullyParallel: false,
  workers: 1,
  testIgnore: [],
  testMatch: "visual.spec.ts",
  updateSnapshots: "none",
});
