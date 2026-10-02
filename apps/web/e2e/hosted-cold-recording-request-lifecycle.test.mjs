import assert from "node:assert/strict";
import test from "node:test";
import { createColdRequestLifecycle } from "./hosted-cold-recording-request-lifecycle.mjs";
import {
  coldCleanupStatuses,
  createColdFailureReceipt,
  normalizeColdCdpResourceType,
  unknownColdFailureReceipt,
} from "./hosted-cold-recording-validation.mjs";

function start(requestId, timestamp = 10, extras = {}) {
  return {
    requestId,
    timestamp,
    request: { url: `https://private.invalid/${requestId}?secret=value` },
    ...extras,
  };
}

function finish(requestId, timestamp = 11) {
  return { requestId, timestamp };
}

test("valid finish and failed finish retain first valid intervals and failure state", () => {
  const lifecycle = createColdRequestLifecycle();
  lifecycle.requestWillBeSent(start("ok"), { url: "safe-in-memory" });
  lifecycle.loadingFinished(finish("ok"));
  lifecycle.requestWillBeSent(start("failed", 12), {});
  lifecycle.loadingFailed(finish("failed", 15));
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.trackedRequests, 2);
  assert.equal(snapshot.incompleteTrackedRequests, 0);
  assert.equal(snapshot.requests[0].startTimestamp, 10);
  assert.equal(snapshot.requests[0].endTimestamp, 11);
  assert.equal(snapshot.requests[1].failed, true);
  assert.deepEqual(snapshot.networkClockState, {
    invalidStart: 0,
    terminalNotSeen: 0,
    invalidTerminal: 0,
    notSeenAfterResponse: 0,
    incompleteAfterRedirect: 0,
    unexpectedSameIdReplacement: 0,
    duplicateTerminal: 0,
    unmatchedTrackedEvent: 0,
  });
});

test("both missing endpoints and response-without-terminal fail the completion invariant", () => {
  const lifecycle = createColdRequestLifecycle();
  lifecycle.requestWillBeSent({ requestId: "both-missing" }, {});
  lifecycle.requestWillBeSent(start("response-only"), {});
  lifecycle.responseReceived({ requestId: "response-only" });
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.incompleteTrackedRequests, 2);
  assert.deepEqual(snapshot.networkClockState, {
    invalidStart: 1,
    terminalNotSeen: 2,
    invalidTerminal: 0,
    notSeenAfterResponse: 1,
    incompleteAfterRedirect: 0,
    unexpectedSameIdReplacement: 0,
    duplicateTerminal: 0,
    unmatchedTrackedEvent: 0,
  });
});

test("missing and nonfinite starts and terminals remain distinct from unseen terminals", () => {
  const lifecycle = createColdRequestLifecycle();
  lifecycle.requestWillBeSent({ requestId: "missing-start" }, {});
  lifecycle.loadingFinished(finish("missing-start"));
  lifecycle.requestWillBeSent(start("invalid-start", Number.NaN), {});
  lifecycle.loadingFinished(finish("invalid-start"));
  lifecycle.requestWillBeSent(start("missing-terminal"), {});
  lifecycle.loadingFinished({ requestId: "missing-terminal" });
  lifecycle.requestWillBeSent(start("invalid-terminal"), {});
  lifecycle.loadingFailed({
    requestId: "invalid-terminal",
    timestamp: Number.POSITIVE_INFINITY,
  });
  lifecycle.requestWillBeSent(start("not-seen"), {});
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.incompleteTrackedRequests, 5);
  assert.deepEqual(snapshot.networkClockState, {
    invalidStart: 2,
    terminalNotSeen: 1,
    invalidTerminal: 2,
    notSeenAfterResponse: 0,
    incompleteAfterRedirect: 0,
    unexpectedSameIdReplacement: 0,
    duplicateTerminal: 0,
    unmatchedTrackedEvent: 0,
  });
});

test("redirect replacement tracks only the current hop and preserves incomplete evidence", () => {
  const lifecycle = createColdRequestLifecycle();
  lifecycle.requestWillBeSent(start("redirect-id"), {});
  lifecycle.loadingFinished(finish("redirect-id"));
  lifecycle.requestWillBeSent(
    start("redirect-id", 20, { redirectResponse: { status: 302 } }),
    { url: "current-hop" },
  );
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.trackedRequests, 1);
  assert.equal(snapshot.incompleteTrackedRequests, 1);
  assert.equal(snapshot.requests[0].replacedAfterRedirect, true);
  assert.deepEqual(snapshot.networkClockState, {
    invalidStart: 0,
    terminalNotSeen: 1,
    invalidTerminal: 0,
    notSeenAfterResponse: 0,
    incompleteAfterRedirect: 1,
    unexpectedSameIdReplacement: 0,
    duplicateTerminal: 0,
    unmatchedTrackedEvent: 0,
  });
  lifecycle.loadingFinished(finish("redirect-id", 22));
  assert.equal(lifecycle.snapshot().incompleteTrackedRequests, 0);
});

