import { createHash } from "node:crypto";

export const COLD_REPORT_MAX_BYTES = 256 * 1024;
export const COLD_MAX_RESOURCES = 2_048;
export const COLD_MAX_PHASE_SEGMENTS = 100_000;
// Pinned Chromium uses two 100 µs clamped page-clock reads per bracket.
export const COLD_CLOCK_TIMER_ALLOWANCE_MS = 0.2;
export const COLD_CLOCK_SUPPORTED_CHROMIUM_VERSION = "153.0.8010.12";
export const COLD_CLOCK_REPORT_RESOLUTION_MS = 0.1;
export const COLD_FAILURE_RECEIPT_MAX_BYTES = 2 * 1024;
export const COLD_FAILURE_RECEIPT_PREFIX = "[hosted-cold-recording] failure ";
export const COLD_CLEANUP_STATES = Object.freeze([
  "not-attempted",
  "ok",
  "failed",
  "unknown",
]);
export const COLD_CLEANUP_OPERATIONS = Object.freeze([
  "childReport",
  "parentReport",
  "generatedSpec",
  "generatedConfig",
  "scratch",
]);
export const COLD_FAILURE_STAGES = Object.freeze([
  "prepare",
  "source-bind",
  "child-start",
  "journey",
  "clock",
  "capture-finish",
  "network",
  "phase",
  "report-build",
  "privacy",
  "report-write",
  "cleanup",
  "unknown",
]);
export const COLD_FAILURE_CODES = Object.freeze([
  "source-binding",
  "build-binding",
  "preflight-validation",
  "child-exit",
  "journey-assertion",
  "clock-sample",
  "clock-alignment",
  "trace-integrity",
  "request-completion",
  "network-clock-incomplete",
  "network-clock",
  "phase-validation",
  "report-schema",
  "report-privacy",
  "report-write",
  "cleanup",
  "unknown",
]);
const COLD_FAILURE_COUNT_BOUNDS = Object.freeze({
  clockSamples: 3,
  traceEventsReceived: 250_000,
  timelineRecordsRetained: 250_000,
  trackedRequests: 2_048,
  incompleteTrackedRequests: 2_048,
  cpuSamples: 500_000,
  cpuNodes: 50_000,
});
const COLD_FAILURE_FLAG_KEYS = Object.freeze([
  "journeyAssertionsComplete",
  "traceOverflow",
  "networkOverflow",
  "traceDataLoss",
  "reportPrivacyPassed",
]);
const OWNED_COLD_FAILURES = new WeakSet();

export class ColdDiagnosticFailure extends Error {
  constructor(code, stage, message = "Cold diagnostic check failed.") {
    if (
      !COLD_FAILURE_CODES.includes(code) ||
      !COLD_FAILURE_STAGES.includes(stage)
    )
      throw new Error("Invalid owned cold diagnostic failure.");
    super(message);
    this.name = "ColdDiagnosticFailure";
    this.code = code;
    this.stage = stage;
    OWNED_COLD_FAILURES.add(this);
    Object.freeze(this);
  }
}

export function coldDiagnosticFailure(code, stage, message) {
  return new ColdDiagnosticFailure(code, stage, message);
}

export function ownedColdDiagnosticFailureFields(error) {
  try {
    if (
      !error ||
      !OWNED_COLD_FAILURES.has(error) ||
      Object.getPrototypeOf(error) !== ColdDiagnosticFailure.prototype
    )
      return null;
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const stage = Object.getOwnPropertyDescriptor(error, "stage");
    if (
      !code ||
      !("value" in code) ||
      !COLD_FAILURE_CODES.includes(code.value) ||
      !stage ||
      !("value" in stage) ||
      !COLD_FAILURE_STAGES.includes(stage.value)
    )
      return null;
    return { code: code.value, stage: stage.value };
  } catch {
    return null;
  }
}

function emptyColdCounts() {
  return Object.fromEntries(
    Object.keys(COLD_FAILURE_COUNT_BOUNDS).map((key) => [key, null]),
  );
}

function emptyColdFlags() {
  return Object.fromEntries(COLD_FAILURE_FLAG_KEYS.map((key) => [key, null]));
}

export function coldCleanupStatuses(defaultStatus = "not-attempted") {
  if (!COLD_CLEANUP_STATES.includes(defaultStatus))
    throw new Error("Invalid cleanup state.");
  return Object.fromEntries(
    COLD_CLEANUP_OPERATIONS.map((operation) => [operation, defaultStatus]),
  );
}

export function createColdFailureReceipt({
  childOutcome,
  primary,
  counts,
  flags,
  cleanup,
}) {
  const receipt = {
    schemaVersion: 2,
    kind: "cold-recorder-failure",
    childOutcome,
    primary,
    counts,
    flags,
    cleanup,
  };
  validateColdFailureReceipt(receipt);
  const encoded = JSON.stringify(receipt);
  if (Buffer.byteLength(encoded, "utf8") > COLD_FAILURE_RECEIPT_MAX_BYTES)
    throw new Error("Cold failure receipt exceeded its byte cap.");
  return receipt;
}

export function unknownColdFailureReceipt(stage = "unknown") {
  const safeStage = COLD_FAILURE_STAGES.includes(stage) ? stage : "unknown";
  return createColdFailureReceipt({
    childOutcome: "unknown",
    primary: { code: "unknown", stage: safeStage },
    counts: emptyColdCounts(),
    flags: emptyColdFlags(),
    cleanup: {
      ...coldCleanupStatuses(),
      childReport: "unknown",
    },
  });
}

function validateColdFailureReceipt(value) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "kind",
      "childOutcome",
      "primary",
      "counts",
      "flags",
      "cleanup",
    ],
    "failure receipt",
  );
  if (value.schemaVersion !== 2 || value.kind !== "cold-recorder-failure")
    throw new Error("Invalid cold failure receipt identity.");
  if (
    !["not-started", "passed", "failed", "unknown"].includes(value.childOutcome)
  )
    throw new Error("Invalid child outcome.");
  if (value.primary === null) {
    if (
      value.childOutcome !== "passed" ||
      !COLD_CLEANUP_OPERATIONS.some(
        (operation) => value.cleanup?.[operation] === "failed",
      )
    )
      throw new Error("Missing primary failure.");
    if (
      value.flags?.journeyAssertionsComplete !== true ||
      value.flags?.reportPrivacyPassed !== true
    )
      throw new Error("Passed child lacks validated report flags.");
  } else {
    exactKeys(value.primary, ["code", "stage"], "primary failure");
    if (
      !COLD_FAILURE_CODES.includes(value.primary.code) ||
      !COLD_FAILURE_STAGES.includes(value.primary.stage)
    )
      throw new Error("Invalid primary failure enum.");
  }
  exactKeys(
    value.counts,
    Object.keys(COLD_FAILURE_COUNT_BOUNDS),
    "failure receipt counts",
  );
  for (const [key, max] of Object.entries(COLD_FAILURE_COUNT_BOUNDS)) {
    const count = value.counts[key];
    if (
      count !== null &&
      (!Number.isInteger(count) || count < 0 || count > max)
    )
      throw new Error("Invalid cold failure receipt count.");
  }
  const tracked = value.counts.trackedRequests;
  const incomplete = value.counts.incompleteTrackedRequests;
  if (tracked !== null && incomplete !== null && incomplete > tracked)
    throw new Error("Invalid cold failure receipt count relationship.");
  exactKeys(value.flags, COLD_FAILURE_FLAG_KEYS, "failure receipt flags");
  for (const key of COLD_FAILURE_FLAG_KEYS) {
    if (value.flags[key] !== null && typeof value.flags[key] !== "boolean")
      throw new Error("Invalid cold failure receipt flag.");
  }
  exactKeys(value.cleanup, COLD_CLEANUP_OPERATIONS, "cleanup statuses");
  for (const [operation, status] of Object.entries(value.cleanup)) {
    if (!COLD_CLEANUP_STATES.includes(status))
      throw new Error("Invalid cleanup status.");
    if (
      status === "unknown" &&
      (operation !== "childReport" || value.childOutcome === "passed")
    )
      throw new Error(
        "Unknown cleanup status is only valid for inaccessible child evidence.",
      );
  }
  return value;
}

