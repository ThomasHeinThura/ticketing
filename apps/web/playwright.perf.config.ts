import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/performance.bench.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  use: {
    baseURL: "http://127.0.0.1:4178",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "pnpm --filter @taskdesk/web preview --host 127.0.0.1 --port 4178 --strictPort",
    url: "http://127.0.0.1:4178/auth/sign-in",
    reuseExistingServer: false,
    env: { VITE_API_URL: "http://127.0.0.1:4178" },
  },
});
