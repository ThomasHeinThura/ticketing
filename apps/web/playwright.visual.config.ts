import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    // Chromium's partial raster blends the anti-aliased corner pixels of translucent
    // rounded borders a second time whenever a screenshot invalidates part of a
    // tile, so an unchanged page alternates between two renderings. Full raster
    // makes every frame a pure function of the DOM and CSS.
    launchOptions: { args: ["--disable-partial-raster"] },
  },
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
