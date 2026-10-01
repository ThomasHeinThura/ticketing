import assert from "node:assert/strict";
import test from "node:test";
import {
  assertColdReportPrivacy,
  buildSanitizedColdReport,
} from "./hosted-cold-recording-validation.mjs";

const hash = "a".repeat(64);
const sourceSha = "b".repeat(40);

function reportInput(overrides = {}) {
  return {
    provenance: {
      sourceSha,
      expectedSourceSha: sourceSha,
      candidateHeadSha: sourceSha,
      benchmarkSha256: hash,
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
      { phase: "router-auth-wait", start: 90, end: 120 },
    ],
    lcpMs: 150,
    lcpElementTag: "h1",
    rowsAtLcp: 310,
    rowCount: 500,
    clickTarget: "WLP-1",
    routeStartMs: 160,
    routePaintMs: 55,
    routePaintState: "loading",
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
  assert.equal(report.journey.lcpElementTag, "h1");
  assert.equal(report.journey.routePaintState, "loading");
  assert.equal(
    report.resources[0].source,
    "agent-initial-runtime-AbCdEf012345.js",
  );
  assert.equal(report.resources[1].route, "/api/auth/get-session");
  assert.equal(report.resources[2].route, "/api/projects/:project/work-items");
  assert.equal(report.resources[4].route, "unrecognized");
  assert.equal(report.resources[4].source, "unrecognized");
  assertColdReportPrivacy(report);
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

test("cold report rejects incomplete journey evidence, source drift, and capture loss", () => {
  for (const overrides of [
    { rowCount: 499 },
    { clickTarget: "WLP-2" },
    { lcpElementTag: "p" },
    { detailVisible: false },
    { routeStartMs: 0 },
    { routePaintMs: 0 },
    { routePaintState: "none" },
    { traceDataLoss: true },
    { traceTruncated: true },
    { networkTruncated: true },
    { clockUncertaintyMs: 1001 },
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
  assert.throws(() => assertColdReportPrivacy(report), /unknown field/);
});
