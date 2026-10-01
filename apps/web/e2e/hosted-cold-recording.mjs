#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  cleanupHasFailure,
  createOwnedFile,
  createOwnedTempDirectory,
  createReportParent,
  finalizeParentOutcome,
  outputTargetIsAbsent,
  readChildFailureReceipt,
  runParentCleanup,
} from "./hosted-cold-recording-io.mjs";
import {
  assertColdReportPrivacy,
  coldDiagnosticFailure,
  createColdFailureReceipt,
  deriveManifestAssetBasenames,
  formatColdFailureReceiptLine,
  hashedBasename,
  ownedColdDiagnosticFailureFields,
  parentChildExitReceipt,
  unknownColdFailureReceipt,
} from "./hosted-cold-recording-validation.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");
const repoDir = resolve(webDir, "../..");
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const candidateArg = process.argv.find((arg) =>
  arg.startsWith("--candidate-sha="),
);
const discoveryOnly = process.argv.includes("--list");
const outputPath = outputArg?.slice("--output=".length);
const resolvedOutputPath = outputPath ? resolve(outputPath) : null;
if ((!outputPath && !discoveryOnly) || !candidateArg)
  throw new Error(
    "Usage: hosted-cold-recording.mjs --candidate-sha=<exact-head> --output=<report.json> [--list]",
  );
if (
  candidateArg?.slice("--candidate-sha=".length) &&
  !/^[a-f0-9]{40}$/i.test(candidateArg.slice("--candidate-sha=".length))
)
  throw new Error("Invalid candidate SHA argument.");
const candidateHeadSha = candidateArg?.slice("--candidate-sha=".length) || null;
let scratch = null;
let scratchOwned = null;
let scratchResults = null;
let generatedSpec = null;
let generatedConfig = null;
let generatedSpecOwned = null;
let generatedConfigOwned = null;
let reportPathForGeneration = null;
let failureReceiptPath = null;
let parentReportOwned = null;
let childReceipt = null;
let childOutcome = "not-started";
let primaryFailure = null;
let childReportCleanup = "not-attempted";
let discoverySucceeded = false;
const origin = "http://127.0.0.1:4179";
const safeSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat().sort();
}

async function readBuildEvidence() {
  const distDir = join(webDir, "dist");
  const files = await listFiles(distDir);
  const indexPath = join(distDir, "index.html");
  const manifestPath = join(distDir, ".vite", "manifest.json");
  const mapFiles = files.filter((path) => path.endsWith(".js.map"));
  const jsFiles = files.filter(
    (path) => path.endsWith(".js") && !path.endsWith(".js.map"),
  );
  if (mapFiles.length === 0 || jsFiles.length === 0)
    throw new Error("Missing built JavaScript or source maps.");
  const hashFiles = async (paths) =>
    Promise.all(
      paths.map(async (path) => {
        const bytes = await readFile(path);
        const hashed = hashedBasename(basename(path), bytes);
        if (!hashed)
          throw new Error("Build file has an unrecognized hashed basename.");
        return hashed;
      }),
    );
  const aggregateFiles = async (paths) => {
    const rows = await Promise.all(
      paths.map(
        async (path) =>
          `${basename(path)}\0${safeSha256(await readFile(path))}`,
      ),
    );
    rows.sort();
    return { count: rows.length, sha256: safeSha256(rows.join("\n")) };
  };
  const manifest = await readFile(manifestPath);
  const indexHtml = await readFile(indexPath);
  const parsedManifest = JSON.parse(manifest.toString("utf8"));
  const distPaths = files.map((path) => path.slice(distDir.length + 1));
  const assetBasenames = deriveManifestAssetBasenames(
    parsedManifest,
    distPaths,
  );
  await hashFiles(jsFiles);
  await hashFiles(mapFiles);
  const distRows = await Promise.all(
    files.map(
      async (path) =>
        `${path.slice(distDir.length + 1)}\0${safeSha256(await readFile(path))}`,
    ),
  );
  distRows.sort();
  return {
    evidence: {
      indexHtmlSha256: safeSha256(indexHtml),
      manifestSha256: safeSha256(manifest),
      dist: { count: files.length, sha256: safeSha256(distRows.join("\n")) },
      javascript: await aggregateFiles(jsFiles),
      sourceMaps: await aggregateFiles(mapFiles),
    },
    assetBasenames: [...assetBasenames].sort(),
  };
}

