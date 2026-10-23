import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { defineConfig } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)("@playwright/test");
export function parityConfig(upstreamDirectory, candidateDirectory) {
  return defineConfig({
    testDir: fileURLToPath(new URL(".", import.meta.url)),
    testMatch: "compare.spec.mjs",
    workers: 1,
    retries: 0,
    forbidOnly: true,
    updateSnapshots: "none",
    reporter: "list",
    metadata: { upstreamDirectory, candidateDirectory },
    outputDir: path.join(candidateDirectory, "diff-results"),
    snapshotPathTemplate: path.join(upstreamDirectory, "{arg}{ext}"),
  });
}
