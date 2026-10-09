import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  assertCalibrationSourcePinned,
  CALIBRATION_FACTOR_MAX,
  CALIBRATION_FACTOR_MIN,
  CALIBRATION_MAX_SPREAD,
  CALIBRATION_SOURCE,
  CALIBRATION_SOURCE_SHA256,
  calibratedMedianOfThreeWithRetry,
  describeHost,
  normaliseSample,
  PERFORMANCE_REFERENCE,
  resolveCalibration,
  sha256Hex,
  summariseCalibration,
} from "./performance-calibration.mjs";

const pinned = (overrides = {}) => ({
  sourceSha256: CALIBRATION_SOURCE_SHA256,
  unthrottledMs: 100,
  throttledMs: 400,
  evidence: "test fixture",
  ...overrides,
});
/** Five calibration runs with the given median and no spread. */
const runsAt = (ms) => [ms, ms, ms, ms, ms];

const calibrated = (factor, state = "unthrottled") =>
  resolveCalibration({
    runs: runsAt((state === "throttled" ? 400 : 100) * factor),
    state,
    reference: pinned(),
  });

/** Drives the full retry pipeline with fixed raw samples and a fixed calibration. */
async function judge({ samples, budget, scale, factor, reference, state }) {
  let index = 0;
  const base = state === "throttled" ? 400 : 100;
  return calibratedMedianOfThreeWithRetry({
    sample: async () => samples[index++],
    budget,
    scale,
    state: state ?? "unthrottled",
    calibrate: async () => runsAt(base * factor),
    reference: reference ?? pinned(),
  });
}

test("calibration workload source is pinned by SHA-256", () => {
  assert.equal(sha256Hex(CALIBRATION_SOURCE), CALIBRATION_SOURCE_SHA256);
  assert.equal(assertCalibrationSourcePinned(), CALIBRATION_SOURCE_SHA256);
  assert.throws(
    () => assertCalibrationSourcePinned(`${CALIBRATION_SOURCE} `),
    /does not match its pinned SHA-256/,
  );
});

test("calibration workload source is a self-contained function expression", () => {
  const workload = new vm.Script(`(${CALIBRATION_SOURCE})`).runInNewContext({});
  assert.equal(typeof workload, "function");
  assert.doesNotMatch(CALIBRATION_SOURCE, /Math\.random|Date\.now/);
});

test("the shipped reference is unpinned until recorded from real runs", () => {
  assert.equal(PERFORMANCE_REFERENCE.unthrottledMs, null);
  assert.equal(PERFORMANCE_REFERENCE.throttledMs, null);
});

test("full normalisation divides by the speed factor, symmetric around 1", () => {
  const slow = calibrated(1.5);
  assert.equal(slow.mode, "calibrated");
  assert.equal(normaliseSample(750, slow, "full"), 500);
  const fast = calibrated(0.8);
  assert.equal(normaliseSample(400, fast, "full"), 500);
  assert.equal(normaliseSample(400, calibrated(1), "full"), 400);
});

test("post-DCL normalisation scales only the CPU portion, never the network floor", () => {
  const slow = calibrated(1.5, "throttled");
  // floor 2100 stays; (2550 - 2100) / 1.5 = 300.
  assert.equal(
    normaliseSample({ value: 2550, floorMs: 2100 }, slow, "post-dcl"),
    2400,
  );
  const fast = calibrated(0.8, "throttled");
  // A faster runner makes the post-DCL portion larger, so the result is stricter.
  assert.equal(
    normaliseSample({ value: 2400, floorMs: 2100 }, fast, "post-dcl"),
    2475,
  );
  // LCP before DCL: nothing after the floor to scale.
  assert.equal(
    normaliseSample({ value: 900, floorMs: 2100 }, slow, "post-dcl"),
    900,
  );
});

