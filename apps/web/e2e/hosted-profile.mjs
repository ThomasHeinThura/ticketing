#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");
const repoDir = resolve(webDir, "../..");
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const listOnly = process.argv.includes("--list-only");
if (!outputArg?.slice("--output=".length)) {
  throw new Error(
    "Usage: node e2e/hosted-profile.mjs --output=<unique-directory>",
  );
}
const outputDir = resolve(outputArg.slice("--output=".length));
const generatedSpec = join(
  scriptDir,
  "performance.hosted-profile.generated.ts",
);
const generatedConfig = join(
  webDir,
  "playwright.hosted-profile.generated.config.ts",
);

async function listMapFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? listMapFiles(path)
        : entry.name.endsWith(".map")
          ? [path]
          : [];
    }),
  );
  return files.flat();
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function collectBuildEvidence() {
  const dist = join(webDir, "dist");
  const manifestPath = join(dist, ".vite", "manifest.json");
  const mapPaths = await listMapFiles(dist);
  const indexPath = join(dist, "index.html");
  return {
    indexHtml: {
      path: relative(repoDir, indexPath),
      sha256: await sha256(indexPath),
    },
    manifest: {
      path: relative(repoDir, manifestPath),
      sha256: await sha256(manifestPath),
    },
    sourceMaps: await Promise.all(
      mapPaths.sort().map(async (path) => ({
        path: relative(repoDir, path),
        sha256: await sha256(path),
      })),
    ),
  };
}