const generatedRecorder = `
import { createOwnedFile, writeChildFailureReceipt as persistChildFailureReceipt } from "./hosted-cold-recording-io.mjs";
import {
  assertColdReportPrivacy,
  assertColdMainThreadJourneyOverlap,
  buildSanitizedColdReport,
  coldDiagnosticFailure,
  createColdClockSample,
  estimateClockAlignment,
  ownedColdDiagnosticFailureFields,
  translateColdNetworkTimestamp,
  translateColdTraceInterval,
} from "./hosted-cold-recording-validation.mjs";

const COLD_REPORT_PATH = __REPORT_PATH__;
const COLD_FAILURE_RECEIPT_PATH = __FAILURE_RECEIPT_PATH__;
const COLD_PROVENANCE = __PROVENANCE__;
const COLD_ASSET_BASENAMES = new Set(__ASSET_BASENAMES__);
const COLD_MAX_EVENTS = 250_000;
const COLD_MAX_NETWORK = 2_048;
const COLD_MAX_CPU_SAMPLES = 500_000;
const COLD_MAX_CPU_NODES = 50_000;
const COLD_TRACE_NAMES = new Set([
  "thread_name", "RunTask", "EvaluateScript", "CompileScript", "ParseHTML",
  "V8.CompileCode", "V8.ParseOnBackground", "RemoveChild", "Remove",
  "DOM.removeChild", "UpdateLayoutTree", "RecalculateStyles", "Layout",
  "PrePaint", "Paint", "CompositeLayers", "FunctionCall", "RunMicrotasks",
  "EventDispatch",
]);
const COLD_REACT_FUNCTIONS = new Set([
  "performUnitOfWork", "completeUnitOfWork", "renderWithHooks", "commitRoot",
  "commitMutationEffects", "flushPassiveEffects", "beginWork", "completeWork",
]);
let coldStage = "prepare";
let coldOwnedReport = null;
let childReceiptAttempted = false;
const coldCounts = {
  clockSamples: 0,
  traceEventsReceived: 0,
  timelineRecordsRetained: 0,
  trackedRequests: 0,
  incompleteTrackedRequests: 0,
  cpuSamples: null,
  cpuNodes: null,
};
const coldFlags = {
  journeyAssertionsComplete: null,
  traceOverflow: null,
  networkOverflow: null,
  traceDataLoss: null,
  reportPrivacyPassed: null,
};

async function writeChildFailureReceipt(error) {
  if (childReceiptAttempted) return;
  childReceiptAttempted = true;
  const owned = ownedColdDiagnosticFailureFields(error);
  await persistChildFailureReceipt({
    path: COLD_FAILURE_RECEIPT_PATH,
    childReportOwned: coldOwnedReport,
    primary: { code: owned?.code ?? "unknown", stage: owned?.stage ?? coldStage },
    counts: { ...coldCounts },
    flags: { ...coldFlags },
  });
}
type SafeTraceEvent = {
  name: string;
  ph?: string;
  tid?: number;
  ts?: number;
  dur?: number;
  args?: { name?: string; data?: { functionName?: string } };
};
type CapturedRequest = {
  url: string;
  method?: string;
  resourceType?: string;
  initiatorType?: string;
  initiatorUrl: string;
  startTimestamp?: number;
  endTimestamp?: number;
  status?: number;
  failed?: boolean;
  priority?: string;
};
type TraceInterval = { start: number; end: number; name: string; phase: string | null };
type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RawRecord
    : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function keepSafeTraceFields(value: unknown): SafeTraceEvent | null {
  const event = asRecord(value);
  if (!event || typeof event.name !== "string" || !COLD_TRACE_NAMES.has(event.name)) return null;
  const safe: SafeTraceEvent = { name: event.name };
  if (typeof event.ph === "string") safe.ph = event.ph;
  if (Number.isInteger(event.tid)) safe.tid = event.tid as number;
  if (isFiniteNumber(event.ts)) safe.ts = event.ts;
  if (isFiniteNumber(event.dur)) safe.dur = event.dur;
  const args = asRecord(event.args);
  if (event.name === "thread_name" && args?.name === "CrRendererMain") {
    safe.args = { name: "CrRendererMain" };
  }
  const functionName = asRecord(args?.data)?.functionName;
  if (typeof functionName === "string" && COLD_REACT_FUNCTIONS.has(functionName)) {
    safe.args = { data: { functionName } };
  }
  return safe;
}

async function startColdCapture(page: Page) {
  const session = await page.context().newCDPSession(page);
  const traceEvents: SafeTraceEvent[] = [];
  const requests = new Map<string, CapturedRequest>();
  let traceOverflow = false;
  let traceClockInvalid = false;
  let receivedTraceEventCount = 0;
  let networkOverflow = false;
  const tracingComplete = new Promise<{ dataLossOccurred: boolean }>((resolve) => {
    session.once("Tracing.tracingComplete", resolve);
  });
  const clockSamples: Array<{ offsetMs: number; uncertaintyMs: number }> = [];
  function requestIsIncomplete(request: CapturedRequest) {
    return request.startTimestamp === undefined || request.endTimestamp === undefined;
  }
  function storeTrackedRequest(requestId: string, request: CapturedRequest) {
    const previous = requests.get(requestId);
    if (previous && requestIsIncomplete(previous))
      coldCounts.incompleteTrackedRequests -= 1;
    requests.set(requestId, request);
    coldCounts.trackedRequests = requests.size;
    if (requestIsIncomplete(request)) coldCounts.incompleteTrackedRequests += 1;
  }
  function setTrackedRequestEnd(
    request: CapturedRequest,
    timestamp: unknown,
    failed: boolean,
  ) {
    const wasIncomplete = requestIsIncomplete(request);
    if (failed) request.failed = true;
    request.endTimestamp = isFiniteNumber(timestamp) ? timestamp : undefined;
    const isIncomplete = requestIsIncomplete(request);
    coldCounts.incompleteTrackedRequests += Number(isIncomplete) - Number(wasIncomplete);
  }
  session.on("Tracing.dataCollected", (value: unknown) => {
    const event = asRecord(value);
    const values = Array.isArray(event?.value) ? event.value : [];
    if (receivedTraceEventCount + values.length > COLD_MAX_EVENTS) {
      traceOverflow = true;
      coldFlags.traceOverflow = true;
      return;
    }
    receivedTraceEventCount += values.length;
    coldCounts.traceEventsReceived = receivedTraceEventCount;
    for (const value of values) {
      const rawTraceEvent = asRecord(value);
      if (
        rawTraceEvent?.ph === "X" &&
        (!isFiniteNumber(rawTraceEvent.ts) ||
          !isFiniteNumber(rawTraceEvent.dur) ||
          rawTraceEvent.ts < 0 ||
          rawTraceEvent.dur < 0)
      ) traceClockInvalid = true;
      const safe = keepSafeTraceFields(value);
      if (safe) traceEvents.push(safe);
    }
    coldCounts.timelineRecordsRetained = traceEvents.length;
  });
  session.on("Network.requestWillBeSent", (value: unknown) => {
    if (requests.size >= COLD_MAX_NETWORK) {
      networkOverflow = true;
      coldFlags.networkOverflow = true;
      return;
    }
    const event = asRecord(value);
    const requestId = event?.requestId;
    if (typeof requestId !== "string") return;
    const request = asRecord(event.request);
    const initiator = asRecord(event.initiator);
    const stack = asRecord(initiator?.stack);
    const callFrames = Array.isArray(stack?.callFrames) ? stack.callFrames : [];
    const stackFrame = asRecord(callFrames[0]);
    const url = request?.url;
    const initiatorUrl = stackFrame?.url;
    storeTrackedRequest(requestId, {
      url: typeof url === "string" && url.length <= 4096 ? url : "",
      method: typeof request?.method === "string" ? request.method : undefined,
      resourceType: typeof event.type === "string" ? event.type : undefined,
      initiatorType: typeof initiator?.type === "string" ? initiator.type : undefined,
      initiatorUrl: typeof initiatorUrl === "string" && initiatorUrl.length <= 4096 ? initiatorUrl : "",
      startTimestamp: isFiniteNumber(event.timestamp) ? event.timestamp : undefined,
      priority: typeof request?.initialPriority === "string" ? request.initialPriority : undefined,
    });
  });
  session.on("Network.responseReceived", (value: unknown) => {
    const event = asRecord(value);
    const request = typeof event?.requestId === "string" ? requests.get(event.requestId) : undefined;
    if (!request) return;
    const response = asRecord(event?.response);
    request.status = isFiniteNumber(response?.status) ? response.status : undefined;
    request.resourceType = typeof event?.type === "string" ? event.type : undefined;
  });
  session.on("Network.resourceChangedPriority", (value: unknown) => {
    const event = asRecord(value);
    const request = typeof event?.requestId === "string" ? requests.get(event.requestId) : undefined;
    if (request && typeof event?.newPriority === "string") request.priority = event.newPriority;
  });
  session.on("Network.loadingFailed", (value: unknown) => {
    const event = asRecord(value);
    const request = typeof event?.requestId === "string" ? requests.get(event.requestId) : undefined;
    if (request) {
      setTrackedRequestEnd(request, event?.timestamp, true);
    }
  });
  session.on("Network.loadingFinished", (value: unknown) => {
    const event = asRecord(value);
    const request = typeof event?.requestId === "string" ? requests.get(event.requestId) : undefined;
    if (request) {
      setTrackedRequestEnd(request, event?.timestamp, false);
    }
  });
  await session.send("Network.enable");
  await session.send("Performance.enable");
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 1000 });
  await session.send("Profiler.start");
  await session.send("Tracing.start", {
    transferMode: "ReportEvents",
    categories: "devtools.timeline,v8.cpu_profiler,blink.user_timing,disabled-by-default-devtools.timeline",
  });

  async function clockSample() {
    coldStage = "clock";
    const before = await page.evaluate(() => ({
      now: performance.now(),
      timeOrigin: performance.timeOrigin,
    }));
    const result = asRecord(await session.send("Performance.getMetrics"));
    const after = await page.evaluate(() => ({
      now: performance.now(),
      timeOrigin: performance.timeOrigin,
    }));
    const metricRows = Array.isArray(result?.metrics) ? result.metrics : [];
    const timestampSeconds = metricRows
      .map(asRecord)
      .find((metric) => metric?.name === "Timestamp")?.value;
    const sample = createColdClockSample({
      chromiumVersion: COLD_PROVENANCE.chromiumVersion,
      timestampSeconds,
      beforeMs: before.now,
      afterMs: after.now,
      beforeTimeOriginMs: before.timeOrigin,
      afterTimeOriginMs: after.timeOrigin,
      expectedTimeOriginMs: clockSamples[0]?.documentTimeOriginMs,
    });
    clockSamples.push(sample);
    coldCounts.clockSamples = clockSamples.length;
    return sample;
  }
  return {
    align: clockSample,
    finish: async (expectedTimeOriginMs: number, journeyEndMs: number) => {
      coldStage = "capture-finish";
      await clockSample();
      await clockSample();
      coldStage = "capture-finish";
    const profileResult = asRecord(await session.send("Profiler.stop"));
    await session.send("Tracing.end");
    const completion = await tracingComplete;
    await session.detach();
    const profile = asRecord(profileResult?.profile);
    const samples = Array.isArray(profile?.samples) ? profile.samples : [];
    const nodes = Array.isArray(profile?.nodes) ? profile.nodes : [];
    coldCounts.cpuSamples = samples.length;
    coldCounts.cpuNodes = nodes.length;
    coldFlags.traceOverflow = traceOverflow;
    coldFlags.networkOverflow = networkOverflow;
    coldFlags.traceDataLoss = typeof completion.dataLossOccurred === "boolean"
      ? completion.dataLossOccurred
      : null;
    if (traceClockInvalid || traceOverflow || networkOverflow || samples.length === 0 || samples.length > COLD_MAX_CPU_SAMPLES || nodes.length === 0 || nodes.length > COLD_MAX_CPU_NODES || completion.dataLossOccurred !== false)
      throw coldDiagnosticFailure("trace-integrity", "capture-finish", "Capture integrity check failed.");
    coldStage = "clock";
    const clockAlignment = estimateClockAlignment(clockSamples);
    if (
      !isFiniteNumber(expectedTimeOriginMs) ||
      clockAlignment.documentTimeOriginMs !== expectedTimeOriginMs
    ) throw coldDiagnosticFailure("clock-alignment", "clock", "Document clock origins did not match.");
    const offsetMs = clockAlignment.offsetMs;
    coldStage = "network";
    const resources = [...requests.values()].map((request) => {
      let timing: { start: number; end: number } | undefined;
      if (request.startTimestamp !== undefined || request.endTimestamp !== undefined) {
        if (!isFiniteNumber(request.startTimestamp) || !isFiniteNumber(request.endTimestamp))
          throw coldDiagnosticFailure("network-clock-incomplete", "network", "A tracked request has incomplete clock endpoints.");
        const start = translateColdNetworkTimestamp(request.startTimestamp, offsetMs);
        const end = translateColdNetworkTimestamp(request.endTimestamp, offsetMs);
        if (end < start) throw coldDiagnosticFailure("network-clock", "network", "Tracked request interval is reversed.");
        timing = { start, end };
      }
      return {
        url: request.url,
        method: request.method,
        resourceType: request.resourceType,
        initiatorType: request.initiatorType,
        initiatorUrl: request.initiatorUrl,
        status: request.status,
        failed: request.failed,
        priority: request.priority,
        timing,
      };
    });
    const mainTid = traceEvents.find((event) =>
      event.name === "thread_name" && event.ph === "M" && event.args?.name === "CrRendererMain"
    )?.tid;
    if (typeof mainTid !== "number") throw coldDiagnosticFailure("phase-validation", "phase", "Main thread marker is missing.");
    coldStage = "phase";
    const phases = deriveExclusiveMainThreadPhases(traceEvents, mainTid, offsetMs, journeyEndMs);
    return {
      resources,
      phases,
      documentTimeOriginMs: clockAlignment.documentTimeOriginMs,
      uncertaintyMs: clockAlignment.uncertaintyMs,
      traceEventCount: receivedTraceEventCount,
      timelineRecordCount: traceEvents.length,
      cpuSampleCount: samples.length,
      traceDataLoss: completion.dataLossOccurred,
      traceTruncated: traceOverflow,
      networkTruncated: networkOverflow,
    };
    },
  };
}

function tracePhase(event: SafeTraceEvent) {
  const name = event.name;
  const functionName = event.args?.data?.functionName ?? "";
  if (["EvaluateScript", "CompileScript", "ParseHTML", "V8.CompileCode", "V8.ParseOnBackground"].includes(name)) return "parse-evaluate";
  if (["RemoveChild", "Remove", "DOM.removeChild"].includes(name)) return "dom-removal";
  if (["UpdateLayoutTree", "RecalculateStyles", "Layout", "PrePaint", "Paint", "CompositeLayers"].includes(name)) return "paint-layout";
  if (/^(performUnitOfWork|completeUnitOfWork|renderWithHooks|commitRoot|commitMutationEffects|flushPassiveEffects|beginWork|completeWork)$/.test(functionName)) return "react-render-commit";
  if (name === "FunctionCall" || name === "RunMicrotasks" || name === "EventDispatch") return "main-thread-other";
  return null;
}

function deriveExclusiveMainThreadPhases(events: SafeTraceEvent[], mainTid: number, offsetMs: number, journeyEndMs: number) {
  if (!isFiniteNumber(journeyEndMs) || journeyEndMs <= 0 || journeyEndMs > 600_000)
    throw new Error("invalid-observed-journey-window");
  const intervals: TraceInterval[] = events.flatMap((event) => {
    if (event.tid !== mainTid || event.ph !== "X") return [];
    if (!isFiniteNumber(event.ts) || !isFiniteNumber(event.dur) || event.dur < 0)
      throw new Error("invalid-main-thread-trace-clock");
    if (event.dur === 0) return [];
    const translated = translateColdTraceInterval(event.ts, event.dur, offsetMs);
    return [{
      start: translated.startMs,
      end: translated.endMs,
      name: event.name,
      phase: tracePhase(event),
    }];
  });
  const tasks = intervals.filter((event) => event.name === "RunTask").sort((a, b) => a.start - b.start);
  assertColdMainThreadJourneyOverlap(tasks, journeyEndMs);
  const classifiedIntervals = intervals
    .filter((event) => event.phase && event.name !== "RunTask")
    .sort((a, b) => a.start - b.start);
  const candidatesByTask: TraceInterval[][] = tasks.map(() => []);
  let candidateAssignments = 0;
  for (const candidate of classifiedIntervals) {
    let low = 0;
    let high = tasks.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (tasks[middle].end <= candidate.start) low = middle + 1;
      else high = middle;
    }
    for (let taskIndex = low; taskIndex < tasks.length && tasks[taskIndex].start < candidate.end; taskIndex += 1) {
      if (tasks[taskIndex].end > candidate.start) {
        candidatesByTask[taskIndex].push(candidate);
        candidateAssignments += 1;
        if (candidateAssignments > 500_000) throw new Error("phase-overflow");
      }
    }
  }
  const segments: Array<{ phase: string; start: number; end: number }> = [];
  let cursor = 0;
  for (const [taskIndex, task] of tasks.entries()) {
    const taskStart = Math.max(0, task.start);
    const taskEnd = Math.min(600_000, task.end);
    if (taskEnd <= taskStart || taskStart < cursor) continue;
    if (taskStart > cursor) segments.push({ phase: "main-thread-idle", start: cursor, end: taskStart });
    const candidates = candidatesByTask[taskIndex].filter((candidate) => candidate.start < taskEnd && candidate.end > taskStart);
    const boundaries = new Set([taskStart, taskEnd]);
    for (const candidate of candidates) {
      boundaries.add(Math.max(taskStart, candidate.start));
      boundaries.add(Math.min(taskEnd, candidate.end));
    }
    const points = [...boundaries].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index];
      const end = points[index + 1];
      if (end <= start) continue;
      const midpoint = (start + end) / 2;
      const active = candidates.filter((candidate) => candidate.start <= midpoint && candidate.end >= midpoint);
      const phase = ["dom-removal", "paint-layout", "react-render-commit", "parse-evaluate", "main-thread-other"].find((item) => active.some((candidate) => candidate.phase === item)) ?? "main-thread-other";
      segments.push({ phase, start, end });
      if (segments.length > 100_000) throw new Error("phase-overflow");
    }
    cursor = taskEnd;
  }
  const end = tasks.length ? Math.min(600_000, Math.max(0, ...tasks.map((task) => task.end))) : 0;
  if (end > cursor) segments.push({ phase: "main-thread-idle", start: cursor, end });
  return segments.map((segment) => ({
    phase: segment.phase,
    start: Math.round(segment.start * 10) / 10,
    end: Math.round(segment.end * 10) / 10,
  }));
}

test("Hosted G11 cold work-list to detail recording", async ({ browser }) => {
  test.setTimeout(180_000);
  try {
    await withPerformancePage(browser, true, async (page) => {
    const capture = await startColdCapture(page);
    try {
      coldStage = "journey";
      await page.goto(WORK_LIST_PATH);
      await capture.align();
      coldStage = "journey";
      const rows = page.locator("[data-testid=work-item-list-populated] tbody tr");
      await page.waitForFunction(() => (window as G11Window).__g11Metrics.lcp > 0, undefined, { timeout: 30_000 });
      const lcpState = await page.evaluate(() => {
        const lcpMs = (window as G11Window).__g11Metrics.lcp;
        const sampleAtMs = performance.now();
        return {
          lcpMs,
          lcpElementTag: (window as G11Window).__g11Metrics.lcpElement.split(/[.#]/, 1)[0].toLowerCase(),
          timeOriginMs: performance.timeOrigin,
          rowsAtPostObserverSample: document.querySelectorAll("[data-testid=work-item-list-populated] tbody tr").length,
          rowCountSampleAtMs: sampleAtMs,
          rowCountSampleAfterLcpEntryMs: Math.max(0, sampleAtMs - lcpMs),
        };
      });
      if (lcpState.lcpElementTag !== "h1") throw coldDiagnosticFailure("journey-assertion", "journey", "The required H1 LCP predicate failed.");
      await expect(rows).toHaveCount(500, { timeout: 30_000 });
      await waitForTwoFrames(page);
      const rowCount = await rows.count();
      if (rowCount !== 500 || lcpState.rowsAtPostObserverSample > 500) throw coldDiagnosticFailure("journey-assertion", "journey", "The fixed row-count predicate failed.");
      const target = page.getByRole("link", { name: WORK_ITEM_KEY, exact: true });
      await expect(target).toHaveCount(1);
      const targetHref = await target.getAttribute("href");
      if (targetHref !== "/agent/work-items/WLP-1") throw coldDiagnosticFailure("journey-assertion", "journey", "The fixed click-target predicate failed.");
      await target.click();
      await page.waitForFunction(() => (window as G11Window).__g11Metrics.routePaint > 0, undefined, { timeout: 30_000 });
      const routeState = await page.evaluate(() => ({
        routeStartMs: (window as G11Window).__g11Metrics.routeStart,
        routePaintMs: (window as G11Window).__g11Metrics.routePaint,
        routePaintTarget: (window as G11Window).__g11Metrics.routePaintTarget,
        routeVisibilityProbeCount:
          (window as G11Window).__g11Metrics.routeVisibilityProbeCount,
        routeVisibilityProbeTotalMs:
          (window as G11Window).__g11Metrics.routeVisibilityProbeTotalMs,
        routeVisibilityProbeMaxMs:
          (window as G11Window).__g11Metrics.routeVisibilityProbeMaxMs,
        timeOriginMs: performance.timeOrigin,
      }));
      if (routeState.timeOriginMs !== lcpState.timeOriginMs) throw coldDiagnosticFailure("clock-alignment", "clock", "Document clock origin changed during the journey.");
      if (
        routeState.routeStartMs <= 0 ||
        routeState.routePaintMs <= 0 ||
        !["loading", "detail"].includes(routeState.routePaintTarget)
      ) throw coldDiagnosticFailure("journey-assertion", "journey", "The route-paint mark predicate failed.");
      await expect(page.getByTestId("work-item-detail")).toBeVisible({ timeout: 15_000 });
      const detailUrl = new URL(page.url());
      if (detailUrl.pathname !== "/agent/work-items/WLP-1") throw coldDiagnosticFailure("journey-assertion", "journey", "The fixed detail URL predicate failed.");
      coldFlags.journeyAssertionsComplete = true;
      coldStage = "capture-finish";
      const rawCapture = await capture.finish(lcpState.timeOriginMs, routeState.routePaintMs);
      if (rawCapture.documentTimeOriginMs !== routeState.timeOriginMs)
        throw coldDiagnosticFailure("clock-alignment", "clock", "Capture and journey clock origins did not match.");
      coldStage = "report-build";
      const report = buildSanitizedColdReport({
        provenance: COLD_PROVENANCE,
        assetBasenames: COLD_ASSET_BASENAMES,
        resources: rawCapture.resources,
        phaseSegments: rawCapture.phases,
        lcpMs: lcpState.lcpMs,
        lcpElementTag: lcpState.lcpElementTag,
        rowsAtPostObserverSample: lcpState.rowsAtPostObserverSample,
        rowCountSampleAtMs: lcpState.rowCountSampleAtMs,
        rowCountSampleAfterLcpEntryMs: lcpState.rowCountSampleAfterLcpEntryMs,
        rowCount,
        clickTarget: WORK_ITEM_KEY,
        routeStartMs: routeState.routeStartMs,
        routePaintMs: routeState.routePaintMs,
        routePaintTarget: routeState.routePaintTarget,
        routeVisibilityProbeCount: routeState.routeVisibilityProbeCount,
        routeVisibilityProbeTotalMs: routeState.routeVisibilityProbeTotalMs,
        routeVisibilityProbeMaxMs: routeState.routeVisibilityProbeMaxMs,
        detailVisible: true,
        urlVerified: true,
        clockUncertaintyMs: rawCapture.uncertaintyMs,
        traceDataLoss: rawCapture.traceDataLoss,
        traceTruncated: rawCapture.traceTruncated,
        networkTruncated: rawCapture.networkTruncated,
        traceEventCount: rawCapture.traceEventCount,
        timelineRecordCount: rawCapture.timelineRecordCount,
        cpuSampleCount: rawCapture.cpuSampleCount,
        lcpWindow: { lcpMs: lcpState.lcpMs },
        clickWindow: { routeStartMs: routeState.routeStartMs, routePaintMs: routeState.routePaintMs },
      });
      coldStage = "privacy";
      assertColdReportPrivacy(report, COLD_ASSET_BASENAMES);
      coldFlags.reportPrivacyPassed = true;
      coldStage = "report-write";
      const reportWrite = await createOwnedFile(
        COLD_REPORT_PATH,
        JSON.stringify(report),
      );
      coldOwnedReport = reportWrite.owned;
      if (!reportWrite.complete) {
        throw coldDiagnosticFailure("report-write", "report-write", "The bounded report write failed.");
      }
    }, { g13Windows: true });
  } catch (error) {
    await writeChildFailureReceipt(error);
    throw new Error("Cold G11 recording failed a required journey, privacy, or capture-integrity check.");
  }
});

`;

