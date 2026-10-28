import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

export function runComparison(
  upstreamDirectory,
  candidateDirectory,
  captureOutput = false,
) {
  const require = createRequire(
    new URL("../../apps/web/package.json", import.meta.url),
  );
  const directory = mkdtempSync(path.join(tmpdir(), "taskdesk-parity-config-"));
  const config = path.join(directory, "playwright.config.mjs");
  writeFileSync(
    config,
    `import { parityConfig } from ${JSON.stringify(new URL("./playwright.config.mjs", import.meta.url).href)};\nexport default parityConfig(${JSON.stringify(upstreamDirectory)}, ${JSON.stringify(candidateDirectory)});\n`,
    { mode: 0o600 },
  );
  try {
    return spawnSync(
      process.execPath,
      [
        require.resolve("@playwright/test/cli"),
        "test",
        "--config",
        config,
        "--update-snapshots=none",
        ...(captureOutput ? ["--max-failures=1"] : []),
      ],
      captureOutput
        ? { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
        : { stdio: "inherit" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
