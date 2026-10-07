import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  assetMapPathFromScriptUrl,
  readSafeSourceMap,
  requireCpuParentGraph,
  resolveOwnedTraceDirectory,
  summarizeLayoutEvents,
} from "../../../scripts/ci/lib/board-trace-evidence.mjs";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";
import { installLastItemPaintRecorder } from "./helpers/last-item-paint-recorder";

test("diagnostic: attribute board render through the 200th card paint", async ({
  page,
}) => {
  const outputDirectory = await resolveOwnedTraceDirectory(
    process.env.TASKDESK_G11_BOARD_TRACE_DIR ?? "",
  );
  const baseUrl = "http://127.0.0.1:4178";
  const context = page.context();
  const session = await context.newCDPSession(page);
  const traceEvents: Array<Record<string, unknown>> = [];
  const parsedScripts = new Map<
    string,
    { scriptId: string; sourceMapURL?: string }
  >();
  const layoutEventNames = new Set([
    "UpdateLayoutTree",
    "Layout",
    "RecalculateStyles",
    "PrePaint",
    "Paint",
  ]);
  session.on("Tracing.dataCollected", ({ value }) => {
    for (const event of value) {
      if (layoutEventNames.has(event.name)) {
        traceEvents.push({
          name: event.name,
          cat: event.cat,
          ph: event.ph,
          ts: event.ts,
          dur: event.dur,
          pid: event.pid,
          tid: event.tid,
        });
      }
    }
  });
  session.on("Debugger.scriptParsed", (event) => {
    if (typeof event.url === "string" && event.url.length > 0) {
      parsedScripts.set(event.url, {
        scriptId: event.scriptId,
        ...(event.sourceMapURL ? { sourceMapURL: event.sourceMapURL } : {}),
      });
    }
  });

  await installPerformanceApiFixture(page);
  await installLastItemPaintRecorder(page, {
    kind: "board",
    expectedCount: 200,
    metric: "boardPaint",
  });
  await session.send("Debugger.enable");
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Tracing.start", {
    categories:
      "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires,blink.user_timing",
    transferMode: "ReportEvents",
  });
  await session.send("Profiler.start");
  const captureStart = new Date().toISOString();
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
  );
  await expect(
    page.getByText("Seeded legacy task 200", { exact: true }),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(
    200,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () =>
      (window as Window & { __g11Metrics?: { boardPaint: number } })
        .__g11Metrics?.boardPaint > 0,
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const paint = await page.evaluate(() => {
    const metrics = (
      window as Window & {
        __g11Metrics?: { boardPaint: number; documentStart: number };
      }
    ).__g11Metrics;
    return {
      elapsedFromDocumentStart: metrics
        ? metrics.boardPaint - metrics.documentStart
        : null,
      boardPaint: metrics?.boardPaint ?? null,
      now: performance.now(),
      cardCount: document.querySelectorAll('[data-task-id^="legacy-task-"]')
        .length,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  const { profile } = await session.send("Profiler.stop");
  const complete = new Promise<{ stream?: string }>((resolve) =>
    session.once("Tracing.tracingComplete", resolve),
  );
  await session.send("Tracing.end");
  await complete;
  const captureEnd = new Date().toISOString();

  const cpuProfile = requireCpuParentGraph(profile);
  const layoutEvents = summarizeLayoutEvents(
    traceEvents as Array<{
      name: string;
      cat?: string;
      ph?: string;
      ts?: number;
      dur?: number;
      pid?: number;
      tid?: number;
    }>,
  );
  expect(layoutEvents.some((event) => event.name === "UpdateLayoutTree")).toBe(
    true,
  );
  expect(layoutEvents.some((event) => event.name === "Layout")).toBe(true);
  expect(paint.cardCount).toBe(200);

  const assetsDirectory = path.resolve(process.cwd(), "dist/agent/assets");
  const mapsDirectory = path.join(outputDirectory, "source-maps");
  await mkdir(mapsDirectory, { recursive: false, mode: 0o700 });
  const mapManifest: Array<{
    scriptUrl: string;
    scriptId: string;
    sourceMapURL?: string;
    copiedMap?: string;
    mapSha256?: string;
    sourceCount?: number;
    sources?: string[];
  }> = [];
  const scriptUrls = new Set(
    cpuProfile.nodes
      .map((node: { callFrame?: { url?: string } }) => node.callFrame?.url)
      .filter((url: unknown): url is string => typeof url === "string"),
  );
  for (const scriptUrl of scriptUrls) {
    const script = parsedScripts.get(scriptUrl);
    const mapPath = assetMapPathFromScriptUrl(
      scriptUrl,
      baseUrl,
      assetsDirectory,
    );
    if (!mapPath) continue;
    try {
      const sourceMap = await readSafeSourceMap(mapPath, assetsDirectory);
      const mapFilename = path.basename(mapPath);
      await writeFile(
        path.join(mapsDirectory, mapFilename),
        sourceMap.contents,
        {
          mode: 0o600,
          flag: "wx",
        },
      );
      mapManifest.push({
        scriptUrl,
        scriptId: script?.scriptId ?? "unreported",
        ...(script?.sourceMapURL ? { sourceMapURL: script.sourceMapURL } : {}),
        copiedMap: `source-maps/${mapFilename}`,
        mapSha256: sourceMap.sha256,
        sourceCount: sourceMap.sourceCount,
        sources: sourceMap.sources,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        mapManifest.push({
          scriptUrl,
          scriptId: script?.scriptId ?? "unreported",
          ...(script?.sourceMapURL
            ? { sourceMapURL: script.sourceMapURL }
            : {}),
        });
        continue;
      }
      throw error;
    }
  }

  const capture = {
    diagnosticOnly: true,
    acceptance: false,
    sourceCommit: process.env.TASKDESK_G11_SOURCE_SHA ?? "local-unrecorded",
    route: `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
    viewport: { width: 1280, height: 720 },
    canonicalFixture: true,
    fingerprints: await Promise.all(
      ["source-fingerprint.txt", "environment.txt", "build-assets.txt"].map(
        async (filename) => {
          const contents = await readFile(
            path.join(path.dirname(outputDirectory), filename),
          );
          return {
            evidenceFile: `../${filename}`,
            sha256: createHash("sha256").update(contents).digest("hex"),
          };
        },
      ),
    ),
    startedAt: captureStart,
    completedAt: captureEnd,
    paint,
    cpuProfile: {
      nodeCount: cpuProfile.nodeCount,
      parentEdgeCount: cpuProfile.parentEdgeCount,
      sampleCount: cpuProfile.sampleCount,
      startTime: cpuProfile.startTime,
      endTime: cpuProfile.endTime,
    },
    layoutEventCount: layoutEvents.length,
    layoutEvents,
    scriptMapCount: mapManifest.length,
    scripts: mapManifest,
  };
  await writeFile(
    path.join(outputDirectory, "board-trace-events.json"),
    JSON.stringify(layoutEvents),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    path.join(outputDirectory, "board-cpu-profile.json"),
    JSON.stringify(cpuProfile),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    path.join(outputDirectory, "board-source-maps.json"),
    JSON.stringify(mapManifest, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    path.join(outputDirectory, "capture.json"),
    JSON.stringify(capture, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  await session.detach();
});
