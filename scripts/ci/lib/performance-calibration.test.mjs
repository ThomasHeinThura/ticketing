import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  assertCalibrationSourcePinned,
  CALIBRATED_METRICS,
  CALIBRATION_BATCHES,
  CALIBRATION_FACTOR_MAX,
  CALIBRATION_FACTOR_MIN,
  CALIBRATION_MAX_SPREAD,
  CALIBRATION_OPTIONS,
  CALIBRATION_SOURCE,
  calibratedMedianOfThreeWithRetry,
  calibrationOptionsSha256,
  describeHost,
  normaliseSample,
  PERFORMANCE_REFERENCE,
  resolveJobCalibration,
  sha256Hex,
  summariseCalibration,
} from "./performance-calibration.mjs";

// Literal hashes recorded with R0 (the values in force when the collection runs ran). These
// are deliberately NOT imported: a test that compares a constant with itself proves nothing.
const RECORDED_SOURCE_SHA256 =
  "6b75d3e90b6a3ea297ad3ace423166e3602a185d865cb3ec9a2889bbce206ce5";
const RECORDED_OPTIONS_SHA256 =
  "2f4c9448c86ed2cb1ed2e62cff530dd1d4eed6b589acdf7bd58af7833d1961df";

/** One job calibration from identical batches: a test shorthand for resolveJobCalibration. */
const resolveCalibration = ({ runs, ...rest }) =>
  resolveJobCalibration({ batches: [runs, runs, runs], ...rest });

const R0_UNTHROTTLED = 100;
const R0_THROTTLED = 400;
const pinned = (overrides = {}) => ({
  sourceSha256: RECORDED_SOURCE_SHA256,
  optionsSha256: RECORDED_OPTIONS_SHA256,
  unthrottledMs: R0_UNTHROTTLED,
  throttledMs: R0_THROTTLED,
  evidence: "test fixture",
  ...overrides,
});
const baseOf = (state) =>
  state === "throttled" ? R0_THROTTLED : R0_UNTHROTTLED;
/** Five calibration runs with the given median and no spread. */
const runsAt = (ms) => [ms, ms, ms, ms, ms];

const calibrated = (factor, state = "unthrottled") =>
  resolveCalibration({
    runs: runsAt(baseOf(state) * factor),
    state,
    reference: pinned(),
  });

/** Drives the full retry pipeline with fixed raw samples and a fixed calibration. */
async function judge({ samples, budget, metric, factor, reference, metrics }) {
  let index = 0;
  const table = metrics ?? CALIBRATED_METRICS;
  return calibratedMedianOfThreeWithRetry({
    sample: async () => samples[index++],
    budget,
    metric,
    metrics: table,
    calibration: resolveCalibration({
      runs: runsAt(baseOf(table[metric].state) * factor),
      state: table[metric].state,
      reference: reference ?? pinned(),
    }),
  });
}