export function parseColdFailureReceipt(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > COLD_FAILURE_RECEIPT_MAX_BYTES
  )
    throw new Error("Invalid cold failure receipt byte length.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const receipt = JSON.parse(text);
  validateColdFailureReceipt(receipt);
  // Child receipts use canonical compact JSON; this also rejects duplicate keys.
  if (JSON.stringify(receipt) !== text)
    throw new Error("Noncanonical cold failure receipt encoding.");
  return receipt;
}

export function resolveColdFailureReceipt(bytes, stage = "child-start") {
  try {
    return parseColdFailureReceipt(bytes);
  } catch {
    return unknownColdFailureReceipt(stage);
  }
}

export function formatColdFailureReceiptLine(receipt) {
  const validated = parseColdFailureReceipt(
    Buffer.from(JSON.stringify(receipt), "utf8"),
  );
  return `${COLD_FAILURE_RECEIPT_PREFIX}${JSON.stringify(validated)}`;
}

export function parentChildExitReceipt({
  childOutcome = "failed",
  cleanup,
} = {}) {
  const status = coldCleanupStatuses("not-attempted");
  if (cleanup) Object.assign(status, cleanup);
  if (status.childReport === "not-attempted") status.childReport = "unknown";
  return createColdFailureReceipt({
    childOutcome,
    primary: { code: "child-exit", stage: "child-start" },
    counts: emptyColdCounts(),
    flags: emptyColdFlags(),
    cleanup: status,
  });
}

const ROUTE_PAINT_CRITERION =
  "A route-paint mark requires a positive conservative inward-bounded axis-aligned target region after viewport and ancestor overflow/paint-containment clipping. Subpixel boundary strips may fail closed; ambiguous RTL/root or top-scrollbar origins, CSS zoom other than 1, unsupported transforms, out-of-flow boxes, fragmented targets, nonrectangular clips/masks, nondefault overflow-clip margins, and rounded overflow clips fail closed. This is not pixel-level or occlusion proof.";

const METHODS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);
const RESOURCE_TYPES = new Set([
  "document",
  "eventsource",
  "fetch",
  "font",
  "image",
  "manifest",
  "media",
  "other",
  "script",
  "stylesheet",
  "texttrack",
  "websocket",
  "xhr",
]);
const INITIATOR_TYPES = new Set([
  "parser",
  "script",
  "preload",
  "preflight",
  "other",
]);
const PRIORITIES = new Set(["VeryHigh", "High", "Medium", "Low", "VeryLow"]);
const PHASES = new Set([
  "main-thread-idle",
  "main-thread-other",
  "parse-evaluate",
  "react-render-commit",
  "dom-removal",
  "paint-layout",
]);
const KNOWN_ROUTES = [
  [],
  ["auth", "sign-in"],
  ["agent", "projects", ":project", "work"],
  ["agent", "work-items", ":workItem"],
  ["api", "auth", "get-session"],
  ["api", "config"],
  ["api", "workspace"],
  ["api", "workspace", ":workspace", "work-item-types"],
  ["api", "workspace", ":workspace", "members"],
  ["api", "project"],
  ["api", "project", ":project"],
  ["api", "capabilities"],
  ["api", "label", "workspace", ":workspace"],
  ["api", "projects", ":project", "work-items"],
  ["api", "work-items", ":workItem"],
];

