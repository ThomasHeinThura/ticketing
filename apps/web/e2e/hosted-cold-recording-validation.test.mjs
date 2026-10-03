import assert from "node:assert/strict";
import test from "node:test";
import {
  assertColdMainThreadJourneyOverlap,
  assertColdReportPrivacy,
  buildSanitizedColdReport,
  COLD_CLEANUP_OPERATIONS,
  COLD_CLEANUP_STATES,
  COLD_CLOCK_SUPPORTED_CHROMIUM_VERSION,
  COLD_CLOCK_TIMER_ALLOWANCE_MS,
  COLD_FAILURE_CODES,
  COLD_FAILURE_RECEIPT_MAX_BYTES,
  COLD_FAILURE_RECEIPT_PREFIX,
  COLD_PHASE_CATEGORIES,
  classifyColdIncompleteRequest,
  coldCleanupStatuses,
  coldDiagnosticFailure,
  coldPassedHandoffMatchesValidatedReport,
  createColdClockSample,
  createColdFailureReceipt,
  createColdIncompleteClassification,
  deriveManifestAssetBasenames,
  estimateClockAlignment,
  formatColdFailureReceiptLine,
  hashedBasename,
  normalizeColdCdpResourceType,
  ownedColdDiagnosticFailureFields,
  parseColdFailureReceipt,
  resolveColdFailureReceipt,
  translateColdNetworkTimestamp,
  translateColdTraceInterval,
  unknownColdFailureReceipt,
} from "./hosted-cold-recording-validation.mjs";

const hash = "a".repeat(64);
const sourceSha = "b".repeat(40);
const assetBasenames = new Set([
  "agent-initial-runtime-AbCdEf012345.js",
  "_layout-AbCdEf012345.js",
]);
const TEST_TIME_ORIGIN_MS = 1_780_000_000_000;

function makeClockSample(
  offsetMs,
  pageNowMs = 125,
  originMs = TEST_TIME_ORIGIN_MS,
) {
  return createColdClockSample({
    chromiumVersion: COLD_CLOCK_SUPPORTED_CHROMIUM_VERSION,
    timestampSeconds: (offsetMs + pageNowMs) / 1000,
    beforeMs: pageNowMs,
    afterMs: pageNowMs,
    beforeTimeOriginMs: originMs,
    afterTimeOriginMs: originMs,
    expectedTimeOriginMs: originMs,
  });
}

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

function failureReceipt(overrides = {}) {
  const empty = unknownColdFailureReceipt("journey");
  return createColdFailureReceipt({
    childOutcome: "failed",
    primary: { code: "journey-assertion", stage: "journey" },
    counts: {
      ...empty.counts,
      clockSamples: 1,
      trackedRequests: 2,
      incompleteTrackedRequests: 1,
    },
    flags: {
      ...empty.flags,
      journeyAssertionsComplete: false,
    },
    cleanup: { ...coldCleanupStatuses(), childReport: "ok" },
    networkClockState: {
      invalidStart: 1,
      terminalNotSeen: 1,
      invalidTerminal: 0,
      notSeenAfterResponse: 0,
      incompleteAfterRedirect: 0,
      unexpectedSameIdReplacement: 0,
      duplicateTerminal: 0,
      unmatchedTrackedEvent: 0,
    },
    incompleteClassification: {
      resourceKinds: {
        document: 0,
        stylesheet: 0,
        image: 0,
        media: 0,
        font: 0,
        script: 0,
        texttrack: 0,
        xhr: 1,
        fetch: 0,
        eventsource: 0,
        websocket: 0,
        manifest: 0,
        signedexchange: 0,
        ping: 0,
        cspviolationreport: 0,
        preflight: 0,
        other: 0,
        unknown: 0,
      },
      sourceClasses: {
        "verified-build-asset": 0,
        "known-fixed-route": 1,
        "same-origin-other": 0,
        "other-or-invalid": 0,
      },
    },
    ...overrides,
  });
}

