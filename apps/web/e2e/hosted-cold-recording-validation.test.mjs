import assert from "node:assert/strict";
import test from "node:test";
import {
  assertColdReportPrivacy,
  buildSanitizedColdReport,
  deriveManifestAssetBasenames,
  estimateClockAlignment,
  hashedBasename,
} from "./hosted-cold-recording-validation.mjs";

const hash = "a".repeat(64);
const sourceSha = "b".repeat(40);
const assetBasenames = new Set([
  "agent-initial-runtime-AbCdEf012345.js",
  "_layout-AbCdEf012345.js",
]);

function reportInput(overrides = {}) {
  return {
    assetBasenames,
    provenance: {
      sourceSha,
      expectedSourceSha: sourceSha,
      candidateHeadSha: sourceSha,
      benchmarkSha256: hash,
      routePaintRecorderSha256: hash,
      perfConfigSha256: hash,
      networkHelperSha256: hash,
      nodeVersion: "24.19.0",
      pnpmVersion: "10.32.1",
      playwrightVersion: "1.63.0",
      chromiumVersion: "153.0.8010.12",
      build: {
        indexHtmlSha256: hash,
        manifestSha256: hash,
        dist: { count: 31, sha256: hash },
        javascript: { count: 4, sha256: hash },
        sourceMaps: { count: 4, sha256: hash },
      },
    },
    resources: [
      {
        url: "http://127.0.0.1:4179/assets/agent-initial-runtime-AbCdEf012345.js?token=private",
        method: "GET",
        resourceType: "script",
        initiatorType: "parser",
        initiatorUrl:
          "http://127.0.0.1:4179/agent/projects/private/work?secret=value",
        priority: "High",
        timing: { start: 10, end: 80 },
      },
      {
        url: "http://127.0.0.1:4179/api/auth/get-session?token=private",
        method: "GET",
        resourceType: "fetch",
        initiatorType: "script",
        initiatorUrl:
          "http://127.0.0.1:4179/assets/agent-initial-runtime-AbCdEf012345.js",
        status: 200,
        timing: { start: 20, end: 60 },
      },
      {
        url: "http://127.0.0.1:4179/api/projects/customer-private/work-items?cursor=private",
        method: "GET",
        resourceType: "fetch",
        initiatorType: "script",
        initiatorUrl: "http://127.0.0.1:4179/assets/_layout-AbCdEf012345.js",
        status: 200,
        timing: { start: 70, end: 190 },
      },
      {
        url: "http://127.0.0.1:4179/assets/_layout-AbCdEf012345.js",
        method: "GET",
        resourceType: "script",
        initiatorType: "script",
        initiatorUrl:
          "http://127.0.0.1:4179/assets/agent-initial-runtime-AbCdEf012345.js",
        priority: "Medium",
        timing: { start: 90, end: 120 },
      },
      {
        url: "http://127.0.0.1:4179/api/unrecognized/private?secret=value",
        method: "GET",
        resourceType: "fetch",
        initiatorType: "other",
        initiatorUrl: "http://127.0.0.1:4179/unknown/private",
      },
    ],
    phaseSegments: [
      { phase: "main-thread-idle", start: 0, end: 10 },
      { phase: "parse-evaluate", start: 10, end: 30 },
      { phase: "react-render-commit", start: 30, end: 50 },
      { phase: "dom-removal", start: 50, end: 60 },
      { phase: "paint-layout", start: 60, end: 90 },
      { phase: "main-thread-idle", start: 90, end: 120 },
    ],
    lcpMs: 150,
    lcpElementTag: "h1",
    rowsAtPostObserverSample: 310,
    rowCountSampleAtMs: 151,
    rowCountSampleAfterLcpEntryMs: 1,
    rowCount: 500,
    clickTarget: "WLP-1",
    routeStartMs: 160,
    routePaintMs: 55,
    routePaintTarget: "detail",
    routeVisibilityProbeCount: 5,
    routeVisibilityProbeTotalMs: 0.4,
    routeVisibilityProbeMaxMs: 0.2,
    detailVisible: true,
    urlVerified: true,
    clockUncertaintyMs: 1.4,
    traceDataLoss: false,
    traceTruncated: false,
    networkTruncated: false,
    traceEventCount: 100,
    timelineRecordCount: 40,
    cpuSampleCount: 75,
    lcpWindow: { lcpMs: 150 },
    clickWindow: { routeStartMs: 160, routePaintMs: 55 },
    ...overrides,
  };
}

