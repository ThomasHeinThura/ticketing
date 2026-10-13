/**
 * G11 speed-calibrated measurement (owner decision 2026-10-10).
 *
 * Hosted runners come in at least two speed classes, so an absolute millisecond budget measures
 * the runner as much as the product. At job start a fixed, pinned, CPU-bound reference workload
 * is therefore run in the same browser and in each CPU-throttle state (CALIBRATION_BATCHES batches
 * of the recorded options, median of the batch medians). The ratio of that median to a recorded
 * reference value R0 is the job's speed factor F per state (F > 1: slower than the reference),
 * used for every metric and every set of the job; it is never recalibrated per set. Each metric is
 * judged against its UNCHANGED budget after normalisation to reference speed.
 *
 * Nothing here changes a budget, a workload size, throttling, network emulation, the sample count
 * or the retry rule. The statistic is the median of three; best-of-N is never used.
 *
 * Fail-closed rules:
 * - R0 is a required recorded constant. While it is null the gate is in calibration-only mode:
 *   the calibration is measured and logged, never gated, and every metric is judged raw, exactly
 *   as before this module existed.
 * - A present but malformed or stale R0 (wrong source hash, wrong options hash, no evidence,
 *   non-positive value) throws. The R0 record holds the source and options hashes as LITERALS
 *   from when it was recorded; they are compared at run time with hashes computed live from
 *   CALIBRATION_SOURCE and CALIBRATION_OPTIONS, so editing the workload or an option, even with
 *   a refreshed exported hash constant, throws until R0 itself is re-recorded. It never degrades
 *   to a silent pass.
 * - When calibrated, a factor outside [FACTOR_MIN, FACTOR_MAX] or an unstable calibration
 *   (spread above MAX_SPREAD) throws. The job fails; it never passes.
 */
import { createHash } from "node:crypto";

/**
 * Observed per-set calibration factors on the six hosted collection runs (R0 = the FAST-class
 * median) ranged 0.91 (fast, throttled) to 1.67 (slow, throttled); the slow class sat near 1.40.
 * The bound adds margin and fails closed outside it.
 */
export const CALIBRATION_FACTOR_MIN = 0.75;
export const CALIBRATION_FACTOR_MAX = 1.75;
/**
 * (max - min) / median across the measured runs of one calibration batch. Observed with this
 * exact options set (2 warm-ups) across the 65 hosted calibration sets of the six collection
 * jobs (27 fast, 38 slow): fast median 0.344 (per-job medians 0.324-0.360), maximum 0.392; slow
 * median 0.331 (per-job medians 0.275-0.371), maximum 0.433. The bound is that maximum plus
 * about a quarter margin. Runs 1-2 are consistently slower and run 2 is the slowest, which the median
 * of five absorbs; the same shape is inside R0. It can only make the job fail closed.
 */
export const CALIBRATION_MAX_SPREAD = 0.55;
/**
 * Raising the discarded warm-ups would lower the spread, but every option here is hashed into
 * the R0 pin, and R0 was recorded with exactly these options. Changing any of them invalidates
 * R0 until it is re-recorded.
 */
export const CALIBRATION_OPTIONS = Object.freeze({
  warmups: 2,
  runs: 5,
  rows: 400,
  columns: 6,
});
/**
 * Calibration batches per throttle state per job. Each batch uses CALIBRATION_OPTIONS unchanged
 * (so R0, a median of such batch medians, stays comparable); the job factor uses the median of
 * the batch medians, so one noisy batch cannot move it.
 */
export const CALIBRATION_BATCHES = 3;
export const CALIBRATION_WARMUP_RUNS = CALIBRATION_OPTIONS.warmups;
export const CALIBRATION_RUNS = CALIBRATION_OPTIONS.runs;
export const CALIBRATION_ROWS = CALIBRATION_OPTIONS.rows;
export const CALIBRATION_COLUMNS = CALIBRATION_OPTIONS.columns;

/**
 * The pinned in-browser workload: a React-like virtual-tree build, mount, forced layout, keyed
 * patch (text, class and style changes), forced layout, and unmount over a fixed table. Inputs
 * come from a seeded linear congruential generator, so every run does identical work. It is
 * evaluated in the page as `(SOURCE)(options)` and resolves to the per-run durations in ms,
 * warm-up runs already discarded. Its SHA-256 is pinned below and checked at runtime.
 */
