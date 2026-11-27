import { defineConfig, devices } from "@playwright/test";

// CI splits the suite in two so heavy Testcontainers journeys shard separately from the rest.
// E2E_SET=smoke runs everything except the persisted specs; E2E_SET=persisted runs only them;
// unset runs all tests.
const PERSISTED = /-persisted\.spec\.ts$/;
const e2eSet = process.env.E2E_SET;
if (e2eSet !== undefined && e2eSet !== "smoke" && e2eSet !== "persisted")
  throw new Error(`E2E_SET must be "smoke" or "persisted", got "${e2eSet}"`);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Real-runtime journeys create and tear down Testcontainers networks. Keep
  // those network mutations isolated from mock-only browser tests on this host.
  workers: 1,
  testIgnore: [
    "visual.spec.ts",
    "storybook-visual.spec.ts",
    ...(e2eSet === "smoke" ? [PERSISTED] : []),
  ],
  ...(e2eSet === "persisted" ? { testMatch: PERSISTED } : {}),
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4178",
    locale: "en-GB",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    // Off centrally: failing runs must not upload page content (#709).
    trace: "off",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "pnpm --filter @taskdesk/web preview --host 127.0.0.1 --port 4178 --strictPort",
    url: "http://127.0.0.1:4178/auth/sign-in",
    reuseExistingServer: false,
  },
});
