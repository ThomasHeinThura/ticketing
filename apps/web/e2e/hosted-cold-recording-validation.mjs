import { createHash } from "node:crypto";

export const COLD_REPORT_MAX_BYTES = 256 * 1024;
export const COLD_MAX_RESOURCES = 2_048;
export const COLD_MAX_PHASE_SEGMENTS = 100_000;

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

export function estimateClockAlignment(samples) {
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 100)
    throw new Error("Invalid bounded clock alignment samples.");
  if (
    samples.some(
      (sample) =>
        !sample ||
        !finite(sample.offsetMs, -60_000, 60_000) ||
        !finite(sample.uncertaintyMs, 0, 1000),
    )
  )
    throw new Error("Invalid clock alignment sample.");
  const offsetMs =
    samples.reduce((sum, sample) => sum + sample.offsetMs, 0) / samples.length;
  const uncertaintyMs = Math.max(
    ...samples.map(
      (sample) => Math.abs(sample.offsetMs - offsetMs) + sample.uncertaintyMs,
    ),
  );
  return { offsetMs, uncertaintyMs };
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
  if (
    resource.timing &&
    [resource.timing.start, resource.timing.end].every((value) =>
      finite(value, -60_000, 600_000),
    ) &&
    resource.timing.end >= resource.timing.start
  ) {
    output.timingMs = {
      start: Math.round(resource.timing.start * 10) / 10,
      end: Math.round(resource.timing.end * 10) / 10,
    };
  }
  return output;
}

function safePhaseSegments(segments) {
  if (!Array.isArray(segments) || segments.length > COLD_MAX_PHASE_SEGMENTS)
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
  const safeSegments = phaseSegments;
  const report = {
    schemaVersion: 1,
    kind: "hosted-cold-work-list-to-detail-diagnostic",
    acceptance: "diagnostic-only",
    provenance: {
      sourceSha: provenance.sourceSha.toLowerCase(),
      candidateHeadSha: provenance.candidateHeadSha.toLowerCase(),
      benchmarkSha256: provenance.benchmarkSha256.toLowerCase(),
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
  const allowedRootKeys = new Set([
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
  ]);
  if (Object.keys(report).some((key) => !allowedRootKeys.has(key)))
    throw new Error("Sanitized report contains an unknown field.");
  const encoded = JSON.stringify(report);
  if (Buffer.byteLength(encoded, "utf8") > COLD_REPORT_MAX_BYTES)
    throw new Error("Sanitized report exceeded its byte bound.");
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
      throw new Error(
        `Sanitized report contains forbidden field content: ${forbidden}`,
      );
  }
  if (!/^[\w{}:/.-]+$/.test(report.journey.directRoute))
    throw new Error(
      "Sanitized route template contains unsupported characters.",
    );
  if (report.acceptance !== "diagnostic-only")
    throw new Error("Cold report must remain diagnostic-only.");
  if (
    report.clocks.alignmentBound !==
      "maximum-sampled-offset-residual-plus-bracket" ||
    report.clocks.driftBetweenSamples !== "unmeasured" ||
    report.clocks.pairwiseCoordinateRoundingMs !== 0.1
  )
    throw new Error("Clock report overstates unmeasured alignment precision.");
  if (
    report.journey.rowCountSampleTimebase !== "document-performance-timeline-ms"
  )
    throw new Error("Post-observer row sample is missing its timebase.");
  const metadata = { ...report };
  delete metadata.resources;
  const encodedMetadata = JSON.stringify(metadata);
  for (const basename of assetBasenames) {
    if (encodedMetadata.includes(basename))
      throw new Error(
        "Verified asset basename leaked outside resource labels.",
      );
  }
  const allowedProvenanceKeys = new Set([
    "sourceSha",
    "candidateHeadSha",
    "benchmarkSha256",
    "perfConfigSha256",
    "networkHelperSha256",
    "nodeVersion",
    "pnpmVersion",
    "playwrightVersion",
    "chromiumVersion",
    "build",
  ]);
  if (
    Object.keys(report.provenance).some(
      (key) => !allowedProvenanceKeys.has(key),
    )
  )
    throw new Error("Cold report provenance contains an unknown field.");
  const allowedBuildKeys = new Set([
    "indexHtmlSha256",
    "manifestSha256",
    "dist",
    "javascript",
    "sourceMaps",
  ]);
  if (
    Object.keys(report.provenance.build).some(
      (key) => !allowedBuildKeys.has(key),
    )
  )
    throw new Error("Cold report build provenance contains an unknown field.");
  if (
    Object.keys(report.nonCausalOverlays).sort().join(",") !==
      "idleRequestTemporalOverlap,note" ||
    report.nonCausalOverlays.note !==
      "Per-route sums of request/idle temporal overlap; overlapping request intervals may be counted more than once. It does not identify a wait boundary or causal edge and is not added to phase totals." ||
    !Array.isArray(report.nonCausalOverlays.idleRequestTemporalOverlap) ||
    report.nonCausalOverlays.idleRequestTemporalOverlap.length > 2
  )
    throw new Error("Invalid non-causal request overlap overlay.");
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
      throw new Error("Invalid non-causal request overlap row.");
    seenOverlayRoutes.add(overlay.route);
  }
  const routeLabels = new Set(
    KNOWN_ROUTES.map((route) => `/${route.join("/")}` || "/"),
  );
  for (const resource of report.resources) {
    const allowedResourceKeys = new Set([
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
    ]);
    if (Object.keys(resource).some((key) => !allowedResourceKeys.has(key)))
      throw new Error("Resource report contains an unknown field.");
    if (resource.route !== "unrecognized" && !routeLabels.has(resource.route))
      throw new Error("Resource route is not a known fixed template.");
    if (
      resource.source !== "unrecognized" &&
      resource.source !== resource.route &&
      !assetBasenames.has(resource.source)
    )
      throw new Error("Resource source is not a verified asset or route.");
    if (
      resource.initiatorSource !== "unrecognized" &&
      !routeLabels.has(resource.initiatorSource) &&
      !assetBasenames.has(resource.initiatorSource)
    )
      throw new Error("Resource initiator is not a verified route or asset.");
  }
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
