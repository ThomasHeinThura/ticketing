import assert from "node:assert/strict";
import test from "node:test";
import { assertHostedCaptureComplete } from "./hosted-profile-validation.mjs";

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

for (const [label, mutate] of [
  [
    "unresolved sample node",
    (payload) => {
      payload.cpuProfile.samples = [9];
    },
  ],
  [
    "sample and delta count mismatch",
    (payload) => {
      payload.cpuProfile.timeDeltas = [];
    },
  ],
  [
    "non-finite sample duration",
    (payload) => {
      payload.cpuProfile.timeDeltas = [Number.NaN];
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
