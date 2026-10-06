import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  accumulateCpuProfileChunk,
  type CpuProfile,
  type CpuProfileCaptureStatus,
  type CpuProfileNode,
  createCpuProfileAccumulator,
  finalizeCpuProfileCapture,
} from "../src/lib/performance-cpu-profile-capture";
import {
  type BoundProfileSourceMap,
  type ProfiledAssetIdentity,
  parseProfileSourceMap,
  sampleProfileCallers,
} from "../src/lib/performance-profile-attribution";
import { summarizeProfileCoverage } from "../src/lib/performance-profile-intervals";
import {
  installPerformanceApiFixture,
  PERFORMANCE_BASE_URL,
  PROJECT_ID,
  WORK_LIST_PATH,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";
import { installLastItemPaintRecorder } from "./helpers/last-item-paint-recorder";
import { attachPerformanceNetworkCapture } from "./helpers/performance-network-summary";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ORIGIN = PERFORMANCE_BASE_URL;
const RESULT_DIR = path.join(
  ROOT,
  "apps/web/test-results/g11-initial-page-diagnostic",
);

type DiagnosticBuildIdentity = {
  sourceCommitSha: string;
  sourceTreeSha256: string;
  sourceTreeFileCount: number;
  workingTreeChanges: string[];
  manifestSha256: string;
  canonicalFixtureSha256: string;
  initialAssets: Array<{ file: string; sha256: string }>;
  profiledAssets: Array<{
    file: string;
    sha256: string;
    sourceMapSha256?: string;
    sourceMapStatus: "matched" | "missing" | "invalid" | "asset-mismatch";
  }>;
};

type InitialDocumentMetrics = {
  lcp: {
    startTime: number;
    element: string;
    textLength: number;
    url: string;
  } | null;
  heading: { found: boolean; tag: string | null; textLength: number };
  navigation: {
    responseStart: number;
    domInteractive: number;
    load: number;
  } | null;
  resources: Array<{
    kind: string;
    asset: string;
    start: number;
    responseStart: number;
    end: number;
    transferBytes: number;
  }>;
  longTasks: Array<{ start: number; duration: number }>;
};

type BrowserTimelineEvent = {
  name: string;
  category: string;
  phase: string;
  startMicroseconds: number;
  durationMicroseconds?: number;
  mark?: string;
  markDocumentId?: string;
  source?: { asset: string; line: number };
  stack?: Array<{
    asset: string;
    line: number;
    column: number;
  }>;
};

type RawTimelineEvent = {
  id?: string | number;
  pid?: number;
  tid?: number;
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  args?: {
    data?: {
      url?: string;
      scriptName?: string;
      lineNumber?: number;
      stackTrace?: {
        callFrames?: Array<{
          functionName?: string;
          url?: string;
          lineNumber?: number;
          columnNumber?: number;
        }>;
      };
      name?: string;
      message?: string;
    };
  };
};

const TIMELINE_EVENT_NAMES = new Set([
  "RunTask",
  "FunctionCall",
  "EvaluateScript",
  "UpdateLayoutTree",
  "RecalculateStyles",
  "Layout",
  "PrePaint",
  "Paint",
  "CompositeLayers",
  "EventDispatch",
  "FireAnimationFrame",
  "LargestContentfulPaint::Candidate",
  "ParseHTML",
  "ParseAuthorStyleSheet",
  "TimeStamp",
  "UserTiming",
]);

const CLOCK_MARKS = new Set([
  "document-start",
  "initial-lcp",
  "state-start",
  "state-paint",
  "assignment-start",
  "assignment-paint",
  "board-paint",
]);

function safeTimelineAsset(value: string) {
  try {
    const parsed = new URL(value, ORIGIN);
    const basename = path.posix.basename(parsed.pathname);
    return parsed.origin === ORIGIN &&
      parsed.pathname.startsWith("/assets/") &&
      /^[A-Za-z0-9_.-]{1,128}\.js$/.test(basename)
      ? basename
      : "non-asset";
  } catch {
    return "non-asset";
  }
}

function sanitizeTimelineEvent(
  event: RawTimelineEvent,
): BrowserTimelineEvent | undefined {
  if (!event.name) return undefined;
  const data = event.args?.data;
  const rawMark = data?.name ?? data?.message;
  const markerMatch =
    typeof rawMark === "string"
      ? /^g11-diagnostic:([a-f0-9]{16}):([a-z-]+)$/.exec(rawMark)
      : null;
  const markDocumentId = markerMatch?.[1];
  const mark = markerMatch?.[2];
  if (markerMatch && (!mark || !CLOCK_MARKS.has(mark))) return undefined;
  if (!mark && !TIMELINE_EVENT_NAMES.has(event.name)) return undefined;
  const callFrames = data?.stackTrace?.callFrames;
  const stack = Array.isArray(callFrames)
    ? callFrames.slice(0, 12).map((frame) => ({
        asset: safeTimelineAsset(String(frame.url ?? "")),
        line: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : 0,
        column: Number.isFinite(frame.columnNumber)
          ? frame.columnNumber + 1
          : 0,
      }))
    : undefined;
  return {
    name: event.name,
    category: /^[A-Za-z0-9._-]{0,80}$/.test(String(event.cat ?? ""))
      ? String(event.cat ?? "")
      : "unknown",
    phase: /^[A-Za-z]$/.test(String(event.ph ?? ""))
      ? String(event.ph ?? "")
      : "?",
    startMicroseconds: Number(event.ts) || 0,
    ...(Number.isFinite(event.dur) ? { durationMicroseconds: event.dur } : {}),
    ...(mark ? { mark } : {}),
    ...(markDocumentId ? { markDocumentId } : {}),
    ...(data?.url || data?.scriptName
      ? {
          source: {
            asset: safeTimelineAsset(data.url ?? data.scriptName ?? ""),
            line: Number.isFinite(data.lineNumber)
              ? Number(data.lineNumber) + 1
              : 0,
          },
        }
      : {}),
    ...(stack?.length ? { stack } : {}),
  };
}

const WINDOW_PERFORMANCE_METRICS = [
  "ScriptDuration",
  "TaskDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "LayoutCount",
  "RecalcStyleCount",
  "Nodes",
  "LayoutObjects",
] as const;

async function performanceMetricSnapshot(
  cdp: import("playwright-core").CDPSession,
) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(
    metrics
      .filter((metric: { name: string }) =>
        (WINDOW_PERFORMANCE_METRICS as readonly string[]).includes(metric.name),
      )
      .map((metric: { name: string; value: number }) => [
        metric.name,
        metric.value,
      ]),
  ) as Record<string, number>;
}