function validatedPhaseFailureReceipt(overrides = {}) {
  const base = failureReceipt();
  return createColdFailureReceipt({
    ...base,
    childOutcome: "failed",
    primary: { code: "network-clock-incomplete", stage: "network" },
    counts: {
      ...base.counts,
      clockSamples: 3,
      traceEventsReceived: 20,
      timelineRecordsRetained: 10,
      cpuSamples: 5,
      cpuNodes: 3,
      trackedRequests: 2,
      incompleteTrackedRequests: 1,
    },
    flags: {
      ...base.flags,
      journeyAssertionsComplete: true,
      traceOverflow: false,
      networkOverflow: false,
      traceDataLoss: false,
    },
    phaseCensus: {
      state: "validated",
      windows: {
        lcp: Object.fromEntries(
          COLD_PHASE_CATEGORIES.map((phase) => [phase, 0]),
        ),
        clickToPaint: Object.fromEntries(
          COLD_PHASE_CATEGORIES.map((phase) => [phase, 0]),
        ),
      },
    },
    ...overrides,
  });
}

function successfulChildEvidence(overrides = {}) {
  const zeroState = {
    invalidStart: 0,
    terminalNotSeen: 0,
    invalidTerminal: 0,
    notSeenAfterResponse: 0,
    incompleteAfterRedirect: 0,
    unexpectedSameIdReplacement: 0,
    duplicateTerminal: 0,
    unmatchedTrackedEvent: 0,
  };
  const empty = unknownColdFailureReceipt("journey");
  return {
    childOutcome: "passed",
    primary: null,
    counts: {
      ...empty.counts,
      clockSamples: 3,
      traceEventsReceived: 100,
      timelineRecordsRetained: 40,
      trackedRequests: 5,
      incompleteTrackedRequests: 0,
      cpuSamples: 75,
      cpuNodes: 12,
    },
    flags: {
      ...empty.flags,
      journeyAssertionsComplete: true,
      traceOverflow: false,
      networkOverflow: false,
      traceDataLoss: false,
      reportPrivacyPassed: true,
    },
    cleanup: coldCleanupStatuses(),
    incompleteClassification: createColdIncompleteClassification(),
    networkClockState: zeroState,
    ...overrides,
  };
}

test("CDP resource kinds normalize through a finite mapping and incomplete source classes disclose no URL data", () => {
  assert.deepEqual(normalizeColdCdpResourceType("Fetch"), {
    resourceKind: "fetch",
    reportResourceType: "fetch",
  });
  assert.deepEqual(normalizeColdCdpResourceType("Script"), {
    resourceKind: "script",
    reportResourceType: "script",
  });
  assert.deepEqual(normalizeColdCdpResourceType("CSPViolationReport"), {
    resourceKind: "cspviolationreport",
    reportResourceType: "other",
  });
  assert.deepEqual(normalizeColdCdpResourceType(undefined), {
    resourceKind: "unknown",
    reportResourceType: "other",
  });
  assert.deepEqual(normalizeColdCdpResourceType("customer-secret-type"), {
    resourceKind: "unknown",
    reportResourceType: "other",
  });

  const context = {
    origin: "http://127.0.0.1:4179",
    assetBasenames,
  };
  const asset = classifyColdIncompleteRequest(
    {
      url: `${context.origin}/assets/agent-initial-runtime-AbCdEf012345.js?token=customer-secret`,
      resourceKind: "script",
    },
    context,
  );
  const unlistedHashedName = classifyColdIncompleteRequest(
    {
      url: `${context.origin}/assets/not-in-manifest-AbCdEf012345.js`,
      resourceKind: "script",
    },
    context,
  );
  const knownRoute = classifyColdIncompleteRequest(
    {
      url: `${context.origin}/api/projects/customer-secret/work-items?cursor=private`,
      resourceKind: "fetch",
    },
    context,
  );
  const sameOriginOther = classifyColdIncompleteRequest(
    {
      url: `${context.origin}/private/path?secret=value`,
      resourceKind: "unknown",
    },
    context,
  );
  const foreign = classifyColdIncompleteRequest(
    {
      url: "https://foreign.invalid/private/path?secret=value",
      resourceKind: "xhr",
    },
    context,
  );
  const invalid = classifyColdIncompleteRequest(
    { url: "not a URL secret=value", resourceKind: "other" },
    context,
  );
  assert.deepEqual(asset, {
    resourceKind: "script",
    sourceClass: "verified-build-asset",
  });
  assert.deepEqual(unlistedHashedName, {
    resourceKind: "script",
    sourceClass: "same-origin-other",
  });
  assert.deepEqual(knownRoute, {
    resourceKind: "fetch",
    sourceClass: "known-fixed-route",
  });
  assert.deepEqual(sameOriginOther, {
    resourceKind: "unknown",
    sourceClass: "same-origin-other",
  });
  assert.deepEqual(foreign, {
    resourceKind: "xhr",
    sourceClass: "other-or-invalid",
  });
  assert.deepEqual(invalid, {
    resourceKind: "other",
    sourceClass: "other-or-invalid",
  });
  const serialized = JSON.stringify([
    asset,
    unlistedHashedName,
    knownRoute,
    sameOriginOther,
    foreign,
    invalid,
  ]);
  for (const secret of [
    "customer-secret",
    "private/path",
    "cursor=private",
    "foreign.invalid",
    "secret=value",
    "not a URL",
  ])
    assert.equal(serialized.includes(secret), false);
});

