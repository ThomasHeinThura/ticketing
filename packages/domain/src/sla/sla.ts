/**
 * SLA computation — pure functions, no I/O, no ambient clock.
 *
 * The one implementation of `sla.md`'s computation rules, used by the API, the UI,
 * reports and `sla-scan` alike (`sla.md` § The central decision; ADR 0009). Every
 * function takes the policy, the work item's stored facts, and every instant it
 * needs as plain arguments. None of them read `Date.now()`, load a policy row, or
 * resolve which policy applies (`SLA-1`'s four-level resolution is the caller's —
 * it owns the type/request-type/project/workspace chain and the `SLA-3` version
 * pin; this module receives the already-resolved policy).
 *
 * Covered-time arithmetic is delegated to `../calendar` (`coveredMinutesBetween`,
 * `nextWindowOpening`), which owns DST correctness (`SLA-5`'s "evaluated in the
 * calendar's timezone" — the edge case that forbids adding 3600 seconds).
 */

import {
  coveredMinutesBetween,
  nextWindowOpening,
} from "../calendar/calendar.js";
import type {
  SlaGoal,
  SlaMetricState,
  SlaPause,
  SlaPolicy,
  SlaState,
  SlaWorkItemFacts,
} from "./types.js";
import { SLA_METRICS } from "./types.js";

/**
 * The most specific goal for a metric: an exact (type, priority) match beats a
 * wildcard on either dimension, which beats a wildcard on both. Ties (two goals
 * with the same specificity) resolve to the first — the caller's goal order is the
 * policy author's intent, and the editor presents the matrix in that order.
 */
export function matchGoal(
  policy: SlaPolicy,
  metric: (typeof SLA_METRICS)[number],
  workItemTypeId: string | null,
  priority: string | null,
): SlaGoal | null {
  let best: { goal: SlaGoal; score: number } | null = null;
  for (const goal of policy.goals) {
    if (goal.metric !== metric) continue;
    if (
      goal.workItemTypeId !== null &&
      goal.workItemTypeId !== workItemTypeId
    ) {
      continue;
    }
    if (goal.priority !== null && goal.priority !== priority) {
      continue;
    }
    // Specificity: exact type +2, exact priority +1 — higher wins.
    const score =
      (goal.workItemTypeId !== null ? 2 : 0) + (goal.priority !== null ? 1 : 0);
    if (best === null || score > best.score) {
      best = { goal, score };
    }
  }
  return best?.goal ?? null;
}

/**
 * The covered minutes between `from` and `to`, minus every pause interval that
 * overlaps the range (`SLA-12`). Pauses are subtracted as covered time, not
 * wall-clock: a pause spanning a weekend subtracts only the covered minutes inside
 * it. Overlapping pauses are rejected at write time (`SLA-11`'s unique open row and
 * the 409 on a manual pause over an automatic one); if malformed data ever arrives
 * here anyway, the union is taken by clamping each pause against the previous
 * pause's end, so time is never double-subtracted.
 */