function metricDeltas(
  before: Record<string, number>,
  after: Record<string, number>,
) {
  return Object.fromEntries(
    WINDOW_PERFORMANCE_METRICS.flatMap((name) =>
      before[name] === undefined || after[name] === undefined
        ? []
        : [[name, after[name] - before[name]]],
    ),
  );
}

declare global {
  interface Window {
    __g11InitialDiagnostic?: {
      lcp: { startTime: number; element: string; textLength: number } | null;
      longTasks: Array<{ start: number; duration: number }>;
    };
  }
}

function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function safeAssetName(value: string) {
  try {
    const parsed = new URL(value, ORIGIN);
    if (parsed.origin !== ORIGIN) return "external";
    return path.posix.basename(parsed.pathname) || "document";
  } catch {
    return "unrecognized";
  }
}

function alignBoundaryToTrace(capture: DiagnosticCapture) {
  const boundary = capture.boundary;
  if (!boundary) return null;
  const markerEvents = capture.browserPerformance.timelineEvents
    .filter((event) => event.mark)
    .sort((left, right) => left.startMicroseconds - right.startMicroseconds);
  const startMarks = capture.clockMarks.filter(
    (mark) => mark.name === boundary.startMark,
  );
  const endMarks = capture.clockMarks.filter(
    (mark) => mark.name === boundary.endMark,
  );
  if (startMarks.length === 0 || endMarks.length === 0)
    throw new Error(`${capture.name} did not record both browser clock marks.`);

  const candidates = startMarks.flatMap((startMark) =>
    endMarks
      .filter((endMark) => endMark.documentId === startMark.documentId)
      .flatMap((endMark) =>
        markerEvents
          .filter(
            (event) =>
              event.mark === startMark.name &&
              event.markDocumentId === startMark.documentId,
          )
          .flatMap((startEvent) =>
            markerEvents
              .filter(
                (event) =>
                  event.mark === endMark.name &&
                  event.markDocumentId === endMark.documentId,
              )
              .flatMap((endEvent) => {
                const startMidpoint =
                  (startMark.beforeMarkPerformanceNowMs +
                    startMark.afterMarkPerformanceNowMs) /
                  2;
                const endMidpoint =
                  (endMark.beforeMarkPerformanceNowMs +
                    endMark.afterMarkPerformanceNowMs) /
                  2;
                const elapsedPerformanceMs = endMidpoint - startMidpoint;
                const elapsedTraceMicroseconds =
                  endEvent.startMicroseconds - startEvent.startMicroseconds;
                if (elapsedPerformanceMs <= 0 || elapsedTraceMicroseconds <= 0)
                  return [];
                const microsecondsPerMillisecond =
                  elapsedTraceMicroseconds / elapsedPerformanceMs;
                return [
                  {
                    startMark,
                    endMark,
                    startEvent,
                    endEvent,
                    startMidpoint,
                    endMidpoint,
                    microsecondsPerMillisecond,
                    score: Math.abs(microsecondsPerMillisecond - 1000),
                  },
                ];
              }),
          ),
      ),
  );
  if (candidates.length === 0)
    throw new Error(`${capture.name} did not emit both CDP clock marks.`);
  const pair = candidates.sort((left, right) => left.score - right.score)[0];
  if (!pair || Math.abs(pair.microsecondsPerMillisecond - 1000) > 5)
    throw new Error(
      `${capture.name} clock alignment was outside the monotonic-clock tolerance (scale=${pair?.microsecondsPerMillisecond ?? "none"}).`,
    );
  const offsetMicroseconds =
    pair.startEvent.startMicroseconds -
    pair.microsecondsPerMillisecond * pair.startMidpoint;
  const toTraceMicroseconds = (performanceNowMs: number) =>
    offsetMicroseconds + pair.microsecondsPerMillisecond * performanceNowMs;
  const markerUncertaintyMicroseconds = (mark: (typeof pair)["startMark"]) =>
    ((mark.afterMarkPerformanceNowMs - mark.beforeMarkPerformanceNowMs) / 2) *
      pair.microsecondsPerMillisecond +
    2;
  const elapsedPerformanceMs = pair.endMidpoint - pair.startMidpoint;
  const scaleUncertaintyMicrosecondsPerMillisecond =
    (pair.microsecondsPerMillisecond *
      ((pair.startMark.afterMarkPerformanceNowMs -
        pair.startMark.beforeMarkPerformanceNowMs +
        pair.endMark.afterMarkPerformanceNowMs -
        pair.endMark.beforeMarkPerformanceNowMs) /
        2)) /
    elapsedPerformanceMs;
  const extrapolationMs = Math.max(
    Math.abs(boundary.startPerformanceNowMs - pair.startMidpoint),
    Math.abs(boundary.endPerformanceNowMs - pair.endMidpoint),
  );
  const startTraceMicroseconds = toTraceMicroseconds(
    boundary.startPerformanceNowMs,
  );
  const endTraceMicroseconds = toTraceMicroseconds(
    boundary.endPerformanceNowMs,
  );
  const uncertaintyMicroseconds =
    Math.max(
      markerUncertaintyMicroseconds(pair.startMark),
      markerUncertaintyMicroseconds(pair.endMark),
    ) +
    extrapolationMs * scaleUncertaintyMicrosecondsPerMillisecond;
  if (endTraceMicroseconds <= startTraceMicroseconds)
    throw new Error(`${capture.name} had an empty or inverted paint interval.`);
  return {
    boundary,
    documentId: pair.startMark.documentId,
    transform: {
      from: "window.performance.now() milliseconds",
      to: "CDP trace monotonic microseconds",
      microsecondsPerMillisecond: pair.microsecondsPerMillisecond,
      scaleUncertaintyMicrosecondsPerMillisecond,
      extrapolationMilliseconds: extrapolationMs,
      offsetMicroseconds,
      uncertaintyMicroseconds,
      measuredAgainstMarkers: [
        {
          name: boundary.startMark,
          documentId: pair.startMark.documentId,
          performanceNowBeforeMarkMs: pair.startMark.beforeMarkPerformanceNowMs,
          performanceNowAfterMarkMs: pair.startMark.afterMarkPerformanceNowMs,
          traceTimestampMicroseconds: pair.startEvent.startMicroseconds,
        },
        {
          name: boundary.endMark,
          documentId: pair.endMark.documentId,
          performanceNowBeforeMarkMs: pair.endMark.beforeMarkPerformanceNowMs,
          performanceNowAfterMarkMs: pair.endMark.afterMarkPerformanceNowMs,
          traceTimestampMicroseconds: pair.endEvent.startMicroseconds,
        },
      ],
    },
    startTraceMicroseconds,
    endTraceMicroseconds,
  };
}