test("calibration workload source is pinned by SHA-256", () => {
  assert.equal(sha256Hex(CALIBRATION_SOURCE), RECORDED_SOURCE_SHA256);
  assert.equal(assertCalibrationSourcePinned(), RECORDED_SOURCE_SHA256);
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

test("the calibration options are hashed into the pin and any change changes the hash", () => {
  assert.equal(calibrationOptionsSha256(), RECORDED_OPTIONS_SHA256);
  assert.deepEqual(
    { ...CALIBRATION_OPTIONS },
    { warmups: 2, runs: 5, rows: 400, columns: 6 },
  );
  for (const key of ["warmups", "runs", "rows", "columns"]) {
    assert.notEqual(
      calibrationOptionsSha256({
        ...CALIBRATION_OPTIONS,
        [key]: CALIBRATION_OPTIONS[key] + 1,
      }),
      RECORDED_OPTIONS_SHA256,
      key,
    );
  }
});

test("the shipped R0 is the recorded FAST-class reference, pinned together", () => {
  assert.equal(PERFORMANCE_REFERENCE.unthrottledMs, 51.65);
  assert.equal(PERFORMANCE_REFERENCE.throttledMs, 230.7);
  assert.equal(PERFORMANCE_REFERENCE.sourceSha256, RECORDED_SOURCE_SHA256);
  assert.equal(PERFORMANCE_REFERENCE.optionsSha256, RECORDED_OPTIONS_SHA256);
  for (const id of [
    "37976720914",
    "113976781168",
    "37977779990",
    "113980309611",
    "37978934788",
    "113984215185",
    "37972321719",
    "113961809231",
    "37973730948",
    "113966606217",
    "37974125393",
    "113971494970",
  ]) {
    assert.match(PERFORMANCE_REFERENCE.evidence, new RegExp(id));
  }
  assert.match(PERFORMANCE_REFERENCE.evidence, /FAST = unthrottled/);
  // The shipped pin must be accepted for both states with the shipped hashes.
  for (const state of ["unthrottled", "throttled"]) {
    const base = state === "throttled" ? 230.7 : 51.65;
    const calibration = resolveCalibration({ runs: runsAt(base), state });
    assert.equal(calibration.mode, "calibrated");
    assert.equal(calibration.factor, 1);
  }
});

test("the spread bound and factor clamp are the recorded values", () => {
  assert.equal(CALIBRATION_MAX_SPREAD, 0.55);
  assert.equal(CALIBRATION_FACTOR_MIN, 0.75);
  assert.equal(CALIBRATION_FACTOR_MAX, 1.75);
});

test("the calibration statistic is the median of five, not min, max or mean", () => {
  assert.equal(summariseCalibration([10, 50, 30, 20, 40]).medianMs, 30);
  assert.equal(summariseCalibration([1, 100, 30, 31, 29]).medianMs, 30);
  assert.equal(summariseCalibration([100, 99, 30, 98, 97]).medianMs, 98);
  const summary = summariseCalibration([10, 50, 30, 20, 40]);
  assert.equal(summary.spread, (50 - 10) / 30);
  assert.throws(() => summariseCalibration([1, 2, 3]), /exactly 5/);
});

test("a calibration's factor uses that median, so a single outlier run cannot move it", () => {
  const withOutlier = resolveCalibration({
    runs: [100, 100, 100, 100, 150],
    state: "unthrottled",
    reference: pinned(),
  });
  assert.equal(withOutlier.factor, 1);
  const lowOutlier = resolveCalibration({
    runs: [100, 100, 100, 100, 60],
    state: "unthrottled",
    reference: pinned(),
  });
  assert.equal(lowOutlier.factor, 1);
});

test("full normalisation divides by F^k, symmetric around 1", () => {
  const slow = calibrated(1.5);
  assert.equal(slow.mode, "calibrated");
  assert.equal(normaliseSample(750, slow, "full", 1), 500);
  const fast = calibrated(0.8);
  assert.ok(Math.abs(normaliseSample(400, fast, "full", 1) - 500) < 1e-9);
  assert.equal(normaliseSample(400, calibrated(1), "full", 1), 400);
  // k = 0 leaves the value alone; k = 0.5 divides by sqrt(F).
  assert.equal(normaliseSample(750, slow, "full", 0), 750);
  assert.ok(
    Math.abs(normaliseSample(750, slow, "full", 0.5) - 750 / Math.sqrt(1.5)) <
      1e-9,
  );
});

test("post-DCL normalisation scales only the CPU portion, never the network floor", () => {
  const slow = calibrated(1.5, "throttled");
  assert.equal(
    normaliseSample({ value: 2550, floorMs: 2100 }, slow, "post-dcl", 1),
    2400,
  );
  const fast = calibrated(0.8, "throttled");
  assert.ok(
    Math.abs(
      normaliseSample({ value: 2400, floorMs: 2100 }, fast, "post-dcl", 1) -
        2475,
    ) < 1e-9,
  );
  // LCP at or before DCL leaves no post-floor portion to scale: fail closed, never scale it all.
  assert.throws(
    () => normaliseSample({ value: 900, floorMs: 2100 }, slow, "post-dcl", 1),
    /0 < floor < LCP/,
  );
});

test("post-DCL normalisation fails closed without a finite DCL floor", () => {
  const slow = calibrated(1.5, "throttled");
  assert.throws(
    () => normaliseSample({ value: 2550 }, slow, "post-dcl", 1),
    /DOMContentLoaded floor/,
  );
  assert.throws(
    () =>
      normaliseSample(
        { value: 2550, floorMs: Number.NaN },
        slow,
        "post-dcl",
        1,
      ),
    /DOMContentLoaded floor/,
  );
});

test("scale none is never changed and unknown scales throw", () => {
  assert.equal(normaliseSample(16.8, calibrated(1.4), "none"), 16.8);
  assert.throws(
    () => normaliseSample(1, calibrated(1.4), "half", 1),
    /Unknown G11 normalisation scale/,
  );
});

test("per-metric k cannot exceed 1: no metric is amplified beyond the calibration", () => {
  for (const [id, entry] of Object.entries(CALIBRATED_METRICS)) {
    assert.ok(entry.k >= 0 && entry.k <= 1, `${id} k=${entry.k}`);
  }
  const slow = calibrated(1.5);
  for (const k of [1.01, 2, -0.1, Number.NaN, undefined]) {
    assert.throws(
      () => normaliseSample(750, slow, "full", k),
      /sensitivity k must lie in \[0, 1\]/,
    );
  }
  // Even at k = 1 the normalised value is never below raw / F.
  assert.equal(normaliseSample(750, slow, "full", 1), 500);
});

test("the pinned k table matches the recorded metrics and states", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(CALIBRATED_METRICS).map(([id, entry]) => [id, entry.k]),
    ),
    {
      list: 1,
      board: 1,
      lcp: 1,
      route: 0.62,
      create: 0.74,
      palette: 0.56,
      paletteNav: 0.59,
      taskState: 0.9,
      taskAssign: 0.41,
    },
  );
  assert.equal(CALIBRATED_METRICS.list.state, "unthrottled");
  assert.equal(CALIBRATED_METRICS.board.state, "unthrottled");
  for (const id of [
    "lcp",
    "route",
    "create",
    "palette",
    "paletteNav",
    "taskState",
    "taskAssign",
  ]) {
    assert.equal(CALIBRATED_METRICS[id].state, "throttled", id);
  }
  assert.equal(CALIBRATED_METRICS.lcp.scale, "post-dcl");
});