test("failure receipts are closed, bounded, typed, and relay only validated values", () => {
  const receipt = failureReceipt();
  const encoded = Buffer.from(JSON.stringify(receipt), "utf8");
  assert.deepEqual(parseColdFailureReceipt(encoded), receipt);
  const line = formatColdFailureReceiptLine(receipt);
  assert.equal(line.startsWith(COLD_FAILURE_RECEIPT_PREFIX), true);
  assert.deepEqual(
    parseColdFailureReceipt(
      Buffer.from(line.slice(COLD_FAILURE_RECEIPT_PREFIX.length)),
    ),
    receipt,
  );

  const hostile =
    "https://private.invalid/customer?token=secret <div>hidden</div>";
  const untyped = new Error(hostile);
  untyped.url = hostile;
  untyped.dom = hostile;
  untyped.stack = hostile;
  assert.equal(ownedColdDiagnosticFailureFields(untyped), null);
  const typed = coldDiagnosticFailure("request-completion", "network", hostile);
  assert.deepEqual(ownedColdDiagnosticFailureFields(typed), {
    code: "request-completion",
    stage: "network",
  });
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error(hostile);
      },
    },
  );
  assert.equal(ownedColdDiagnosticFailureFields(proxy), null);
  const forged = Object.assign(Object.create(Object.getPrototypeOf(typed)), {
    code: "request-completion",
    stage: "network",
  });
  assert.equal(ownedColdDiagnosticFailureFields(forged), null);
  const unknownLine = formatColdFailureReceiptLine(
    unknownColdFailureReceipt("child-start"),
  );
  assert.equal(unknownLine.includes(hostile), false);
  assert.equal(unknownLine.includes("Error"), false);
  assert.equal(unknownLine.startsWith(COLD_FAILURE_RECEIPT_PREFIX), true);
});

test("every closed failure code relays only its literal code and fixed stage", () => {
  const hostile =
    "https://tenant.invalid/path?auth=secret <section>private</section>";
  for (const code of COLD_FAILURE_CODES) {
    const error = coldDiagnosticFailure(code, "unknown", hostile);
    assert.deepEqual(ownedColdDiagnosticFailureFields(error), {
      code,
      stage: "unknown",
    });
    const empty = unknownColdFailureReceipt("unknown");
    const receipt = createColdFailureReceipt({
      childOutcome: "failed",
      primary: { code, stage: "unknown" },
      counts: empty.counts,
      flags: empty.flags,
      cleanup: { ...coldCleanupStatuses(), childReport: "not-attempted" },
    });
    assert.equal(JSON.stringify(receipt).includes(hostile), false);
    assert.deepEqual(
      parseColdFailureReceipt(Buffer.from(JSON.stringify(receipt))),
      receipt,
    );
  }
});