export const CALIBRATION_SOURCE = `function calibrationWorkload(options) {
  var warmups = options.warmups;
  var runs = options.runs;
  var rows = options.rows;
  var columns = options.columns;
  var seed = 0;
  function next() {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  }
  function vnode(tag, props, children) {
    return { tag: tag, props: props, children: children };
  }
  function build(generation) {
    var tableRows = [];
    for (var r = 0; r < rows; r += 1) {
      var cells = [];
      for (var c = 0; c < columns; c += 1) {
        var roll = next();
        var changed = generation > 0 && roll % 3 === 0;
        cells.push(
          vnode("div", { className: "cell c" + (c % 3) + (changed ? " hot" : ""), style: "width:" + (changed ? 150 : 120) + "px;padding:" + (roll % 5) + "px" }, [
            vnode("span", { className: "label", text: "item-" + r + "-" + c + (changed ? "-g" + generation : "") }, []),
            vnode("em", { className: "badge", text: String(roll % 997) }, []),
          ])
        );
      }
      tableRows.push(vnode("div", { className: "row r" + (r % 2), style: "display:flex;height:" + (28 + (r % 4)) + "px" }, cells));
    }
    return vnode("div", { className: "table", style: "width:1000px" }, tableRows);
  }
  function apply(element, props) {
    for (var key in props) {
      if (key === "text") element.textContent = props[key];
      else if (key === "className") element.className = props[key];
      else if (key === "style") element.style.cssText = props[key];
    }
  }
  function mount(node, parent) {
    var element = document.createElement(node.tag);
    apply(element, node.props);
    for (var i = 0; i < node.children.length; i += 1) mount(node.children[i], element);
    parent.appendChild(element);
    return element;
  }
  function patch(element, previous, current) {
    for (var key in current.props) {
      if (previous.props[key] !== current.props[key]) {
        apply(element, { [key]: current.props[key] });
      }
    }
    for (var i = 0; i < current.children.length; i += 1) {
      patch(element.children[i], previous.children[i], current.children[i]);
    }
  }
  function once() {
    var container = document.createElement("div");
    container.style.cssText = "position:absolute;left:0;top:0;width:1000px";
    document.body.appendChild(container);
    seed = 20261010;
    var start = performance.now();
    var first = build(0);
    var rootElement = mount(first, container);
    var layoutSink = container.offsetHeight;
    var second = build(1);
    patch(rootElement, first, second);
    for (var r = 0; r < rootElement.children.length; r += 6) {
      layoutSink += rootElement.children[r].getBoundingClientRect().height;
    }
    layoutSink += container.offsetHeight;
    var elapsed = performance.now() - start;
    document.body.removeChild(container);
    if (!(layoutSink > 0)) throw new Error("calibration layout produced no height");
    return elapsed;
  }
  for (var w = 0; w < warmups; w += 1) once();
  var durations = [];
  for (var n = 0; n < runs; n += 1) durations.push(once());
  return durations;
}`;

export const CALIBRATION_SOURCE_SHA256 =
  "6b75d3e90b6a3ea297ad3ace423166e3602a185d865cb3ec9a2889bbce206ce5";

/** SHA-256 of the options object in fixed key order, so key order can never change the pin. */
export function calibrationOptionsSha256(options = CALIBRATION_OPTIONS) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        warmups: options.warmups,
        runs: options.runs,
        rows: options.rows,
        columns: options.columns,
      }),
    )
    .digest("hex");
}

/**
 * R0: the recorded reference medians of CALIBRATION_SOURCE, one per CPU-throttle state.
 * Owner decision (Thomas, 2026-10-10): the unchanged G11 budgets refer to the FAST hosted runner
 * class, so R0 is the FAST-class reference. Each value is the median of ALL calibration set
 * medians (every metric, every set including retry sets) from the three FAST runs only:
 * unthrottled n = 6 (list, board; 3 runs), throttled n = 21 (7 metrics; 3 runs; retry sets
 * would add more). Computed from the "G11 calibration ..." log lines.
 *
 * Collection: workflow_dispatch "CI - full" on claude/g11-calibration-602 at 2c52f65c, raw
 * gating, calibration-only. Calibration evidence, not gate evidence.
 *   FAST (R0): run 37976720914 job 113976781168; run 37977779990 job 113980309611;
 *              run 37978934788 job 113984215185 (G11 PASS).
 *   SLOW (class ratio and sensitivities only): run 37972321719 job 113961809231;
 *              run 37973730948 job 113966606217; run 37974125393 job 113971494970 (G11 FAIL).
 * Classification rule: FAST when the job's unthrottled calibration median is below 60 ms (fast
 * observed 47.4-57.7, slow 66.6-73.6, a clean gap) and G11 passed; SLOW otherwise.
 *
 * Both throttle states are pinned together, against this source hash and this options hash.
 * Changing the workload or its options invalidates R0 until re-recorded.
 */