export function coveredMinutesMinusPauses(
  policy: SlaPolicy,
  from: Date,
  to: Date,
  pauses: SlaPause[],
): number {
  if (to.getTime() <= from.getTime()) {
    return 0;
  }
  const relevant = pauses
    .map((p) => ({
      start: p.startedAt.getTime() < from.getTime() ? from : p.startedAt,
      end:
        p.endedAt === null || p.endedAt.getTime() > to.getTime()
          ? to
          : p.endedAt,
    }))
    .filter((p) => p.end.getTime() > p.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let covered = coveredMinutesBetween(policy.calendar, from, to);
  let lastEnd = from.getTime();
  for (const pause of relevant) {
    const start = Math.max(pause.start.getTime(), lastEnd);
    if (pause.end.getTime() > start) {
      covered -= coveredMinutesBetween(
        policy.calendar,
        new Date(start),
        pause.end,
      );
      lastEnd = Math.max(lastEnd, pause.end.getTime());
    }
  }
  return covered;
}

/**
 * The instant at which `targetMinutes` of covered time have elapsed since `from`,
 * skipping pauses (`SLA-4`). `null` when the calendar never opens, or when an open
 * pause means the target is unreachable until it closes.
 */
export function dueAtFor(
  policy: SlaPolicy,
  from: Date,
  targetMinutes: number,
  pauses: SlaPause[],
): Date | null {
  if (targetMinutes <= 0) {
    return from;
  }
  return instantAtCoveredOffset(policy, from, targetMinutes, pauses);
}

/**
 * The instant at which `offsetMinutes` of covered time have elapsed from `from`,
 * resuming after each pause's end. Millisecond precision: a binary search within
 * the final covered stretch finds the first instant at which consumed covered
 * time reaches the offset.
 */
function instantAtCoveredOffset(
  policy: SlaPolicy,
  from: Date,
  offsetMinutes: number,
  pauses: SlaPause[],
): Date | null {
  if (offsetMinutes <= 0) {
    return from;
  }

  // Guard: an open pause that began at or before `from` freezes the clock — the
  // target is unreachable until it closes, so there is no due instant yet.
  const openPauseOverFrom = pauses.some(
    (p) => p.endedAt === null && p.startedAt.getTime() <= from.getTime(),
  );
  if (openPauseOverFrom) {
    return null;
  }

  let cursor = from;
  let remaining = offsetMinutes;
  for (let guard = 0; guard < 100_000; guard++) {
    const opening = nextWindowOpening(policy.calendar, cursor);
    if (opening === null) {
      return null;
    }
    // The next pause that starts strictly after this opening.
    const nextPause = pauses
      .filter((p) => p.startedAt.getTime() > opening.getTime())
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0];

    // Probe far enough ahead to cover the remaining offset, doubling the horizon
    // until the stretch delivers the remaining covered minutes (a sparse calendar
    // — 1 covered minute a day — needs a far horizon, not a fixed multiplier),
    // stopping at the next pause if there is one. The 400-day ceiling matches
    // `nextWindowOpening`'s own guard: beyond that, treat the calendar as unable
    // to deliver the target.
    let horizonOffsetMin = (remaining + 1) * 8;
    const horizonCapMin = 400 * 1440;
    let probeHorizon = nextPause
      ? nextPause.startedAt
      : new Date(opening.getTime() + horizonOffsetMin * 60_000);
    let coveredInStretch = coveredMinutesBetween(
      policy.calendar,
      opening,
      probeHorizon,
    );
    while (
      !nextPause &&
      coveredInStretch < remaining &&
      horizonOffsetMin < horizonCapMin
    ) {
      horizonOffsetMin = Math.min(horizonOffsetMin * 2, horizonCapMin);
      probeHorizon = new Date(opening.getTime() + horizonOffsetMin * 60_000);
      coveredInStretch = coveredMinutesBetween(
        policy.calendar,
        opening,
        probeHorizon,
      );
    }

    if (coveredInStretch >= remaining) {
      // The target lands inside this stretch — binary-search the exact instant,
      // to millisecond precision (a coarse tolerance would report a due instant
      // seconds past the true boundary).
      let lo = opening.getTime();
      let hi = probeHorizon.getTime();
      while (hi - lo > 1) {
        const mid = new Date(Math.floor((lo + hi) / 2));
        if (coveredMinutesBetween(policy.calendar, opening, mid) >= remaining) {
          hi = mid.getTime();
        } else {
          lo = mid.getTime();
        }
      }
      return new Date(hi);
    }
    remaining -= coveredInStretch;
    if (!nextPause) {
      // The stretch was unbounded yet fell short within the 400-day horizon —
      // the calendar cannot deliver the target.
      return null;
    }
    if (nextPause.endedAt === null) {
      // An open pause freezes the clock: the due instant is deferred.
      return null;
    }
    cursor = nextPause.endedAt;
  }
  return null;
}