function clipTimelineEvents(
  events: BrowserTimelineEvent[],
  startTraceMicroseconds: number,
  endTraceMicroseconds: number,
) {
  return events.flatMap((event) => {
    const duration = event.durationMicroseconds ?? 0;
    const eventEnd = event.startMicroseconds + duration;
    const start = Math.max(event.startMicroseconds, startTraceMicroseconds);
    const end = Math.min(eventEnd, endTraceMicroseconds);
    if (duration > 0 && end <= start) return [];
    if (
      duration === 0 &&
      (event.startMicroseconds < startTraceMicroseconds ||
        event.startMicroseconds > endTraceMicroseconds)
    )
      return [];
    return [
      {
        ...event,
        startMicroseconds: start,
        ...(duration > 0 ? { durationMicroseconds: end - start } : {}),
      },
    ];
  });
}

function sanitizeCpuProfile(
  profile: CpuProfile,
  startMicroseconds?: number,
  endMicroseconds?: number,
) {
  if (profile.nodes.size > 5_000 || profile.samples.length > 100_000)
    return undefined;
  const samples = profile.samples.flatMap((sample) => {
    const start = startMicroseconds ?? Number.NEGATIVE_INFINITY;
    const end = endMicroseconds ?? Number.POSITIVE_INFINITY;
    const clippedStart = Math.max(sample.start, start);
    const clippedEnd = Math.min(sample.start + sample.duration, end);
    return clippedEnd > clippedStart
      ? [
          {
            nodeId: sample.nodeId,
            startMicroseconds: clippedStart,
            durationMicroseconds: clippedEnd - clippedStart,
          },
        ]
      : [];
  });
  if (samples.length === 0) return undefined;
  const nodes = [...profile.nodes.values()].map((node) => {
    let asset = "runtime";
    try {
      const frameUrl = new URL(node.callFrame?.url ?? "", ORIGIN);
      const basename = path.posix.basename(frameUrl.pathname);
      asset =
        frameUrl.origin === ORIGIN &&
        frameUrl.pathname.startsWith("/assets/") &&
        /^[A-Za-z0-9_.-]{1,128}\.js$/.test(basename)
          ? basename
          : "non-asset";
    } catch {
      asset = "non-asset";
    }
    return {
      id: node.id,
      ...(Number.isSafeInteger(node.parent) && (node.parent ?? -1) >= 0
        ? { parentId: node.parent }
        : {}),
      asset,
      line: (node.callFrame?.lineNumber ?? -1) + 1,
      column: (node.callFrame?.columnNumber ?? -1) + 1,
    };
  });
  return {
    nodes,
    samples,
  };
}