export const PERFORMANCE_REFERENCE = Object.freeze({
  // LITERAL hashes in force when the six collection runs ran. Compared at run time with hashes
  // computed live from CALIBRATION_SOURCE and CALIBRATION_OPTIONS; never with an exported
  // constant, so editing the workload or an option fails closed until this record is re-made.
  sourceSha256:
    "6b75d3e90b6a3ea297ad3ace423166e3602a185d865cb3ec9a2889bbce206ce5",
  optionsSha256:
    "2f4c9448c86ed2cb1ed2e62cff530dd1d4eed6b589acdf7bd58af7833d1961df",
  unthrottledMs: 51.65,
  throttledMs: 230.7,
  evidence:
    "FAST-class medians of all calibration set medians (unthrottled n=6, throttled n=21) from workflow_dispatch ci-full at 2c52f65c: runs 37976720914/job 113976781168, 37977779990/job 113980309611, 37978934788/job 113984215185 (G11 PASS, EPYC 9V45/9V45/9V74); slow class for ratios only: runs 37972321719/job 113961809231, 37973730948/job 113966606217, 37974125393/job 113971494970 (G11 FAIL). FAST = unthrottled calibration median < 60 ms and G11 pass. Owner decision 2026-10-10: budgets refer to the FAST class. Calibration evidence, not gate evidence.",
});

/**
 * Per-metric sensitivity. A metric is normalised by F^k, where k = ln(r_metric) / ln(r_cal)
 * clamped to [0, 1]: r_metric is the metric's SLOW/FAST median ratio and r_cal the calibration's
 * SLOW/FAST median ratio in the same throttle state. k never exceeds 1, so no metric is ever
 * normalised more than the calibration itself. k values are floored to two decimals (lower k
 * means less normalisation, so rounding down is stricter).
 *
 * Evidence: the 43 non-p1/p2 hosted G11 jobs in the variance diagnosis (rows.json; class by
 * board render < 520 ms: 12 FAST, 31 SLOW) pooled with the six collection runs (3 FAST, 3 SLOW);
 * 15 FAST and 34 SLOW jobs; class medians of the judged metric medians. Calibration ratios from
 * the six runs: unthrottled 72.2 / 51.65 = 1.398 (n = 9 / 6 sets); throttled 324.1 / 230.7 =
 * 1.405 (n = 29 / 21 sets). Metrics judged raw (sign-in, comment, drag p95, CLS, G13) are not
 * listed.
 *
 *   id            state        fast    slow    r_metric  k raw   k pinned
 *   list          unthrottled  343.1   495.2   1.443     1.096   1.00 (clamped)
 *   board         unthrottled  455.4   649.8   1.427     1.061   1.00 (clamped)
 *   lcp           throttled    post-DCL 284.1 / 419.3 ms (12 fast, 30 slow samples: six runs'
 *                              LCP diagnostics plus the diagnosis' 15) r 1.476   1.145   1.00 (clamped)
 *   route         throttled    88.4    109.3   1.236     0.623   0.62
 *   create        throttled    124.8   160.6   1.287     0.741   0.74
 *   palette       throttled    161.7   195.8   1.211     0.563   0.56
 *   paletteNav    throttled    131.6   161.2   1.225     0.597   0.59
 *   taskState     throttled    149.1   202.7   1.360     0.903   0.90
 *   taskAssign    throttled    159.7   184.1   1.153     0.418   0.41
 *
 * The interaction metrics are frame-quantised and noisy; their k carries that noise, which is
 * why re-recording from more hosted runs is recommended before relying on a k below 1.
 */
export const CALIBRATED_METRICS = Object.freeze({
  list: Object.freeze({ state: "unthrottled", scale: "full", k: 1 }),
  board: Object.freeze({ state: "unthrottled", scale: "full", k: 1 }),
  lcp: Object.freeze({ state: "throttled", scale: "post-dcl", k: 1 }),
  route: Object.freeze({ state: "throttled", scale: "full", k: 0.62 }),
  create: Object.freeze({ state: "throttled", scale: "full", k: 0.74 }),
  palette: Object.freeze({ state: "throttled", scale: "full", k: 0.56 }),
  paletteNav: Object.freeze({ state: "throttled", scale: "full", k: 0.59 }),
  taskState: Object.freeze({ state: "throttled", scale: "full", k: 0.9 }),
  taskAssign: Object.freeze({ state: "throttled", scale: "full", k: 0.41 }),
});