test("failure receipt relay rejects hostile schemas, counts, flags, and oversized payloads", () => {
  const valid = failureReceipt();
  const changed = (patch) => ({ ...valid, ...patch });
  assert.throws(() =>
    parseColdFailureReceipt(
      Buffer.from(
        JSON.stringify(changed({ extra: "https://private.invalid/token" })),
      ),
    ),
  );
  const bad = [
    changed({ primary: { code: "customer-supplied", stage: "journey" } }),
    changed({
      primary: { code: "journey-assertion", stage: "arbitrary stage" },
    }),
    changed({ counts: { ...valid.counts, cpuNodes: -1 } }),
    changed({ counts: { ...valid.counts, cpuNodes: 50_001 } }),
    changed({ counts: { ...valid.counts, cpuNodes: Number.NaN } }),
    changed({ counts: { ...valid.counts, incompleteTrackedRequests: 3 } }),
    changed({ flags: { ...valid.flags, traceOverflow: "false" } }),
    changed({ cleanup: { ...valid.cleanup, generatedSpec: "customer-label" } }),
    changed({ cleanup: { ...valid.cleanup, scratch: "unknown" } }),
    changed({ childOutcome: "customer-label" }),
    changed({ primary: null }),
    changed({
      counts: { ...valid.counts, incompleteTrackedRequests: 2 },
      networkClockState: {
        ...valid.networkClockState,
        terminalNotSeen: 1,
        invalidTerminal: 2,
      },
    }),
    changed({
      childOutcome: "passed",
      primary: null,
      flags: {
        ...valid.flags,
        journeyAssertionsComplete: true,
        reportPrivacyPassed: true,
      },
      cleanup: { ...valid.cleanup, childReport: "unknown" },
    }),
  ];
  for (const value of bad) assert.throws(() => createColdFailureReceipt(value));
  assert.throws(() =>
    parseColdFailureReceipt(
      Buffer.alloc(COLD_FAILURE_RECEIPT_MAX_BYTES + 1, 32),
    ),
  );
  const duplicateKey = JSON.stringify(valid).replace(
    '"code":"journey-assertion"',
    '"code":"unknown","code":"journey-assertion"',
  );
  assert.throws(() => parseColdFailureReceipt(Buffer.from(duplicateKey)));

  const fallback = unknownColdFailureReceipt("child-start");
  assert.equal(fallback.primary.code, "unknown");
  assert.equal(fallback.primary.stage, "child-start");
  assert.ok(Object.values(fallback.counts).every((value) => value === null));
  assert.ok(Object.values(fallback.flags).every((value) => value === null));
  assert.deepEqual(fallback.phaseCensus, {
    state: "unavailable",
    windows: null,
  });
  for (const absentOrInvalid of [
    null,
    Buffer.from("{}"),
    Buffer.alloc(COLD_FAILURE_RECEIPT_MAX_BYTES + 1),
  ]) {
    const resolved = resolveColdFailureReceipt(absentOrInvalid, "child-start");
    assert.equal(resolved.primary.code, "unknown");
    assert.equal(resolved.primary.stage, "child-start");
    assert.equal(JSON.stringify(resolved).includes("private"), false);
  }
});

test("passed child cleanup failure is represented separately from a null primary", () => {
  const cleanup = coldCleanupStatuses();
  cleanup.generatedConfig = "failed";
  const receipt = createColdFailureReceipt({
    ...successfulChildEvidence(),
    cleanup,
  });
  assert.equal(receipt.schemaVersion, 5);
  assert.equal(receipt.primary, null);
  assert.equal(receipt.cleanup.generatedConfig, "failed");
  assert.equal(
    createColdFailureReceipt({ ...receipt, cleanup: coldCleanupStatuses() })
      .primary,
    null,
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...receipt,
      childOutcome: "failed",
      cleanup: coldCleanupStatuses(),
    }),
  );
  assert.equal(COLD_CLEANUP_OPERATIONS.length, 5);
  assert.ok(COLD_CLEANUP_STATES.includes(receipt.cleanup.scratch));
  const line = formatColdFailureReceiptLine(receipt);
  assert.equal(line.startsWith(COLD_FAILURE_RECEIPT_PREFIX), true);
  assert.ok(Buffer.byteLength(line, "utf8") < COLD_FAILURE_RECEIPT_MAX_BYTES);
});

test("passed handoffs require complete nonzero capture evidence and zero network anomalies", () => {
  const baseline = successfulChildEvidence();
  const invalidHandoffs = [
    {
      ...baseline,
      counts: { ...baseline.counts, incompleteTrackedRequests: 1 },
      networkClockState: { ...baseline.networkClockState, invalidStart: 1 },
    },
    {
      ...baseline,
      counts: { ...baseline.counts, trackedRequests: 0 },
    },
    {
      ...baseline,
      networkClockState: {
        ...baseline.networkClockState,
        unmatchedTrackedEvent: 1,
      },
    },
    {
      ...baseline,
      counts: { ...baseline.counts, clockSamples: 2 },
    },
    {
      ...baseline,
      counts: { ...baseline.counts, cpuNodes: 0 },
    },
    {
      ...baseline,
      flags: { ...baseline.flags, networkOverflow: null },
    },
    { ...baseline, networkClockState: null },
  ];
  for (const handoff of invalidHandoffs)
    assert.throws(() => createColdFailureReceipt(handoff));
});