test("post-DCL normalisation fails closed without a finite DCL floor", () => {
  const slow = calibrated(1.5, "throttled");
  assert.throws(
    () => normaliseSample({ value: 2550 }, slow, "post-dcl"),
    /DOMContentLoaded floor/,
  );
  assert.throws(
    () =>
      normaliseSample({ value: 2550, floorMs: Number.NaN }, slow, "post-dcl"),
    /DOMContentLoaded floor/,
  );
});

test("scale none is never changed and unknown scales throw", () => {
  assert.equal(normaliseSample(16.8, calibrated(2), "none"), 16.8);
  assert.throws(
    () => normaliseSample(1, calibrated(2), "half"),
    /Unknown G11 normalisation scale/,
  );
});

test("a speed factor outside the bound fails closed, bounds are inclusive", () => {
  assert.equal(calibrated(CALIBRATION_FACTOR_MIN).mode, "calibrated");
  assert.equal(calibrated(CALIBRATION_FACTOR_MAX).mode, "calibrated");
  assert.throws(() => calibrated(0.49), /outside \[0\.5, 2\.5\]/);
  assert.throws(() => calibrated(2.51), /outside \[0\.5, 2\.5\]/);
});

test("an unstable calibration fails closed", () => {
  const median = 100;
  const unstable = [
    median * (1 - CALIBRATION_MAX_SPREAD),
    median * 0.9,
    median,
    median * 1.1,
    median * (1 + CALIBRATION_MAX_SPREAD) + 5,
  ];
  assert.throws(
    () =>
      resolveCalibration({
        runs: unstable,
        state: "unthrottled",
        reference: pinned(),
      }),
    /unstable/,
  );
  const steady = [95, 98, 100, 102, 105];
  assert.equal(
    resolveCalibration({
      runs: steady,
      state: "unthrottled",
      reference: pinned(),
    }).mode,
    "calibrated",
  );
});

test("malformed calibration runs fail closed when calibrated", () => {
  for (const runs of [
    [1, 2, 3],
    [1, 2, 3, 4, Number.NaN],
    [0, 1, 1, 1, 1],
  ]) {
    assert.throws(
      () =>
        resolveCalibration({
          runs,
          state: "unthrottled",
          reference: pinned(),
        }),
      /exactly 5 positive finite runs/,
    );
  }
  assert.throws(() => summariseCalibration("nope"), /exactly 5/);
});

test("an absent R0 is calibration-only: measured, never gated, raw judged", () => {
  const unpinned = resolveCalibration({
    runs: runsAt(150),
    state: "unthrottled",
    reference: PERFORMANCE_REFERENCE,
  });
  assert.equal(unpinned.mode, "calibration-only");
  assert.equal(unpinned.factor, 1);
  assert.equal(unpinned.medianMs, 150);
  // Even a wildly out-of-range or unstable measurement cannot fail or change the raw gate.
  const wild = resolveCalibration({
    runs: [1, 500, 3, 4000, 5],
    state: "throttled",
    reference: PERFORMANCE_REFERENCE,
  });
  assert.equal(wild.mode, "calibration-only");
  assert.equal(normaliseSample(777.7, wild, "full"), 777.7);
  assert.equal(
    normaliseSample({ value: 2555, floorMs: 2100 }, wild, "post-dcl"),
    2555,
  );
  const broken = resolveCalibration({
    runs: [],
    state: "throttled",
    reference: PERFORMANCE_REFERENCE,
  });
  assert.equal(broken.mode, "calibration-only");
  assert.match(broken.note, /exactly 5/);
});