test("a speed factor outside the bound fails closed, bounds are inclusive", () => {
  assert.equal(calibrated(CALIBRATION_FACTOR_MIN).mode, "calibrated");
  assert.equal(calibrated(CALIBRATION_FACTOR_MAX).mode, "calibrated");
  assert.throws(() => calibrated(0.74), /outside \[0\.75, 1\.75\]/);
  assert.throws(() => calibrated(1.76), /outside \[0\.75, 1\.75\]/);
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
  // The worst spread observed on hosted runners (0.433) is accepted.
  assert.equal(
    resolveCalibration({
      runs: [86.7, 100, 100, 100, 130],
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
        resolveCalibration({ runs, state: "unthrottled", reference: pinned() }),
      /exactly 5 positive finite runs/,
    );
  }
});

const unpinnedReference = {
  sourceSha256: null,
  optionsSha256: null,
  unthrottledMs: null,
  throttledMs: null,
  evidence: null,
};

test("an absent R0 is calibration-only: measured, never gated, raw judged", () => {
  const unpinned = resolveCalibration({
    runs: runsAt(150),
    state: "unthrottled",
    reference: unpinnedReference,
  });
  assert.equal(unpinned.mode, "calibration-only");
  assert.equal(unpinned.factor, 1);
  assert.equal(unpinned.medianMs, 150);
  const wild = resolveCalibration({
    runs: [1, 500, 3, 4000, 5],
    state: "throttled",
    reference: unpinnedReference,
  });
  assert.equal(wild.mode, "calibration-only");
  assert.equal(normaliseSample(777.7, wild, "full", 1), 777.7);
  assert.equal(
    normaliseSample({ value: 2555, floorMs: 2100 }, wild, "post-dcl", 1),
    2555,
  );
  const broken = resolveCalibration({
    runs: [],
    state: "throttled",
    reference: unpinnedReference,
  });
  assert.equal(broken.mode, "calibration-only");
  assert.match(broken.note, /exactly 5/);
});

test("a present but malformed or stale R0 throws instead of degrading to raw", () => {
  const options = { runs: runsAt(100), state: "unthrottled" };
  for (const unthrottledMs of [0, Number.NaN, -5]) {
    assert.throws(
      () =>
        resolveCalibration({
          ...options,
          reference: pinned({ unthrottledMs }),
        }),
      /positive finite/,
    );
  }
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
      resolveCalibration({
        ...options,
        state: "sideways",
        reference: pinned(),
      }),
    /Unknown G11 calibration state/,
  );
});