test("passed handoff must match the independently validated v1 report before publication", () => {
  const report = buildSanitizedColdReport(reportInput());
  assertColdReportPrivacy(report, assetBasenames);
  const handoff = createColdFailureReceipt(successfulChildEvidence());
  assert.deepEqual(handoff.phaseCensus, {
    state: "unavailable",
    windows: null,
  });
  assert.equal(coldPassedHandoffMatchesValidatedReport(handoff, report), true);
  assert.equal(
    coldPassedHandoffMatchesValidatedReport(failureReceipt(), report),
    false,
  );
  assert.equal(
    coldPassedHandoffMatchesValidatedReport(
      createColdFailureReceipt({
        ...successfulChildEvidence(),
        counts: { ...successfulChildEvidence().counts, trackedRequests: 4 },
      }),
      report,
    ),
    false,
  );
  assert.equal(
    coldPassedHandoffMatchesValidatedReport(
      { ...handoff, networkClockState: null },
      report,
    ),
    false,
  );
  assert.equal(
    coldPassedHandoffMatchesValidatedReport(
      createColdFailureReceipt({
        ...successfulChildEvidence(),
        counts: {
          ...successfulChildEvidence().counts,
          traceEventsReceived: 99,
        },
      }),
      report,
    ),
    false,
  );
});

test("v5 receipt validates null, bounded network snapshot and classification partitions", () => {
  const base = unknownColdFailureReceipt();
  assert.equal(base.networkClockState, null);
  assert.equal(base.incompleteClassification, null);
  const snapshot = {
    invalidStart: 1,
    terminalNotSeen: 1,
    invalidTerminal: 0,
    notSeenAfterResponse: 1,
    incompleteAfterRedirect: 0,
    unexpectedSameIdReplacement: 0,
    duplicateTerminal: 0,
    unmatchedTrackedEvent: 0,
  };
  const valid = failureReceipt({
    counts: {
      ...base.counts,
      trackedRequests: 2,
      incompleteTrackedRequests: 1,
    },
    networkClockState: snapshot,
    incompleteClassification: {
      resourceKinds: {
        document: 0,
        stylesheet: 0,
        image: 0,
        media: 0,
        font: 0,
        script: 0,
        texttrack: 0,
        xhr: 1,
        fetch: 0,
        eventsource: 0,
        websocket: 0,
        manifest: 0,
        signedexchange: 0,
        ping: 0,
        cspviolationreport: 0,
        preflight: 0,
        other: 0,
        unknown: 0,
      },
      sourceClasses: {
        "verified-build-asset": 0,
        "known-fixed-route": 1,
        "same-origin-other": 0,
        "other-or-invalid": 0,
      },
    },
  });
  assert.deepEqual(
    parseColdFailureReceipt(Buffer.from(JSON.stringify(valid)))
      .networkClockState,
    snapshot,
  );
  assert.deepEqual(
    parseColdFailureReceipt(Buffer.from(JSON.stringify(valid)))
      .incompleteClassification,
    valid.incompleteClassification,
  );
  const invalid = [
    { ...snapshot, leakedUrl: "https://private.invalid/path?token=secret" },
    { ...snapshot, invalidStart: -1 },
    { ...snapshot, duplicateTerminal: 250_001 },
    { ...snapshot, notSeenAfterResponse: 2 },
    { ...snapshot, incompleteAfterRedirect: 2 },
    { ...snapshot, terminalNotSeen: 0 },
  ];
  for (const networkClockState of invalid) {
    assert.throws(() =>
      createColdFailureReceipt({ ...valid, networkClockState }),
    );
  }
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      counts: { ...valid.counts, trackedRequests: null },
    }),
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      counts: { ...valid.counts, incompleteTrackedRequests: 0 },
    }),
  );
  assert.throws(() =>
    createColdFailureReceipt({ ...valid, incompleteClassification: null }),
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...base,
      incompleteClassification: createColdIncompleteClassification(),
    }),
  );
  assert.throws(() =>
    parseColdFailureReceipt(
      Buffer.from(JSON.stringify({ ...valid, schemaVersion: 3 })),
    ),
  );
  assert.throws(() =>
    parseColdFailureReceipt(
      Buffer.from(JSON.stringify({ ...valid, schemaVersion: 4 })),
    ),
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      incompleteClassification: {
        ...valid.incompleteClassification,
        resourceKinds: {
          ...valid.incompleteClassification.resourceKinds,
          xhr: 0,
          unknown: 0,
        },
      },
    }),
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      incompleteClassification: {
        ...valid.incompleteClassification,
        resourceKinds: {
          ...valid.incompleteClassification.resourceKinds,
          xhr: 2_049,
        },
      },
    }),
  );
  const hostile =
    "https://tenant.invalid/secret?token=value <div>private</div>";
  const line = formatColdFailureReceiptLine(valid);
  assert.equal(line.includes(hostile), false);
  assert.equal(line.includes("requestId"), false);
});