export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function assertCalibrationSourcePinned(
  source = CALIBRATION_SOURCE,
  expected = PERFORMANCE_REFERENCE.sourceSha256 ?? CALIBRATION_SOURCE_SHA256,
) {
  const actual = sha256Hex(source);
  if (actual !== expected) {
    throw new Error(
      `The G11 calibration workload does not match its pinned SHA-256 (expected ${expected}, got ${actual}).`,
    );
  }
  return actual;
}

function medianOf(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function summariseCalibration(runs, expectedRuns = CALIBRATION_RUNS) {
  if (
    !Array.isArray(runs) ||
    runs.length !== expectedRuns ||
    runs.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error(
      `A G11 calibration must contain exactly ${expectedRuns} positive finite runs.`,
    );
  }
  const medianMs = medianOf(runs);
  const spread = (Math.max(...runs) - Math.min(...runs)) / medianMs;
  return { runs: [...runs], medianMs, spread };
}

function referenceFor(state, reference, sourceSha256, optionsSha256) {
  if (state !== "throttled" && state !== "unthrottled") {
    throw new Error(`Unknown G11 calibration state: ${String(state)}`);
  }
  const { unthrottledMs, throttledMs } = reference;
  const absent = (value) => value === null || value === undefined;
  if (absent(unthrottledMs) && absent(throttledMs)) return null;
  if (absent(unthrottledMs) || absent(throttledMs)) {
    throw new Error(
      "The pinned G11 reference must pin both throttle states together; a mixed pin fails closed.",
    );
  }
  for (const value of [unthrottledMs, throttledMs]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        "The pinned G11 reference values must be positive finite numbers.",
      );
    }
  }
  if (reference.sourceSha256 !== sourceSha256) {
    throw new Error(
      "The pinned G11 reference was recorded against a different calibration workload; re-record it.",
    );
  }
  if (reference.optionsSha256 !== optionsSha256) {
    throw new Error(
      "The pinned G11 reference was recorded with different calibration options; re-record it.",
    );
  }
  if (typeof reference.evidence !== "string" || reference.evidence === "") {
    throw new Error(
      "The pinned G11 reference must cite its recorded evidence.",
    );
  }
  return state === "throttled" ? throttledMs : unthrottledMs;
}

/**
 * Turns the calibration batches of one throttle state into the job's calibration verdict.
 * mode "calibration-only": R0 unpinned; measured and logged, never gated, factor is 1.
 * mode "calibrated": R0 pinned; every batch is stability-checked, the job median is the median
 *   of the batch medians, and factor = job median / R0, bounded, else throws.
 * The source and options hashes are computed live here and compared with the R0 record.
 */