test("null, empty and non-string evidence throws", () => {
  const options = { runs: runsAt(100), state: "unthrottled" };
  for (const evidence of [null, undefined, "", 42]) {
    assert.throws(
      () => resolveCalibration({ ...options, reference: pinned({ evidence }) }),
      /cite its recorded evidence/,
      String(evidence),
    );
  }
});

test("a mixed pin (one throttle state only) throws in both states", () => {
  for (const reference of [
    pinned({ throttledMs: null }),
    pinned({ unthrottledMs: null }),
    pinned({ throttledMs: undefined }),
  ]) {
    for (const state of ["unthrottled", "throttled"]) {
      assert.throws(
        () => resolveCalibration({ runs: runsAt(100), state, reference }),
        /both throttle states together/,
      );
    }
  }
});

test("editing the workload fails closed even with a refreshed hash constant", () => {
  // The shipped path computes the hash live; simulate an edited workload whose exported
  // constant was refreshed to match. The R0 record holds the LITERAL recorded hash.
  const edited = `${CALIBRATION_SOURCE}\n// heavier workload`;
  const refreshed = sha256Hex(edited);
  assert.notEqual(refreshed, RECORDED_SOURCE_SHA256);
  for (const state of ["unthrottled", "throttled"]) {
    assert.throws(
      () =>
        resolveCalibration({
          runs: runsAt(state === "throttled" ? 230.7 : 51.65),
          state,
          reference: PERFORMANCE_REFERENCE,
          sourceSha256: refreshed,
        }),
      /different calibration workload/,
    );
  }
  // A refreshed constant does not satisfy the source assertion either.
  assert.throws(
    () => assertCalibrationSourcePinned(edited),
    /does not match its pinned SHA-256/,
  );
});

test("editing any calibration option fails closed against the shipped R0", () => {
  for (const key of ["warmups", "runs", "rows", "columns"]) {
    const edited = calibrationOptionsSha256({
      ...CALIBRATION_OPTIONS,
      [key]: CALIBRATION_OPTIONS[key] + 1,
    });
    assert.throws(
      () =>
        resolveCalibration({
          runs: runsAt(230.7),
          state: "throttled",
          reference: PERFORMANCE_REFERENCE,
          optionsSha256: edited,
        }),
      /different calibration options/,
      key,
    );
  }
});

test("a stale or missing recorded options hash invalidates R0", () => {
  for (const optionsSha256 of [
    calibrationOptionsSha256({ ...CALIBRATION_OPTIONS, warmups: 4 }),
    null,
  ]) {
    assert.throws(
      () =>
        resolveCalibration({
          runs: runsAt(100),
          state: "unthrottled",
          reference: pinned({ optionsSha256 }),
        }),
      /different calibration options/,
    );
  }
});

// Reference-speed value of each calibrated metric used by the key negative control. A runner
// of speed factor F measures a product that costs v at reference speed as v * F^k raw.
const REFERENCE_VALUE = {
  list: { budget: 500, value: 405 },
  board: { budget: 500, value: 405 },
  route: { budget: 300, value: 243 },
  create: { budget: 200, value: 162 },
  palette: { budget: 200, value: 162 },
  paletteNav: { budget: 200, value: 162 },
  taskState: { budget: 200, value: 162 },
  taskAssign: { budget: 200, value: 162 },
};

test("negative control: a 25% regression still fails at F=1.4 for EACH normalised metric", async () => {
  const factor = 1.4;
  for (const [id, { budget, value }] of Object.entries(REFERENCE_VALUE)) {
    const { k } = CALIBRATED_METRICS[id];
    const slowRaw = (v) => v * factor ** k;
    const baseline = await judge({
      samples: [slowRaw(value), slowRaw(value), slowRaw(value)],
      budget,
      metric: id,
      factor,
    });
    assert.equal(baseline.retried, false, `${id} baseline retried`);
    assert.ok(baseline.result < budget, `${id} baseline must pass`);
    const regressed = await judge({
      samples: Array.from({ length: 6 }, () => slowRaw(value * 1.25)),
      budget,
      metric: id,
      factor,
    });
    assert.equal(regressed.retried, true, `${id} regressed retried`);
    assert.ok(
      regressed.result >= budget,
      `${id}: 25% regression got ${regressed.result} vs budget ${budget}`,
    );
  }
  // LCP: DCL 2100 is network floor; baseline post-DCL 380; a 25% CPU regression is 475.
  const lcpRaw = (post) => ({
    value: 2100 + post * factor ** CALIBRATED_METRICS.lcp.k,
    floorMs: 2100,
  });
  const lcpBaseline = await judge({
    samples: [lcpRaw(380), lcpRaw(380), lcpRaw(380)],
    budget: 2500,
    metric: "lcp",
    factor,
  });
  assert.ok(lcpBaseline.result < 2500);
  const lcpRegressed = await judge({
    samples: Array.from({ length: 6 }, () => lcpRaw(380 * 1.25)),
    budget: 2500,
    metric: "lcp",
    factor,
  });
  assert.ok(lcpRegressed.result >= 2500, `got ${lcpRegressed.result}`);
});