async function getBuildIdentity(profileAssetNames: Set<string>) {
  const manifestPath = path.join(
    ROOT,
    "apps/web/dist/agent/.vite/manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    { file?: string; imports?: string[]; isEntry?: boolean; src?: string }
  >;
  const entry = Object.entries(manifest).find(
    ([key, value]) =>
      value.isEntry && (key === "index.html" || value.src === "index.html"),
  );
  if (!entry)
    throw new Error(
      "The emitted agent entry was absent from the Vite manifest.",
    );

  const reachable = new Set<string>();
  const visit = (key: string) => {
    if (reachable.has(key)) return;
    reachable.add(key);
    for (const dependency of manifest[key]?.imports ?? []) visit(dependency);
  };
  visit(entry[0]);

  const initialFiles = new Set(
    [...reachable]
      .map((key) => manifest[key]?.file)
      .filter((file): file is string => file !== undefined),
  );
  const profileFiles = new Set(
    Object.values(manifest)
      .map((item) => item.file)
      .filter(
        (file): file is string =>
          file !== undefined &&
          profileAssetNames.has(path.posix.basename(file)),
      ),
  );
  const relevantFiles = new Set([...initialFiles, ...profileFiles]);
  const assets = await Promise.all(
    [...relevantFiles].flatMap((file) => {
      const assetPath = path.join(ROOT, "apps/web/dist/agent", file);
      return [
        (async () => ({
          file,
          sha256: digest(await readFile(assetPath)),
        }))(),
      ];
    }),
  );
  const sourceMaps = new Map<string, BoundProfileSourceMap>();
  const profiledAssets: DiagnosticBuildIdentity["profiledAssets"] = [];
  const identitiesByAsset = new Map<string, ProfiledAssetIdentity>();
  for (const asset of assets.filter((entry) => profileFiles.has(entry.file))) {
    const basename = path.posix.basename(asset.file);
    if (!asset.file.endsWith(".js")) {
      profiledAssets.push({ ...asset, sourceMapStatus: "missing" });
      continue;
    }
    let mapBytes: Buffer;
    try {
      const mapPath = path.join(
        ROOT,
        "apps/web/dist/agent",
        `${asset.file}.map`,
      );
      const mapStats = await stat(mapPath);
      if (mapStats.size > 5 * 1024 * 1024) {
        profiledAssets.push({ ...asset, sourceMapStatus: "invalid" });
        continue;
      }
      mapBytes = await readFile(mapPath);
    } catch {
      profiledAssets.push({ ...asset, sourceMapStatus: "missing" });
      continue;
    }
    const sourceMapSha256 = digest(mapBytes);
    const mapText = mapBytes.toString("utf8");
    let mapFile: string | undefined;
    try {
      const parsed = JSON.parse(mapText) as { file?: unknown };
      if (typeof parsed.file === "string") mapFile = parsed.file;
    } catch {
      // The parser below rejects malformed maps; retain only its fixed status.
    }
    if (mapFile !== undefined && mapFile !== basename) {
      profiledAssets.push({
        ...asset,
        sourceMapSha256,
        sourceMapStatus: "asset-mismatch",
      });
      continue;
    }
    const sourceMap = parseProfileSourceMap(mapText, basename);
    if (!sourceMap) {
      profiledAssets.push({
        ...asset,
        sourceMapSha256,
        sourceMapStatus: "invalid",
      });
      continue;
    }
    profiledAssets.push({
      ...asset,
      sourceMapSha256,
      sourceMapStatus: "matched",
    });
    sourceMaps.set(basename, {
      sha256: sourceMapSha256,
      parsed: sourceMap,
    });
    identitiesByAsset.set(basename, {
      ...asset,
      sourceMapSha256,
    });
  }
  const sourcePaths = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps/web",
      "packages/ui",
      "packages/libs",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  const sourceTreeHash = createHash("sha256");
  for (const sourcePath of sourcePaths) {
    sourceTreeHash.update(sourcePath).update("\0");
    sourceTreeHash.update(await readFile(path.join(ROOT, sourcePath)));
    sourceTreeHash.update("\0");
  }
  const workingTreeChanges = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      "apps/web",
      "packages/ui",
      "packages/libs",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  const identity: DiagnosticBuildIdentity = {
    sourceCommitSha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    sourceTreeSha256: sourceTreeHash.digest("hex"),
    sourceTreeFileCount: sourcePaths.length,
    workingTreeChanges,
    manifestSha256: digest(await readFile(manifestPath)),
    canonicalFixtureSha256: digest(
      await readFile(
        path.join(ROOT, "apps/web/e2e/helpers/g11-performance-fixture.ts"),
      ),
    ),
    initialAssets: assets.filter((asset) => initialFiles.has(asset.file)),
    profiledAssets,
  };
  return { identity, identitiesByAsset, sourceMaps };
}

async function collectDocumentMetrics(
  page: Page,
): Promise<InitialDocumentMetrics> {
  return page.evaluate((origin) => {
    const lcp = window.__g11InitialDiagnostic?.lcp;
    const heading = document.querySelector("h1");
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      lcp: lcp
        ? {
            ...lcp,
            url: "",
          }
        : null,
      heading: {
        found: Boolean(heading?.getClientRects().length),
        tag: heading?.tagName.toLowerCase() ?? null,
        textLength: heading?.textContent?.trim().length ?? 0,
      },
      navigation: navigation
        ? {
            responseStart: navigation.responseStart,
            domInteractive: navigation.domInteractive,
            load: navigation.loadEventEnd,
          }
        : null,
      resources: performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .filter((entry) => entry.name.startsWith(`${origin}/`))
        .map((entry) => ({
          kind: entry.initiatorType,
          asset: new URL(entry.name).pathname.split("/").at(-1) ?? "",
          start: entry.startTime,
          responseStart: entry.responseStart,
          end: entry.responseEnd,
          transferBytes: entry.transferSize,
        }))
        .sort((left, right) => left.start - right.start),
      longTasks: window.__g11InitialDiagnostic?.longTasks ?? [],
    };
  }, ORIGIN);
}

type DiagnosticCapture = {
  name: string;
  metrics: InitialDocumentMetrics;
  network: ReturnType<typeof JSON.parse>;
  browserPerformance: {
    metrics: Record<string, number>;
    timelineEvents: BrowserTimelineEvent[];
  };
  cpuProfiles: CpuProfile[];
  cpuProfileCaptureStatus: CpuProfileCaptureStatus;
  clockMarks: Array<{
    name: string;
    documentId: string;
    boundaryPerformanceNowMs: number;
    beforeMarkPerformanceNowMs: number;
    afterMarkPerformanceNowMs: number;
  }>;
  boundary: DiagnosticBoundary;
};

type DiagnosticBoundary = {
  startMark: string;
  endMark: string;
  startPerformanceNowMs: number;
  endPerformanceNowMs: number;
  source: string;
} | null;