test("cold report binds the exact source and emits only bounded diagnostic evidence", () => {
  const report = buildSanitizedColdReport(reportInput());

  assert.equal(report.acceptance, "diagnostic-only");
  assert.equal(report.provenance.sourceSha, sourceSha);
  assert.equal(report.provenance.candidateHeadSha, sourceSha);
  assert.deepEqual(report.provenance.build.sourceMaps, {
    count: 4,
    sha256: hash,
  });
  assert.equal(report.environment.rows, 500);
  assert.equal(report.journey.clickTarget, "WLP-1");
  assert.equal(report.journey.routePaintTarget, "detail");
  assert.deepEqual(report.journey.visibilityProbeOverhead, {
    measurement: "performance.now-bracketed probe duration",
    resolutionMs: 0.1,
    mayPerturbMark: true,
    resolutionNote:
      "A 0.0 ms reading is below report resolution and is not evidence of zero observer effect.",
    sampleCount: 5,
    totalMs: 0.4,
    maxMs: 0.2,
  });
  assert.equal(report.journey.lcpElementTag, "h1");
  assert.equal(report.journey.rowsAtPostObserverSample, 310);
  assert.equal(report.journey.rowCountSampleAtMs, 151);
  assert.equal(report.journey.rowCountSampleAfterLcpEntryMs, 1);
  assert.equal(
    report.journey.rowCountSampleTimebase,
    "document-performance-timeline-ms",
  );
  assert.equal("rowsReadyAtLcp" in report.journey, false);
  assert.equal("routePaintState" in report.journey, false);
  assert.equal(
    report.clocks.alignmentBound,
    "maximum-sampled-offset-residual-plus-bracket",
  );
  assert.deepEqual(report.nonCausalOverlays.idleRequestTemporalOverlap, [
    { route: "/api/projects/:project/work-items", overlapMs: 30 },
  ]);
  assert.equal(
    report.nonCausalOverlays.note.includes("does not identify a wait boundary"),
    true,
  );
  assert.equal(report.phaseTotalsMs["main-thread-idle"], 40);
  assert.equal(
    report.resources[0].source,
    "agent-initial-runtime-AbCdEf012345.js",
  );
  assert.equal(report.resources[1].route, "/api/auth/get-session");
  assert.equal(report.resources[2].route, "/api/projects/:project/work-items");
  assert.equal(report.resources[4].route, "unrecognized");
  assert.equal(report.resources[4].source, "unrecognized");
  assertColdReportPrivacy(report, assetBasenames);
});

test("cold report strips queries and unsafe paths from resource and initiator labels", () => {
  const report = buildSanitizedColdReport(reportInput());
  const encoded = JSON.stringify(report);

  assert.equal(encoded.includes("private"), false);
  assert.equal(encoded.includes("secret"), false);
  assert.equal(encoded.includes("token"), false);
  assert.equal(
    report.resources[0].initiatorSource,
    "/agent/projects/:project/work",
  );
  assert.equal(report.resources[4].initiatorSource, "unrecognized");
});

test("only current manifest assets survive resource and initiator labels", () => {
  const privateBasename = "customer-acme-legal-AbCdEf012345.js";
  const resources = reportInput().resources.map((resource) => ({
    ...resource,
  }));
  resources[0].url = `http://127.0.0.1:4179/assets/${privateBasename}`;
  resources[0].initiatorUrl = `http://127.0.0.1:4179/assets/${privateBasename}`;
  const report = buildSanitizedColdReport(reportInput({ resources }));

  assert.equal(report.resources[0].source, "unrecognized");
  assert.equal(report.resources[0].initiatorSource, "unrecognized");
  assert.equal(JSON.stringify(report).includes("customer-acme-legal"), false);
  assert.equal(
    JSON.stringify(report.provenance).includes("AbCdEf012345"),
    false,
  );
  assertColdReportPrivacy(report, assetBasenames);

  report.journey.unexpectedMetadata = [...assetBasenames][0];
  assert.throws(
    () => assertColdReportPrivacy(report, assetBasenames),
    /journey schema/,
  );
  delete report.journey.unexpectedMetadata;

  report.resources[0].source = privateBasename;
  assert.throws(
    () => assertColdReportPrivacy(report, assetBasenames),
    /verified asset or route/,
  );
});

test("manifest allowlist contains only hashed assets present in the current dist inventory", () => {
  const manifest = {
    "src/main.tsx": {
      file: "assets/agent-initial-runtime-AbCdEf012345.js",
      css: ["assets/index-AbCdEf012345.css"],
      assets: [
        "assets/geist-latin-AbCdEf012345.woff2",
        "assets/accept._inviteId-CPVYxqOq.js",
      ],
    },
  };
  const names = deriveManifestAssetBasenames(manifest, [
    "assets/agent-initial-runtime-AbCdEf012345.js",
    "assets/index-AbCdEf012345.css",
    "assets/geist-latin-AbCdEf012345.woff2",
    "assets/accept._inviteId-CPVYxqOq.js",
    "assets/customer-acme-legal-AbCdEf012345.js",
  ]);
  assert.deepEqual([...names].sort(), [
    "accept._inviteId-CPVYxqOq.js",
    "agent-initial-runtime-AbCdEf012345.js",
    "geist-latin-AbCdEf012345.woff2",
    "index-AbCdEf012345.css",
  ]);
  assert.throws(
    () =>
      deriveManifestAssetBasenames(manifest, ["assets/not-the-manifest.js"]),
    /not a current dist file/,
  );
  assert.equal(
    hashedBasename("mermaid.core-DFihE3QI.js", "current build bytes")?.basename,
    "mermaid.core-DFihE3QI.js",
  );
});