function finite(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${label} schema.`);
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length ||
    actual.some((key, i) => key !== allowed[i])
  )
    throw new Error(`Invalid ${label} schema.`);
}

function safeRoute(value, origin) {
  try {
    const parsed = new URL(value);
    if (parsed.origin !== origin) return "unrecognized";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const segments = path === "/" ? [] : path.slice(1).split("/");
    if (segments.some((segment) => segment.length === 0)) return "unrecognized";
    const match = KNOWN_ROUTES.find(
      (route) =>
        route.length === segments.length &&
        route.every(
          (part, index) => part.startsWith(":") || part === segments[index],
        ),
    );
    return match ? `/${match.join("/")}` || "/" : "unrecognized";
  } catch {
    return "unrecognized";
  }
}

const ASSET_BASENAME_PATTERN =
  /^[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|mjs|woff2?|ttf|otf|svg|png|webp)$/;

export function deriveManifestAssetBasenames(manifest, distPaths) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    !Array.isArray(distPaths)
  )
    throw new Error("Missing verified build manifest inventory.");
  const builtFiles = new Set(distPaths);
  const referenced = new Set();
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid build manifest entry.");
    for (const key of ["file", "css", "assets"]) {
      const values =
        typeof entry[key] === "string"
          ? [entry[key]]
          : Array.isArray(entry[key])
            ? entry[key]
            : [];
      for (const path of values) {
        if (
          typeof path !== "string" ||
          !/^assets\/[A-Za-z0-9_.-]+$/.test(path) ||
          path.includes("..") ||
          !builtFiles.has(path)
        )
          throw new Error("Build manifest asset is not a current dist file.");
        referenced.add(path);
      }
    }
  }
  if (referenced.size === 0 || referenced.size > 20_000)
    throw new Error("Invalid bounded manifest asset inventory.");
  const basenames = new Set();
  for (const path of referenced) {
    const basename = path.slice("assets/".length);
    if (!ASSET_BASENAME_PATTERN.test(basename))
      throw new Error("Manifest asset lacks a hashed basename.");
    basenames.add(basename);
  }
  return basenames;
}

function requireAssetBasenames(value) {
  if (!(value instanceof Set) || value.size === 0 || value.size > 20_000)
    throw new Error("Missing verified build asset allowlist.");
  for (const basename of value) {
    if (typeof basename !== "string" || !ASSET_BASENAME_PATTERN.test(basename))
      throw new Error("Invalid verified build asset allowlist.");
  }
  return value;
}

function clockNumericAllowanceMs(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value))
  )
    throw new Error("Invalid numeric clock conversion.");
  // Eight ULPs cover the bounded multiply, midpoint and subtraction steps.
  const allowanceMs = 8 * Number.EPSILON * Math.max(1, ...values.map(Math.abs));
  if (
    !Number.isFinite(allowanceMs) ||
    allowanceMs >= COLD_CLOCK_REPORT_RESOLUTION_MS
  )
    throw new Error(
      "Clock conversion cannot preserve report coordinate resolution.",
    );
  return allowanceMs;
}

export function createColdClockSample({
  chromiumVersion,
  timestampSeconds,
  beforeMs,
  afterMs,
  beforeTimeOriginMs,
  afterTimeOriginMs,
  expectedTimeOriginMs,
}) {
  if (chromiumVersion !== COLD_CLOCK_SUPPORTED_CHROMIUM_VERSION)
    throw coldDiagnosticFailure(
      "clock-sample",
      "clock",
      "Clock precision contract is not verified for this Chromium version.",
    );
  if (
    !finite(timestampSeconds, 0, Number.MAX_SAFE_INTEGER / 1000) ||
    !finite(beforeMs, 0, Number.MAX_SAFE_INTEGER) ||
    !finite(afterMs, 0, Number.MAX_SAFE_INTEGER) ||
    afterMs < beforeMs ||
    !finite(beforeTimeOriginMs, 1, Number.MAX_SAFE_INTEGER) ||
    beforeTimeOriginMs !== afterTimeOriginMs ||
    (expectedTimeOriginMs !== undefined &&
      beforeTimeOriginMs !== expectedTimeOriginMs)
  )
    throw coldDiagnosticFailure(
      "clock-sample",
      "clock",
      "Invalid or changed document clock sample.",
    );

  const timestampMs = timestampSeconds * 1000;
  if (!finite(timestampMs, 0, Number.MAX_SAFE_INTEGER))
    throw coldDiagnosticFailure(
      "clock-sample",
      "clock",
      "CDP timestamp conversion is unsafe.",
    );
  const midpointMs = beforeMs / 2 + afterMs / 2;
  const numericAllowanceMs = clockNumericAllowanceMs([
    timestampMs,
    beforeMs,
    afterMs,
    midpointMs,
  ]);
  const offsetMs = timestampMs - midpointMs;
  const offsetNumericAllowanceMs = clockNumericAllowanceMs([
    timestampMs,
    midpointMs,
    offsetMs,
  ]);
  const precisionAllowanceMs =
    COLD_CLOCK_TIMER_ALLOWANCE_MS +
    numericAllowanceMs +
    offsetNumericAllowanceMs;
  const bracketMs = afterMs - beforeMs;
  const uncertaintyMs = bracketMs / 2 + precisionAllowanceMs;
  if (
    !Number.isFinite(offsetMs) ||
    offsetMs < -precisionAllowanceMs ||
    !finite(bracketMs, 0, Number.MAX_SAFE_INTEGER) ||
    !finite(uncertaintyMs, 0, 1000)
  )
    throw coldDiagnosticFailure(
      "clock-sample",
      "clock",
      "Clock sample exceeds its safe coordinate or uncertainty bound.",
    );
  return {
    offsetMs,
    uncertaintyMs,
    precisionAllowanceMs,
    documentTimeOriginMs: beforeTimeOriginMs,
  };
}

export function estimateClockAlignment(samples) {
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 100)
    throw coldDiagnosticFailure(
      "clock-alignment",
      "clock",
      "Invalid bounded clock alignment samples.",
    );
  const documentTimeOriginMs = samples[0]?.documentTimeOriginMs;
  if (
    samples.some(
      (sample) =>
        !sample ||
        !finite(
          sample.offsetMs,
          -Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
        ) ||
        !finite(sample.uncertaintyMs, COLD_CLOCK_TIMER_ALLOWANCE_MS, 1000) ||
        !finite(
          sample.precisionAllowanceMs,
          COLD_CLOCK_TIMER_ALLOWANCE_MS,
          0.3,
        ) ||
        sample.offsetMs < -sample.precisionAllowanceMs ||
        !finite(sample.documentTimeOriginMs, 1, Number.MAX_SAFE_INTEGER) ||
        sample.documentTimeOriginMs !== documentTimeOriginMs ||
        clockNumericAllowanceMs([sample.offsetMs]) >=
          COLD_CLOCK_REPORT_RESOLUTION_MS,
    )
  )
    throw coldDiagnosticFailure(
      "clock-alignment",
      "clock",
      "Invalid clock alignment sample.",
    );
  const offsetMs = samples.reduce(
    (sum, sample) => sum + sample.offsetMs / samples.length,
    0,
  );
  const alignmentNumericAllowanceMs = clockNumericAllowanceMs([
    ...samples.map((sample) => sample.offsetMs),
    offsetMs,
  ]);
  const uncertaintyMs =
    Math.max(
      ...samples.map(
        (sample) => Math.abs(sample.offsetMs - offsetMs) + sample.uncertaintyMs,
      ),
    ) + alignmentNumericAllowanceMs;
  if (
    !finite(offsetMs, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) ||
    !finite(uncertaintyMs, COLD_CLOCK_TIMER_ALLOWANCE_MS, 1000)
  )
    throw coldDiagnosticFailure(
      "clock-alignment",
      "clock",
      "Clock alignment exceeds its safe coordinate or uncertainty bound.",
    );
  return { offsetMs, uncertaintyMs, documentTimeOriginMs };
}

function pageRelativeMs(valueMs, offsetMs, code, stage) {
  if (
    !finite(valueMs, 0, Number.MAX_SAFE_INTEGER) ||
    !finite(offsetMs, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  )
    throw coldDiagnosticFailure(code, stage, "Invalid clock-domain value.");
  const resultMs = valueMs - offsetMs;
  if (
    !finite(resultMs, -60_000, 600_000) ||
    clockNumericAllowanceMs([valueMs, offsetMs, resultMs]) >=
      COLD_CLOCK_REPORT_RESOLUTION_MS
  )
    throw coldDiagnosticFailure(
      code,
      stage,
      "Clock translation is outside the report time window or resolution.",
    );
  return resultMs;
}

export function translateColdNetworkTimestamp(timestampSeconds, offsetMs) {
  if (!finite(timestampSeconds, 0, Number.MAX_SAFE_INTEGER / 1000))
    throw coldDiagnosticFailure(
      "network-clock",
      "network",
      "Invalid CDP network timestamp.",
    );
  const timestampMs = timestampSeconds * 1000;
  if (!finite(timestampMs, 0, Number.MAX_SAFE_INTEGER))
    throw coldDiagnosticFailure(
      "network-clock",
      "network",
      "CDP network timestamp conversion is unsafe.",
    );
  return pageRelativeMs(timestampMs, offsetMs, "network-clock", "network");
}

export function translateColdTraceInterval(
  timestampMicroseconds,
  durationMicroseconds,
  offsetMs,
) {
  if (
    !finite(timestampMicroseconds, 0, Number.MAX_SAFE_INTEGER) ||
    !finite(durationMicroseconds, 0, Number.MAX_SAFE_INTEGER)
  )
    throw coldDiagnosticFailure(
      "phase-validation",
      "phase",
      "Invalid CDP trace interval.",
    );
  const timestampMs = timestampMicroseconds / 1000;
  const durationMs = durationMicroseconds / 1000;
  if (
    !finite(timestampMs, 0, Number.MAX_SAFE_INTEGER) ||
    !finite(durationMs, 0, Number.MAX_SAFE_INTEGER)
  )
    throw coldDiagnosticFailure(
      "phase-validation",
      "phase",
      "CDP trace interval conversion is unsafe.",
    );
  const startMs = pageRelativeMs(
    timestampMs,
    offsetMs,
    "phase-validation",
    "phase",
  );
  const endMs = startMs + durationMs;
  if (
    !finite(endMs, startMs, 600_000) ||
    clockNumericAllowanceMs([timestampMs, durationMs, startMs, endMs]) >=
      COLD_CLOCK_REPORT_RESOLUTION_MS
  )
    throw coldDiagnosticFailure(
      "phase-validation",
      "phase",
      "Translated CDP trace interval is unsafe or outside the report time window.",
    );
  return { startMs, endMs, durationMs };
}

export function assertColdMainThreadJourneyOverlap(intervals, journeyEndMs) {
  if (
    !Array.isArray(intervals) ||
    intervals.length === 0 ||
    !finite(journeyEndMs, Number.MIN_VALUE, 600_000) ||
    intervals.some(
      (interval) =>
        !interval ||
        !finite(interval.start, -60_000, 600_000) ||
        !finite(interval.end, interval.start, 600_000),
    ) ||
    !intervals.some(
      (interval) => interval.start < journeyEndMs && interval.end > 0,
    )
  )
    throw coldDiagnosticFailure(
      "phase-validation",
      "phase",
      "No valid main-thread task overlaps the observed journey.",
    );
  return true;
}

function safeAsset(value, origin, assetBasenames) {
  try {
    const parsed = new URL(value);
    if (parsed.origin !== origin) return { kind: "unrecognized" };
    const basename = parsed.pathname.split("/").at(-1) ?? "";
    return assetBasenames.has(basename)
      ? { kind: "asset", basename }
      : { kind: "unrecognized" };
  } catch {
    return { kind: "unrecognized" };
  }
}

function safeHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function boundedCount(value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`Invalid bounded ${label} count.`);
  }
  return value;
}

function safeResource(resource, origin, assetBasenames) {
  const method = METHODS.has(resource.method) ? resource.method : "OTHER";
  const resourceType = RESOURCE_TYPES.has(resource.resourceType)
    ? resource.resourceType
    : "other";
  const route = safeRoute(resource.url, origin);
  const asset = safeAsset(resource.url, origin, assetBasenames);
  const output = {
    method,
    route,
    resourceType,
    source:
      asset.kind === "asset"
        ? asset.basename
        : route === "unrecognized"
          ? "unrecognized"
          : route,
    initiatorType: INITIATOR_TYPES.has(resource.initiatorType)
      ? resource.initiatorType
      : "other",
    initiatorSource:
      safeAsset(resource.initiatorUrl ?? "", origin, assetBasenames).basename ??
      safeRoute(resource.initiatorUrl ?? "", origin),
  };
  if (
    Number.isInteger(resource.status) &&
    resource.status >= 100 &&
    resource.status <= 599
  )
    output.status = resource.status;
  if (resource.failed === true) output.failed = true;
  if (PRIORITIES.has(resource.priority)) output.priority = resource.priority;
  if (resource.timing !== undefined) {
    if (
      !resource.timing ||
      !finite(resource.timing.start, -60_000, 600_000) ||
      !finite(resource.timing.end, resource.timing.start, 600_000)
    )
      throw new Error(
        "Translated resource timing is invalid or outside its page-relative window.",
      );
    output.timingMs = {
      start: Math.round(resource.timing.start * 10) / 10,
      end: Math.round(resource.timing.end * 10) / 10,
    };
  }
  return output;
}

function safePhaseSegments(segments) {
  if (
    !Array.isArray(segments) ||
    segments.length === 0 ||
    segments.length > COLD_MAX_PHASE_SEGMENTS
  )
    throw new Error("Invalid or oversized phase table.");
  let previousEnd = Number.NEGATIVE_INFINITY;
  return segments.map((segment) => {
    if (
      !PHASES.has(segment.phase) ||
      !finite(segment.start, -60_000, 600_000) ||
      !finite(segment.end, segment.start, 600_000) ||
      segment.start < previousEnd - 0.1
    ) {
      throw new Error(
        "Invalid or overlapping mutually exclusive phase segment.",
      );
    }
    previousEnd = segment.end;
    return {
      phase: segment.phase,
      startMs: Math.round(segment.start * 10) / 10,
      durationMs: Math.round((segment.end - segment.start) * 10) / 10,
    };
  });
}

function safeBoundary(value, label) {
  if (!value || typeof value !== "object")
    throw new Error(`Missing ${label} boundary.`);
  const output = {};
  for (const key of ["lcpMs", "routeStartMs", "routePaintMs"]) {
    if (key in value) {
      if (!finite(value[key], 0, 600_000))
        throw new Error(`Invalid ${label} ${key}.`);
      output[key] = Math.round(value[key] * 10) / 10;
    }
  }
  return output;
}

function safeAggregate(value) {
  if (
    !value ||
    !Number.isInteger(value.count) ||
    value.count < 0 ||
    value.count > 20_000
  ) {
    throw new Error("Invalid build evidence count.");
  }
  const hash = safeHash(value.sha256);
  if (!hash) throw new Error("Invalid build evidence hash.");
  return { count: value.count, sha256: hash };
}

function windowPhaseTotals(segments, start, end) {
  if (!finite(start, -60_000, 600_000) || !finite(end, start, 600_000))
    throw new Error("Invalid measured-window bounds.");
  return Object.fromEntries(
    [...PHASES].map((phase) => [
      phase,
      Math.round(
        segments.reduce((total, segment) => {
          if (segment.phase !== phase) return total;
          const segmentEnd = segment.startMs + segment.durationMs;
          return (
            total +
            Math.max(
              0,
              Math.min(end, segmentEnd) - Math.max(start, segment.startMs),
            )
          );
        }, 0) * 10,
      ) / 10,
    ]),
  );
}

function nonCausalIdleRequestOverlap(resources, segments) {
  const trackedRoutes = new Set([
    "/api/auth/get-session",
    "/api/projects/:project/work-items",
  ]);
  const events = new Map();
  const add = (time, kind, route, delta) => {
    const row = events.get(time) ?? { idleDelta: 0, requests: new Map() };
    if (kind === "idle") row.idleDelta += delta;
    else row.requests.set(route, (row.requests.get(route) ?? 0) + delta);
    events.set(time, row);
  };
  for (const segment of segments) {
    if (segment.phase !== "main-thread-idle") continue;
    add(segment.startMs, "idle", "", 1);
    add(segment.startMs + segment.durationMs, "idle", "", -1);
  }
  for (const resource of resources) {
    if (!trackedRoutes.has(resource.route) || !resource.timingMs) continue;
    add(resource.timingMs.start, "request", resource.route, 1);
    add(resource.timingMs.end, "request", resource.route, -1);
  }
  const points = [...events.keys()].sort((left, right) => left - right);
  const activeRequests = new Map();
  const totals = new Map();
  let activeIdle = 0;
  for (let index = 0; index < points.length; index += 1) {
    const at = points[index];
    const event = events.get(at);
    activeIdle += event.idleDelta;
    for (const [route, delta] of event.requests) {
      const next = (activeRequests.get(route) ?? 0) + delta;
      if (next > 0) activeRequests.set(route, next);
      else activeRequests.delete(route);
    }
    const next = points[index + 1];
    if (next === undefined || activeIdle <= 0 || next <= at) continue;
    for (const [route, count] of activeRequests)
      totals.set(route, (totals.get(route) ?? 0) + (next - at) * count);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, overlapMs]) => ({
      route,
      overlapMs: Math.round(overlapMs * 10) / 10,
    }));
}

export function buildSanitizedColdReport(input) {
  if (
    input?.rowCount !== 500 ||
    input?.detailVisible !== true ||
    input?.urlVerified !== true
  )
    throw new Error(
      "Cold journey did not prove all rows and visible detail URL.",
    );
  if (
    !finite(input.lcpMs, 0, 600_000) ||
    !finite(input.routeStartMs, 0, 600_000) ||
    !finite(input.routePaintMs, 0, 600_000) ||
    input.routeStartMs <= 0 ||
    input.routePaintMs <= 0 ||
    !["loading", "detail"].includes(input.routePaintTarget) ||
    !Number.isInteger(input.routeVisibilityProbeCount) ||
    input.routeVisibilityProbeCount < 1 ||
    input.routeVisibilityProbeCount > 100_000 ||
    !finite(input.routeVisibilityProbeTotalMs, 0, 60_000) ||
    !finite(input.routeVisibilityProbeMaxMs, 0, 10_000) ||
    input.routeVisibilityProbeMaxMs > input.routeVisibilityProbeTotalMs ||
    !Number.isInteger(input.rowsAtPostObserverSample) ||
    input.rowsAtPostObserverSample < 0 ||
    input.rowsAtPostObserverSample > 500 ||
    !finite(input.rowCountSampleAtMs, input.lcpMs, 600_000) ||
    !finite(input.rowCountSampleAfterLcpEntryMs, 0, 600_000) ||
    Math.abs(
      input.rowCountSampleAtMs -
        input.lcpMs -
        input.rowCountSampleAfterLcpEntryMs,
    ) > 0.01
  )
    throw new Error("Cold journey timing marks are invalid.");
  if (input.clickTarget !== "WLP-1")
    throw new Error(
      "Cold journey click target is not the fixed WLP-1 fixture.",
    );
  if (input.lcpElementTag !== "h1")
    throw new Error("Cold journey did not preserve the existing H1 LCP mark.");
  if (
    input.traceDataLoss !== false ||
    input.traceTruncated !== false ||
    input.networkTruncated !== false
  )
    throw new Error("Cold recording contains trace or network data loss.");
  if (!Array.isArray(input.resources))
    throw new Error("Missing bounded resource records.");
  boundedCount(input.resources.length, COLD_MAX_RESOURCES, "resource");
  const phaseSegments = safePhaseSegments(input.phaseSegments);
  const provenance = input.provenance;
  if (!provenance || !/^[a-f0-9]{40}$/i.test(provenance.sourceSha ?? ""))
    throw new Error("Missing exact source SHA.");
  if (
    !/^[a-f0-9]{40}$/i.test(provenance.candidateHeadSha ?? "") ||
    provenance.sourceSha.toLowerCase() !==
      provenance.candidateHeadSha.toLowerCase()
  )
    throw new Error("Candidate SHA does not bind to the exact source SHA.");
  if (!/^[a-f0-9]{64}$/i.test(provenance.benchmarkSha256 ?? ""))
    throw new Error("Missing canonical benchmark hash.");
  if (!/^[a-f0-9]{64}$/i.test(provenance.routePaintRecorderSha256 ?? ""))
    throw new Error("Missing shared route-paint recorder hash.");
  for (const version of [
    provenance.nodeVersion,
    provenance.pnpmVersion,
    provenance.playwrightVersion,
    provenance.chromiumVersion,
  ]) {
    if (
      typeof version !== "string" ||
      !/^\d+(?:\.\d+){2,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(version)
    )
      throw new Error("Missing complete tool version provenance.");
  }
  if (
    input.clockUncertaintyMs === undefined ||
    !finite(input.clockUncertaintyMs, 0, 1000)
  )
    throw new Error("Invalid numeric clock uncertainty.");
  if (
    provenance.sourceSha.toLowerCase() !==
    provenance.expectedSourceSha?.toLowerCase()
  )
    throw new Error("Source binding does not match the requested exact head.");
  const indexHtmlSha256 = safeHash(provenance.build?.indexHtmlSha256);
  const manifestSha256 = safeHash(provenance.build?.manifestSha256);
  const perfConfigSha256 = safeHash(provenance.perfConfigSha256);
  const networkHelperSha256 = safeHash(provenance.networkHelperSha256);
  if (
    !indexHtmlSha256 ||
    !manifestSha256 ||
    !perfConfigSha256 ||
    !networkHelperSha256
  )
    throw new Error("Missing exact build or source binding hashes.");

  const assetBasenames = requireAssetBasenames(input.assetBasenames);
  const origin = "http://127.0.0.1:4179";
  const safeResources = input.resources.map((resource) =>
    safeResource(resource, origin, assetBasenames),
  );
  if (safeResources.length > COLD_MAX_RESOURCES)
    throw new Error("Sanitized resource table exceeded its bound.");
  if (
    !safeResources.some(
      (resource) =>
        resource.route === "/api/projects/:project/work-items" &&
        resource.timingMs !== undefined,
    )
  )
    throw coldDiagnosticFailure(
      "request-completion",
      "report-build",
      "Cold journey lacks a valid translated work-list request interval.",
    );
  const safeSegments = phaseSegments;
  const report = {
    schemaVersion: 1,
    kind: "hosted-cold-work-list-to-detail-diagnostic",
    acceptance: "diagnostic-only",
    provenance: {
      sourceSha: provenance.sourceSha.toLowerCase(),
      candidateHeadSha: provenance.candidateHeadSha.toLowerCase(),
      benchmarkSha256: provenance.benchmarkSha256.toLowerCase(),
      routePaintRecorderSha256:
        provenance.routePaintRecorderSha256.toLowerCase(),
      perfConfigSha256,
      networkHelperSha256,
      nodeVersion: provenance.nodeVersion,
      pnpmVersion: provenance.pnpmVersion,
      playwrightVersion: provenance.playwrightVersion,
      chromiumVersion: provenance.chromiumVersion,
      build: {
        indexHtmlSha256,
        manifestSha256,
        dist: safeAggregate(provenance.build?.dist),
        javascript: safeAggregate(provenance.build?.javascript),
        sourceMaps: safeAggregate(provenance.build?.sourceMaps),
      },
    },
    environment: {
      viewport: { width: 1280, height: 720 },
      network: { profile: "Fast 4G", downKbps: 1600, upKbps: 750, rttMs: 150 },
      cpuSlowdown: 4,
      rows: 500,
    },
    journey: {
      directRoute: "/agent/projects/:project/work",
      lcpMs: Math.round(input.lcpMs * 10) / 10,
      lcpElementTag: "h1",
      rowsAtPostObserverSample: input.rowsAtPostObserverSample,
      rowCountSampleAtMs: Math.round(input.rowCountSampleAtMs * 10) / 10,
      rowCountSampleAfterLcpEntryMs:
        Math.round(input.rowCountSampleAfterLcpEntryMs * 10) / 10,
      rowCountSampleTimebase: "document-performance-timeline-ms",
      rowsReadyCount: input.rowCount,
      clickTarget: "WLP-1",
      clickRoute: "/agent/work-items/:workItem",
      routeStartMs: Math.round(input.routeStartMs * 10) / 10,
      routePaintMs: Math.round(input.routePaintMs * 10) / 10,
      routePaintTarget: input.routePaintTarget,
      visibilityProbeOverhead: {
        measurement: "performance.now-bracketed probe duration",
        resolutionMs: 0.1,
        mayPerturbMark: true,
        resolutionNote:
          "A 0.0 ms reading is below report resolution and is not evidence of zero observer effect.",
        sampleCount: boundedCount(
          input.routeVisibilityProbeCount,
          100_000,
          "visibility probe",
        ),
        totalMs: Math.ceil(input.routeVisibilityProbeTotalMs * 10) / 10,
        maxMs: Math.ceil(input.routeVisibilityProbeMaxMs * 10) / 10,
      },
      detailVisible: true,
      detailUrlVerified: true,
    },
    clocks: {
      alignmentUncertaintyMs: Math.ceil(input.clockUncertaintyMs * 10) / 10,
      pairwiseCoordinateRoundingMs: 0.1,
      alignmentBound: "maximum-sampled-offset-residual-plus-bracket",
      driftBetweenSamples: "unmeasured",
      dataLoss: false,
      traceEventCount: boundedCount(
        input.traceEventCount,
        1_000_000,
        "trace event",
      ),
      timelineRecordCount: boundedCount(
        input.timelineRecordCount,
        1_000_000,
        "timeline record",
      ),
      cpuSamples: boundedCount(input.cpuSampleCount, 500_000, "CPU sample"),
    },
    resources: safeResources,
    mutuallyExclusiveMainThreadPhases: safeSegments,
    nonCausalOverlays: {
      idleRequestTemporalOverlap: nonCausalIdleRequestOverlap(
        safeResources,
        safeSegments,
      ),
      note: "Per-route sums of request/idle temporal overlap; overlapping request intervals may be counted more than once. It does not identify a wait boundary or causal edge and is not added to phase totals.",
    },
    phaseTotalsMs: Object.fromEntries(
      [...PHASES].map((phase) => [
        phase,
        Math.round(
          safeSegments
            .filter((segment) => segment.phase === phase)
            .reduce((total, segment) => total + segment.durationMs, 0) * 10,
        ) / 10,
      ]),
    ),
    windowAccounting: {
      lcpWindow: safeBoundary(input.lcpWindow, "LCP"),
      clickToPaintWindow: safeBoundary(input.clickWindow, "click"),
      phaseTotalsByWindow: {
        lcp: windowPhaseTotals(safeSegments, 0, input.lcpMs),
        clickToPaint: windowPhaseTotals(
          safeSegments,
          input.routeStartMs,
          input.routeStartMs + input.routePaintMs,
        ),
      },
      note: "Main-thread phases are exclusive; resource intervals are a correlated overlay and are not added to phase totals.",
    },
    interpretation: {
      causalEdges: "unresolved-by-design",
      routePaintCriterion: ROUTE_PAINT_CRITERION,
      rule: "A proposed edge is unresolved when its clock uncertainty intervals overlap; temporal proximity alone is not causal evidence.",
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(report), "utf8");
  if (bytes > COLD_REPORT_MAX_BYTES)
    throw new Error("Sanitized report exceeded its byte bound.");
  return report;
}

export function assertColdReportPrivacy(report, verifiedAssetBasenames) {
  const assetBasenames = requireAssetBasenames(verifiedAssetBasenames);
  exactKeys(
    report,
    [
      "schemaVersion",
      "kind",
      "acceptance",
      "provenance",
      "environment",
      "journey",
      "clocks",
      "resources",
      "mutuallyExclusiveMainThreadPhases",
      "nonCausalOverlays",
      "phaseTotalsMs",
      "windowAccounting",
      "interpretation",
    ],
    "root report",
  );
  if (
    report.schemaVersion !== 1 ||
    report.kind !== "hosted-cold-work-list-to-detail-diagnostic" ||
    report.acceptance !== "diagnostic-only"
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Cold report identity is invalid.",
    );
  if (
    !Array.isArray(report.resources) ||
    report.resources.length > COLD_MAX_RESOURCES
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Resource table is missing or oversized.",
    );
  if (
    !Array.isArray(report.mutuallyExclusiveMainThreadPhases) ||
    report.mutuallyExclusiveMainThreadPhases.length === 0 ||
    report.mutuallyExclusiveMainThreadPhases.length > COLD_MAX_PHASE_SEGMENTS
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Phase table is missing or oversized.",
    );
  const encoded = JSON.stringify(report);
  if (Buffer.byteLength(encoded, "utf8") > COLD_REPORT_MAX_BYTES)
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Sanitized report exceeded its byte bound.",
    );
  for (const forbidden of [
    "http://",
    "https://",
    "?",
    "cookie",
    "authorization",
    "headers",
    "requestbody",
    "responsebody",
    "domsnapshot",
    "traceevents",
    "callframe",
    "textcontent",
    "exceptiontext",
    "rawurl",
  ]) {
    if (encoded.toLowerCase().includes(forbidden.toLowerCase()))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        `Sanitized report contains forbidden field content: ${forbidden}`,
      );
  }
  exactKeys(
    report.environment,
    ["viewport", "network", "cpuSlowdown", "rows"],
    "environment",
  );
  exactKeys(report.environment.viewport, ["width", "height"], "viewport");
  exactKeys(
    report.environment.network,
    ["profile", "downKbps", "upKbps", "rttMs"],
    "network profile",
  );
  if (
    report.environment.viewport.width !== 1280 ||
    report.environment.viewport.height !== 720 ||
    report.environment.network.profile !== "Fast 4G" ||
    report.environment.network.downKbps !== 1600 ||
    report.environment.network.upKbps !== 750 ||
    report.environment.network.rttMs !== 150 ||
    report.environment.cpuSlowdown !== 4 ||
    report.environment.rows !== 500
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Cold recording environment is outside its fixed profile.",
    );
  exactKeys(
    report.journey,
    [
      "directRoute",
      "lcpMs",
      "lcpElementTag",
      "rowsAtPostObserverSample",
      "rowCountSampleAtMs",
      "rowCountSampleAfterLcpEntryMs",
      "rowCountSampleTimebase",
      "rowsReadyCount",
      "clickTarget",
      "clickRoute",
      "routeStartMs",
      "routePaintMs",
      "routePaintTarget",
      "visibilityProbeOverhead",
      "detailVisible",
      "detailUrlVerified",
    ],
    "journey",
  );
  if (
    report.journey.directRoute !== "/agent/projects/:project/work" ||
    report.journey.clickRoute !== "/agent/work-items/:workItem"
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Journey route is not a fixed route template.",
    );
  exactKeys(
    report.journey.visibilityProbeOverhead,
    [
      "measurement",
      "resolutionMs",
      "mayPerturbMark",
      "resolutionNote",
      "sampleCount",
      "totalMs",
      "maxMs",
    ],
    "visibility probe overhead",
  );
  if (
    report.journey.visibilityProbeOverhead.measurement !==
      "performance.now-bracketed probe duration" ||
    report.journey.visibilityProbeOverhead.resolutionMs !== 0.1 ||
    report.journey.visibilityProbeOverhead.mayPerturbMark !== true ||
    report.journey.visibilityProbeOverhead.resolutionNote !==
      "A 0.0 ms reading is below report resolution and is not evidence of zero observer effect." ||
    !Number.isInteger(report.journey.visibilityProbeOverhead.sampleCount) ||
    !finite(report.journey.visibilityProbeOverhead.sampleCount, 1, 100_000) ||
    !finite(report.journey.visibilityProbeOverhead.totalMs, 0, 60_000) ||
    !finite(report.journey.visibilityProbeOverhead.maxMs, 0, 10_000) ||
    report.journey.visibilityProbeOverhead.maxMs >
      report.journey.visibilityProbeOverhead.totalMs
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Invalid visibility probe overhead evidence.",
    );
  if (
    !["loading", "detail"].includes(report.journey.routePaintTarget) ||
    report.journey.lcpElementTag !== "h1" ||
    report.journey.clickTarget !== "WLP-1" ||
    report.journey.rowsReadyCount !== 500 ||
    report.journey.detailVisible !== true ||
    report.journey.detailUrlVerified !== true
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Journey evidence does not match the bounded recording.",
    );
  for (const key of [
    "lcpMs",
    "rowCountSampleAtMs",
    "rowCountSampleAfterLcpEntryMs",
    "routeStartMs",
    "routePaintMs",
  ])
    if (!finite(report.journey[key], 0, 600_000))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Invalid journey timing value.",
      );
  if (
    report.journey.lcpMs <= 0 ||
    report.journey.routeStartMs <= 0 ||
    report.journey.routePaintMs <= 0 ||
    Math.abs(
      report.journey.rowCountSampleAtMs -
        report.journey.lcpMs -
        report.journey.rowCountSampleAfterLcpEntryMs,
    ) > 0.11
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Journey timing correlation is invalid.",
    );
  if (
    !Number.isInteger(report.journey.rowsAtPostObserverSample) ||
    !finite(report.journey.rowsAtPostObserverSample, 0, 500) ||
    report.journey.rowCountSampleTimebase !== "document-performance-timeline-ms"
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Invalid post-observer row sample.",
    );
  exactKeys(
    report.clocks,
    [
      "alignmentUncertaintyMs",
      "pairwiseCoordinateRoundingMs",
      "alignmentBound",
      "driftBetweenSamples",
      "dataLoss",
      "traceEventCount",
      "timelineRecordCount",
      "cpuSamples",
    ],
    "clocks",
  );
  if (
    report.clocks.alignmentBound !==
      "maximum-sampled-offset-residual-plus-bracket" ||
    report.clocks.driftBetweenSamples !== "unmeasured" ||
    report.clocks.pairwiseCoordinateRoundingMs !== 0.1
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Clock report overstates unmeasured alignment precision.",
    );
  if (
    !finite(report.clocks.alignmentUncertaintyMs, 0, 1000) ||
    report.clocks.dataLoss !== false ||
    !Number.isInteger(report.clocks.traceEventCount) ||
    !finite(report.clocks.traceEventCount, 0, 1_000_000) ||
    !Number.isInteger(report.clocks.timelineRecordCount) ||
    !finite(report.clocks.timelineRecordCount, 0, 1_000_000) ||
    !Number.isInteger(report.clocks.cpuSamples) ||
    !finite(report.clocks.cpuSamples, 0, 500_000)
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Invalid clock or capture integrity report.",
    );
  const metadata = { ...report };
  delete metadata.resources;
  const encodedMetadata = JSON.stringify(metadata);
  for (const basename of assetBasenames) {
    if (encodedMetadata.includes(basename))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Verified asset basename leaked outside resource labels.",
      );
  }
  exactKeys(
    report.provenance,
    [
      "sourceSha",
      "candidateHeadSha",
      "benchmarkSha256",
      "routePaintRecorderSha256",
      "perfConfigSha256",
      "networkHelperSha256",
      "nodeVersion",
      "pnpmVersion",
      "playwrightVersion",
      "chromiumVersion",
      "build",
    ],
    "provenance",
  );
  exactKeys(
    report.provenance.build,
    ["indexHtmlSha256", "manifestSha256", "dist", "javascript", "sourceMaps"],
    "build provenance",
  );
  for (const value of [
    report.provenance.sourceSha,
    report.provenance.candidateHeadSha,
  ])
    if (!/^[a-f0-9]{40}$/.test(value))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Invalid source binding.",
      );
  if (report.provenance.sourceSha !== report.provenance.candidateHeadSha)
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Source hashes do not match the candidate head.",
    );
  for (const key of [
    "benchmarkSha256",
    "routePaintRecorderSha256",
    "perfConfigSha256",
    "networkHelperSha256",
    "indexHtmlSha256",
    "manifestSha256",
  ])
    if (
      !/^[a-f0-9]{64}$/.test(
        report.provenance[key] ?? report.provenance.build[key],
      )
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Invalid source or build hash binding.",
      );
  for (const key of ["dist", "javascript", "sourceMaps"]) {
    exactKeys(
      report.provenance.build[key],
      ["count", "sha256"],
      `${key} build aggregate`,
    );
    if (
      !Number.isInteger(report.provenance.build[key].count) ||
      !finite(report.provenance.build[key].count, 0, 20_000) ||
      !/^[a-f0-9]{64}$/.test(report.provenance.build[key].sha256)
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Invalid build aggregate.",
      );
  }
  for (const key of [
    "nodeVersion",
    "pnpmVersion",
    "playwrightVersion",
    "chromiumVersion",
  ])
    if (
      typeof report.provenance[key] !== "string" ||
      !/^\d+(?:\.\d+){2,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(report.provenance[key])
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Invalid tool-version provenance.",
      );
  if (
    Object.keys(report.nonCausalOverlays).sort().join(",") !==
      "idleRequestTemporalOverlap,note" ||
    report.nonCausalOverlays.note !==
      "Per-route sums of request/idle temporal overlap; overlapping request intervals may be counted more than once. It does not identify a wait boundary or causal edge and is not added to phase totals." ||
    !Array.isArray(report.nonCausalOverlays.idleRequestTemporalOverlap) ||
    report.nonCausalOverlays.idleRequestTemporalOverlap.length > 2
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Invalid non-causal request overlap overlay.",
    );
  const overlayRoutes = new Set([
    "/api/auth/get-session",
    "/api/projects/:project/work-items",
  ]);
  const seenOverlayRoutes = new Set();
  for (const overlay of report.nonCausalOverlays.idleRequestTemporalOverlap) {
    if (
      Object.keys(overlay).sort().join(",") !== "overlapMs,route" ||
      !overlayRoutes.has(overlay.route) ||
      seenOverlayRoutes.has(overlay.route) ||
      !finite(overlay.overlapMs, 0, 1_000_000)
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Invalid non-causal request overlap row.",
      );
    seenOverlayRoutes.add(overlay.route);
  }
  const routeLabels = new Set(
    KNOWN_ROUTES.map((route) => `/${route.join("/")}` || "/"),
  );
  for (const resource of report.resources) {
    const allowedResourceKeys = [
      "method",
      "route",
      "resourceType",
      "source",
      "initiatorType",
      "initiatorSource",
      "status",
      "failed",
      "priority",
      "timingMs",
    ];
    if (
      !resource ||
      typeof resource !== "object" ||
      Array.isArray(resource) ||
      Object.keys(resource).some((key) => !allowedResourceKeys.includes(key))
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource report contains an unknown field.",
      );
    for (const key of [
      "method",
      "route",
      "resourceType",
      "source",
      "initiatorType",
      "initiatorSource",
    ])
      if (typeof resource[key] !== "string")
        throw coldDiagnosticFailure(
          "report-privacy",
          "privacy",
          "Resource string field has an invalid type.",
        );
    if (!METHODS.has(resource.method) && resource.method !== "OTHER")
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource method is invalid.",
      );
    if (!RESOURCE_TYPES.has(resource.resourceType))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource type is invalid.",
      );
    if (!INITIATOR_TYPES.has(resource.initiatorType))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource initiator type is invalid.",
      );
    if ("status" in resource && !finite(resource.status, 100, 599))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource status is invalid.",
      );
    if ("failed" in resource && typeof resource.failed !== "boolean")
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource failure flag is invalid.",
      );
    if ("priority" in resource && !PRIORITIES.has(resource.priority))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource priority is invalid.",
      );
    if ("timingMs" in resource) {
      exactKeys(resource.timingMs, ["start", "end"], "resource timing");
      if (
        !finite(resource.timingMs.start, -60_000, 600_000) ||
        !finite(resource.timingMs.end, resource.timingMs.start, 600_000)
      )
        throw coldDiagnosticFailure(
          "report-privacy",
          "privacy",
          "Resource timing is invalid.",
        );
    }
    if (resource.route !== "unrecognized" && !routeLabels.has(resource.route))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource route is not a known fixed template.",
      );
    if (
      resource.source !== "unrecognized" &&
      resource.source !== resource.route &&
      !assetBasenames.has(resource.source)
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource source is not a verified asset or route.",
      );
    if (
      resource.initiatorSource !== "unrecognized" &&
      !routeLabels.has(resource.initiatorSource) &&
      !assetBasenames.has(resource.initiatorSource)
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Resource initiator is not a verified route or asset.",
      );
  }
  if (
    !report.resources.some(
      (resource) =>
        resource.route === "/api/projects/:project/work-items" &&
        resource.timingMs !== undefined,
    )
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Report lacks a valid translated work-list request interval.",
    );
  for (const segment of report.mutuallyExclusiveMainThreadPhases) {
    exactKeys(segment, ["phase", "startMs", "durationMs"], "phase segment");
    if (
      !PHASES.has(segment.phase) ||
      !finite(segment.startMs, -60_000, 600_000) ||
      !finite(segment.durationMs, 0, 600_000)
    )
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Phase segment is invalid.",
      );
  }
  exactKeys(report.phaseTotalsMs, [...PHASES], "phase totals");
  for (const duration of Object.values(report.phaseTotalsMs))
    if (!finite(duration, 0, 600_000))
      throw coldDiagnosticFailure(
        "report-privacy",
        "privacy",
        "Phase total is invalid.",
      );
  exactKeys(
    report.windowAccounting,
    ["lcpWindow", "clickToPaintWindow", "phaseTotalsByWindow", "note"],
    "window accounting",
  );
  exactKeys(report.windowAccounting.lcpWindow, ["lcpMs"], "LCP window");
  exactKeys(
    report.windowAccounting.clickToPaintWindow,
    ["routeStartMs", "routePaintMs"],
    "click window",
  );
  exactKeys(
    report.windowAccounting.phaseTotalsByWindow,
    ["lcp", "clickToPaint"],
    "window phase totals",
  );
  if (
    report.windowAccounting.lcpWindow.lcpMs !== report.journey.lcpMs ||
    report.windowAccounting.clickToPaintWindow.routeStartMs !==
      report.journey.routeStartMs ||
    report.windowAccounting.clickToPaintWindow.routePaintMs !==
      report.journey.routePaintMs
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Window boundaries do not match the journey marks.",
    );
  for (const windowTotals of Object.values(
    report.windowAccounting.phaseTotalsByWindow,
  )) {
    exactKeys(windowTotals, [...PHASES], "window phase total");
    for (const duration of Object.values(windowTotals))
      if (!finite(duration, 0, 600_000))
        throw coldDiagnosticFailure(
          "report-privacy",
          "privacy",
          "Window phase duration is invalid.",
        );
  }
  if (
    report.windowAccounting.note !==
    "Main-thread phases are exclusive; resource intervals are a correlated overlay and are not added to phase totals."
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Window accounting note is invalid.",
    );
  exactKeys(
    report.interpretation,
    ["causalEdges", "routePaintCriterion", "rule"],
    "interpretation",
  );
  if (
    report.interpretation.causalEdges !== "unresolved-by-design" ||
    report.interpretation.routePaintCriterion !== ROUTE_PAINT_CRITERION ||
    report.interpretation.rule !==
      "A proposed edge is unresolved when its clock uncertainty intervals overlap; temporal proximity alone is not causal evidence."
  )
    throw coldDiagnosticFailure(
      "report-privacy",
      "privacy",
      "Interpretation overstates causal evidence.",
    );
  return true;
}

export function hashedBasename(path, content) {
  const basename = String(path).split(/[\\/]/).at(-1) ?? "";
  const match = basename.match(
    /^([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,})(\.js|\.js\.map)$/,
  );
  if (!match) return null;
  return { basename: `${match[1]}${match[2]}`, sha256: sha256(content) };
}