test("negative control: a fixed LCP delay, in the network floor or the CPU portion, still fails", async () => {
  const baseline = await judge({
    samples: Array.from({ length: 3 }, () => ({ value: 2550, floorMs: 2130 })),
    budget: 2500,
    metric: "lcp",
    factor: 1.4,
  });
  assert.ok(baseline.result < 2500);
  const delayed = await judge({
    samples: Array.from({ length: 6 }, () => ({ value: 2670, floorMs: 2130 })),
    budget: 2500,
    metric: "lcp",
    factor: 1.4,
  });
  assert.ok(delayed.result >= 2500, `got ${delayed.result}`);
  const networkDelay = await judge({
    samples: Array.from({ length: 6 }, () => ({ value: 2700, floorMs: 2400 })),
    budget: 2500,
    metric: "lcp",
    factor: 1.7,
  });
  assert.ok(networkDelay.result >= 2500);
});

test("negative control: the median cannot hide a consistent regression", async () => {
  const outlierLow = await judge({
    samples: [300, 650, 660, 300, 650, 660],
    budget: 500,
    metric: "list",
    factor: 1,
  });
  assert.equal(outlierLow.sets[0].result, 650);
  assert.equal(outlierLow.result, 650);
  const retried = await judge({
    samples: [650, 640, 660, 300, 650, 640],
    budget: 500,
    metric: "list",
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
    metric: "list",
    factor: 1,
  });
  assert.equal(worse.sets[0].result, 520);
  assert.equal(worse.result, 560);
});

test("negative control: factor 1.0 cannot turn an over-budget result into a pass", async () => {
  for (const metric of Object.keys(CALIBRATED_METRICS)) {
    const measured = await judge({
      samples: Array.from({ length: 6 }, () => ({ value: 520, floorMs: 100 })),
      budget: 500,
      metric,
      factor: 1,
    });
    assert.equal(measured.sets[0].calibration.factor, 1);
    assert.deepEqual(measured.sets[0].normalised, measured.sets[0].raw);
    assert.ok(measured.result >= 500, metric);
  }
});

test("a faster-than-reference runner is judged stricter, not more leniently", async () => {
  const measured = await judge({
    samples: Array.from({ length: 6 }, () => 300),
    budget: 500,
    metric: "list",
    factor: 0.8,
  });
  assert.ok(measured.sets[0].result > 300 * 1.2);
  const fastRunner = await judge({
    samples: Array.from({ length: 6 }, () => 420),
    budget: 500,
    metric: "list",
    factor: 0.8,
  });
  assert.ok(fastRunner.result >= 500);
});

test("calibration-only mode gates exactly as the uncalibrated median-of-three rule", async () => {
  let index = 0;
  const samples = [510, 505, 520, 490, 495, 480];
  const measured = await calibratedMedianOfThreeWithRetry({
    sample: async () => samples[index++],
    budget: 500,
    metric: "list",
    calibration: resolveCalibration({
      runs: runsAt(123),
      state: "unthrottled",
      reference: unpinnedReference,
    }),
  });
  assert.equal(measured.sets[0].calibration.mode, "calibration-only");
  assert.deepEqual(measured.sets[0].normalised, [510, 505, 520]);
  assert.equal(measured.retried, true);
  assert.equal(measured.result, 490);
  assert.deepEqual(measured.sets[1].raw, [490, 495, 480]);
});