function generatedConfigTemplate(scratchResults) {
  return `import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "performance.hosted-cold-recording.generated.ts",
  grep: /Hosted G11 cold work-list to detail recording/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 180_000,
  outputDir: ${JSON.stringify(scratchResults)},
  use: { baseURL: "${origin}", trace: "off", ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
  webServer: {
    command: "pnpm --filter @taskdesk/web preview --host 127.0.0.1 --port 4179 --strictPort",
    url: "${origin}/auth/sign-in",
    reuseExistingServer: false,
    env: { VITE_API_URL: "${origin}" },
  },
});
`;
}

let parentStage = "prepare";
let counts = null;
let flags = null;
let discoveryPrimary = null;

function emptyEvidence() {
  const empty = unknownColdFailureReceipt();
  return { counts: empty.counts, flags: empty.flags };
}

function setParentFailure(error) {
  if (primaryFailure) return;
  const owned = ownedColdDiagnosticFailureFields(error);
  primaryFailure = owned ?? { code: "unknown", stage: parentStage };
}

function validatedReportMatches(report, provenance, assetBasenames) {
  try {
    assertColdReportPrivacy(report, assetBasenames);
  } catch {
    return false;
  }
  const bound = report?.provenance;
  return Boolean(
    bound?.sourceSha === provenance.sourceSha &&
      bound?.candidateHeadSha === provenance.candidateHeadSha &&
      bound?.benchmarkSha256 === provenance.benchmarkSha256 &&
      bound?.routePaintRecorderSha256 === provenance.routePaintRecorderSha256 &&
      bound?.perfConfigSha256 === provenance.perfConfigSha256 &&
      bound?.networkHelperSha256 === provenance.networkHelperSha256 &&
      bound?.nodeVersion === provenance.nodeVersion &&
      bound?.pnpmVersion === provenance.pnpmVersion &&
      bound?.playwrightVersion === provenance.playwrightVersion &&
      bound?.chromiumVersion === provenance.chromiumVersion &&
      JSON.stringify(bound.build) === JSON.stringify(provenance.build),
  );
}

