import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  fullyParallel: false,
  workers: 1,
  testIgnore: [],
  testMatch: "visual.spec.ts",
});