test("an unstable or out-of-range calibration fails the metric before any sample result", async () => {
  await assert.rejects(
    judge({ samples: [1, 1, 1], budget: 500, metric: "list", factor: 1.8 }),
    /failing closed/,
  );
  await assert.rejects(
    judge({ samples: [1, 1, 1], budget: 500, metric: "list", factor: 0.7 }),
    /failing closed/,
  );
});

test("the job calibration is reused by every set: no per-set recalibration", async () => {
  let index = 0;
  const samples = [600, 600, 600, 400, 400, 400];
  const calibration = resolveCalibration({
    runs: runsAt(R0_UNTHROTTLED),
    state: "unthrottled",
    reference: pinned(),
  });
  const measured = await calibratedMedianOfThreeWithRetry({
    sample: async () => samples[index++],
    budget: 500,
    metric: "list",
    calibration,
  });
  assert.equal(measured.retried, true);
  assert.equal(measured.sets.length, 2);
  assert.equal(measured.sets[0].calibration, calibration);
  assert.equal(measured.sets[1].calibration, calibration);
  assert.equal(measured.sets[0].result, 600);
  assert.equal(measured.result, 400);
  await assert.rejects(
    calibratedMedianOfThreeWithRetry({
      sample: async () => 1,
      budget: 0,
      metric: "list",
      calibration,
    }),
    /budget must be a positive finite number/,
  );
  await assert.rejects(
    calibratedMedianOfThreeWithRetry({
      sample: async () => 1,
      budget: 500,
      metric: "sign-in",
      calibration,
    }),
    /Unknown G11 calibrated metric/,
  );
  // A calibration for the wrong throttle state, or none, is refused.
  await assert.rejects(
    calibratedMedianOfThreeWithRetry({
      sample: async () => 1,
      budget: 500,
      metric: "route",
      calibration,
    }),
    /missing or for another throttle state/,
  );
});

test("the retry fires at exactly the budget and not below it", async () => {
  const atBudget = await judge({
    samples: [500, 500, 500, 500, 500, 500],
    budget: 500,
    metric: "list",
    factor: 1,
  });
  assert.equal(atBudget.retried, true);
  assert.equal(atBudget.sets.length, 2);
  assert.ok(atBudget.result >= 500);
  const justBelow = await judge({
    samples: [499.99, 499.99, 499.99],
    budget: 500,
    metric: "list",
    factor: 1,
  });
  assert.equal(justBelow.retried, false);
  assert.equal(justBelow.sets.length, 1);
});

test("job calibration is the median of three batch medians: per-batch noise cannot move the factor", () => {
  assert.equal(CALIBRATION_BATCHES, 3);
  // One noisy batch (±25%) around a steady 100 ms runner leaves the factor at 1.
  for (const noisy of [75, 125]) {
    const job = resolveJobCalibration({
      batches: [runsAt(100), runsAt(noisy), runsAt(100)],
      state: "unthrottled",
      reference: pinned(),
    });
    assert.equal(job.factor, 1);
    assert.equal(job.medianMs, 100);
  }
  const spreadOut = resolveJobCalibration({
    batches: [runsAt(90), runsAt(100), runsAt(110)],
    state: "unthrottled",
    reference: pinned(),
  });
  assert.equal(spreadOut.factor, 1);
  assert.equal(spreadOut.batches.length, 3);
});

test("a wrong number of batches fails closed when calibrated", () => {
  for (const batches of [[], [runsAt(100)], [runsAt(100), runsAt(100)]]) {
    assert.throws(
      () =>
        resolveJobCalibration({
          batches,
          state: "unthrottled",
          reference: pinned(),
        }),
      /exactly 3 batches/,
    );
  }
});

test("each batch's spread is checked, not only the job median", () => {
  const unstable = [86.7, 100, 100, 100, 150];
  assert.throws(
    () =>
      resolveJobCalibration({
        batches: [runsAt(100), unstable, runsAt(100)],
        state: "unthrottled",
        reference: pinned(),
      }),
    /unstable/,
  );
});

test("post-DCL needs a floor strictly between 0 and LCP", () => {
  const slow = calibrated(1.5, "throttled");
  for (const floorMs of [0, -1, 2550, 2600, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normaliseSample({ value: 2550, floorMs }, slow, "post-dcl", 1),
      /0 < floor < LCP/,
      String(floorMs),
    );
  }
  assert.equal(
    normaliseSample({ value: 2550, floorMs: 2100 }, slow, "post-dcl", 1),
    2400,
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