const generatedSource = String.raw`
import { writeFile } from "node:fs/promises";
import type { CDPSession } from "@playwright/test";

const HOSTED_PROFILE_OUTPUT = __HOSTED_PROFILE_OUTPUT__;

async function captureHostedProfileScreen(page: Page, name: string) {
  const directory = HOSTED_PROFILE_OUTPUT + "/screenshots";
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: directory + "/" + name + ".png" });
}

function assertHostedCaptureComplete(payload: {
  counts: { cpuProfileNodes: number; cpuSamples: number; timeDeltas: number; timelineEvents: number };
  tracingComplete: { dataLossOccurred: boolean };
}, path: string) {
  if (
    payload.counts.cpuProfileNodes === 0 ||
    payload.counts.cpuSamples === 0 ||
    payload.counts.timeDeltas === 0 ||
    payload.counts.timelineEvents === 0 ||
    payload.tracingComplete.dataLossOccurred !== false
  ) {
    throw new Error("Incomplete hosted profile; raw payload was saved to " + path);
  }
}

async function hostedProfileClock(page: Page, session: CDPSession) {
  const before = await page.evaluate(() => ({ now: performance.now(), timeOrigin: performance.timeOrigin }));
  const cdp = await session.send("Performance.getMetrics");
  const after = await page.evaluate(() => ({ now: performance.now(), timeOrigin: performance.timeOrigin }));
  const timestamp = cdp.metrics.find((metric) => metric.name === "Timestamp")?.value;
  if (typeof timestamp !== "number") throw new Error("CDP Performance.getMetrics omitted Timestamp");
  const browserMidpoint = (before.now + after.now) / 2;
  return {
    before,
    after,
    cdpTimestampSeconds: timestamp,
    cdpMinusBrowserMonotonicMs: timestamp * 1000 - browserMidpoint,
    uncertaintyMs: (after.now - before.now) / 2,
  };
}

async function beginHostedProfile(
  page: Page,
  name: string,
  throttling: "none" | "fast4g-cpu4",
) {
  const session = await page.context().newCDPSession(page);
  const traceEvents: unknown[] = [];
  const traceComplete = new Promise<{ dataLossOccurred: boolean }>((resolve) => {
    session.once("Tracing.tracingComplete", (event) => resolve(event));
  });
  session.on("Tracing.dataCollected", (event) => traceEvents.push(...event.value));
  await session.send("Performance.enable");
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 1000 });
  await session.send("Profiler.start");
  await session.send("Tracing.start", {
    transferMode: "ReportEvents",
    categories: "devtools.timeline,v8.cpu_profiler,blink.user_timing,disabled-by-default-devtools.timeline",
  });
  const clockStart = await hostedProfileClock(page, session);
  const browserStart = await page.evaluate(() => ({
    performanceNow: performance.now(),
    timeOrigin: performance.timeOrigin,
    href: location.href,
  }));
  return async (measurement: Record<string, unknown>) => {
    const browserStop = await page.evaluate(() => ({
      performanceNow: performance.now(),
      timeOrigin: performance.timeOrigin,
      href: location.href,
    }));
    const resourceTiming = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        responseEnd: entry.responseEnd,
        transferSize: "transferSize" in entry ? entry.transferSize : undefined,
      })),
    );
    const profileResult = await session.send("Profiler.stop");
    await session.send("Tracing.end");
    const completed = await traceComplete;
    const clockEnd = await hostedProfileClock(page, session);
    const payload = {
      schemaVersion: 1,
      journey: name,
      measurement,
      browserStart,
      browserStop,
      captureSettings: {
        authentication: "existing G11 authenticated fixture session",
        throttling:
          throttling === "fast4g-cpu4"
            ? {
                connectionType: "cellular4g",
                latencyMs: 150,
                downloadBytesPerSecond: 200_000,
                uploadBytesPerSecond: 93_750,
                cpuRate: 4,
              }
            : null,
        viewport: { width: 1280, height: 720 },
      },
      resourceTiming,
      clockCorrelation: { start: clockStart, end: clockEnd },
      cpuProfile: profileResult.profile,
      traceEvents,
      tracingComplete: completed,
      counts: {
        cpuProfileNodes: profileResult.profile.nodes?.length ?? 0,
        cpuSamples: profileResult.profile.samples?.length ?? 0,
        timeDeltas: profileResult.profile.timeDeltas?.length ?? 0,
        timelineEvents: traceEvents.length,
      },
    };
    await mkdir(HOSTED_PROFILE_OUTPUT, { recursive: true });
    const path = HOSTED_PROFILE_OUTPUT + "/" + name + ".json";
    await writeFile(path, JSON.stringify(payload) + "\n");
    await session.detach();
    assertHostedCaptureComplete(payload, path);
    console.info("Hosted profile saved: " + path + " " + JSON.stringify(payload.counts));
  };
}

test("Hosted G11 attribution profile: list, LCP, detail, palette, and board", async ({ browser }) => {
  test.setTimeout(600_000);
  let rejectsEmptyCapture = false;
  try {
    assertHostedCaptureComplete({
      counts: { cpuProfileNodes: 1, cpuSamples: 0, timeDeltas: 1, timelineEvents: 1 },
      tracingComplete: { dataLossOccurred: false },
    }, "empty-payload-self-check");
  } catch {
    rejectsEmptyCapture = true;
  }
  if (!rejectsEmptyCapture) throw new Error("Hosted profile validator accepted an empty CPU sample payload");
  const provenance = {
    sourceSha: "__SOURCE_SHA__",
    canonicalBenchmarkSha256: "__CANONICAL_BENCH_SHA256__",
    canonicalPreviewPort: 4178,
    diagnosticPreviewPort: 4179,
    buildCommand: "pnpm build (completed by CI before diagnostic)",
    node: process.version,
    pnpm: "__PNPM_VERSION__",
    platform: process.platform,
    arch: process.arch,
    chromium: browser.version(),
    playwright: "__PLAYWRIGHT_VERSION__",
    fixtures: { listRows: 500, boardCards: 200, workItemKey: "WLP-1" },
    build: __BUILD_EVIDENCE__,
  };
  await mkdir(HOSTED_PROFILE_OUTPUT, { recursive: true });
  await writeFile(HOSTED_PROFILE_OUTPUT + "/provenance.json", JSON.stringify(provenance, null, 2) + "\n");

  await withPerformancePage(browser, false, async (page) => {
    await installLastItemPaintRecorder(page, { kind: "list", expectedCount: 500, metric: "listPaint" });
    const stop = await beginHostedProfile(page, "work-list-500-rows", "none");
    await page.goto(WORK_LIST_PATH);
    await expect(page.locator("[data-testid=work-item-list-populated] tbody tr")).toHaveCount(500, { timeout: 30_000 });
    await page.waitForFunction(() => (window as G11Window).__g11Metrics.listPaint > 0, undefined, { timeout: 30_000 });
    const measurement = await page.evaluate(() => ({
      metric: "listPaint-documentStart",
      documentStart: (window as G11Window).__g11Metrics.documentStart,
      listPaint: (window as G11Window).__g11Metrics.listPaint,
      performanceNow: performance.now(),
      performanceTimeOrigin: performance.timeOrigin,
      rows: document.querySelectorAll("[data-testid=work-item-list-populated] tbody tr").length,
      url: location.href,
      boundary: "capture includes navigation through the existing G11 two-RAF listPaint mark",
    }));
    await stop(measurement);
    await captureHostedProfileScreen(page, "work-list-500-rows");
  });

  await withPerformancePage(browser, true, async (page) => {
    const stop = await beginHostedProfile(page, "work-list-lcp-500-rows", "fast4g-cpu4");
    await page.goto(WORK_LIST_PATH);
    await page.waitForFunction(() => (window as G11Window).__g11Metrics.lcp > 0, undefined, { timeout: 30_000 });
    const measurement = await page.evaluate(() => ({
      metric: "existing-g11-lcp",
      lcp: (window as G11Window).__g11Metrics.lcp,
      lcpText: (window as G11Window).__g11Metrics.lcpText,
      lcpElement: (window as G11Window).__g11Metrics.lcpElement,
      performanceNow: performance.now(),
      performanceTimeOrigin: performance.timeOrigin,
      rowsAtProfileStop: document.querySelectorAll("[data-testid=work-item-list-populated] tbody tr").length,
      url: location.href,
      boundary: "capture stops after the existing LCP observer mark; row count is recorded but checked after stop",
    }));
    await stop(measurement);
    await expect(page.locator("[data-testid=work-item-list-populated] tbody tr")).toHaveCount(500, { timeout: 30_000 });
    await captureHostedProfileScreen(page, "work-list-lcp");
  });

  await withPerformancePage(browser, true, async (page) => {
    await openWorkList(page);
    const stop = await beginHostedProfile(page, "work-item-detail-click-to-paint", "fast4g-cpu4");
    await page.getByRole("link", { name: WORK_ITEM_KEY, exact: true }).click();
    await page.waitForFunction(() => (window as G11Window).__g11Metrics.routePaint > 0, undefined, { timeout: 30_000 });
    const measurement = await page.evaluate(() => ({
      metric: "existing-g11-routePaint",
      routeStart: (window as G11Window).__g11Metrics.routeStart,
      routePaint: (window as G11Window).__g11Metrics.routePaint,
      performanceNow: performance.now(),
      performanceTimeOrigin: performance.timeOrigin,
      url: location.href,
      boundary: "capture begins on a loaded 500-row list and stops at routePaint; full detail assertion follows",
    }));
    await stop(measurement);
    await expect(page.getByTestId("work-item-detail")).toBeVisible({ timeout: 15_000 });
    await captureHostedProfileScreen(page, "work-item-detail");
  });

  await withPerformancePage(browser, true, async (page) => {
    await openWorkList(page);
    const stopOpen = await beginHostedProfile(page, "command-palette-open", "fast4g-cpu4");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.waitForFunction(() => (window as G11Window).__g11Metrics.palettePaint > 0, undefined, { timeout: 15_000 });
    const measurement = await page.evaluate(() => ({
      metric: "existing-g11-palettePaint",
      paletteStart: (window as G11Window).__g11Metrics.paletteStart,
      paletteInsert: (window as G11Window).__g11Metrics.paletteInsert,
      palettePaint: (window as G11Window).__g11Metrics.palettePaint,
      performanceNow: performance.now(),
      performanceTimeOrigin: performance.timeOrigin,
      url: location.href,
      boundary: "capture stops at existing two-RAF palettePaint mark; dialog and focus assertions follow",
    }));
    await stopOpen(measurement);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder(/search/i)).toBeFocused();
    await captureHostedProfileScreen(page, "command-palette-open");
  });

  await withPerformancePage(browser, true, async (page) => {
    await openWorkList(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByPlaceholder(/search/i)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    const stop = await beginHostedProfile(page, "command-palette-navigation", "fast4g-cpu4");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (window as G11Window).__g11Metrics.paletteNavigationPaint > 0, undefined, { timeout: 15_000 });
    const measurement = await page.evaluate(() => ({
      metric: "existing-g11-paletteNavigationPaint",
      paletteNavigationStart: (window as G11Window).__g11Metrics.paletteNavigationStart,
      paletteNavigationPaint: (window as G11Window).__g11Metrics.paletteNavigationPaint,
      performanceNow: performance.now(),
      performanceTimeOrigin: performance.timeOrigin,
      url: location.href,
      boundary: "capture starts immediately before existing Enter gesture and stops at the pending-route paint mark",
    }));
    await stop(measurement);
    await expect(page).toHaveURL(new RegExp("/dashboard/workspace/" + WORKSPACE_ID));
    await expect(page.getByRole("main").getByText("Performance fixture", { exact: true })).toBeVisible();
    await captureHostedProfileScreen(page, "command-palette-navigation");
  });

  await withPerformancePage(browser, false, async (page) => {
    await installLastItemPaintRecorder(page, { kind: "board", expectedCount: 200, metric: "boardPaint" });
    const stop = await beginHostedProfile(page, "legacy-board-200-cards", "none");
    await page.goto("/dashboard/workspace/" + WORKSPACE_ID + "/project/" + PROJECT_ID + "/board");
    await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(200, { timeout: 30_000 });
    await page.waitForFunction(() => (window as G11Window).__g11Metrics.boardPaint > 0, undefined, { timeout: 30_000 });
    const measurement = await page.evaluate(() => ({
      metric: "boardPaint-documentStart",
      documentStart: (window as G11Window).__g11Metrics.documentStart,
      boardPaint: (window as G11Window).__g11Metrics.boardPaint,
      performanceNow: performance.now(),
      performanceTimeOrigin: performance.timeOrigin,
      cards: document.querySelectorAll('[data-task-id^="legacy-task-"]').length,
      url: location.href,
      boundary: "capture includes navigation through the existing G11 two-RAF boardPaint mark",
    }));
    await stop(measurement);
    await captureHostedProfileScreen(page, "legacy-board-200-cards");
  });
});
`;