export function resolveJobCalibration({
  batches,
  state,
  reference = PERFORMANCE_REFERENCE,
  sourceSha256 = sha256Hex(CALIBRATION_SOURCE),
  optionsSha256 = calibrationOptionsSha256(CALIBRATION_OPTIONS),
  maxSpread = CALIBRATION_MAX_SPREAD,
  factorMin = CALIBRATION_FACTOR_MIN,
  factorMax = CALIBRATION_FACTOR_MAX,
}) {
  const referenceMs = referenceFor(
    state,
    reference,
    sourceSha256,
    optionsSha256,
  );
  const summarise = () => {
    if (!Array.isArray(batches) || batches.length !== CALIBRATION_BATCHES) {
      throw new Error(
        `A G11 job calibration must contain exactly ${CALIBRATION_BATCHES} batches.`,
      );
    }
    const summaries = batches.map((runs) => summariseCalibration(runs));
    return {
      batches: summaries,
      medianMs: medianOf(summaries.map((summary) => summary.medianMs)),
      spread: Math.max(...summaries.map((summary) => summary.spread)),
    };
  };
  if (referenceMs === null) {
    try {
      const summary = summarise();
      return {
        mode: "calibration-only",
        state,
        factor: 1,
        referenceMs: null,
        ...summary,
        note: summary.spread > maxSpread ? "spread above bound" : undefined,
      };
    } catch (error) {
      return {
        mode: "calibration-only",
        state,
        factor: 1,
        referenceMs: null,
        batches: [],
        medianMs: Number.NaN,
        spread: Number.NaN,
        note: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const summary = summarise();
  if (summary.spread > maxSpread) {
    throw new Error(
      `The G11 calibration is unstable (${state} batch spread ${summary.spread.toFixed(3)} > ${maxSpread}); failing closed.`,
    );
  }
  const factor = summary.medianMs / referenceMs;
  if (!(factor >= factorMin && factor <= factorMax)) {
    throw new Error(
      `The G11 speed factor ${factor.toFixed(3)} (${state}) is outside [${factorMin}, ${factorMax}]; failing closed.`,
    );
  }
  return { mode: "calibrated", state, factor, referenceMs, ...summary };
}

/**
 * Normalises one raw sample to reference speed.
 * scale "none": not CPU-bound; never changed.
 * scale "full": value / F^k (unthrottled render times, click-to-paint, route transition),
 *   k the metric's sensitivity in [0, 1] (CALIBRATED_METRICS).
 * scale "post-dcl": only the CPU portion after DOMContentLoaded is scaled, the network floor is
 *   not: floor + (value - floor) / F^k. The DCL event end is the floor.
 * Not calibrated (calibration-only): the raw value, bit for bit.
 */
export function normaliseSample(sample, calibration, scale, sensitivity) {
  const { value, floorMs } =
    typeof sample === "number" ? { value: sample, floorMs: undefined } : sample;
  if (!Number.isFinite(value)) {
    throw new Error("A G11 sample must be a finite measurement.");
  }
  if (scale === "none") return value;
  if (!Number.isFinite(sensitivity) || sensitivity < 0 || sensitivity > 1) {
    throw new Error(
      "A G11 metric sensitivity k must lie in [0, 1]; a metric is never normalised more than the calibration.",
    );
  }
  if (calibration.mode !== "calibrated") return value;
  const factor = calibration.factor ** sensitivity;
  if (scale === "full") return value / factor;
  if (scale === "post-dcl") {
    if (!Number.isFinite(floorMs) || floorMs <= 0 || floorMs >= value) {
      throw new Error(
        "A post-DCL G11 sample needs a finite DOMContentLoaded floor with 0 < floor < LCP; failing closed.",
      );
    }
    return floorMs + (value - floorMs) / factor;
  }
  throw new Error(`Unknown G11 normalisation scale: ${String(scale)}`);
}

function medianOfThree(values) {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      "A G11 sample set must contain exactly three finite measurements.",
    );
  }
  return [...values].sort((left, right) => left - right)[1];
}

/**
 * The existing G11 rule, applied to normalised values: median of three; if that median is at or
 * over budget (`>=`), take one more set of three and the second set decides. The job's
 * calibration is resolved once per throttle state and reused by every set, retry included.
 * Returns every set, raw and normalised, so a retry never hides the first set.
 */
export async function calibratedMedianOfThreeWithRetry({
  sample,
  budget,
  metric,
  calibration,
  metrics = CALIBRATED_METRICS,
}) {
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("A G11 metric budget must be a positive finite number.");
  }
  const entry = Object.hasOwn(metrics, metric) ? metrics[metric] : undefined;
  if (!entry)
    throw new Error(`Unknown G11 calibrated metric: ${String(metric)}`);
  const { state, scale, k } = entry;
  if (!calibration || calibration.state !== state) {
    throw new Error(
      `The G11 job calibration for ${state} is missing or for another throttle state.`,
    );
  }
  const runSet = async () => {
    const raw = [];
    const normalised = [];
    for (let index = 0; index < 3; index += 1) {
      const measured = await sample();
      raw.push(typeof measured === "number" ? measured : measured.value);
      normalised.push(normaliseSample(measured, calibration, scale, k));
    }
    return {
      calibration,
      raw,
      normalised,
      rawMedian: medianOfThree(raw),
      result: medianOfThree(normalised),
    };
  };
  const sets = [await runSet()];
  let result = sets[0].result;
  let retried = false;
  if (result >= budget) {
    sets.push(await runSet());
    result = sets[1].result;
    retried = true;
  }
  return { result, retried, sets };
}

/** Parses the first x86 `model name` or ARM `Model`/`Hardware` line of /proc/cpuinfo. */
export function describeHost({ cpuinfoText, osCpuModel, parallelism }) {
  let model;
  if (typeof cpuinfoText === "string") {
    const match = /^(?:model name|Model|Hardware)\s*:\s*(.+)$/m.exec(
      cpuinfoText,
    );
    model = match?.[1].trim();
  }
  model ??= osCpuModel ? String(osCpuModel).trim() : "unavailable";
  return { cpuModel: model, nproc: parallelism ?? null };
}
