import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  testIgnore: ["visual.spec.ts", "storybook-visual.spec.ts"],
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4178",
    locale: "en-GB",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "pnpm --filter @taskdesk/web preview --host 127.0.0.1 --port 4178 --strictPort",
    url: "http://127.0.0.1:4178/auth/sign-in",
    reuseExistingServer: false,
  },
});