test("P0 #558 v5: census state and validated receipt prerequisites are closed", () => {
  const valid = validatedPhaseFailureReceipt();
  assert.deepEqual(
    parseColdFailureReceipt(Buffer.from(JSON.stringify(valid))).phaseCensus,
    valid.phaseCensus,
  );
  for (const phaseCensus of [
    { state: "mystery", windows: null },
    { state: "not-validated", windows: { lcp: {}, clickToPaint: {} } },
    { state: "validated", windows: null },
    {
      ...valid.phaseCensus,
      extra: true,
    },
    {
      state: "validated",
      windows: {
        ...valid.phaseCensus.windows,
        lcp: {
          ...valid.phaseCensus.windows.lcp,
          leaked: 1,
        },
      },
    },
    {
      state: "validated",
      windows: {
        ...valid.phaseCensus.windows,
        lcp: {
          ...valid.phaseCensus.windows.lcp,
          "parse-evaluate": 0.1,
        },
      },
    },
    {
      state: "validated",
      windows: {
        ...valid.phaseCensus.windows,
        lcp: {
          ...valid.phaseCensus.windows.lcp,
          "parse-evaluate": 6_000_001,
        },
      },
    },
  ]) {
    assert.throws(() => createColdFailureReceipt({ ...valid, phaseCensus }));
  }
  assert.equal(
    createColdFailureReceipt({
      ...failureReceipt(),
      primary: { code: "network-clock-incomplete", stage: "network" },
      phaseCensus: { state: "not-validated", windows: null },
    }).primary.code,
    "network-clock-incomplete",
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      primary: { code: "journey-assertion", stage: "journey" },
    }),
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      counts: { ...valid.counts, clockSamples: 2 },
    }),
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      flags: { ...valid.flags, traceDataLoss: true },
    }),
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      networkClockState: {
        ...valid.networkClockState,
        unmatchedTrackedEvent: 1,
      },
    }),
  );
  assert.throws(() =>
    createColdFailureReceipt({
      ...valid,
      childOutcome: "passed",
      primary: null,
      counts: { ...valid.counts, incompleteTrackedRequests: 0 },
      phaseCensus: valid.phaseCensus,
    }),
  );
});

test("P0 #558 v5: maximum valid counts and census fit the canonical 2 KiB receipt", () => {
  const base = validatedPhaseFailureReceipt();
  const counts = Object.fromEntries(
    Object.entries(base.counts).map(([key, value]) => [
      key,
      value === null ? null : value,
    ]),
  );
  Object.assign(counts, {
    clockSamples: 3,
    traceEventsReceived: 250_000,
    timelineRecordsRetained: 250_000,
    trackedRequests: 2_048,
    incompleteTrackedRequests: 2_048,
    cpuSamples: 500_000,
    cpuNodes: 50_000,
  });
  const resourceKinds = Object.fromEntries(
    Object.keys(base.incompleteClassification.resourceKinds).map((kind) => [
      kind,
      0,
    ]),
  );
  resourceKinds.unknown = 2_048;
  const sourceClasses = Object.fromEntries(
    Object.keys(base.incompleteClassification.sourceClasses).map((kind) => [
      kind,
      0,
    ]),
  );
  sourceClasses["other-or-invalid"] = 2_048;
  const maxWindow = Object.fromEntries(
    COLD_PHASE_CATEGORIES.map((phase) => [phase, 1_000_000]),
  );
  const receipt = createColdFailureReceipt({
    ...base,
    counts,
    networkClockState: {
      invalidStart: 2_048,
      terminalNotSeen: 2_048,
      invalidTerminal: 0,
      notSeenAfterResponse: 0,
      incompleteAfterRedirect: 0,
      unexpectedSameIdReplacement: 0,
      duplicateTerminal: 0,
      unmatchedTrackedEvent: 0,
    },
    incompleteClassification: { resourceKinds, sourceClasses },
    phaseCensus: {
      state: "validated",
      windows: { lcp: maxWindow, clickToPaint: maxWindow },
    },
  });
  const bytes = Buffer.byteLength(JSON.stringify(receipt), "utf8");
  assert.ok(bytes <= COLD_FAILURE_RECEIPT_MAX_BYTES, `${bytes} bytes`);
});

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
  assert.match(
    report.interpretation.routePaintCriterion,
    /positive conservative inward-bounded axis-aligned target region after viewport and ancestor overflow\/paint-containment clipping/,
  );
  assert.match(
    report.interpretation.routePaintCriterion,
    /Subpixel boundary strips may fail closed; ambiguous RTL\/root or top-scrollbar origins/,
  );
  assert.match(
    report.interpretation.routePaintCriterion,
    /CSS zoom other than 1/,
  );
  assert.match(
    report.interpretation.routePaintCriterion,
    /not pixel-level or occlusion proof/,
  );
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

