import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, release as osRelease } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { summarizeProfileCoverage } from "../src/lib/performance-profile-intervals";
import {
  anchorTraceProfile,
  type TraceProfileClock,
  timeTraceProfileChunk,
  traceProfileKey,
} from "../src/lib/performance-trace-profile-clock";
import {
  aggregateCpuProfileFrames,
  sanitizeCpuProfileNodes,
} from "./helpers/aggregate-cpu-profile";
import {
  installPerformanceApiFixture,
  PERFORMANCE_BASE_URL,
  PROJECT_ID,
  WORK_LIST_PATH,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";
import { installLastItemPaintRecorder } from "./helpers/last-item-paint-recorder";
import { attachPerformanceNetworkCapture } from "./helpers/performance-network-summary";
import {
  aggregateDiagnosticCapturesWithFailureReceipt,
  type DiagnosticCaptureArtifact,
  persistDiagnosticCapturesBestEffort,
} from "./helpers/persist-diagnostic-capture-artifact.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ORIGIN = PERFORMANCE_BASE_URL;
const RESULT_DIR = path.join(
  ROOT,
  "apps/web/test-results/g11-initial-page-diagnostic",
);
const RAW_CAPTURE_DIR = path.join(RESULT_DIR, "raw-captures");

type TraceCpuNode = {
  id: number;
  parent?: number;
  children?: number[];
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
};

type TraceCpuProfile = {
  id: string;
  source: string;
  pid: number;
  tid: number;
  nodes: Map<number, TraceCpuNode>;
  samples: Array<{ nodeId: number; start: number; duration: number }>;
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
  stack?: Array<{
    functionName: string;
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
  "BeginFrame",
  "BeginMainThreadFrame",
  "DrawFrame",
  "FrameStarted",
  "Commit",
  "SubmitCompositorFrame",
  "TimeStamp",
  "UserTiming",
]);

const FOCUSED_DRAG_TIMELINE_EVENT_NAMES = new Set([
  "UpdateLayoutTree",
  "RecalculateStyles",
  "Layout",
  "PrePaint",
  "Paint",
  "CompositeLayers",
  "EventDispatch",
  "BeginFrame",
  "BeginMainThreadFrame",
  "DrawFrame",
  "FrameStarted",
  "Commit",
  "SubmitCompositorFrame",
]);

const CLOCK_MARKS = new Set([
  "document-start",
  "initial-lcp",
  "state-start",
  "state-paint",
  "assignment-start",
  "assignment-paint",
  "board-paint",
  "board-drag-start",
  "board-drag-end",
  "board-drag-frame-window-start",
  "board-drag-frame-window-end",
]);

function safeTimelineAsset(value: string) {
  try {
    const parsed = new URL(value, ORIGIN);
    return parsed.origin === ORIGIN && parsed.pathname.startsWith("/assets/")
      ? path.posix.basename(parsed.pathname)
      : "non-asset";
  } catch {
    return "non-asset";
  }
}

function sanitizeTimelineEvent(
  event: RawTimelineEvent,
  allowedEventNames: ReadonlySet<string> = TIMELINE_EVENT_NAMES,
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
  if (!mark && !allowedEventNames.has(event.name)) return undefined;
  const callFrames = data?.stackTrace?.callFrames;
  const stack = Array.isArray(callFrames)
    ? callFrames.slice(0, 12).map((frame) => ({
        functionName: String(frame.functionName ?? "(anonymous)").slice(0, 120),
        asset: safeTimelineAsset(String(frame.url ?? "")),
        line: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : 0,
        column: Number.isFinite(frame.columnNumber)
          ? frame.columnNumber + 1
          : 0,
      }))
    : undefined;
  return {
    name: event.name,
    category: String(event.cat ?? "").slice(0, 120),
    phase: String(event.ph ?? ""),
    startMicroseconds: Number(event.ts) || 0,
    ...(Number.isFinite(event.dur) ? { durationMicroseconds: event.dur } : {}),
    ...(mark ? { mark } : {}),
    ...(markDocumentId ? { markDocumentId } : {}),
    ...(stack?.length ? { stack } : {}),
    ...(data?.url || data?.scriptName
      ? {
          source: {
            asset: safeTimelineAsset(data.url ?? data.scriptName ?? ""),
            line: Number.isFinite(data.lineNumber)
              ? (data.lineNumber ?? 0) + 1
              : 0,
          },
        }
      : {}),
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
    __g11DiagnosticMark?: (
      name: string,
      boundaryPerformanceNowMs: number,
    ) => void;
    __g11BoardDragProfile?: {
      active: boolean;
      finished: boolean;
      frameTimestamps: number[];
      frameWindow?: {
        startMark: string;
        endMark: string;
        startPerformanceNowMs: number;
        endPerformanceNowMs?: number;
        frameTimestamps: number[];
      };
      pointerFrameTimestamps: number[];
      startPerformanceNowMs?: number;
      endPerformanceNowMs?: number;
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

function inclusiveTraceFrames(
  profiles: ReturnType<typeof sanitizeTraceCpuProfile>[],
) {
  return aggregateCpuProfileFrames(
    profiles.filter((profile) => profile !== undefined),
  );
}

function selectUniqueDirectCpuProfile(profiles: TraceCpuProfile[]) {
  const candidates = profiles.filter(
    (profile) =>
      profile.source === "direct-cdp-profiler" ||
      profile.id === "direct-cdp-profiler",
  );
  if (
    candidates.length !== 1 ||
    candidates[0]?.source !== "direct-cdp-profiler" ||
    candidates[0]?.id !== "direct-cdp-profiler"
  )
    throw new Error(
      `Expected exactly one valid direct CDP CPU profile; found ${candidates.length}.`,
    );
  const selected = candidates[0];
  if (
    selected.nodes.size === 0 ||
    selected.samples.length === 0 ||
    selected.samples.some(
      (sample) =>
        !Number.isFinite(sample.start) ||
        !Number.isFinite(sample.duration) ||
        sample.duration <= 0 ||
        !selected.nodes.has(sample.nodeId),
    )
  )
    throw new Error(
      "The unique direct CDP CPU profile is empty or contains invalid samples.",
    );
  return selected;
}

function assertDirectCpuProfileIsolationProbe() {
  const directProfile: TraceCpuProfile = {
    id: "direct-cdp-profiler",
    source: "direct-cdp-profiler",
    pid: 0,
    tid: 0,
    nodes: new Map([
      [
        1,
        {
          id: 1,
          children: [],
          callFrame: {
            functionName: "overlapProbe",
            url: `${ORIGIN}/assets/diagnostic-overlap-probe.js`,
            lineNumber: 0,
            columnNumber: 0,
          },
        },
      ],
    ]),
    samples: [{ nodeId: 1, start: 100, duration: 100 }],
  };
  const inspectorProfile: TraceCpuProfile = {
    ...directProfile,
    id: "inspector-overlap-probe",
    source: "Inspector",
    samples: [
      { nodeId: 1, start: 100, duration: 100 },
      { nodeId: 1, start: 200, duration: 50 },
    ],
  };
  const selected = selectUniqueDirectCpuProfile([
    directProfile,
    inspectorProfile,
  ]);
  expect(() => selectUniqueDirectCpuProfile([inspectorProfile])).toThrow(
    "Expected exactly one valid direct CDP CPU profile; found 0.",
  );
  expect(() =>
    selectUniqueDirectCpuProfile([
      directProfile,
      { ...directProfile, id: "duplicate-direct-profile" },
    ]),
  ).toThrow("Expected exactly one valid direct CDP CPU profile; found 2.");
  const directSanitized = sanitizeTraceCpuProfile(selected);
  const inspectorSanitized = sanitizeTraceCpuProfile(inspectorProfile);
  const directFrames = inclusiveTraceFrames([directSanitized]);
  const mixedFrames = inclusiveTraceFrames([
    directSanitized,
    inspectorSanitized,
  ]);
  const directCoverage = summarizeProfileCoverage(
    selected.samples.map((sample) => ({
      start: sample.start,
      end: sample.start + sample.duration,
    })),
    0,
    1_000,
  );
  const mixedCoverage = summarizeProfileCoverage(
    [...selected.samples, ...inspectorProfile.samples].map((sample) => ({
      start: sample.start,
      end: sample.start + sample.duration,
    })),
    0,
    1_000,
  );
  expect(selected.source).toBe("direct-cdp-profiler");
  expect(directFrames[0]?.inclusiveSampledMicroseconds).toBe(100);
  expect(mixedFrames[0]?.inclusiveSampledMicroseconds).toBe(250);
  expect(directCoverage.unionCoverage).toBe(100);
  expect(mixedCoverage.unionCoverage).toBe(150);
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

type CorrelationClock = {
  originTraceMicroseconds: number;
  offsetMicroseconds: number;
  microsecondsPerMillisecond: number;
  uncertaintyMicroseconds: number;
  scaleUncertaintyMicrosecondsPerMillisecond: number;
  extrapolationMilliseconds: number;
};

function performanceNowToRelativeTraceMicroseconds(
  performanceNowMs: number,
  clock: CorrelationClock,
) {
  if (
    !Number.isFinite(performanceNowMs) ||
    !Number.isFinite(clock.originTraceMicroseconds) ||
    !Number.isFinite(clock.offsetMicroseconds) ||
    !Number.isFinite(clock.microsecondsPerMillisecond) ||
    clock.microsecondsPerMillisecond <= 0 ||
    !Number.isFinite(clock.uncertaintyMicroseconds) ||
    clock.uncertaintyMicroseconds < 0 ||
    !Number.isFinite(clock.scaleUncertaintyMicrosecondsPerMillisecond) ||
    clock.scaleUncertaintyMicrosecondsPerMillisecond < 0 ||
    !Number.isFinite(clock.extrapolationMilliseconds) ||
    clock.extrapolationMilliseconds < 0
  )
    throw new Error("The correlation clock mapping is invalid.");
  return (
    clock.offsetMicroseconds +
    clock.microsecondsPerMillisecond * performanceNowMs -
    clock.originTraceMicroseconds
  );
}

function summarizeCorrelatedFrameIntervals(
  timestamps: number[],
  clock: CorrelationClock,
  windowEndTraceMicroseconds: number,
) {
  const span = windowEndTraceMicroseconds - clock.originTraceMicroseconds;
  if (!Number.isFinite(span) || span <= 0 || span > 10_000_000)
    throw new Error("The canonical RAF window has invalid trace bounds.");
  return timestamps.slice(1, 5_001).flatMap((timestamp, index) => {
    const previous = timestamps[index];
    if (!Number.isFinite(timestamp) || !Number.isFinite(previous)) return [];
    const rawStart = performanceNowToRelativeTraceMicroseconds(previous, clock);
    const rawEnd = performanceNowToRelativeTraceMicroseconds(timestamp, clock);
    const start = Math.max(0, Math.min(span, rawStart));
    const end = Math.max(start, Math.min(span, rawEnd));
    return end > start
      ? [{ startOffsetMicroseconds: start, durationMicroseconds: end - start }]
      : [];
  });
}

function sanitizeTraceCpuProfile(
  profile: TraceCpuProfile,
  startMicroseconds?: number,
  endMicroseconds?: number,
) {
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
  return {
    nodes: sanitizeCpuProfileNodes([...profile.nodes.values()], ORIGIN),
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
  const maps = await Promise.all(
    [...relevantFiles].map(async (file) => {
      if (!file.endsWith(".js"))
        return [path.posix.basename(file), []] as const;
      try {
        const map = JSON.parse(
          await readFile(
            path.join(ROOT, "apps/web/dist/agent", `${file}.map`),
            "utf8",
          ),
        ) as { sources?: string[] };
        return [path.posix.basename(file), map.sources ?? []] as const;
      } catch {
        return [path.posix.basename(file), []] as const;
      }
    }),
  );
  const moduleMapSources = Object.fromEntries(maps);
  const unmappedJavaScriptAssets = [...relevantFiles]
    .filter((file) => file.endsWith(".js"))
    .filter((file) => moduleMapSources[path.posix.basename(file)]?.length === 0)
    .map((file) => path.posix.basename(file))
    .sort();
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
  return {
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
    profiledAssets: assets.filter((asset) => profileFiles.has(asset.file)),
    modulesByAsset: moduleMapSources,
    moduleMapCoverage: {
      mappedJavaScriptAssets:
        [...relevantFiles].filter((file) => file.endsWith(".js")).length -
        unmappedJavaScriptAssets.length,
      javascriptAssets: [...relevantFiles].filter((file) =>
        file.endsWith(".js"),
      ).length,
      unmappedJavaScriptAssets,
    },
  };
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
  traceCpuProfiles: TraceCpuProfile[];
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
  frameTimestamps?: number[];
  frameWindow?: {
    startMark: string;
    endMark: string;
    startPerformanceNowMs: number;
    endPerformanceNowMs: number;
    frameTimestamps: number[];
  };
  deviceHardwareConcurrency?: number;
} | null;

function createRawCaptureArtifact(
  capture: DiagnosticCapture,
  captureIndex: number,
  sourceAndBuild: Awaited<ReturnType<typeof getBuildIdentity>>,
): DiagnosticCaptureArtifact {
  return {
    schemaVersion: 1,
    diagnosticOnly: true,
    captureIndex,
    sourceAndBuild,
    capturedWindow: {
      name: capture.name,
      metrics: {
        ...capture.metrics,
        lcp: capture.metrics.lcp
          ? {
              startTime: capture.metrics.lcp.startTime,
              element: capture.metrics.lcp.element,
              textLength: capture.metrics.lcp.textLength,
            }
          : null,
      },
      network: capture.network,
      browserPerformance: capture.browserPerformance,
      clockMarks: capture.clockMarks,
      boundary: capture.boundary,
      traceCpuProfiles: capture.traceCpuProfiles.map((profile) => ({
        nodes: sanitizeCpuProfileNodes([...profile.nodes.values()], ORIGIN),
        samples: profile.samples.map((sample) => ({
          nodeId: sample.nodeId,
          startMicroseconds: sample.start,
          durationMicroseconds: sample.duration,
        })),
      })),
    },
  };
}

async function withDiagnosticProfile(
  browser: import("@playwright/test").Browser,
  name: string,
  throttled: boolean,
  prepare: (page: Page) => Promise<void>,
  visit: (page: Page) => Promise<DiagnosticBoundary>,
  allowedTimelineEventNames: ReadonlySet<string> = TIMELINE_EVENT_NAMES,
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
  const timelineEvents: BrowserTimelineEvent[] = [];
  const traceCpuProfilesByThread = new Map<string, TraceCpuProfile>();
  const traceProfileClocks = new Map<string, TraceProfileClock>();
  const invalidTraceProfileKeys = new Set<string>();
  let clockMarks: DiagnosticCapture["clockMarks"] = [];
  let timelineOverflow = false;
  const directCpuProfiler =
    name === "legacy board drag pointerdown to pointerup";
  cdp.on("Tracing.dataCollected", ({ value }) => {
    for (const event of value ?? []) {
      if (event.name === "Profile" || event.name === "ProfileChunk") {
        const data = (
          event.args as { data?: Record<string, unknown> } | undefined
        )?.data;
        const source = String(data?.source ?? "unknown");
        const pid = Number(event.pid) || 0;
        const tid = Number(event.tid) || 0;
        const id = String(event.id ?? "profile");
        const key = traceProfileKey(pid, tid, source, id);
        if (invalidTraceProfileKeys.has(key)) continue;
        if (event.name === "Profile") {
          if (!anchorTraceProfile(traceProfileClocks, key, Number(event.ts))) {
            invalidTraceProfileKeys.add(key);
            traceCpuProfilesByThread.delete(key);
          }
          continue;
        }
        const cpuProfile = data?.cpuProfile as
          | { nodes?: TraceCpuNode[]; samples?: number[] }
          | undefined;
        const timeDeltas = data?.timeDeltas as number[] | undefined;
        const samples = Array.isArray(cpuProfile?.samples)
          ? cpuProfile.samples
          : [];
        const deltas = Array.isArray(timeDeltas) ? timeDeltas : [];
        const timedSamples = timeTraceProfileChunk(
          traceProfileClocks.get(key),
          samples,
          deltas,
        );
        if (samples.length > 0 && !timedSamples) {
          invalidTraceProfileKeys.add(key);
          traceCpuProfilesByThread.delete(key);
          continue;
        }
        let traceProfile = traceCpuProfilesByThread.get(key);
        if (!traceProfile) {
          traceProfile = {
            id,
            source,
            pid,
            tid,
            nodes: new Map(),
            samples: [],
          };
          traceCpuProfilesByThread.set(key, traceProfile);
        }
        for (const node of cpuProfile?.nodes ?? [])
          traceProfile.nodes.set(node.id, node);
        traceProfile.samples.push(...(timedSamples ?? []));
      }
      const sanitized = sanitizeTimelineEvent(event, allowedTimelineEventNames);
      if (!sanitized) continue;
      if (timelineEvents.length >= 20_000) {
        timelineOverflow = true;
        continue;
      }
      timelineEvents.push(sanitized);
    }
  });
  await installPerformanceApiFixture(page);
  await page.addInitScript(
    (allowedMarkNames: string[]) => {
      const allowedMarks = new Set(allowedMarkNames);
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
        if (
          !allowedMarks.has(name) ||
          !Number.isFinite(boundaryPerformanceNowMs)
        )
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
      window.__g11DiagnosticMark = mark;
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
    },
    [...CLOCK_MARKS],
  );

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
    if (directCpuProfiler) {
      // Keep the established trace markers/timeline, but request the CPU profile
      // through CDP's explicit Profiler domain as an independent capture path.
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
      await cdp.send("Profiler.start");
    }
    console.info(`G11 diagnostic phase started: ${name}`);
    boundary = await visit(page);
    if (directCpuProfiler) {
      const { profile } = await cdp.send("Profiler.stop");
      const nodes = new Map<number, TraceCpuNode>();
      for (const node of profile.nodes ?? []) nodes.set(node.id, node);
      const samples: TraceCpuProfile["samples"] = [];
      let sampleStart = Number(profile.startTime);
      const sampleIds: number[] = profile.samples ?? [];
      const deltas: number[] = profile.timeDeltas ?? [];
      for (let index = 0; index < sampleIds.length; index += 1) {
        const duration = Number(deltas[index]);
        const nodeId = Number(sampleIds[index]);
        if (Number.isFinite(duration) && duration > 0 && nodes.has(nodeId))
          samples.push({ nodeId, start: sampleStart, duration });
        sampleStart += Number.isFinite(duration) && duration > 0 ? duration : 0;
      }
      traceCpuProfilesByThread.set("direct-cdp-profiler", {
        id: "direct-cdp-profiler",
        source: "direct-cdp-profiler",
        pid: 0,
        tid: 0,
        nodes,
        samples,
      });
      await cdp.send("Profiler.disable");
    }
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
    traceCpuProfiles: [...traceCpuProfilesByThread.values()],
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
  await page.waitForFunction(
    () => {
      const metrics = (
        window as Window & { __g11Metrics?: { statePaint: number } }
      ).__g11Metrics;
      return metrics !== undefined && metrics.statePaint > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
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
  await page.waitForFunction(
    () => {
      const metrics = (
        window as Window & { __g11Metrics?: { assignmentPaint: number } }
      ).__g11Metrics;
      return metrics !== undefined && metrics.assignmentPaint > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
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

async function visitLegacyBoardDragProfile(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(
    200,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(400);

  let versionedWriteResponses = 0;
  let unsuccessfulVersionedWrites = 0;
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "PUT" &&
      new URL(response.url()).pathname.match(/^\/api\/v2\/task\/[^/]+$/)
    ) {
      versionedWriteResponses += 1;
      if (response.status() !== 200) unsuccessfulVersionedWrites += 1;
    }
  });

  const source = await page
    .getByText("Seeded legacy task 1", { exact: true })
    .boundingBox();
  const destination = await page
    .getByText("Seeded legacy task 51", { exact: true })
    .boundingBox();
  if (!source || !destination)
    throw new Error("The seeded board cards have no browser bounding boxes.");

  await page.evaluate(() => {
    const profile = {
      active: false,
      finished: false,
      frameTimestamps: [] as number[],
      pointerFrameTimestamps: [] as number[],
      frameWindow: undefined as
        | {
            startMark: string;
            endMark: string;
            startPerformanceNowMs: number;
            endPerformanceNowMs?: number;
            frameTimestamps: number[];
          }
        | undefined,
      startPerformanceNowMs: undefined as number | undefined,
      endPerformanceNowMs: undefined as number | undefined,
    };
    window.__g11BoardDragProfile = profile;
    const samplePointerFrame = (now: number) => {
      if (profile.finished) return;
      if (profile.active) profile.pointerFrameTimestamps.push(now);
      requestAnimationFrame(samplePointerFrame);
    };
    requestAnimationFrame(samplePointerFrame);

    const frameWindowStart = performance.now();
    const frameWindowStopAt = frameWindowStart + 2200;
    const frameWindow = {
      startMark: "board-drag-frame-window-start",
      endMark: "board-drag-frame-window-end",
      startPerformanceNowMs: frameWindowStart,
      endPerformanceNowMs: undefined as number | undefined,
      frameTimestamps: profile.frameTimestamps,
    };
    profile.frameWindow = frameWindow;
    window.__g11DiagnosticMark?.(frameWindow.startMark, frameWindowStart);
    const sampleCanonicalFrameWindow = (now: number) => {
      profile.frameTimestamps.push(now);
      if (now < frameWindowStopAt) {
        requestAnimationFrame(sampleCanonicalFrameWindow);
        return;
      }
      frameWindow.endPerformanceNowMs = now;
      window.__g11DiagnosticMark?.(frameWindow.endMark, now);
    };
    requestAnimationFrame(sampleCanonicalFrameWindow);
    document.addEventListener(
      "pointerdown",
      (event) => {
        const target = event.target;
        const card =
          target instanceof Element ? target.closest("[data-task-id]") : null;
        if (
          profile.active ||
          card?.getAttribute("data-task-id") !== "legacy-task-1"
        )
          return;
        const start = performance.now();
        profile.startPerformanceNowMs = start;
        window.__g11DiagnosticMark?.("board-drag-start", start);
        profile.active = true;
      },
      true,
    );
    document.addEventListener(
      "pointerup",
      () => {
        if (!profile.active) return;
        const end = performance.now();
        profile.endPerformanceNowMs = end;
        window.__g11DiagnosticMark?.("board-drag-end", end);
        profile.active = false;
        profile.finished = true;
      },
      true,
    );
  });

  const fromX = source.x + source.width / 2;
  const fromY = source.y + source.height / 2;
  const toX = destination.x + destination.width / 2;
  const toY = destination.y + destination.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (let step = 1; step <= 125; step += 1) {
    const progress = step / 125;
    await page.mouse.move(
      fromX + (toX - fromX) * progress,
      fromY + (toY - fromY) * progress,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();

  const dragCapture = await page.evaluate(() => {
    const profile = window.__g11BoardDragProfile;
    if (
      !profile ||
      profile.startPerformanceNowMs === undefined ||
      profile.endPerformanceNowMs === undefined ||
      !profile.frameWindow ||
      profile.frameWindow.endPerformanceNowMs === undefined
    )
      throw new Error(
        "The legacy board drag pointer boundary was not captured.",
      );
    return {
      startPerformanceNowMs: profile.startPerformanceNowMs,
      endPerformanceNowMs: profile.endPerformanceNowMs,
      frameTimestamps: [...profile.pointerFrameTimestamps],
      frameWindow: {
        startMark: profile.frameWindow.startMark,
        endMark: profile.frameWindow.endMark,
        startPerformanceNowMs: profile.frameWindow.startPerformanceNowMs,
        endPerformanceNowMs: profile.frameWindow.endPerformanceNowMs,
        frameTimestamps: [...profile.frameWindow.frameTimestamps],
      },
      deviceHardwareConcurrency: navigator.hardwareConcurrency,
    };
  });

  await expect
    .poll(() => versionedWriteResponses, { timeout: 30_000 })
    .toBe(100);
  expect(unsuccessfulVersionedWrites).toBe(0);
  const movedCardColumn = await page
    .locator('[data-task-id="legacy-task-1"]')
    .locator("xpath=ancestor::*[@data-column-id]")
    .getAttribute("data-column-id");
  const destinationCardColumn = await page
    .locator('[data-task-id="legacy-task-51"]')
    .locator("xpath=ancestor::*[@data-column-id]")
    .getAttribute("data-column-id");
  expect(movedCardColumn).toBe(destinationCardColumn);

  return {
    startMark: "board-drag-start",
    endMark: "board-drag-end",
    startPerformanceNowMs: dragCapture.startPerformanceNowMs,
    endPerformanceNowMs: dragCapture.endPerformanceNowMs,
    source: "captured pointerdown through pointerup on legacy-task-1",
    frameTimestamps: dragCapture.frameTimestamps,
    frameWindow: dragCapture.frameWindow,
    deviceHardwareConcurrency: dragCapture.deviceHardwareConcurrency,
  };
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
    captures.flatMap(({ traceCpuProfiles }) => [
      ...traceCpuProfiles.flatMap((traceProfile) =>
        [...traceProfile.nodes.values()]
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
  await persistDiagnosticCapturesBestEffort(
    RAW_CAPTURE_DIR,
    captures.map((capture, index) =>
      createRawCaptureArtifact(capture, index + 1, build),
    ),
  );
  const profileWindows = await aggregateDiagnosticCapturesWithFailureReceipt(
    RAW_CAPTURE_DIR,
    captures,
    build,
    (capture) => {
      const { name, browserPerformance } = capture;
      const alignment = alignBoundaryToTrace(capture);
      if (!alignment)
        return {
          name,
          scope: "supplementary full-window context; no canonical G11 metric",
          recorderBoundary: null,
          clockAlignment: null,
          topInclusiveCpuFrames: inclusiveTraceFrames(
            capture.traceCpuProfiles
              .map((traceProfile) => sanitizeTraceCpuProfile(traceProfile))
              .filter((value) => value !== undefined),
          ),
          traceCpuProfiles: capture.traceCpuProfiles
            .map((traceProfile) => sanitizeTraceCpuProfile(traceProfile))
            .filter((value) => value !== undefined),
          timelineEvents: browserPerformance.timelineEvents,
          wholeWindowPerformanceMetrics: {
            scope:
              "context-only cumulative deltas; not a click-to-paint interval",
            values: browserPerformance.metrics,
          },
        };

      const clippedTraceCpuProfiles = capture.traceCpuProfiles
        .map((traceProfile) =>
          sanitizeTraceCpuProfile(
            traceProfile,
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
      const clippedSamples = clippedTraceCpuProfiles.flatMap((traceProfile) =>
        traceProfile.samples.map((sample) => ({
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
        documentId: alignment.documentId,
        scope: "canonical recorder boundary",
        recorderBoundary: alignment.boundary,
        clockAlignment: {
          ...alignment.transform,
          calibratedStartTraceMicroseconds: alignment.startTraceMicroseconds,
          calibratedEndTraceMicroseconds: alignment.endTraceMicroseconds,
          v8TraceProfileCount: capture.traceCpuProfiles.length,
        },
        cpuSampleCoverage: {
          scope:
            "observed trace ProfileChunk samples; not a completeness guarantee",
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
        topInclusiveCpuFrames: inclusiveTraceFrames(clippedTraceCpuProfiles),
        traceCpuProfiles: clippedTraceCpuProfiles,
        timelineEvents: clippedTimeline,
        wholeWindowPerformanceMetrics: {
          scope:
            "context-only cumulative deltas; not a click-to-paint interval",
          values: browserPerformance.metrics,
        },
      };
    },
  );
  const initial = captures[0];
  const result = {
    schemaVersion: 4,
    diagnosticOnly: true,
    fixture:
      "canonical G11 installPerformanceApiFixture (500 work items, 200 board cards)",
    sourceAndBuild: build,
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
        "Sanitized V8 ProfileChunk sample intervals start at the initial Profile event timestamp and accumulate ordered timeDeltas across chunks for the same process, thread, source, and profile id. Chunk emission timestamps are not used as sample anchors. Profiles without a valid initial Profile anchor are omitted; intervals are clipped to the aligned recorder span.",
      cpuFrameAttribution:
        "Self time is sampled time at the node; inclusive time sums each clipped sample once into that node and every reachable caller from retained child links. This is sampled CPU attribution, not wall time or a completeness guarantee. Coordinates remain compiled asset/function/line/column; source maps are inspected only for asset source lists and do not resolve individual functions.",
      contextMetrics:
        "Performance.getMetrics is cumulative over each entire profiler window and is reported as context only; it is not clipped or described as interval data.",
      sensitiveData:
        "Only fixed diagnostic marker labels, function names, generated asset basenames, line/column, event names, and timestamps are retained. Raw trace args, DOM, network payloads, and auth values are excluded.",
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
    profileWindows.every((window) => window.topInclusiveCpuFrames.length > 0),
    "Each hosted failure class must include sampled app JavaScript frames.",
  ).toBe(true);
  expect(
    captures.every(
      ({ network }) => !network.truncated && network.droppedCount === 0,
    ),
    "The diagnostic must retain all observed requests without truncation.",
  ).toBe(true);
});

test("hosted manual diagnostic - legacy board drag CPU profile", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  assertDirectCpuProfileIsolationProbe();
  await mkdir(RESULT_DIR, { recursive: true, mode: 0o700 });
  await chmod(RESULT_DIR, 0o700);
  const focusedResultDir = await mkdtemp(
    path.join(RESULT_DIR, "focused-board-drag-run-"),
  );
  await chmod(focusedResultDir, 0o700);
  const capture = await withDiagnosticProfile(
    browser,
    "legacy board drag pointerdown to pointerup",
    false,
    async () => {},
    visitLegacyBoardDragProfile,
    FOCUSED_DRAG_TIMELINE_EVENT_NAMES,
  );
  const directCpuProfile = selectUniqueDirectCpuProfile(
    capture.traceCpuProfiles,
  );
  const profileAssetNames = new Set(
    [...directCpuProfile.nodes.values()]
      .map((node) => node.callFrame?.url)
      .filter(
        (url): url is string =>
          typeof url === "string" && url.startsWith(`${ORIGIN}/assets/`),
      )
      .map(safeAssetName),
  );
  const build = await getBuildIdentity(profileAssetNames);
  const rawDirectory = path.join(
    focusedResultDir,
    "raw-captures",
    "focused-board-drag",
  );
  const rawArtifact = {
    ...createRawCaptureArtifact(capture, 1, build),
    schemaVersion: 1 as const,
    captureIndex: 1,
  };
  await mkdir(rawDirectory, { recursive: true, mode: 0o700 });
  await chmod(rawDirectory, 0o700);
  await writeFile(
    path.join(rawDirectory, "window-01.json"),
    `${JSON.stringify(rawArtifact, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );

  const [profileWindow] = await aggregateDiagnosticCapturesWithFailureReceipt(
    rawDirectory,
    [capture],
    build,
    (current) => {
      const selectedCpuProfile = selectUniqueDirectCpuProfile(
        current.traceCpuProfiles,
      );
      const cpuCaptureStreams = current.traceCpuProfiles.map((profile) => ({
        source: profile.source,
        nodeCount: profile.nodes.size,
        sampleCount: profile.samples.length,
        includedInFocusedCpuAggregation: profile === selectedCpuProfile,
        scope:
          profile === selectedCpuProfile
            ? "selected direct profile for focused CPU coverage and frame rankings"
            : "separate tracing CPU capture metadata only; excluded from focused CPU coverage and frame rankings",
      }));
      const alignment = alignBoundaryToTrace(current);
      if (!alignment)
        throw new Error(`${current.name} has no pointer interval alignment.`);
      const frameWindow = current.boundary?.frameWindow;
      if (!current.boundary || !frameWindow)
        throw new Error(`${current.name} has no canonical RAF window.`);
      const frameWindowCapture: DiagnosticCapture = {
        ...current,
        boundary: {
          ...current.boundary,
          startMark: frameWindow.startMark,
          endMark: frameWindow.endMark,
          startPerformanceNowMs: frameWindow.startPerformanceNowMs,
          endPerformanceNowMs: frameWindow.endPerformanceNowMs,
          frameTimestamps: frameWindow.frameTimestamps,
          source: "G11 2.2 second RAF sample window",
        },
      };
      const frameWindowAlignment = alignBoundaryToTrace(frameWindowCapture);
      if (!frameWindowAlignment)
        throw new Error(`${current.name} has no RAF-window clock alignment.`);
      const clippedProfiles = [selectedCpuProfile]
        .map((profile) =>
          sanitizeTraceCpuProfile(
            profile,
            alignment.startTraceMicroseconds,
            alignment.endTraceMicroseconds,
          ),
        )
        .filter((profile) => profile !== undefined);
      const frameWindowProfiles = [selectedCpuProfile]
        .map((profile) =>
          sanitizeTraceCpuProfile(
            profile,
            frameWindowAlignment.startTraceMicroseconds,
            frameWindowAlignment.endTraceMicroseconds,
          ),
        )
        .filter((profile) => profile !== undefined);
      const clippedSamples = clippedProfiles.flatMap((profile) =>
        profile.samples.map((sample) => ({
          start: sample.startMicroseconds,
          end: sample.startMicroseconds + sample.durationMicroseconds,
        })),
      );
      const cpuCoverage = summarizeProfileCoverage(
        clippedSamples,
        alignment.startTraceMicroseconds,
        alignment.endTraceMicroseconds,
      );
      const frameWindowSamples = frameWindowProfiles.flatMap((profile) =>
        profile.samples.map((sample) => ({
          start: sample.startMicroseconds,
          end: sample.startMicroseconds + sample.durationMicroseconds,
        })),
      );
      const frameWindowCpuCoverage = summarizeProfileCoverage(
        frameWindowSamples,
        frameWindowAlignment.startTraceMicroseconds,
        frameWindowAlignment.endTraceMicroseconds,
      );
      const frameTimestamps = current.boundary?.frameTimestamps ?? [];
      const frameIntervals = frameTimestamps
        .slice(1)
        .flatMap((timestamp, index) => {
          const previous = frameTimestamps[index];
          return previous === undefined ? [] : [timestamp - previous];
        })
        .filter((interval) => interval > 0);
      const sortedFrameIntervals = [...frameIntervals].sort(
        (left, right) => left - right,
      );
      const canonicalFrameTimestamps = frameWindow.frameTimestamps;
      const canonicalFrameIntervals = canonicalFrameTimestamps
        .slice(1)
        .flatMap((timestamp, index) => {
          const previous = canonicalFrameTimestamps[index];
          return previous === undefined ? [] : [timestamp - previous];
        })
        .filter((interval) => interval > 0);
      const sortedCanonicalFrameIntervals = [...canonicalFrameIntervals].sort(
        (left, right) => left - right,
      );
      const canonicalTimelineEvents = clipTimelineEvents(
        current.browserPerformance.timelineEvents,
        frameWindowAlignment.startTraceMicroseconds,
        frameWindowAlignment.endTraceMicroseconds,
      );
      return {
        name: current.name,
        documentId: alignment.documentId,
        scope: "pointerdown-to-pointerup; no canonical G11 metric",
        recorderBoundary: alignment.boundary,
        clockAlignment: {
          ...alignment.transform,
          calibratedStartTraceMicroseconds: alignment.startTraceMicroseconds,
          calibratedEndTraceMicroseconds: alignment.endTraceMicroseconds,
          selectedDirectProfileCount: clippedProfiles.length,
        },
        cpuSampleCoverage: {
          scope:
            "observed direct CDP Profiler samples only; not a completeness guarantee",
          profileSource: selectedCpuProfile.source,
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
        frameSampling: {
          timestampClock: "window.performance.now() milliseconds",
          timestamps: frameTimestamps,
          intervalCount: frameIntervals.length,
          medianIntervalMs:
            sortedFrameIntervals.length > 0
              ? sortedFrameIntervals[
                  Math.floor(sortedFrameIntervals.length / 2)
                ]
              : null,
          p95IntervalMs:
            sortedFrameIntervals.length > 0
              ? sortedFrameIntervals[
                  Math.ceil(sortedFrameIntervals.length * 0.95) - 1
                ]
              : null,
          intervalsOver20Ms: frameIntervals.filter((value) => value > 20)
            .length,
          intervalsOver33Ms: frameIntervals.filter((value) => value > 33)
            .length,
        },
        topInclusiveCpuFrames: inclusiveTraceFrames(clippedProfiles),
        traceCpuProfiles: clippedProfiles,
        cpuCaptureStreams,
        timelineEvents: clipTimelineEvents(
          current.browserPerformance.timelineEvents,
          alignment.startTraceMicroseconds,
          alignment.endTraceMicroseconds,
        ),
        wholeWindowPerformanceMetrics: {
          scope: "context-only deltas; not clipped to the drag interval",
          values: current.browserPerformance.metrics,
        },
        canonicalRafWindow: {
          scope:
            "G11-compatible RAF sampling: 2200 ms deadline begins before initial mouse.move; profile/timeline clipped to the sampler's first RAF at or beyond that deadline",
          requestedWindowMs: 2200,
          elapsedWindowMs:
            frameWindow.endPerformanceNowMs - frameWindow.startPerformanceNowMs,
          firstFrameAtMs: canonicalFrameTimestamps[0] ?? null,
          lastFrameAtMs: canonicalFrameTimestamps.at(-1) ?? null,
          clockAlignment: {
            ...frameWindowAlignment.transform,
            calibratedStartTraceMicroseconds:
              frameWindowAlignment.startTraceMicroseconds,
            calibratedEndTraceMicroseconds:
              frameWindowAlignment.endTraceMicroseconds,
            selectedDirectProfileCount: frameWindowProfiles.length,
          },
          cpuSampleCoverage: {
            scope:
              "observed direct CDP Profiler samples only, clipped to the 2.2-second RAF window; not a completeness guarantee",
            profileSource: selectedCpuProfile.source,
            intervalStartMicroseconds:
              frameWindowAlignment.startTraceMicroseconds,
            intervalEndMicroseconds: frameWindowAlignment.endTraceMicroseconds,
            observedStartMicroseconds: frameWindowCpuCoverage.observedStart,
            observedEndMicroseconds: frameWindowCpuCoverage.observedEnd,
            uncoveredPrefixMicroseconds: frameWindowCpuCoverage.uncoveredPrefix,
            uncoveredSuffixMicroseconds: frameWindowCpuCoverage.uncoveredSuffix,
            unionCoverageMicroseconds: frameWindowCpuCoverage.unionCoverage,
            clockAlignmentUncertaintyMicroseconds:
              frameWindowAlignment.transform.uncertaintyMicroseconds,
          },
          frameSampling: {
            timestampClock: "window.performance.now() milliseconds",
            timestamps: canonicalFrameTimestamps,
            intervalCount: canonicalFrameIntervals.length,
            medianIntervalMs:
              sortedCanonicalFrameIntervals.length > 0
                ? sortedCanonicalFrameIntervals[
                    Math.floor(sortedCanonicalFrameIntervals.length / 2)
                  ]
                : null,
            p95IntervalMs:
              sortedCanonicalFrameIntervals.length > 0
                ? sortedCanonicalFrameIntervals[
                    Math.ceil(sortedCanonicalFrameIntervals.length * 0.95) - 1
                  ]
                : null,
            intervalsOver20Ms: canonicalFrameIntervals.filter(
              (value) => value > 20,
            ).length,
            intervalsOver33Ms: canonicalFrameIntervals.filter(
              (value) => value > 33,
            ).length,
          },
          topInclusiveCpuFrames: inclusiveTraceFrames(frameWindowProfiles),
          traceCpuProfiles: frameWindowProfiles,
          cpuCaptureStreams,
          timelineEvents: canonicalTimelineEvents,
        },
      };
    },
  );
  expect(
    profileWindow?.frameSampling?.intervalCount ?? 0,
    "The hosted drag diagnostic must include RAF timing samples.",
  ).toBeGreaterThan(0);
  expect(
    profileWindow?.topInclusiveCpuFrames?.length ?? 0,
    "The hosted drag diagnostic must include sampled application JavaScript frames.",
  ).toBeGreaterThan(0);
  expect(
    profileWindow?.cpuSampleCoverage?.unionCoverageMicroseconds ?? 0,
    "The hosted drag diagnostic must include aligned direct Profiler samples.",
  ).toBeGreaterThan(0);
  expect(profileWindow?.cpuSampleCoverage?.profileSource).toBe(
    "direct-cdp-profiler",
  );
  expect(
    profileWindow?.canonicalRafWindow?.frameSampling?.intervalCount ?? 0,
    "The hosted drag diagnostic must include the canonical 2.2 second RAF window.",
  ).toBeGreaterThan(0);
  expect(
    profileWindow?.canonicalRafWindow?.topInclusiveCpuFrames?.length ?? 0,
    "The canonical RAF window must contain sampled application JavaScript frames.",
  ).toBeGreaterThan(0);
  expect(
    profileWindow?.canonicalRafWindow?.cpuSampleCoverage
      ?.unionCoverageMicroseconds ?? 0,
    "The canonical RAF window must contain aligned direct Profiler samples.",
  ).toBeGreaterThan(0);
  expect(
    profileWindow?.canonicalRafWindow?.cpuSampleCoverage?.profileSource,
  ).toBe("direct-cdp-profiler");
  const runtimeMetadata = {
    sourceCommitSha: build.sourceCommitSha,
    sourceTreeSha256: build.sourceTreeSha256,
    manifestSha256: build.manifestSha256,
    canonicalFixtureSha256: build.canonicalFixtureSha256,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    osRelease: osRelease(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    logicalCpuCount: cpus().length,
    availableParallelism: availableParallelism(),
    chromiumVersion: browser.version(),
    playwrightWorkerIndex: test.info().workerIndex,
    playwrightParallelIndex: test.info().parallelIndex,
    invocationWorkerCount: 1,
    browserHardwareConcurrency:
      capture.boundary?.deviceHardwareConcurrency ?? null,
    profilerThreads: capture.traceCpuProfiles.map((profile) => ({
      pid: profile.pid,
      tid: profile.tid,
      source: profile.source,
      nodeCount: profile.nodes.size,
      sampleCount: profile.samples.length,
    })),
  };
  const result = {
    schemaVersion: 1,
    diagnosticOnly: true,
    sourceAndRuntime: runtimeMetadata,
    fixture: "canonical G11 performance fixture: 200 legacy board cards",
    dragInputs: {
      route: `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
      from: "legacy-task-1",
      to: "legacy-task-51",
      moveSteps: 125,
      delayPerStepMs: 16,
      networkCpuThrottling: "none",
    },
    profileWindow,
    topModulesByAsset: build.modulesByAsset,
    networkSummary: capture.network,
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(
    path.join(focusedResultDir, "board-drag-profile.json"),
    serialized,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );

  const normalizeSourceBinding = (specifier: string) => {
    const normalized = specifier.replaceAll("\\", "/").split("?")[0] ?? "";
    const nodeModulesIndex = normalized.lastIndexOf("/node_modules/");
    if (nodeModulesIndex >= 0)
      return `dependency/${normalized.slice(nodeModulesIndex + 14)}`;
    const localSource = normalized.match(
      /(?:^|\/)(apps|packages)\/[^?#]+|(?:^|\/)src\/[^?#]+/,
    )?.[0];
    if (localSource?.startsWith("src/")) return `apps/web/${localSource}`;
    if (localSource?.startsWith("/src/")) return `apps/web${localSource}`;
    if (localSource) return localSource.replace(/^\//, "");
    return path.posix.basename(normalized);
  };
  const canonicalRafWindow = profileWindow.canonicalRafWindow;
  const activeAssets = new Set([
    ...profileWindow.topInclusiveCpuFrames.map((frame) => frame.asset),
    ...canonicalRafWindow.topInclusiveCpuFrames.map((frame) => frame.asset),
  ]);
  const sourceBindings = [...activeAssets].sort().map((asset) => ({
    asset,
    sources: [
      ...new Set(
        (build.modulesByAsset[asset] ?? []).map(normalizeSourceBinding),
      ),
    ].sort(),
  }));
  const countTimelineEvents = (events: BrowserTimelineEvent[]) =>
    Object.fromEntries(
      Object.entries(
        events.reduce<Record<string, number>>((counts, event) => {
          counts[event.name] = (counts[event.name] ?? 0) + 1;
          return counts;
        }, {}),
      ).sort(([left], [right]) => left.localeCompare(right)),
    );
  const summarizeRelativeTimeline = (
    events: BrowserTimelineEvent[],
    startMicroseconds: number,
    endMicroseconds: number,
  ) => {
    const span = endMicroseconds - startMicroseconds;
    if (!Number.isFinite(span) || span <= 0 || span > 10_000_000)
      throw new Error("The canonical timeline window has invalid bounds.");
    return events.slice(0, 5_000).map((event) => {
      const rawOffset = event.startMicroseconds - startMicroseconds;
      const offset = Math.max(0, Math.min(span, rawOffset));
      const hasDuration = Number.isFinite(event.durationMicroseconds);
      const rawDuration = hasDuration
        ? Math.max(0, event.durationMicroseconds ?? 0)
        : 0;
      const duration = Math.max(0, Math.min(span - offset, rawDuration));
      const phase = /^[A-Za-z]$/.test(event.phase) ? event.phase : "unknown";
      return {
        name: TIMELINE_EVENT_NAMES.has(event.name) ? event.name : "other",
        phase,
        startOffsetMicroseconds: offset,
        ...(hasDuration ? { durationMicroseconds: duration } : {}),
        durationKind: hasDuration
          ? duration === 0
            ? "instant"
            : "known"
          : "unknown",
        threadRole: "unknown",
      };
    });
  };
  const canonicalWindowStart =
    canonicalRafWindow.cpuSampleCoverage.intervalStartMicroseconds;
  const canonicalWindowEnd =
    canonicalRafWindow.cpuSampleCoverage.intervalEndMicroseconds;
  const canonicalFrameTimestamps = canonicalRafWindow.frameSampling.timestamps;
  const canonicalClock = canonicalRafWindow.clockAlignment;
  const correlationClock: CorrelationClock = {
    originTraceMicroseconds: canonicalWindowStart,
    offsetMicroseconds: canonicalClock.offsetMicroseconds,
    microsecondsPerMillisecond: canonicalClock.microsecondsPerMillisecond,
    uncertaintyMicroseconds: canonicalClock.uncertaintyMicroseconds,
    scaleUncertaintyMicrosecondsPerMillisecond:
      canonicalClock.scaleUncertaintyMicrosecondsPerMillisecond,
    extrapolationMilliseconds: canonicalClock.extrapolationMilliseconds,
  };
  const delayedFirstRafProbeClock: CorrelationClock = {
    originTraceMicroseconds: 5_000,
    offsetMicroseconds: 1_000,
    microsecondsPerMillisecond: 1_000,
    uncertaintyMicroseconds: 2,
    scaleUncertaintyMicrosecondsPerMillisecond: 0.01,
    extrapolationMilliseconds: 30,
  };
  const delayedFirstRafProbeIntervals = summarizeCorrelatedFrameIntervals(
    [10, 26],
    delayedFirstRafProbeClock,
    30_000,
  );
  const delayedFirstRafProbeEvent = summarizeRelativeTimeline(
    [
      {
        name: "Layout",
        phase: "X",
        startMicroseconds: 13_000,
        durationMicroseconds: 1_000,
      },
    ],
    delayedFirstRafProbeClock.originTraceMicroseconds,
    30_000,
  )[0];
  expect(delayedFirstRafProbeIntervals[0]?.startOffsetMicroseconds).toBe(6_000);
  expect(delayedFirstRafProbeEvent?.startOffsetMicroseconds).toBe(8_000);
  expect(delayedFirstRafProbeEvent?.startOffsetMicroseconds).toBeGreaterThan(
    delayedFirstRafProbeIntervals[0]?.startOffsetMicroseconds ??
      Number.POSITIVE_INFINITY,
  );
  expect(delayedFirstRafProbeEvent?.startOffsetMicroseconds).toBeLessThan(
    (delayedFirstRafProbeIntervals[0]?.startOffsetMicroseconds ?? 0) +
      (delayedFirstRafProbeIntervals[0]?.durationMicroseconds ?? 0),
  );
  const hostedSummary = {
    schemaVersion: 2,
    diagnosticOnly: true,
    purpose: "hosted root-cause investigation; no G11 budget evaluation",
    sourceAndRuntime: runtimeMetadata,
    fixture: "canonical G11 performance fixture: 200 legacy board cards",
    dragInputs: result.dragInputs,
    canonicalRafWindow: {
      requestedWindowMs: canonicalRafWindow.requestedWindowMs,
      elapsedWindowMs: canonicalRafWindow.elapsedWindowMs,
      cpuProfileSelection: {
        selectedSource: "direct-cdp-profiler",
        selectedProfileCount: 1,
        aggregationScope:
          "pointer and canonical CPU coverage/frame rankings use only this direct profile; inclusive ancestor buckets can overlap and are not additive wall time or causal proof",
      },
      correlationClock: {
        origin:
          "canonicalRafWindow.cpuSampleCoverage.intervalStartMicroseconds",
        unit: "trace microseconds relative to canonical RAF trace-window start",
        rafTimestampMapping:
          "relativeTraceUs = offsetMicroseconds + microsecondsPerMillisecond * performanceNowMs - originTraceMicroseconds",
        originTraceMicroseconds: correlationClock.originTraceMicroseconds,
        offsetMicroseconds: correlationClock.offsetMicroseconds,
        microsecondsPerMillisecond: correlationClock.microsecondsPerMillisecond,
        scaleUncertaintyMicrosecondsPerMillisecond:
          correlationClock.scaleUncertaintyMicrosecondsPerMillisecond,
        extrapolationMilliseconds: correlationClock.extrapolationMilliseconds,
        conservativeClockAlignmentUncertaintyMicroseconds:
          correlationClock.uncertaintyMicroseconds,
        eventClock: "CDP trace monotonic microseconds",
        rafClock: "window.performance.now() milliseconds via affine mapping",
      },
      frameSampling: {
        intervalCount: canonicalRafWindow.frameSampling.intervalCount,
        medianIntervalMs: canonicalRafWindow.frameSampling.medianIntervalMs,
        p95IntervalMs: canonicalRafWindow.frameSampling.p95IntervalMs,
        intervalsOver20Ms: canonicalRafWindow.frameSampling.intervalsOver20Ms,
        intervalsOver33Ms: canonicalRafWindow.frameSampling.intervalsOver33Ms,
        relativeIntervals: summarizeCorrelatedFrameIntervals(
          canonicalFrameTimestamps,
          correlationClock,
          canonicalWindowEnd,
        ),
      },
      cpuSampleCoverage: canonicalRafWindow.cpuSampleCoverage,
      appFrameCount: canonicalRafWindow.topInclusiveCpuFrames.length,
      topAppFrames: canonicalRafWindow.topInclusiveCpuFrames.slice(0, 20),
      timelineEventCounts: countTimelineEvents(
        canonicalRafWindow.timelineEvents,
      ),
      timelineEventTimings: summarizeRelativeTimeline(
        canonicalRafWindow.timelineEvents,
        canonicalWindowStart,
        canonicalWindowEnd,
      ),
      cpuCaptureStreams: canonicalRafWindow.cpuCaptureStreams,
      traceTimelineScope:
        "preserved separately from CPU selection; trace timeline events/counts are not CPU profile samples",
    },
    pointerContext: {
      durationMs:
        (capture.boundary?.endPerformanceNowMs ?? 0) -
        (capture.boundary?.startPerformanceNowMs ?? 0),
      frameSampling: {
        intervalCount: profileWindow.frameSampling.intervalCount,
        medianIntervalMs: profileWindow.frameSampling.medianIntervalMs,
        p95IntervalMs: profileWindow.frameSampling.p95IntervalMs,
        intervalsOver20Ms: profileWindow.frameSampling.intervalsOver20Ms,
        intervalsOver33Ms: profileWindow.frameSampling.intervalsOver33Ms,
      },
      cpuSampleCoverage: profileWindow.cpuSampleCoverage,
      cpuProfileSource: profileWindow.cpuSampleCoverage.profileSource,
      appFrameCount: profileWindow.topInclusiveCpuFrames.length,
      timelineEventCounts: countTimelineEvents(profileWindow.timelineEvents),
      cpuCaptureStreams: profileWindow.cpuCaptureStreams,
    },
    sourceBindings,
  };
  const summarySerialized = `${JSON.stringify(hostedSummary, null, 2)}\n`;
  expect(summarySerialized).not.toMatch(
    /(?:\/Users\/|\/home\/|raw-captures|traceCpuProfiles|"timelineEvents"|networkSummary|authorization|x-taskdesk-csrf)/i,
  );
  await writeFile(
    path.join(focusedResultDir, "hosted-board-drag-summary.json"),
    summarySerialized,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  await test.info().attach("g11-board-drag-profile.json", {
    body: serialized,
    contentType: "application/json",
  });
  console.info(
    "G11 focused legacy board drag profile",
    JSON.stringify({
      durationMs:
        (capture.boundary?.endPerformanceNowMs ?? 0) -
        (capture.boundary?.startPerformanceNowMs ?? 0),
      frameIntervals: profileWindow?.frameSampling?.intervalCount ?? 0,
      appFrameBuckets: profileWindow?.topInclusiveCpuFrames?.length ?? 0,
      profilerThreads: runtimeMetadata.profilerThreads.length,
    }),
  );
});
