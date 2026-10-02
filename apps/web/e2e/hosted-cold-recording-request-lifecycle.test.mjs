import assert from "node:assert/strict";
import test from "node:test";
import { createColdRequestLifecycle } from "./hosted-cold-recording-request-lifecycle.mjs";

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