const configText = `import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "performance.hosted-profile.generated.ts",
  grep: /Hosted G11 attribution profile/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 600_000,
  outputDir: ${JSON.stringify(join(outputDir, "playwright-results"))},
  use: { baseURL: "http://127.0.0.1:4179", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm --filter @taskdesk/web preview --host 127.0.0.1 --port 4179 --strictPort",
    url: "http://127.0.0.1:4179/auth/sign-in",
    reuseExistingServer: false,
    env: { VITE_API_URL: "http://127.0.0.1:4179" },
  },
});
`;

try {
  const source = await readFile(
    join(scriptDir, "performance.bench.ts"),
    "utf8",
  );
  const playwrightPackage = JSON.parse(
    await readFile(
      join(webDir, "node_modules/@playwright/test/package.json"),
      "utf8",
    ),
  );
  const build = await collectBuildEvidence();
  const buildProvenance = JSON.stringify(build);
  const canonicalBenchmarkSha256 = createHash("sha256")
    .update(source)
    .digest("hex");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoDir,
    encoding: "utf8",
  }).trim();
  const pnpmVersion = execFileSync("pnpm", ["--version"], {
    cwd: repoDir,
    encoding: "utf8",
  }).trim();
  const extra = generatedSource
    .replace("__HOSTED_PROFILE_OUTPUT__", JSON.stringify(outputDir))
    .replace("__PLAYWRIGHT_VERSION__", playwrightPackage.version)
    .replace("__SOURCE_SHA__", sourceSha)
    .replace("__CANONICAL_BENCH_SHA256__", canonicalBenchmarkSha256)
    .replace("__PNPM_VERSION__", pnpmVersion)
    .replace("__BUILD_EVIDENCE__", buildProvenance);
  const generatedBenchmarkSource = source.replace(
    'const PERFORMANCE_BASE_URL = "http://127.0.0.1:4178";',
    'const PERFORMANCE_BASE_URL = "http://127.0.0.1:4179";',
  );
  if (generatedBenchmarkSource === source) {
    throw new Error(
      "Could not isolate the diagnostic preview port from the canonical benchmark",
    );
  }
  await writeFile(generatedSpec, generatedBenchmarkSource + extra);
  await writeFile(generatedConfig, configText);
  await mkdir(outputDir, { recursive: true });
  const playwrightArgs = [
    "exec",
    "playwright",
    "test",
    "--config=playwright.hosted-profile.generated.config.ts",
    "--workers=1",
  ];
  if (listOnly) playwrightArgs.push("--list");
  const result = spawnSync("pnpm", playwrightArgs, {
    cwd: webDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await Promise.all([
    rm(generatedSpec, { force: true }),
    rm(generatedConfig, { force: true }),
  ]);
}