/**
 * Computes one metric's SLA state from stored facts (`SLA-4`–`SLA-9`, `SLA-12`).
 *
 * `now` is always passed in — this module never reads a clock. `workItemTypeId` and
 * `priority` select the goal; a policy with no matching goal yields `none` for that
 * metric (a first-class answer, not an error).
 */
export function computeMetricState(
  policy: SlaPolicy,
  facts: SlaWorkItemFacts,
  metric: (typeof SLA_METRICS)[number],
  now: Date,
  workItemTypeId: string | null = null,
  priority: string | null = null,
): SlaMetricState {
  const goal = matchGoal(policy, metric, workItemTypeId, priority);
  if (goal === null) {
    return {
      metric,
      state: "none",
      dueAt: null,
      targetMinutes: null,
      consumedMinutes: 0,
      consumedPct: 0,
      remainingMinutes: null,
    };
  }

  const metricPauses = facts.pauses.filter((p) => p.metric === metric);
  const hasOpenPause = metricPauses.some((p) => p.endedAt === null);

  // The stop fact: when did this metric's clock stop? (`SLA-7`/`SLA-8`)
  const stopAt =
    metric === "first_response" ? facts.firstResponseAt : facts.resolvedAt;

  if (stopAt !== null) {
    // Closed metric: met if the stop landed within target covered time.
    const consumedAtStop = coveredMinutesMinusPauses(
      policy,
      facts.startedAt,
      stopAt,
      metricPauses,
    );
    const met = consumedAtStop <= goal.targetMinutes;
    return {
      metric,
      state: met ? "met" : "missed",
      dueAt: dueAtFor(
        policy,
        facts.startedAt,
        goal.targetMinutes,
        metricPauses,
      ),
      targetMinutes: goal.targetMinutes,
      consumedMinutes: consumedAtStop,
      consumedPct: pct(consumedAtStop, goal.targetMinutes),
      remainingMinutes: Math.max(0, goal.targetMinutes - consumedAtStop),
    };
  }

  // Open metric: consume up to `now`. An open pause freezes the clock — the
  // consumed value stops advancing and the due instant is deferred (`SLA-13`'s
  // "Paused" display is the UI's job; here the state simply stops advancing).
  const consumed = coveredMinutesMinusPauses(
    policy,
    facts.startedAt,
    now,
    metricPauses,
  );
  return {
    metric,
    state: stateForConsumedPct(pct(consumed, goal.targetMinutes), policy),
    dueAt: hasOpenPause
      ? null
      : dueAtFor(policy, facts.startedAt, goal.targetMinutes, metricPauses),
    targetMinutes: goal.targetMinutes,
    consumedMinutes: consumed,
    consumedPct: pct(consumed, goal.targetMinutes),
    remainingMinutes: Math.max(0, goal.targetMinutes - consumed),
  };
}

/** Both metrics in one call — the shape `GET /api/work-items/{key}/sla` returns. */
export function computeSlaState(
  policy: SlaPolicy,
  facts: SlaWorkItemFacts,
  now: Date,
  workItemTypeId: string | null = null,
  priority: string | null = null,
): SlaMetricState[] {
  return SLA_METRICS.map((metric) =>
    computeMetricState(policy, facts, metric, now, workItemTypeId, priority),
  );
}

/** The state for an open item at a given consumed percentage (`sla.md` § States). */
function stateForConsumedPct(consumedPct: number, policy: SlaPolicy): SlaState {
  if (consumedPct >= 100) {
    return "breached";
  }
  if (consumedPct >= policy.atRiskThresholdPct) {
    return "at_risk";
  }
  return "ok";
}

function pct(consumed: number, target: number): number {
  if (target <= 0) {
    return 100;
  }
  return (consumed / target) * 100;
}
