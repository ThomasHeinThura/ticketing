import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/** Private input contains only pointers and fixture IDs; passwords never enter metadata. */
export function createPersistedPerformanceConfig(
  inputPath: string,
  outputPath: string,
) {
  return defineConfig({
    testDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "e2e"),
    testMatch: "**/performance.persisted.bench.ts",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 180_000,
    reporter: [["list"]],
    outputDir: path.join(outputPath, "results"),
    metadata: { persistedG11Input: inputPath },
    // Authentication/network artefact privacy must be proven before enabling traces.
    // This first slice is incomplete G11 evidence, even when its two budgets pass.
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 720 },
      trace: "off",
      video: "off",
      screenshot: "off",
    },
  });
}