try {
  if (resolvedOutputPath && !(await outputTargetIsAbsent(resolvedOutputPath)))
    throw coldDiagnosticFailure(
      "report-write",
      "prepare",
      "The requested output target is not absent.",
    );
  scratchOwned = await createOwnedTempDirectory();
  if (!scratchOwned?.owned || !scratchOwned.identity)
    throw coldDiagnosticFailure(
      "report-write",
      "prepare",
      "Private scratch setup failed.",
    );
  scratch = scratchOwned.path;
  scratchResults = join(scratch, "playwright-results");
  generatedSpec = join(
    scriptDir,
    "performance.hosted-cold-recording.generated.ts",
  );
  generatedConfig = join(
    webDir,
    "playwright.hosted-cold-recording.generated.config.ts",
  );
  reportPathForGeneration = join(scratch, "captured-report.json");
  failureReceiptPath = join(scratch, "child-failure-receipt.json");

  parentStage = "source-bind";
  const benchmarkPath = join(scriptDir, "performance.bench.ts");
  const perfConfigPath = join(webDir, "playwright.perf.config.ts");
  const networkHelperPath = join(
    scriptDir,
    "helpers/performance-network-summary.ts",
  );
  const [benchmark, perfConfig, networkHelper] = await Promise.all([
    readFile(benchmarkPath, "utf8"),
    readFile(perfConfigPath),
    readFile(networkHelperPath),
  ]);
  const routePaintRecorder = await readFile(
    join(scriptDir, "helpers/route-paint-recorder.ts"),
  );
  const canonicalBenchmarkSha256 = safeSha256(benchmark);
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoDir,
    encoding: "utf8",
  }).trim();
  if (sourceSha !== candidateHeadSha)
    throw coldDiagnosticFailure(
      "source-binding",
      "source-bind",
      "Checked-out source did not match the requested head.",
    );
  const playwrightPackage = JSON.parse(
    await readFile(
      join(webDir, "node_modules/@playwright/test/package.json"),
      "utf8",
    ),
  );
  const buildEvidence = await readBuildEvidence();
  const pnpmVersion = execFileSync("pnpm", ["--version"], {
    cwd: repoDir,
    encoding: "utf8",
  }).trim();
  let chromiumVersion = "discovery-only";
  if (!discoveryOnly) {
    const versionBrowser = await chromium.launch();
    chromiumVersion = versionBrowser.version();
    await versionBrowser.close();
  }
  const provenance = {
    sourceSha,
    candidateHeadSha,
    benchmarkSha256: canonicalBenchmarkSha256,
    routePaintRecorderSha256: safeSha256(routePaintRecorder),
    perfConfigSha256: safeSha256(perfConfig),
    networkHelperSha256: safeSha256(networkHelper),
    expectedSourceSha: candidateHeadSha,
    nodeVersion: process.versions.node,
    pnpmVersion,
    playwrightVersion: playwrightPackage.version,
    chromiumVersion,
    build: buildEvidence.evidence,
  };
  const previewOccurrences =
    benchmark.match(/http:\/\/127\.0\.0\.1:4178/g) ?? [];
  if (previewOccurrences.length !== 3)
    throw coldDiagnosticFailure(
      "build-binding",
      "source-bind",
      "Canonical preview binding check failed.",
    );
  const routePaintMarker =
    'import { installRoutePaintRecorder } from "./helpers/route-paint-recorder";';
  if (benchmark.split(routePaintMarker).length - 1 !== 1)
    throw coldDiagnosticFailure(
      "build-binding",
      "source-bind",
      "Canonical route-paint source binding check failed.",
    );
  const source = benchmark.replaceAll("http://127.0.0.1:4178", origin);
  if (source.includes("http://127.0.0.1:4178"))
    throw coldDiagnosticFailure(
      "build-binding",
      "source-bind",
      "Diagnostic preview binding check failed.",
    );
  const extra = generatedRecorder
    .replace("__REPORT_PATH__", JSON.stringify(reportPathForGeneration))
    .replace("__FAILURE_RECEIPT_PATH__", JSON.stringify(failureReceiptPath))
    .replace("__PROVENANCE__", JSON.stringify(provenance))
    .replace(
      "__ASSET_BASENAMES__",
      JSON.stringify(buildEvidence.assetBasenames),
    );
  const generated = await createOwnedFile(generatedSpec, `${source}\n${extra}`);
  generatedSpecOwned = generated.owned;
  if (!generated.complete)
    throw coldDiagnosticFailure(
      "source-binding",
      "prepare",
      "Generated test creation failed.",
    );
  const generatedConfigResult = await createOwnedFile(
    generatedConfig,
    generatedConfigTemplate(scratchResults),
  );
  generatedConfigOwned = generatedConfigResult.owned;
  if (!generatedConfigResult.complete)
    throw coldDiagnosticFailure(
      "source-binding",
      "prepare",
      "Generated config creation failed.",
    );

  const validation = spawnSync(
    process.execPath,
    [
      "--test",
      join(scriptDir, "hosted-cold-recording-validation.test.mjs"),
      join(scriptDir, "hosted-cold-recording-io.test.mjs"),
    ],
    { cwd: webDir, stdio: "ignore" },
  );
  if (validation.status !== 0)
    throw coldDiagnosticFailure(
      "preflight-validation",
      "prepare",
      "Cold privacy regression preflight failed.",
    );

  parentStage = "child-start";
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config=playwright.hosted-cold-recording.generated.config.ts",
      "--workers=1",
      ...(discoveryOnly ? ["--list"] : []),
    ],
    { cwd: webDir, stdio: discoveryOnly ? "inherit" : "ignore" },
  );
  if (result.error) {
    childOutcome = "not-started";
    primaryFailure = { code: "child-exit", stage: "child-start" };
  } else if (result.status !== 0) {
    childOutcome = "failed";
    if (!discoveryOnly)
      childReceipt = await readChildFailureReceipt(failureReceiptPath);
    if (childReceipt?.childOutcome === "failed" && childReceipt.primary) {
      primaryFailure = childReceipt.primary;
      counts = childReceipt.counts;
      flags = childReceipt.flags;
      childReportCleanup = childReceipt.cleanup.childReport;
    } else {
      const fallback = parentChildExitReceipt({ childOutcome: "failed" });
      primaryFailure = fallback.primary;
      counts = fallback.counts;
      flags = fallback.flags;
      childReportCleanup = fallback.cleanup.childReport;
    }
    if (discoveryOnly) discoveryPrimary = primaryFailure;
  } else if (discoveryOnly) {
    discoverySucceeded = true;
  } else {
    childOutcome = "unknown";
    parentStage = "report-build";
    const reportStat = await lstat(reportPathForGeneration).catch(() => null);
    if (
      !reportStat?.isFile() ||
      reportStat.isSymbolicLink() ||
      (reportStat.mode & 0o777) !== 0o600 ||
      reportStat.size > 256 * 1024
    )
      throw coldDiagnosticFailure(
        "report-schema",
        "report-build",
        "Completed child report is missing or invalid.",
      );
    let report;
    let reportBytes;
    try {
      reportBytes = await readFile(reportPathForGeneration);
      report = JSON.parse(reportBytes.toString("utf8"));
    } catch {
      throw coldDiagnosticFailure(
        "report-schema",
        "report-build",
        "Completed child report is invalid.",
      );
    }
    parentStage = "privacy";
    if (
      !validatedReportMatches(report, provenance, buildEvidence.assetBasenames)
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Completed child report failed parent validation.",
      );
    childOutcome = "passed";
    flags = {
      ...emptyEvidence().flags,
      journeyAssertionsComplete: true,
      traceDataLoss: report.clocks.dataLoss,
      reportPrivacyPassed: true,
    };
    counts = {
      ...emptyEvidence().counts,
      traceEventsReceived: report.clocks.traceEventCount,
      timelineRecordsRetained: report.clocks.timelineRecordCount,
      cpuSamples: report.clocks.cpuSamples,
    };
    parentStage = "report-write";
    if (!(await createReportParent(resolvedOutputPath)))
      throw coldDiagnosticFailure(
        "report-write",
        "report-write",
        "Report output setup failed.",
      );
    const outputWrite = await createOwnedFile(resolvedOutputPath, reportBytes);
    parentReportOwned = outputWrite.owned;
    if (!outputWrite.complete)
      throw coldDiagnosticFailure(
        "report-write",
        "report-write",
        "Validated report output failed.",
      );
  }
} catch (error) {
  setParentFailure(error);
  if (childOutcome === "not-started" && parentStage === "child-start")
    primaryFailure = { code: "child-exit", stage: "child-start" };
  if (discoveryOnly) discoveryPrimary ??= primaryFailure;
}