test("clock alignment accepts stable arbitrary Chromium tick origins without serializing them", () => {
  const offsetMs = 3 * 24 * 60 * 60 * 1000;
  const samples = [
    makeClockSample(offsetMs),
    makeClockSample(offsetMs, 250),
    makeClockSample(offsetMs, 875),
  ];
  const estimate = estimateClockAlignment(samples);
  const nearOriginEstimate = estimateClockAlignment([
    makeClockSample(100),
    makeClockSample(100, 250),
    makeClockSample(100, 875),
  ]);

  assert.ok(estimate.offsetMs > 60_000);
  assert.ok(estimate.uncertaintyMs >= COLD_CLOCK_TIMER_ALLOWANCE_MS);
  assert.ok(estimate.uncertaintyMs < 0.21);
  assert.ok(
    Math.abs(estimate.uncertaintyMs - nearOriginEstimate.uncertaintyMs) < 0.001,
  );
  assert.equal(estimate.documentTimeOriginMs, TEST_TIME_ORIGIN_MS);
  const roundedBound = buildSanitizedColdReport(
    reportInput({ clockUncertaintyMs: estimate.uncertaintyMs }),
  ).clocks.alignmentUncertaintyMs;
  assert.equal(roundedBound, Math.ceil(estimate.uncertaintyMs * 10) / 10);
  const encoded = JSON.stringify(
    buildSanitizedColdReport(
      reportInput({ clockUncertaintyMs: estimate.uncertaintyMs }),
    ),
  );
  assert.equal(encoded.includes(String(estimate.offsetMs)), false);
  assert.equal(encoded.includes(String(TEST_TIME_ORIGIN_MS)), false);
  assert.equal(encoded.includes("documentTimeOriginMs"), false);
  assert.equal(encoded.includes("offsetMs"), false);
});

test("clock samples preserve seconds, milliseconds and microseconds in one page-relative domain", () => {
  const offsetMs = 86_400_000;
  const sample = createColdClockSample({
    chromiumVersion: COLD_CLOCK_SUPPORTED_CHROMIUM_VERSION,
    timestampSeconds: 86_400.125,
    beforeMs: 125,
    afterMs: 125,
    beforeTimeOriginMs: TEST_TIME_ORIGIN_MS,
    afterTimeOriginMs: TEST_TIME_ORIGIN_MS,
    expectedTimeOriginMs: TEST_TIME_ORIGIN_MS,
  });
  assert.equal(sample.offsetMs, offsetMs);
  const networkMs = translateColdNetworkTimestamp(
    (offsetMs + 250) / 1000,
    sample.offsetMs,
  );
  const trace = translateColdTraceInterval(
    (offsetMs + 249) * 1000,
    1000,
    sample.offsetMs,
  );
  assert.ok(Math.abs(networkMs - 250) < 0.001);
  assert.ok(Math.abs(trace.startMs - 249) < 0.001);
  assert.ok(Math.abs(trace.endMs - 250) < 0.001);
});

test("clock alignment includes the two timer clamps and maximum sampled offset residual", () => {
  const samples = [
    makeClockSample(100_000, 125),
    makeClockSample(100_000, 250),
    makeClockSample(100_010, 875),
  ];
  const estimate = estimateClockAlignment(samples);
  assert.ok(estimate.uncertaintyMs > 6.86);
  assert.ok(estimate.uncertaintyMs < 6.88);

  assert.throws(() => estimateClockAlignment([]), /samples/);
  assert.throws(
    () =>
      estimateClockAlignment([
        samples[0],
        makeClockSample(100_000, 250, TEST_TIME_ORIGIN_MS + 1),
      ]),
    /alignment sample/,
  );
});