test("a present but malformed or stale R0 throws instead of degrading to raw", () => {
  const options = { runs: runsAt(100), state: "unthrottled" };
  assert.throws(
    () =>
      resolveCalibration({
        ...options,
        reference: pinned({ unthrottledMs: 0 }),
      }),
    /positive finite/,
  );
  assert.throws(
    () =>
      resolveCalibration({
        ...options,
        reference: pinned({ unthrottledMs: Number.NaN }),
      }),
    /positive finite/,
  );
  assert.throws(
    () =>
      resolveCalibration({
        ...options,
        reference: pinned({ sourceSha256: "0".repeat(64) }),
      }),
    /different calibration workload/,
  );
  assert.throws(
    () =>
      resolveCalibration({ ...options, reference: pinned({ evidence: "" }) }),
    /cite its recorded evidence/,
  );
  assert.throws(
    () =>
      resolveCalibration({
        ...options,
        state: "sideways",
        reference: pinned(),
      }),
    /Unknown G11 calibration state/,
  );
});

test("negative control: a 25% CPU regression still fails the calibrated gate", async () => {
  // Reference-speed baseline of 400 ms passes a 500 ms budget; +25% is exactly 500 and fails.
  const regressed = await judge({
    samples: [500, 500, 500, 500, 500, 500],
    budget: 500,
    scale: "full",
    factor: 1,
  });
  assert.equal(regressed.retried, true);
  assert.ok(regressed.result >= 500);
  // A slow runner (F = 1.3) hides nothing: baseline 400 -> 520 raw, regressed 650 raw.
  const slowRegressed = await judge({
    samples: [650, 650, 650, 650, 650, 650],
    budget: 500,
    scale: "full",
    factor: 1.3,
  });
  assert.ok(slowRegressed.result >= 500);
  // The un-regressed baseline on the same slow runner passes after normalisation.
  const slowBaseline = await judge({
    samples: [520, 520, 520],
    budget: 500,
    scale: "full",
    factor: 1.3,
  });
  assert.equal(slowBaseline.retried, false);
  assert.ok(slowBaseline.result < 500);
});

test("negative control: a fixed LCP delay still fails the calibrated gate", async () => {
  // Baseline on a slow runner: DCL 2130, post-DCL raw 420 at F = 1.4 -> 2130 + 300 = 2430 passes.
  const baseline = await judge({
    samples: [2550, 2550, 2550].map((value) => ({ value, floorMs: 2130 })),
    budget: 2500,
    scale: "post-dcl",
    factor: 1.4,
    state: "throttled",
  });
  assert.ok(baseline.result < 2500);
  // A fixed 120 ms delay in the post-DCL path (raw) is 120 / 1.4 = 86 ms normalised: fails.
  const delayed = await judge({
    samples: Array.from({ length: 6 }, () => ({ value: 2670, floorMs: 2130 })),
    budget: 2500,
    scale: "post-dcl",
    factor: 1.4,
    state: "throttled",
  });
  assert.ok(delayed.result >= 2500, `got ${delayed.result}`);
  // A delay in the network floor is never scaled away.
  const networkDelay = await judge({
    samples: Array.from({ length: 6 }, () => ({ value: 2700, floorMs: 2400 })),
    budget: 2500,
    scale: "post-dcl",
    factor: 2,
    state: "throttled",
  });
  assert.ok(networkDelay.result >= 2500);
});

test("negative control: the median cannot hide a consistent regression", async () => {
  // Two over-budget samples out of three decide the median; the one fast outlier is ignored.
  const outlierLow = await judge({
    samples: [300, 650, 660, 300, 650, 660],
    budget: 500,
    scale: "full",
    factor: 1,
  });
  assert.equal(outlierLow.sets[0].result, 650);
  assert.equal(outlierLow.result, 650);
  assert.ok(outlierLow.result >= 500);
  // Never best-of-N: the retry set does not combine with, or pick the best of, the first set.
  const retried = await judge({
    samples: [650, 640, 660, 300, 650, 640],
    budget: 500,
    scale: "full",
    factor: 1,
  });
  assert.equal(retried.retried, true);
  assert.equal(retried.sets[0].result, 650);
  assert.equal(retried.sets[1].result, 640);
  assert.equal(retried.result, 640);
  // The second set decides even when it is worse: the better first set is not kept.
  const worse = await judge({
    samples: [510, 520, 530, 550, 560, 570],
    budget: 500,
    scale: "full",
    factor: 1,
  });
  assert.equal(worse.sets[0].result, 520);
  assert.equal(worse.result, 560);
});