const empty = emptyEvidence();
counts ??= empty.counts;
flags ??= empty.flags;

if (discoveryOnly) {
  const cleanup = await runParentCleanup({
    childReport: childReportCleanup,
    childOutcome: discoverySucceeded ? "not-started" : childOutcome,
    primary: discoveryPrimary,
    generatedSpec: generatedSpecOwned,
    generatedConfig: generatedConfigOwned,
    scratch: scratchOwned,
  });
  if (!discoverySucceeded || cleanupHasFailure(cleanup)) {
    const receipt = createColdFailureReceipt({
      childOutcome: "failed",
      primary: discoveryPrimary ?? { code: "child-exit", stage: "child-start" },
      counts,
      flags,
      cleanup,
    });
    process.stdout.write(`${formatColdFailureReceiptLine(receipt)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Generated cold test discovery passed.\n");
  }
} else {
  const finalized = await finalizeParentOutcome({
    childOutcome,
    primary: primaryFailure,
    counts,
    flags,
    childReport: childReportCleanup,
    parentReport: parentReportOwned,
    generatedSpec: generatedSpecOwned,
    generatedConfig: generatedConfigOwned,
    scratch: scratchOwned,
    emitLine: (line) => process.stdout.write(line),
  });
  if (!finalized.succeeded) process.exitCode = 1;
}
