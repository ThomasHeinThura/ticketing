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
  "router-auth-wait",
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

function safeAsset(value, origin) {
  try {
    const parsed = new URL(value);
    if (parsed.origin !== origin) return { kind: "unrecognized" };
    const basename = parsed.pathname.split("/").at(-1) ?? "";
    const match = basename.match(
      /^([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,})\.(js|css|mjs|woff2?|ttf|otf|svg|png|webp)$/,
    );
    return match
      ? { kind: "asset", basename: `${match[1]}.${match[2]}` }
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

function safeResource(resource, origin) {
  const method = METHODS.has(resource.method) ? resource.method : "OTHER";
  const resourceType = RESOURCE_TYPES.has(resource.resourceType)
    ? resource.resourceType
    : "other";
  const route = safeRoute(resource.url, origin);
  const asset = safeAsset(resource.url, origin);
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
      safeAsset(resource.initiatorUrl ?? "", origin).basename ??
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
    !Number.isInteger(input.rowsAtLcp) ||
    input.rowsAtLcp < 0 ||
    input.rowsAtLcp > 500
  )
    throw new Error("Cold journey timing marks are invalid.");
  if (input.clickTarget !== "WLP-1")
    throw new Error(
      "Cold journey click target is not the fixed WLP-1 fixture.",
    );
  if (input.lcpElementTag !== "h1")
    throw new Error("Cold journey did not preserve the existing H1 LCP mark.");
  if (
    !new Set(["loading", "content", "loading-and-content"]).has(
      input.routePaintState,
    )
  )
    throw new Error(
      "Cold journey did not preserve a genuine detail loading or content paint.",
    );
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

  const origin = "http://127.0.0.1:4179";
  const safeResources = input.resources.map((resource) =>
    safeResource(resource, origin),
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
      rowsReadyAtLcp: input.rowsAtLcp,
      rowsReadyCount: input.rowCount,
      clickTarget: "WLP-1",
      clickRoute: "/agent/work-items/:workItem",
      routeStartMs: Math.round(input.routeStartMs * 10) / 10,
      routePaintMs: Math.round(input.routePaintMs * 10) / 10,
      routePaintState: input.routePaintState,
      detailVisible: true,
      detailUrlVerified: true,
    },
    clocks: {
      alignmentUncertaintyMs: Math.round(input.clockUncertaintyMs * 10) / 10,
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

export function assertColdReportPrivacy(report) {
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
    const safeAssetName =
      /^[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|mjs|woff2?|ttf|otf|svg|png|webp)$/.test(
        resource.source,
      );
    if (
      resource.route === "unrecognized" &&
      resource.source !== "unrecognized" &&
      !safeAssetName
    )
      throw new Error("Unrecognized resource retained a source label.");
    if (
      resource.initiatorSource !== "unrecognized" &&
      !/^(?:\/[\w{}:/.-]*|[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|mjs|woff2?|ttf|otf|svg|png|webp))$/.test(
        resource.initiatorSource,
      )
    )
      throw new Error(
        "Resource initiator is not a safe route or hashed asset.",
      );
  }
  return true;
}

export function hashedBasename(path, content) {
  const basename = String(path).split(/[\\/]/).at(-1) ?? "";
  const match = basename.match(
    /^([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,})(\.js|\.js\.map)$/,
  );
  if (!match) return null;
  return { basename: `${match[1]}${match[2]}`, sha256: sha256(content) };
}