test("negative control: factor 1.0 cannot turn an over-budget result into a pass", async () => {
  for (const scale of ["full", "post-dcl"]) {
    const measured = await judge({
      samples: Array.from({ length: 6 }, () => ({
        value: 520,
        floorMs: 100,
      })),
      budget: 500,
      scale,
      factor: 1,
    });
    assert.equal(measured.sets[0].calibration.factor, 1);
    assert.deepEqual(measured.sets[0].normalised, measured.sets[0].raw);
    assert.ok(measured.result >= 500);
  }
});

test("a faster-than-reference runner is judged stricter, not more leniently", async () => {
  const measured = await judge({
    samples: Array.from({ length: 6 }, () => 300),
    budget: 500,
    scale: "full",
    factor: 0.5,
  });
  assert.equal(measured.sets[0].result, 600);
  assert.ok(measured.result >= 500);
});

test("calibration-only mode gates exactly as the uncalibrated median-of-three rule", async () => {
  let index = 0;
  const samples = [510, 505, 520, 490, 495, 480];
  const measured = await calibratedMedianOfThreeWithRetry({
    sample: async () => samples[index++],
    budget: 500,
    scale: "full",
    state: "unthrottled",
    calibrate: async () => runsAt(123),
    reference: PERFORMANCE_REFERENCE,
  });
  assert.equal(measured.sets[0].calibration.mode, "calibration-only");
  assert.deepEqual(measured.sets[0].normalised, [510, 505, 520]);
  assert.equal(measured.retried, true);
  assert.equal(measured.result, 490);
  assert.deepEqual(measured.sets[1].raw, [490, 495, 480]);
});

test("an unstable or out-of-range calibration fails the metric before any sample result", async () => {
  await assert.rejects(
    judge({ samples: [1, 1, 1], budget: 500, scale: "full", factor: 3 }),
    /failing closed/,
  );
  await assert.rejects(
    judge({ samples: [1, 1, 1], budget: 500, scale: "full", factor: 0.2 }),
    /failing closed/,
  );
});

test("the retry rule is unchanged and recalibrates each set", async () => {
  let calibrations = 0;
  let index = 0;
  const samples = [600, 600, 600, 400, 400, 400];
  const measured = await calibratedMedianOfThreeWithRetry({
    sample: async () => samples[index++],
    budget: 500,
    scale: "full",
    state: "unthrottled",
    calibrate: async () => {
      calibrations += 1;
      return runsAt(100);
    },
    reference: pinned(),
  });
  assert.equal(calibrations, 2);
  assert.equal(measured.retried, true);
  assert.equal(measured.sets.length, 2);
  assert.equal(measured.sets[0].result, 600);
  assert.equal(measured.result, 400);
  await assert.rejects(
    calibratedMedianOfThreeWithRetry({
      sample: async () => 1,
      budget: 0,
      scale: "full",
      state: "unthrottled",
      calibrate: async () => runsAt(100),
    }),
    /budget must be a positive finite number/,
  );
});

test("host description reads the CPU model from /proc/cpuinfo", () => {
  const cpuinfo =
    "processor\t: 0\nvendor_id\t: AuthenticAMD\nmodel name\t: AMD EPYC 7763 64-Core Processor\ncpu MHz\t: 2445.4\n";
  assert.deepEqual(describeHost({ cpuinfoText: cpuinfo, parallelism: 4 }), {
    cpuModel: "AMD EPYC 7763 64-Core Processor",
    nproc: 4,
  });
  assert.deepEqual(describeHost({ osCpuModel: "Apple M4", parallelism: 10 }), {
    cpuModel: "Apple M4",
    nproc: 10,
  });
  assert.deepEqual(describeHost({}), { cpuModel: "unavailable", nproc: null });
});