async function withDiagnosticProfile(
  browser: import("@playwright/test").Browser,
  name: string,
  throttled: boolean,
  prepare: (page: Page) => Promise<void>,
  visit: (page: Page) => Promise<DiagnosticBoundary>,
): Promise<DiagnosticCapture> {
  const context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const networkCapture = attachPerformanceNetworkCapture(context, ORIGIN, {
    maxRequests: 512,
    maxAttachmentBytes: 128 * 1024,
  });
  const cdp = await context.newCDPSession(page);
  let boundary: DiagnosticBoundary | undefined;
  let metrics: InitialDocumentMetrics | undefined;
  let browserPerformance: DiagnosticCapture["browserPerformance"] | undefined;
  let cpuProfiles: CpuProfile[] = [];
  const timelineEvents: BrowserTimelineEvent[] = [];
  const cpuProfileAccumulator = createCpuProfileAccumulator();
  let clockMarks: DiagnosticCapture["clockMarks"] = [];
  let timelineOverflow = false;
  cdp.on("Tracing.dataCollected", ({ value }) => {
    for (const event of value ?? []) {
      if (event.name === "ProfileChunk") {
        const data = (
          event.args as { data?: Record<string, unknown> } | undefined
        )?.data;
        const profileChunk = data?.cpuProfile as
          | { nodes?: CpuProfileNode[]; samples?: number[] }
          | undefined;
        const timeDeltas = data?.timeDeltas as number[] | undefined;
        const rawSource = data?.source;
        const source =
          typeof rawSource === "string" &&
          rawSource.length <= 64 &&
          /^[A-Za-z0-9_.:-]+$/.test(rawSource)
            ? rawSource
            : "invalid-source";
        const rawPid = Number(event.pid);
        const rawTid = Number(event.tid);
        const pid = Number.isSafeInteger(rawPid) && rawPid >= 0 ? rawPid : 0;
        const tid = Number.isSafeInteger(rawTid) && rawTid >= 0 ? rawTid : 0;
        const rawId = event.id ?? "profile";
        const id =
          (typeof rawId === "string" || typeof rawId === "number") &&
          String(rawId).length <= 64 &&
          /^[A-Za-z0-9_.:-]+$/.test(String(rawId))
            ? String(rawId)
            : "invalid-id";
        const key = `${pid}:${tid}:${source}:${id}`;
        const nodes = Array.isArray(profileChunk?.nodes)
          ? profileChunk.nodes
          : [];
        const sampleIds = Array.isArray(profileChunk?.samples)
          ? profileChunk.samples
          : [];
        const deltas = Array.isArray(timeDeltas) ? timeDeltas : [];
        accumulateCpuProfileChunk(cpuProfileAccumulator, {
          key:
            source === "invalid-source" || id === "invalid-id"
              ? `invalid profile key ${pid}:${tid}`
              : key,
          id,
          source,
          pid,
          tid,
          timestamp: Number(event.ts),
          nodes,
          sampleIds,
          timeDeltas: deltas,
          malformed:
            !profileChunk ||
            !Array.isArray(profileChunk.nodes) ||
            !Array.isArray(profileChunk.samples) ||
            !Array.isArray(timeDeltas),
        });
      }
      const sanitized = sanitizeTimelineEvent(event);
      if (!sanitized) continue;
      if (timelineEvents.length >= 20_000) {
        timelineOverflow = true;
        continue;
      }
      timelineEvents.push(sanitized);
    }
  });
  await installPerformanceApiFixture(page);
  await page.addInitScript(() => {
    const allowedMarks = new Set([
      "document-start",
      "initial-lcp",
      "state-start",
      "state-paint",
      "assignment-start",
      "assignment-paint",
      "board-paint",
    ]);
    const marks: Array<{
      name: string;
      documentId: string;
      boundaryPerformanceNowMs: number;
      beforeMarkPerformanceNowMs: number;
      afterMarkPerformanceNowMs: number;
    }> = [];
    const documentId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const mark = (name: string, boundaryPerformanceNowMs: number) => {
      if (!allowedMarks.has(name) || !Number.isFinite(boundaryPerformanceNowMs))
        return;
      const beforeMarkPerformanceNowMs = performance.now();
      console.timeStamp(`g11-diagnostic:${documentId}:${name}`);
      const afterMarkPerformanceNowMs = performance.now();
      marks.push({
        name,
        documentId,
        boundaryPerformanceNowMs,
        beforeMarkPerformanceNowMs,
        afterMarkPerformanceNowMs,
      });
    };
    (
      window as Window & { __g11DiagnosticClockMarks?: typeof marks }
    ).__g11DiagnosticClockMarks = marks;
    const metrics = (
      window as Window & {
        __g11Metrics?: Record<string, number>;
      }
    ).__g11Metrics;
    if (metrics) {
      mark("document-start", metrics.documentStart);
      for (const [key, startKey, suffix] of [
        ["stateStart", "", "state-start"],
        ["statePaint", "stateStart", "state-paint"],
        ["assignmentStart", "", "assignment-start"],
        ["assignmentPaint", "assignmentStart", "assignment-paint"],
        ["boardPaint", "documentStart", "board-paint"],
      ] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(metrics, key);
        if (!descriptor || !("value" in descriptor))
          throw new Error(
            `The canonical ${key} recorder field is unavailable.`,
          );
        let current = descriptor.value;
        Object.defineProperty(metrics, key, {
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          get: () => current,
          set: (next: number) => {
            current = next;
            if (typeof next !== "number" || next <= 0) return;
            const boundaryValue = startKey ? metrics[startKey] + next : next;
            mark(suffix, boundaryValue);
          },
        });
      }
    }
    const state = {
      lcp: null as {
        startTime: number;
        element: string;
        textLength: number;
      } | null,
      longTasks: [] as Array<{ start: number; duration: number }>,
    };
    window.__g11InitialDiagnostic = state;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const candidate = entry as PerformanceEntry & {
          element?: Element | null;
        };
        state.lcp = {
          startTime: candidate.startTime,
          element: candidate.element?.tagName.toLowerCase() ?? "no-element",
          textLength: candidate.element?.textContent?.trim().length ?? 0,
        };
        mark("initial-lcp", candidate.startTime);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          state.longTasks.push({
            start: entry.startTime,
            duration: entry.duration,
          });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task observation is browser-dependent; CPUProfile and LCP remain required.
    }
  });

  try {
    if (throttled) {
      // Keep this aligned with installFast4gAndCpuThrottle in the canonical G11 suite.
      await page.goto("about:blank");
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 200_000,
        uploadThroughput: 93_750,
        connectionType: "cellular4g",
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await prepare(page);
    await cdp.send("Performance.enable");
    const beforeMetrics = await performanceMetricSnapshot(cdp);
    await cdp.send("Tracing.start", {
      categories:
        "devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler",
      options: "record-as-much-as-possible",
    });
    console.info(`G11 diagnostic phase started: ${name}`);
    boundary = await visit(page);
    clockMarks = await page.evaluate(
      () =>
        (
          window as Window & {
            __g11DiagnosticClockMarks?: DiagnosticCapture["clockMarks"];
          }
        ).__g11DiagnosticClockMarks ?? [],
    );
    const afterMetrics = await performanceMetricSnapshot(cdp);
    const tracingComplete = new Promise<void>((resolve) =>
      cdp.once("Tracing.tracingComplete", () => resolve()),
    );
    await cdp.send("Tracing.end");
    await tracingComplete;
    finalizeCpuProfileCapture(cpuProfileAccumulator);
    cpuProfiles = [...cpuProfileAccumulator.profiles.values()].filter(
      (profile) => !profile.omissionReason,
    );
    if (timelineOverflow)
      throw new Error(`The ${name} browser timeline exceeded its event bound.`);
    browserPerformance = {
      metrics: metricDeltas(beforeMetrics, afterMetrics),
      timelineEvents,
    };
    metrics = await collectDocumentMetrics(page);
    console.info(`G11 diagnostic phase completed: ${name}`);
  } finally {
    await cdp.detach();
    await context.close();
  }
  if (!metrics || !browserPerformance)
    throw new Error(`The ${name} diagnostic profile did not finish.`);
  if (boundary) {
    const markCount = clockMarks.filter(
      (mark) => mark.name === boundary?.startMark,
    ).length;
    if (markCount === 0)
      throw new Error(`The ${name} start clock marker was not captured.`);
  }
  return {
    name,
    metrics,
    network: JSON.parse(networkCapture.finish()),
    browserPerformance,
    cpuProfiles,
    cpuProfileCaptureStatus: finalizeCpuProfileCapture(cpuProfileAccumulator),
    clockMarks,
    boundary,
  };
}

