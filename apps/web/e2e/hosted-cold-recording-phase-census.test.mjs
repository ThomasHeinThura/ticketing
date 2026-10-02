import assert from "node:assert/strict";
import test from "node:test";
import { deriveColdFailurePhaseCensus } from "./hosted-cold-recording-phase-census.mjs";
import {
  COLD_MAX_PHASE_SEGMENTS,
  COLD_PHASE_CATEGORIES,
  deriveColdPhaseCensus,
} from "./hosted-cold-recording-validation.mjs";

const marks = { lcpMs: 100, routeStartMs: 200, routePaintMs: 30 };

function event(name, startMs, durationMs, extras = {}) {
  return {
    name,
    ph: "X",
    tid: 7,
    ts: startMs * 1000,
    dur: durationMs * 1000,
    ...extras,
  };
}

function trace(events = []) {
  return [
    {
      name: "thread_name",
      ph: "M",
      tid: 7,
      args: { name: "CrRendererMain" },
    },
    ...events,
  ];
}

test("P0 #558 v5: fixed observed windows clip exclusive categories with existing priority", () => {
  const result = deriveColdFailurePhaseCensus(
    trace([
      event("RunTask", 0, 230),
      event("FunctionCall", 0, 230),
      event("EvaluateScript", 10, 30),
      event("FunctionCall", 20, 30, {
        args: { data: { functionName: "commitRoot" } },
      }),
      event("RemoveChild", 30, 30),
      event("Paint", 40, 30),
    ]),
    0,
    marks,
  );

  assert.equal(result.state, "validated");
  assert.deepEqual(result.windows.lcp, {
    "main-thread-idle": 0,
    "main-thread-other": 400,
    "parse-evaluate": 100,
    "react-render-commit": 100,
    "dom-removal": 300,
    "paint-layout": 100,
  });
  assert.deepEqual(result.windows.clickToPaint, {
    "main-thread-idle": 0,
    "main-thread-other": 300,
    "parse-evaluate": 0,
    "react-render-commit": 0,
    "dom-removal": 0,
    "paint-layout": 0,
  });
});

test("P0 #558 v5: route paint is a duration added to route start", () => {
  const result = deriveColdPhaseCensus(
    [{ phase: "paint-layout", start: 229, end: 231 }],
    { lcpMs: 1, routeStartMs: 200, routePaintMs: 30 },
  );
  assert.equal(result.windows.clickToPaint["paint-layout"], 10);
});

test("P0 #558 v5: clips both ends and rounds each category to integer deci-ms", () => {
  const result = deriveColdPhaseCensus(
    [
      { phase: "parse-evaluate", start: 0, end: 10.06 },
      { phase: "paint-layout", start: 190, end: 210.06 },
    ],
    { lcpMs: 20, routeStartMs: 200, routePaintMs: 10 },
  );
  assert.equal(result.windows.lcp["parse-evaluate"], 101);
  assert.equal(result.windows.clickToPaint["paint-layout"], 100);
  assert.ok(
    Object.values(result.windows.lcp).every(Number.isInteger) &&
      Object.values(result.windows.clickToPaint).every(Number.isInteger),
  );
});

test("P0 #558 v5: derivation does not infer an idle tail after the final RunTask", () => {
  const result = deriveColdFailurePhaseCensus(
    trace([event("RunTask", 0, 40), event("EvaluateScript", 0, 20)]),
    0,
    { lcpMs: 100, routeStartMs: 200, routePaintMs: 30 },
  );
  assert.equal(result.windows.lcp["main-thread-idle"], 0);
  assert.equal(result.windows.clickToPaint["main-thread-idle"], 0);
});

test("P0 #558 v5: marker, trace clock, task overlap, and observed windows fail closed", () => {
  assert.throws(() => deriveColdFailurePhaseCensus([], 0, marks));
  assert.throws(() =>
    deriveColdFailurePhaseCensus(trace([event("RunTask", 300, 10)]), 0, marks),
  );
  assert.throws(() =>
    deriveColdFailurePhaseCensus(
      trace([{ ...event("RunTask", 0, 230), ts: Number.NaN }]),
      0,
      marks,
    ),
  );
  assert.throws(() =>
    deriveColdFailurePhaseCensus(trace([event("RunTask", 300, 20)]), 0, marks),
  );
  assert.throws(() =>
    deriveColdFailurePhaseCensus(trace([event("RunTask", 0, 230)]), 0, {
      ...marks,
      routePaintMs: 600_000,
    }),
  );
  assert.throws(() =>
    deriveColdFailurePhaseCensus(trace([event("RunTask", 0, 230)]), 0, {
      ...marks,
      extra: 1,
    }),
  );
});

test("P0 #558 v5: direct census rejects overlap, gaps are not filled, and segment cap is enforced", () => {
  assert.throws(() =>
    deriveColdPhaseCensus(
      [
        { phase: "parse-evaluate", start: 0, end: 20 },
        { phase: "paint-layout", start: 19, end: 30 },
      ],
      marks,
    ),
  );
  const gaps = deriveColdPhaseCensus(
    [{ phase: "parse-evaluate", start: 20, end: 30 }],
    marks,
  );
  assert.equal(gaps.windows.lcp["main-thread-idle"], 0);
  assert.equal(gaps.windows.clickToPaint["main-thread-idle"], 0);
  assert.throws(() =>
    deriveColdPhaseCensus(
      Array.from({ length: COLD_MAX_PHASE_SEGMENTS + 1 }, () => ({
        phase: "main-thread-idle",
        start: 0,
        end: 1,
      })),
      marks,
    ),
  );
  assert.deepEqual(COLD_PHASE_CATEGORIES, [
    "main-thread-idle",
    "main-thread-other",
    "parse-evaluate",
    "react-render-commit",
    "dom-removal",
    "paint-layout",
  ]);
});
