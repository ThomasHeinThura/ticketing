import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHostedCaptureComplete,
  hostedProfileTraceOptions,
  parseCandidateSha,
  rewriteHostedProfileOrigin,
} from "./hosted-profile-validation.mjs";

const validPayload = () => ({
  cpuProfile: {
    nodes: [{ id: 1, callFrame: { functionName: "probe" }, children: [] }],
    samples: [1],
    timeDeltas: [1000],
    startTime: 1,
    endTime: 1001,
  },
  traceEvents: [{ name: "RunTask", cat: "devtools.timeline", ph: "X", ts: 1 }],
  counts: {
    cpuProfileNodes: 1,
    cpuSamples: 1,
    timeDeltas: 1,
    timelineEvents: 1,
  },
  tracingComplete: { dataLossOccurred: false },
});

test("accepts structurally consistent CPU and timeline capture", () => {
  assert.doesNotThrow(() =>
    assertHostedCaptureComplete(validPayload(), "valid.json"),
  );
});

test("rejects negative CPU time deltas", () => {
  const payload = validPayload();
  payload.cpuProfile.startTime = 100;
  payload.cpuProfile.endTime = 500;
  payload.cpuProfile.samples = [1, 1, 1];
  payload.cpuProfile.timeDeltas = [200, -1, 200];
  payload.counts.cpuSamples = 3;
  payload.counts.timeDeltas = 3;
  assert.throws(
    () => assertHostedCaptureComplete(payload, "negative-delta-profile.json"),
    /Incomplete or malformed hosted profile/,
  );
});

test("accepts equal reconstructed timestamps when a delta is zero", () => {
  const payload = validPayload();
  payload.cpuProfile.startTime = 100;
  payload.cpuProfile.endTime = 300;
  payload.cpuProfile.samples = [1, 1, 1];
  payload.cpuProfile.timeDeltas = [100, 0, 100];
  payload.counts.cpuSamples = 3;
  payload.counts.timeDeltas = 3;
  assert.doesNotThrow(() =>
    assertHostedCaptureComplete(payload, "equal-sample-times.json"),
  );
});

test("rejects structurally decreasing reconstructed sample timestamps", () => {
  const payload = validPayload();
  payload.cpuProfile.startTime = 100;
  payload.cpuProfile.endTime = 500;
  payload.cpuProfile.samples = [1, 1, 1];
  payload.cpuProfile.timeDeltas = [200, -100, 200];
  payload.counts.cpuSamples = 3;
  payload.counts.timeDeltas = 3;
  assert.throws(
    () => assertHostedCaptureComplete(payload, "decreasing-sample-times.json"),
    /Incomplete or malformed hosted profile/,
  );
});

for (const [label, mutate] of [
  [
    "unresolved sample node",
    (payload) => {
      payload.cpuProfile.samples = [9];
    },
  ],
  [
    "duplicate CPU node ID",
    (payload) => {
      payload.cpuProfile.nodes.push({
        id: 1,
        callFrame: { functionName: "duplicate" },
        children: [],
      });
      payload.counts.cpuProfileNodes = 2;
    },
  ],
  [
    "sample and delta count mismatch",
    (payload) => {
      payload.cpuProfile.timeDeltas = [];
    },
  ],
  [
    "non-finite time delta",
    (payload) => {
      payload.cpuProfile.timeDeltas = [Number.NaN];
    },
  ],
  [
    "reconstructed sample outside profile interval",
    (payload) => {
      payload.cpuProfile.timeDeltas = [1001];
    },
  ],
  [
    "non-finite profile timing",
    (payload) => {
      payload.cpuProfile.endTime = Number.POSITIVE_INFINITY;
    },
  ],
  [
    "metadata-only trace",
    (payload) => {
      payload.traceEvents = [
        { name: "thread_name", cat: "devtools.timeline", ph: "M", ts: 1 },
      ];
      payload.counts.timelineEvents = 1;
    },
  ],
  [
    "missing source nodes",
    (payload) => {
      payload.cpuProfile.nodes = [];
      payload.counts.cpuProfileNodes = 0;
    },
  ],
]) {
  test(`rejects ${label}`, () => {
    const payload = validPayload();
    mutate(payload);
    assert.throws(
      () => assertHostedCaptureComplete(payload, `${label}.json`),
      /Incomplete or malformed hosted profile/,
    );
  });
}

test("rewrites all expected fixture origins in the temporary benchmark copy", () => {
  const origin = "http://127.0.0.1:4178";
  const source = `base=${origin}; allow=${origin}; preflight=${origin}`;
  assert.equal(
    rewriteHostedProfileOrigin(source),
    source.replaceAll(origin, "http://127.0.0.1:4179"),
  );
});

test("fails closed if the temporary benchmark origin count changes", () => {
  assert.throws(
    () => rewriteHostedProfileOrigin("http://127.0.0.1:4178"),
    /Expected exactly 3 canonical preview origins/,
  );
});

test("parses optional candidate SHA values for provenance", () => {
  assert.equal(parseCandidateSha([]), null);
  assert.equal(parseCandidateSha(["--candidate-sha="]), null);
  assert.equal(
    parseCandidateSha([
      "--candidate-sha=0123456789abcdef0123456789abcdef01234567",
    ]),
    "0123456789abcdef0123456789abcdef01234567",
  );
  assert.throws(
    () => parseCandidateSha(["--candidate-sha=not-a-sha"]),
    /40-character Git SHA/,
  );
});

test("retains hosted diagnostic trace evidence without DOM snapshots", () => {
  assert.deepEqual(hostedProfileTraceOptions(), {
    mode: "retain-on-failure",
    snapshots: false,
    screenshots: true,
    sources: true,
    attachments: true,
  });
});