test("clock uncertainty covers the largest residual from the chosen offset plus its bracket", () => {
  const estimate = estimateClockAlignment([
    { offsetMs: 0, uncertaintyMs: 0 },
    { offsetMs: 0, uncertaintyMs: 0 },
    { offsetMs: 10, uncertaintyMs: 0 },
  ]);
  assert.equal(Math.round(estimate.offsetMs * 100) / 100, 3.33);
  assert.equal(Math.round(estimate.uncertaintyMs * 100) / 100, 6.67);
  const roundedBound = buildSanitizedColdReport(
    reportInput({ clockUncertaintyMs: estimate.uncertaintyMs }),
  ).clocks.alignmentUncertaintyMs;
  assert.equal(roundedBound, 6.7);

  const withBrackets = estimateClockAlignment([
    { offsetMs: 0, uncertaintyMs: 0.2 },
    { offsetMs: 0, uncertaintyMs: 0.2 },
    { offsetMs: 10, uncertaintyMs: 1.5 },
  ]);
  assert.ok(withBrackets.uncertaintyMs >= 8.16);
  assert.throws(() => estimateClockAlignment([]), /samples/);
});

test("cold report rejects incomplete journey evidence, source drift, and capture loss", () => {
  for (const overrides of [
    { rowCount: 499 },
    { clickTarget: "WLP-2" },
    { lcpElementTag: "p" },
    { detailVisible: false },
    { routeStartMs: 0 },
    { routePaintMs: 0 },
    { traceDataLoss: true },
    { traceTruncated: true },
    { networkTruncated: true },
    { clockUncertaintyMs: 1001 },
    { rowCountSampleAtMs: 149 },
    {
      provenance: {
        ...reportInput().provenance,
        expectedSourceSha: "c".repeat(40),
      },
    },
  ]) {
    assert.throws(() => buildSanitizedColdReport(reportInput(overrides)));
  }
});

test("cold report rejects overlapping phases, invalid hashes, and oversized resource tables", () => {
  assert.throws(
    () =>
      buildSanitizedColdReport(
        reportInput({
          phaseSegments: [
            { phase: "main-thread-idle", start: 0, end: 20 },
            { phase: "parse-evaluate", start: 10, end: 30 },
          ],
        }),
      ),
    /overlapping/,
  );
  assert.throws(
    () =>
      buildSanitizedColdReport(
        reportInput({
          phaseSegments: [{ phase: "router-auth-wait", start: 0, end: 1 }],
        }),
      ),
    /overlapping mutually exclusive phase segment/,
  );

  assert.throws(
    () =>
      buildSanitizedColdReport(
        reportInput({
          provenance: {
            ...reportInput().provenance,
            build: {
              ...reportInput().provenance.build,
              sourceMaps: { count: 1, sha256: "unsafe" },
            },
          },
        }),
      ),
    /build evidence hash/,
  );

  assert.throws(
    () =>
      buildSanitizedColdReport(
        reportInput({
          resources: Array.from(
            { length: 2049 },
            () => reportInput().resources[0],
          ),
        }),
      ),
    /bounded resource/,
  );
});

test("privacy assertion rejects diagnostic reports that contain raw network or DOM fields", () => {
  const report = buildSanitizedColdReport(reportInput());
  report.rawUrl = "/private?token=secret";
  assert.throws(
    () => assertColdReportPrivacy(report, assetBasenames),
    /schema/,
  );
});

test("privacy assertion closes nested string-bearing schemas and fixed journey routes", () => {
  const cases = [
    {
      change(report) {
        report.environment.customerLabel = "tenant-private-acme";
      },
      expected: /environment schema/,
    },
    {
      change(report) {
        report.journey.customerLabel = "tenant-private-acme";
      },
      expected: /journey schema/,
    },
    {
      change(report) {
        report.journey.directRoute = "/agent/projects/customer-private/work";
      },
      expected: /fixed route template/,
    },
    {
      change(report) {
        report.journey.clickRoute = "/agent/work-items/customer-private";
      },
      expected: /fixed route template/,
    },
    {
      change(report) {
        report.resources[0].route = "/api/projects/customer-private/work-items";
      },
      expected: /known fixed template/,
    },
    {
      change(report) {
        report.windowAccounting.interpretation = "private";
      },
      expected: /window accounting schema/,
    },
  ];

  for (const { change, expected } of cases) {
    const report = buildSanitizedColdReport(reportInput());
    change(report);
    assert.throws(
      () => assertColdReportPrivacy(report, assetBasenames),
      expected,
    );
  }
});