test("clock alignment rejects origin changes, unsupported precision and unsafe brackets", () => {
  const base = {
    chromiumVersion: COLD_CLOCK_SUPPORTED_CHROMIUM_VERSION,
    timestampSeconds: 100.125,
    beforeMs: 125,
    afterMs: 125,
    beforeTimeOriginMs: TEST_TIME_ORIGIN_MS,
    afterTimeOriginMs: TEST_TIME_ORIGIN_MS,
    expectedTimeOriginMs: TEST_TIME_ORIGIN_MS,
  };
  assert.throws(
    () =>
      createColdClockSample({
        ...base,
        afterTimeOriginMs: TEST_TIME_ORIGIN_MS + 1,
      }),
    /changed document clock/,
  );
  assert.throws(
    () =>
      createColdClockSample({
        ...base,
        expectedTimeOriginMs: TEST_TIME_ORIGIN_MS + 1,
      }),
    /changed document clock/,
  );
  assert.throws(
    () => createColdClockSample({ ...base, chromiumVersion: "154.0.1.2" }),
    /precision contract/,
  );
  assert.throws(
    () => createColdClockSample({ ...base, afterMs: 124 }),
    /Invalid or changed document clock sample/,
  );
  assert.throws(
    () => createColdClockSample({ ...base, afterMs: 2126 }),
    /uncertainty bound/,
  );
  assert.throws(
    () =>
      createColdClockSample({ ...base, timestampSeconds: Number.MAX_VALUE }),
    /Invalid or changed document clock sample/,
  );
  assert.throws(
    () => createColdClockSample({ ...base, timestampSeconds: 1e13 }),
    /clock sample|timestamp conversion/i,
  );
  assert.throws(
    () =>
      createColdClockSample({
        ...base,
        timestampSeconds: 0.0001,
        beforeMs: 0.3,
        afterMs: 0.5,
      }),
    /coordinate or uncertainty bound/,
  );
  assert.throws(
    () => estimateClockAlignment([makeClockSample(0), makeClockSample(3000)]),
    /uncertainty bound/,
  );
  assert.throws(
    () => translateColdNetworkTimestamp(601, 0),
    /outside the report time window/,
  );
  assert.throws(
    () => translateColdTraceInterval(601_000_000, 1, 0),
    /outside the report time window/,
  );
  assert.throws(
    () => translateColdTraceInterval(1, Number.POSITIVE_INFINITY, 0),
    /Invalid CDP trace interval/,
  );
});

test("cold report requires a valid translated interval for the fixed work-list request", () => {
  const resources = reportInput().resources.map((resource) => ({
    ...resource,
  }));
  resources[2].timing = undefined;
  assert.throws(
    () => buildSanitizedColdReport(reportInput({ resources })),
    /lacks a valid translated work-list request interval/,
  );
  resources[2].timing = { start: 601_000, end: 601_100 };
  assert.throws(
    () => buildSanitizedColdReport(reportInput({ resources })),
    /Translated resource timing/,
  );
  const report = buildSanitizedColdReport(reportInput());
  delete report.resources.find(
    (resource) => resource.route === "/api/projects/:project/work-items",
  ).timingMs;
  assert.throws(
    () => assertColdReportPrivacy(report, assetBasenames),
    /lacks a valid translated work-list request interval/,
  );
});

test("main-thread phases require a valid task interval overlapping the observed journey", () => {
  assert.equal(
    assertColdMainThreadJourneyOverlap([{ start: -2, end: 10 }], 200),
    true,
  );
  for (const intervals of [
    [],
    [{ start: 250, end: 300 }],
    [{ start: -60_001, end: 10 }],
    [{ start: 10, end: 9 }],
  ]) {
    assert.throws(
      () => assertColdMainThreadJourneyOverlap(intervals, 200),
      /No valid main-thread task overlaps/,
    );
  }
  const report = buildSanitizedColdReport(reportInput());
  report.mutuallyExclusiveMainThreadPhases = [];
  assert.throws(
    () => assertColdReportPrivacy(report, assetBasenames),
    /Phase table is missing or oversized/,
  );
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
    {
      change(report) {
        report.interpretation.routePaintCriterion = "pixel-perfect paint proof";
      },
      expected: /Interpretation overstates causal evidence/,
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
