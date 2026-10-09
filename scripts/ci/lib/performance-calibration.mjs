/**
 * G11 speed-calibrated measurement (owner decision 2026-10-10).
 *
 * Hosted runners come in at least two speed classes, so an absolute millisecond budget measures
 * the runner as much as the product. Each metric's sample set is therefore preceded by a fixed,
 * pinned, CPU-bound reference workload run in the same browser and in the same CPU-throttle state
 * as the metric. The ratio of that run's median to a recorded reference value R0 is the runner's
 * speed factor F (F > 1: slower than the reference). The metric is judged against the UNCHANGED
 * budget after normalisation to reference speed.
 *
 * Nothing here changes a budget, a workload size, throttling, network emulation, the sample count
 * or the retry rule. The statistic is the median of three; best-of-N is never used.
 *
 * Fail-closed rules:
 * - R0 is a required recorded constant. While it is null the gate is in calibration-only mode:
 *   the calibration is measured and logged, never gated, and every metric is judged raw, exactly
 *   as before this module existed.
 * - A present but malformed or stale R0 (wrong source hash, no evidence, non-positive value)
 *   throws. It never degrades to a silent pass.
 * - When calibrated, a factor outside [FACTOR_MIN, FACTOR_MAX] or an unstable calibration
 *   (spread above MAX_SPREAD) throws. The job fails; it never passes.
 */
import { createHash } from "node:crypto";

export const CALIBRATION_FACTOR_MIN = 0.5;
export const CALIBRATION_FACTOR_MAX = 2.5;
/**
 * (max - min) / median across the measured calibration runs. No recorded data exists yet for a
 * stable runner, so this is a provisional bound; it can only make the job fail closed.
 */
export const CALIBRATION_MAX_SPREAD = 0.35;
export const CALIBRATION_WARMUP_RUNS = 2;
export const CALIBRATION_RUNS = 5;
export const CALIBRATION_ROWS = 400;
export const CALIBRATION_COLUMNS = 6;

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

/**
 * R0: the recorded reference medians of CALIBRATION_SOURCE, one per CPU-throttle state, with the
 * source hash they were measured against and the evidence (hosted run ids) they came from.
 * UNPINNED: no real hosted measurement of this workload exists yet, so none may be invented.
 * While null, the gate runs calibration-only and judges raw values.
 */
export const PERFORMANCE_REFERENCE = Object.freeze({
  sourceSha256: null,
  unthrottledMs: null,
  throttledMs: null,
  evidence: null,
});

export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function assertCalibrationSourcePinned(
  source = CALIBRATION_SOURCE,
  expected = CALIBRATION_SOURCE_SHA256,
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

function referenceFor(state, reference, sourceSha256) {
  if (state !== "throttled" && state !== "unthrottled") {
    throw new Error(`Unknown G11 calibration state: ${String(state)}`);
  }
  const value =
    state === "throttled" ? reference.throttledMs : reference.unthrottledMs;
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `The pinned G11 reference (${state}) must be a positive finite number.`,
    );
  }
  if (reference.sourceSha256 !== sourceSha256) {
    throw new Error(
      "The pinned G11 reference was recorded against a different calibration workload; re-record it.",
    );
  }
  if (typeof reference.evidence !== "string" || reference.evidence === "") {
    throw new Error(
      "The pinned G11 reference must cite its recorded evidence.",
    );
  }
  return value;
}

/**
 * Turns raw calibration runs into a calibration verdict for one CPU-throttle state.
 * mode "calibration-only": R0 unpinned; measured and logged, never gated, factor is 1.
 * mode "calibrated": R0 pinned; factor = median / R0, bounded and stability-checked, else throws.
 */
export function resolveCalibration({
  runs,
  state,
  reference = PERFORMANCE_REFERENCE,
  sourceSha256 = CALIBRATION_SOURCE_SHA256,
  maxSpread = CALIBRATION_MAX_SPREAD,
  factorMin = CALIBRATION_FACTOR_MIN,
  factorMax = CALIBRATION_FACTOR_MAX,
}) {
  const referenceMs = referenceFor(state, reference, sourceSha256);
  if (referenceMs === null) {
    try {
      const summary = summariseCalibration(runs);
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
        runs: Array.isArray(runs) ? [...runs] : [],
        medianMs: Number.NaN,
        spread: Number.NaN,
        note: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const summary = summariseCalibration(runs);
  if (summary.spread > maxSpread) {
    throw new Error(
      `The G11 calibration is unstable (${state} spread ${summary.spread.toFixed(3)} > ${maxSpread}); failing closed.`,
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
 * scale "full": value / F (unthrottled render times, click-to-paint, route transition).
 * scale "post-dcl": only the CPU portion after DOMContentLoaded is scaled, the network floor is
 *   not: floor + (value - floor) / F. The DCL event end is the floor.
 * Not calibrated (calibration-only): the raw value, bit for bit.
 */
export function normaliseSample(sample, calibration, scale) {
  const { value, floorMs } =
    typeof sample === "number" ? { value: sample, floorMs: undefined } : sample;
  if (!Number.isFinite(value)) {
    throw new Error("A G11 sample must be a finite measurement.");
  }
  if (scale === "none" || calibration.mode !== "calibrated") return value;
  const { factor } = calibration;
  if (scale === "full") return value / factor;
  if (scale === "post-dcl") {
    if (!Number.isFinite(floorMs) || floorMs < 0) {
      throw new Error(
        "A post-DCL G11 sample needs a finite DOMContentLoaded floor; failing closed.",
      );
    }
    const floor = Math.min(floorMs, value);
    return floor + (value - floor) / factor;
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
 * over budget, take one more set of three (recalibrating first) and the second set decides.
 * Returns every set, raw and normalised, so a retry never hides the first set.
 */
export async function calibratedMedianOfThreeWithRetry({
  sample,
  budget,
  scale,
  state,
  calibrate,
  reference = PERFORMANCE_REFERENCE,
  sourceSha256 = CALIBRATION_SOURCE_SHA256,
}) {
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("A G11 metric budget must be a positive finite number.");
  }
  const runSet = async () => {
    const calibration = resolveCalibration({
      runs: await calibrate(),
      state,
      reference,
      sourceSha256,
    });
    const raw = [];
    const normalised = [];
    for (let index = 0; index < 3; index += 1) {
      const measured = await sample();
      raw.push(typeof measured === "number" ? measured : measured.value);
      normalised.push(normaliseSample(measured, calibration, scale));
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