test("unexpected replacement, unmatched terminal, and duplicate terminal fail closed without replacing first terminal", () => {
  const lifecycle = createColdRequestLifecycle();
  lifecycle.requestWillBeSent(start("same-id"), {});
  lifecycle.requestWillBeSent(start("same-id", 12), {});
  lifecycle.loadingFinished(finish("same-id", 14));
  lifecycle.loadingFailed(finish("same-id", 16));
  lifecycle.loadingFinished(finish("unmatched", 18));
  lifecycle.responseReceived({ requestId: "unmatched-response" });
  lifecycle.update({ requestId: "unmatched-priority" }, { priority: "Low" });
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.incompleteTrackedRequests, 0);
  assert.equal(snapshot.protocolIntegrityFailure, true);
  assert.equal(snapshot.requests[0].endTimestamp, 14);
  assert.equal(snapshot.requests[0].failed, false);
  assert.deepEqual(snapshot.networkClockState, {
    invalidStart: 0,
    terminalNotSeen: 0,
    invalidTerminal: 0,
    notSeenAfterResponse: 0,
    incompleteAfterRedirect: 0,
    unexpectedSameIdReplacement: 1,
    duplicateTerminal: 1,
    unmatchedTrackedEvent: 3,
  });
});

test("snapshot is stable, bounded, and excludes request identities and URLs from telemetry", () => {
  const lifecycle = createColdRequestLifecycle({ maxRequests: 2 });
  const privateId = "private-request-id";
  lifecycle.requestWillBeSent(start(privateId), {});
  lifecycle.loadingFinished(finish(privateId));
  const first = lifecycle.snapshot();
  lifecycle.requestWillBeSent(start("second"), {});
  const afterSecond = lifecycle.snapshot();
  assert.equal(first.trackedRequests, 1);
  assert.equal(first.requests.length, 1);
  assert.equal(afterSecond.trackedRequests, 2);
  assert.equal(afterSecond.networkClockState.invalidStart, 0);
  lifecycle.requestWillBeSent(start("overflow"), {});
  assert.equal(lifecycle.snapshot().requestOverflow, true);
  const serializedTelemetry = JSON.stringify(afterSecond.networkClockState);
  assert.equal(serializedTelemetry.includes(privateId), false);
  assert.equal(serializedTelemetry.includes("private.invalid"), false);
});

test("incomplete classification uses the immutable current-hop snapshot and fixed CDP categories", () => {
  const origin = "http://127.0.0.1:4179";
  const assetBasenames = new Set(["verified-entry-AbCdEf012345.js"]);
  const lifecycle = createColdRequestLifecycle();
  const scriptType = normalizeColdCdpResourceType("Script");
  lifecycle.requestWillBeSent(
    { requestId: "redirected", timestamp: 10 },
    {
      url: `${origin}/assets/verified-entry-AbCdEf012345.js`,
      resourceKind: scriptType.resourceKind,
      resourceType: scriptType.reportResourceType,
    },
  );
  const fetchType = normalizeColdCdpResourceType("Fetch");
  lifecycle.requestWillBeSent(
    {
      requestId: "redirected",
      timestamp: 20,
      redirectResponse: { status: 302 },
    },
    {
      url: `${origin}/api/projects/customer-secret/work-items?cursor=private`,
      resourceKind: fetchType.resourceKind,
      resourceType: fetchType.reportResourceType,
    },
  );
  const first = lifecycle.snapshot({ origin, assetBasenames });
  assert.equal(first.incompleteTrackedRequests, 1);
  assert.equal(first.requests.length, 1);
  assert.equal(first.requests[0].resourceType, "fetch");
  assert.equal(first.requests[0].resourceKind, "fetch");
  assert.equal(first.incompleteClassification.resourceKinds.fetch, 1);
  assert.equal(first.incompleteClassification.resourceKinds.script, 0);
  assert.equal(
    first.incompleteClassification.sourceClasses["known-fixed-route"],
    1,
  );
  assert.equal(
    first.incompleteClassification.sourceClasses["verified-build-asset"],
    0,
  );
  lifecycle.loadingFinished(finish("redirected", 22));
  assert.equal(first.incompleteTrackedRequests, 1);
  assert.equal(first.incompleteClassification.resourceKinds.fetch, 1);
  assert.equal(
    lifecycle.snapshot({ origin, assetBasenames }).incompleteTrackedRequests,
    0,
  );
  const serializedClassification = JSON.stringify(
    first.incompleteClassification,
  );
  for (const privateValue of [
    "customer-secret",
    "cursor=private",
    "redirected",
    origin,
    "work-items",
  ])
    assert.equal(serializedClassification.includes(privateValue), false);
});

