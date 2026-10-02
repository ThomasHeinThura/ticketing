import {
  assertColdMainThreadJourneyOverlap,
  deriveColdPhaseCensus,
  translateColdTraceInterval,
} from "./hosted-cold-recording-validation.mjs";

function tracePhase(event) {
  const name = event.name;
  const functionName = event.args?.data?.functionName ?? "";
  if (
    [
      "EvaluateScript",
      "CompileScript",
      "ParseHTML",
      "V8.CompileCode",
      "V8.ParseOnBackground",
    ].includes(name)
  )
    return "parse-evaluate";
  if (["RemoveChild", "Remove", "DOM.removeChild"].includes(name))
    return "dom-removal";
  if (
    [
      "UpdateLayoutTree",
      "RecalculateStyles",
      "Layout",
      "PrePaint",
      "Paint",
      "CompositeLayers",
    ].includes(name)
  )
    return "paint-layout";
  if (
    /^(performUnitOfWork|completeUnitOfWork|renderWithHooks|commitRoot|commitMutationEffects|flushPassiveEffects|beginWork|completeWork)$/.test(
      functionName,
    )
  )
    return "react-render-commit";
  if (["FunctionCall", "RunMicrotasks", "EventDispatch"].includes(name))
    return "main-thread-other";
  return null;
}

export function deriveExclusiveMainThreadPhases(
  events,
  mainTid,
  offsetMs,
  journeyEndMs,
  { includeInferredIdleTail = true, roundSegments = true } = {},
) {
  if (
    !Number.isFinite(journeyEndMs) ||
    journeyEndMs <= 0 ||
    journeyEndMs > 600_000
  )
    throw new Error("invalid-observed-journey-window");
  const intervals = events.flatMap((event) => {
    if (event.tid !== mainTid || event.ph !== "X") return [];
    if (
      !Number.isFinite(event.ts) ||
      !Number.isFinite(event.dur) ||
      event.dur < 0
    )
      throw new Error("invalid-main-thread-trace-clock");
    if (event.dur === 0) return [];
    const translated = translateColdTraceInterval(
      event.ts,
      event.dur,
      offsetMs,
    );
    return [
      {
        start: translated.startMs,
        end: translated.endMs,
        name: event.name,
        phase: tracePhase(event),
      },
    ];
  });
  const tasks = intervals
    .filter((event) => event.name === "RunTask")
    .sort((a, b) => a.start - b.start);
  assertColdMainThreadJourneyOverlap(tasks, journeyEndMs);
  const classifiedIntervals = intervals
    .filter((event) => event.phase && event.name !== "RunTask")
    .sort((a, b) => a.start - b.start);
  const candidatesByTask = tasks.map(() => []);
  let candidateAssignments = 0;
  for (const candidate of classifiedIntervals) {
    let low = 0;
    let high = tasks.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (tasks[middle].end <= candidate.start) low = middle + 1;
      else high = middle;
    }
    for (
      let taskIndex = low;
      taskIndex < tasks.length && tasks[taskIndex].start < candidate.end;
      taskIndex += 1
    ) {
      if (tasks[taskIndex].end > candidate.start) {
        candidatesByTask[taskIndex].push(candidate);
        candidateAssignments += 1;
        if (candidateAssignments > 500_000) throw new Error("phase-overflow");
      }
    }
  }
  const segments = [];
  let cursor = 0;
  for (const [taskIndex, task] of tasks.entries()) {
    const taskStart = Math.max(0, task.start);
    const taskEnd = Math.min(600_000, task.end);
    if (taskEnd <= taskStart || taskStart < cursor) continue;
    if (taskStart > cursor)
      segments.push({
        phase: "main-thread-idle",
        start: cursor,
        end: taskStart,
      });
    const candidates = candidatesByTask[taskIndex].filter(
      (candidate) => candidate.start < taskEnd && candidate.end > taskStart,
    );
    const boundaries = new Set([taskStart, taskEnd]);
    for (const candidate of candidates) {
      boundaries.add(Math.max(taskStart, candidate.start));
      boundaries.add(Math.min(taskEnd, candidate.end));
    }
    const points = [...boundaries].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (end <= start) continue;
      const midpoint = (start + end) / 2;
      const active = candidates.filter(
        (candidate) => candidate.start <= midpoint && candidate.end >= midpoint,
      );
      const phase =
        [
          "dom-removal",
          "paint-layout",
          "react-render-commit",
          "parse-evaluate",
          "main-thread-other",
        ].find((item) =>
          active.some((candidate) => candidate.phase === item),
        ) ?? "main-thread-other";
      segments.push({ phase, start, end });
      if (segments.length > 100_000) throw new Error("phase-overflow");
    }
    cursor = taskEnd;
  }
  const end = tasks.length
    ? Math.min(600_000, Math.max(0, ...tasks.map((task) => task.end)))
    : 0;
  if (includeInferredIdleTail && end > cursor)
    segments.push({ phase: "main-thread-idle", start: cursor, end });
  return segments.map((segment) => ({
    phase: segment.phase,
    start: roundSegments ? Math.round(segment.start * 10) / 10 : segment.start,
    end: roundSegments ? Math.round(segment.end * 10) / 10 : segment.end,
  }));
}

export function deriveColdFailurePhaseCensus(events, offsetMs, marks) {
  if (!marks || typeof marks !== "object")
    throw new Error("missing-phase-census-marks");
  if (Object.keys(marks).sort().join(",") !== "lcpMs,routePaintMs,routeStartMs")
    throw new Error("invalid-phase-census-marks");
  const mainTid = events.find(
    (event) =>
      event.name === "thread_name" &&
      event.ph === "M" &&
      event.args?.name === "CrRendererMain",
  )?.tid;
  if (!Number.isInteger(mainTid)) throw new Error("missing-main-thread-marker");
  const endMs = Math.max(marks.lcpMs, marks.routeStartMs + marks.routePaintMs);
  // The failure census clips precise positive intervals before rounding totals;
  // successful report-v1 derivation keeps the helper's default endpoint rounding.
  const segments = deriveExclusiveMainThreadPhases(
    events,
    mainTid,
    offsetMs,
    endMs,
    { includeInferredIdleTail: false, roundSegments: false },
  );
  return deriveColdPhaseCensus(segments, marks);
}