async function visitInitialWorkList(page: Page) {
  await page.goto(WORK_LIST_PATH, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await expect(page.locator("h1")).toBeVisible();
  await page.waitForFunction(
    () => Boolean(window.__g11InitialDiagnostic?.lcp),
    undefined,
    { timeout: 45_000 },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  return page.evaluate(() => {
    const metrics = (
      window as Window & {
        __g11Metrics?: { documentStart: number };
      }
    ).__g11Metrics;
    const lcp = window.__g11InitialDiagnostic?.lcp;
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (!metrics || !lcp || !navigation)
      throw new Error("The initial navigation paint boundary is incomplete.");
    return {
      startMark: "document-start",
      endMark: "initial-lcp",
      startPerformanceNowMs: navigation.startTime,
      endPerformanceNowMs: lcp.startTime,
      source: "navigation startTime through the observed real LCP entry",
    };
  });
}

async function prepareTaskState(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
    { waitUntil: "domcontentloaded" },
  );
  await page.getByRole("button", { name: "Backlog", exact: true }).waitFor({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Backlog", exact: true }).click();
}

async function visitTaskState(page: Page) {
  await page
    .getByRole("button", { name: /^In progress/ })
    .last()
    .click();
  await expect(
    page.locator('[data-slot="popover-trigger"]:visible').filter({
      hasText: "In progress",
    }),
  ).toBeVisible();
  return page.evaluate(() => {
    const metrics = (
      window as Window & {
        __g11Metrics?: { stateStart: number; statePaint: number };
      }
    ).__g11Metrics;
    if (!metrics || metrics.stateStart <= 0 || metrics.statePaint <= 0)
      throw new Error("The canonical state paint boundary is incomplete.");
    return {
      startMark: "state-start",
      endMark: "state-paint",
      startPerformanceNowMs: metrics.stateStart,
      endPerformanceNowMs: metrics.stateStart + metrics.statePaint,
      source: "canonical stateStart and statePaint recorder fields (ms)",
    };
  });
}

async function prepareTaskAssignment(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
    { waitUntil: "domcontentloaded" },
  );
  await page
    .getByRole("button", { name: /Unassigned/ })
    .last()
    .click({ timeout: 30_000 });
}

async function visitTaskAssignment(page: Page) {
  await page
    .getByRole("button", { name: /G11 Agent/ })
    .last()
    .click({ timeout: 30_000 });
  await expect(
    page.locator('[data-slot="popover-trigger"]:visible').filter({
      hasText: "G11 Agent",
    }),
  ).toBeVisible();
  return page.evaluate(() => {
    const metrics = (
      window as Window & {
        __g11Metrics?: { assignmentStart: number; assignmentPaint: number };
      }
    ).__g11Metrics;
    if (
      !metrics ||
      metrics.assignmentStart <= 0 ||
      metrics.assignmentPaint <= 0
    )
      throw new Error("The canonical assignment paint boundary is incomplete.");
    return {
      startMark: "assignment-start",
      endMark: "assignment-paint",
      startPerformanceNowMs: metrics.assignmentStart,
      endPerformanceNowMs: metrics.assignmentStart + metrics.assignmentPaint,
      source:
        "canonical assignmentStart and assignmentPaint recorder fields (ms)",
    };
  });
}

async function visitBoard(page: Page) {
  await installLastItemPaintRecorder(page, {
    kind: "board",
    expectedCount: 200,
    metric: "boardPaint",
  });
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(
    200,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () =>
      (window as Window & { __g11Metrics?: { boardPaint: number } })
        .__g11Metrics?.boardPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  return page.evaluate(() => {
    const metrics = (
      window as Window & {
        __g11Metrics?: { documentStart: number; boardPaint: number };
      }
    ).__g11Metrics;
    if (!metrics || metrics.documentStart <= 0 || metrics.boardPaint <= 0)
      throw new Error(
        "The canonical 200-card board paint boundary is incomplete.",
      );
    return {
      startMark: "document-start",
      endMark: "board-paint",
      startPerformanceNowMs: metrics.documentStart,
      endPerformanceNowMs: metrics.boardPaint,
      source: "canonical documentStart through boardPaint recorder fields (ms)",
    };
  });
}

async function visitBoardTaskDetailsSheet(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
    { waitUntil: "domcontentloaded" },
  );
  const firstTaskCard = page.locator('[data-task-id^="legacy-task-"]').first();
  await expect(firstTaskCard).toBeVisible({ timeout: 30_000 });
  const taskId = await firstTaskCard.getAttribute("data-task-id");
  if (!taskId) throw new Error("The first board card had no task identity.");

  await firstTaskCard.click();
  await expect(page).toHaveURL(new RegExp(`[?&]taskId=${taskId}(?:&|$)`));
  await expect(
    page.locator('.taskdesk-tiptap-prose[contenteditable="true"]'),
  ).toBeVisible({
    timeout: 30_000,
  });

  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/[?&]taskId=/);
  await expect(
    page.locator('.taskdesk-tiptap-prose[contenteditable="true"]'),
  ).toHaveCount(0);
  await page.keyboard.press("?");
  const helpDialog = page.getByRole("dialog");
  await expect(helpDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(helpDialog).toHaveCount(0);
  return null;
}

test("diagnostic: source-bound G11 failure-path CPU profiles", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const captures = [
    await withDiagnosticProfile(
      browser,
      "initial work-list navigation to LCP",
      true,
      async () => {},
      visitInitialWorkList,
    ),
    await withDiagnosticProfile(
      browser,
      "task-state option selection click-to-paint",
      true,
      prepareTaskState,
      visitTaskState,
    ),
    await withDiagnosticProfile(
      browser,
      "task-assignment option selection click-to-paint",
      true,
      prepareTaskAssignment,
      visitTaskAssignment,
    ),
    await withDiagnosticProfile(
      browser,
      "board navigation to all 200 cards rendered",
      false,
      async () => {},
      visitBoard,
    ),
    await withDiagnosticProfile(
      browser,
      "board task selection opens editor and Escape closes sheet",
      false,
      async () => {},
      visitBoardTaskDetailsSheet,
    ),
  ];
  const profileAssetNames = new Set(
    captures.flatMap(({ cpuProfiles }) => [
      ...cpuProfiles.flatMap((cpuProfile) =>
        [...cpuProfile.nodes.values()]
          .map((node) => node.callFrame?.url)
          .filter(
            (url): url is string =>
              typeof url === "string" && url.startsWith(`${ORIGIN}/assets/`),
          )
          .map(safeAssetName),
      ),
    ]),
  );
  const build = await getBuildIdentity(profileAssetNames);
  const sampledAttributions = (
    profiles: ReturnType<typeof sanitizeCpuProfile>[],
  ) =>
    profiles
      .filter((profile) => profile !== undefined)
      .flatMap((profile) =>
        sampleProfileCallers(
          profile.nodes,
          profile.samples,
          build.identitiesByAsset,
          build.sourceMaps,
        ),
      )
      .sort(
        (left, right) => right.sampledMicroseconds - left.sampledMicroseconds,
      )
      .slice(0, 60);
  const profileWindows = captures.map((capture) => {
    const { name, browserPerformance } = capture;
    const alignment = alignBoundaryToTrace(capture);
    if (!alignment)
      return {
        name,
        cpuProfileCaptureStatus: capture.cpuProfileCaptureStatus,
        scope: "supplementary full-window context; no canonical G11 metric",
        recorderBoundary: null,
        clockAlignment: null,
        topCpuFrames: sampledAttributions(
          capture.cpuProfiles
            .map((cpuProfile) => sanitizeCpuProfile(cpuProfile))
            .filter((value) => value !== undefined),
        ),
        cpuProfiles: capture.cpuProfiles
          .map((cpuProfile) => sanitizeCpuProfile(cpuProfile))
          .filter((value) => value !== undefined),
        timelineEvents: browserPerformance.timelineEvents,
        wholeWindowPerformanceMetrics: {
          scope:
            "context-only cumulative deltas; not a click-to-paint interval",
          values: browserPerformance.metrics,
        },
      };

    const clippedCpuProfiles = capture.cpuProfiles
      .map((cpuProfile) =>
        sanitizeCpuProfile(
          cpuProfile,
          alignment.startTraceMicroseconds,
          alignment.endTraceMicroseconds,
        ),
      )
      .filter((value) => value !== undefined);
    const clippedTimeline = clipTimelineEvents(
      browserPerformance.timelineEvents,
      alignment.startTraceMicroseconds,
      alignment.endTraceMicroseconds,
    );
    const clippedSamples = clippedCpuProfiles.flatMap((cpuProfile) =>
      cpuProfile.samples.map((sample) => ({
        start: sample.startMicroseconds,
        end: sample.startMicroseconds + sample.durationMicroseconds,
      })),
    );
    const cpuCoverage = summarizeProfileCoverage(
      clippedSamples,
      alignment.startTraceMicroseconds,
      alignment.endTraceMicroseconds,
    );
    return {
      name,
      cpuProfileCaptureStatus: capture.cpuProfileCaptureStatus,
      documentId: alignment.documentId,
      scope: "canonical recorder boundary",
      recorderBoundary: alignment.boundary,
      clockAlignment: {
        ...alignment.transform,
        calibratedStartTraceMicroseconds: alignment.startTraceMicroseconds,
        calibratedEndTraceMicroseconds: alignment.endTraceMicroseconds,
        v8TraceProfileCount: capture.cpuProfiles.length,
      },
      cpuSampleCoverage: {
        scope:
          "observed V8 trace ProfileChunk samples; not a completeness guarantee",
        intervalStartMicroseconds: alignment.startTraceMicroseconds,
        intervalEndMicroseconds: alignment.endTraceMicroseconds,
        observedStartMicroseconds: cpuCoverage.observedStart,
        observedEndMicroseconds: cpuCoverage.observedEnd,
        uncoveredPrefixMicroseconds: cpuCoverage.uncoveredPrefix,
        uncoveredSuffixMicroseconds: cpuCoverage.uncoveredSuffix,
        unionCoverageMicroseconds: cpuCoverage.unionCoverage,
        clockAlignmentUncertaintyMicroseconds:
          alignment.transform.uncertaintyMicroseconds,
      },
      topCpuFrames: sampledAttributions(clippedCpuProfiles),
      cpuProfiles: clippedCpuProfiles,
      timelineEvents: clippedTimeline,
      wholeWindowPerformanceMetrics: {
        scope: "context-only cumulative deltas; not a click-to-paint interval",
        values: browserPerformance.metrics,
      },
    };
  });
  const initial = captures[0];
  const result = {
    schemaVersion: 5,
    diagnosticOnly: true,
    fixture:
      "canonical G11 installPerformanceApiFixture (500 work items, 200 board cards)",
    sourceAndBuild: build.identity,
    profileModes: {
      lcpStateAssignment: "150ms latency, 200KB/s down, 93.75KB/s up, 4x CPU",
      boardRender:
        "unthrottled, matching canonical G11 board-render measurement",
    },
    attributionMethod: {
      browserClock: "window.performance.now() milliseconds",
      traceClock: "CDP trace monotonic microseconds",
      transform:
        "Two diagnostic CDP TimeStamp markers on the same document, measured around window.performance.now(); affine scale and offset map canonical recorder values to trace time. Uncertainty includes marker-call brackets plus measured slope uncertainty propagated across extrapolated distance.",
      cpuProfileClock:
        "V8 trace ProfileChunk sample intervals use each chunk's CDP trace timestamp and timeDeltas, then are clipped to the calibrated recorder span. Coverage reports observed sample bounds and uncovered prefixes/suffixes; gaps remain gaps.",
      sourceMapBinding:
        "A source-map index is used only when its adjacent map parses as version 3, its optional file name matches the profiled asset basename, and the JavaScript asset is present in the emitted Vite manifest. The artifact stores exact JavaScript and map SHA-256 plus numeric source/name indexes and original coordinates; it never stores source paths, source contents, or source-map names.",
      callerAttribution:
        "V8 trace ProfileChunk parent node ids are reduced to a unique acyclic caller chain of at most eight frames. The output is limited to the top 60 sampled frames and 5,000 nodes / 100,000 samples per profile. Cyclic, missing, or unbound caller/source-map edges are omitted.",
      contextMetrics:
        "Performance.getMetrics is cumulative over each entire profiler window and is reported as context only; it is not clipped or described as interval data.",
      sensitiveData:
        "Only fixed diagnostic marker labels, generated asset basenames, bounded node ids, numeric source-map indexes/coordinates bound to recorded map digests, event names, and timestamps are retained. Function labels and raw trace args, DOM, network payloads, source-map strings/contents, local paths, URLs, and auth values are excluded.",
    },
    route: WORK_LIST_PATH,
    profileWindows,
    initialDocument: initial.metrics,
    networkByWindow: captures.map(({ name, network }) => ({ name, network })),
  };
  await mkdir(RESULT_DIR, { recursive: true });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(
    path.join(RESULT_DIR, "initial-page-profile.json"),
    serialized,
    { mode: 0o600 },
  );
  await test.info().attach("g11-initial-page-profile.json", {
    body: serialized,
    contentType: "application/json",
  });
  expect(
    initial.metrics.lcp,
    "The real page LCP entry must be observed.",
  ).not.toBeNull();
  expect(
    initial.metrics.heading.found,
    "The real work-list heading must be visible.",
  ).toBe(true);
  expect(profileWindows).toHaveLength(5);
  expect(
    profileWindows.every((window) => window.topCpuFrames.length > 0),
    "Each hosted failure class must include sampled app JavaScript frames.",
  ).toBe(true);
  expect(
    captures.every(
      ({ network }) => !network.truncated && network.droppedCount === 0,
    ),
    "The diagnostic must retain all observed requests without truncation.",
  ).toBe(true);
});