test("all incomplete current hops partition into one closed kind and source class each", () => {
  const origin = "http://127.0.0.1:4179";
  const assetBasenames = new Set(["verified-entry-AbCdEf012345.js"]);
  const lifecycle = createColdRequestLifecycle();
  const rows = [
    [
      "rid-opaque-01",
      `${origin}/assets/verified-entry-AbCdEf012345.js`,
      "Script",
    ],
    ["rid-opaque-02", `${origin}/api/work-items/WLP-1?token=private`, "Fetch"],
    ["rid-opaque-03", `${origin}/unlisted?secret=value`, "XHR"],
    ["rid-opaque-04", "https://foreign.invalid/private?token=value", "Image"],
    ["rid-opaque-05", "not a URL secret=value", "UnknownCustomerKind"],
  ];
  for (const [requestId, url, type] of rows) {
    const normalized = normalizeColdCdpResourceType(type);
    lifecycle.requestWillBeSent(
      { requestId, timestamp: 10 },
      {
        url,
        resourceKind: normalized.resourceKind,
        resourceType: normalized.reportResourceType,
      },
    );
  }
  const snapshot = lifecycle.snapshot({ origin, assetBasenames });
  assert.equal(snapshot.incompleteTrackedRequests, rows.length);
  assert.equal(
    Object.values(snapshot.incompleteClassification.resourceKinds).reduce(
      (sum, count) => sum + count,
      0,
    ),
    rows.length,
  );
  assert.equal(
    Object.values(snapshot.incompleteClassification.sourceClasses).reduce(
      (sum, count) => sum + count,
      0,
    ),
    rows.length,
  );
  assert.equal(snapshot.incompleteClassification.resourceKinds.unknown, 1);
  assert.equal(
    snapshot.incompleteClassification.sourceClasses["verified-build-asset"],
    1,
  );
  assert.equal(
    snapshot.incompleteClassification.sourceClasses["known-fixed-route"],
    1,
  );
  assert.equal(
    snapshot.incompleteClassification.sourceClasses["same-origin-other"],
    1,
  );
  assert.equal(
    snapshot.incompleteClassification.sourceClasses["other-or-invalid"],
    2,
  );
  const serialized = JSON.stringify(snapshot.incompleteClassification);
  for (const privateValue of [
    "rid-opaque",
    "WLP-1",
    "foreign.invalid",
    "secret=value",
    "UnknownCustomerKind",
  ])
    assert.equal(serialized.includes(privateValue), false);

  const empty = unknownColdFailureReceipt();
  const receipt = createColdFailureReceipt({
    childOutcome: "failed",
    primary: { code: "network-clock-incomplete", stage: "network" },
    counts: {
      ...empty.counts,
      trackedRequests: rows.length,
      incompleteTrackedRequests: rows.length,
    },
    flags: empty.flags,
    cleanup: coldCleanupStatuses(),
    networkClockState: snapshot.networkClockState,
    incompleteClassification: snapshot.incompleteClassification,
  });
  const serializedReceipt = JSON.stringify(receipt);
  for (const privateValue of [
    "rid-opaque",
    "WLP-1",
    "foreign.invalid",
    "secret=value",
    "UnknownCustomerKind",
    origin,
  ])
    assert.equal(serializedReceipt.includes(privateValue), false);
});

test("anomaly counters fail closed at their cap rather than wrapping", () => {
  const lifecycle = createColdRequestLifecycle({
    maxRequests: 2,
    maxEvents: 1,
  });
  lifecycle.requestWillBeSent(start("same-id"), {});
  lifecycle.requestWillBeSent(start("same-id", 12), {});
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.networkClockState.unexpectedSameIdReplacement, 1);
  assert.equal(snapshot.anomalyOverflow, true);
  assert.equal(snapshot.protocolIntegrityFailure, true);
});
