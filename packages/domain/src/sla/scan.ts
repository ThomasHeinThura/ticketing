/**
 * SLA — the `sla-scan` decision core (SLA-14, SLA-15, SLA-15a).
 *
 * The job reads `work_item_sla_cache`, recomputes with `computeMetricState`, and calls
 * this with the pair: "what should `sla-scan` emit, and what should the cache become?"
 * Pure — the job owns scheduling (every 5 minutes), the candidate query (open items
 * only; a row with `resolved_at` set is outside the candidate set per SLA-15a) and
 * persistence. Emission is *state-difference* against the cache, which is exactly what
 * "once each, per work item, per metric" means operationally: after an emit the job
 * writes `nextStoredState` back, so the same crossing is never observed again.
 *
 * Boundaries, made explicit (all flagged in the PR body):
 *
 * - `sla.at_risk` fires only when the computed state IS `at_risk` and the stored state
 *   was not; `sla.breached` fires only when computed IS `breached` and stored was not.
 * - An `ok` → `breached` jump inside one 5-minute interval emits **`sla.breached` only**
 *   — the scan never observed `at_risk`, and SLA-15 words the rule as "on a transition
 *   INTO" the state. The literal reading is implemented; the alternative (emitting both)
 *   would fabricate an observation the scan did not make.
 * - `sla.met`/`sla.missed` are **never** scan emissions (SLA-15a: they belong to the
 *   transition into a completed-group state). If a computed `met`/`missed` reaches here
 *   anyway (a candidate-set bug upstream), no event fires; the cache still syncs.
 * - A downward correction (`at_risk` → `ok`, only possible via manual data change —
 *   consumed time is monotonic for open items) emits nothing but re-arms the crossing:
 *   a later `ok` → `at_risk` would fire again. Acceptable residual: the correction that
 *   caused it is itself audit-logged.
 *
 * Event keys are the ones registered in `docs/01-architecture/events.md`.
 */

import type { SlaState } from "./types.js";

/** The only two events `sla-scan` may emit (SLA-15a). */
export type ScanEvent = "sla.at_risk" | "sla.breached";

export interface ScanDecision {
  /** Events to emit for this (metric, work item) — 0, 1, or 2 items, in order. */
  readonly emit: readonly ScanEvent[];
  /** What `work_item_sla_cache.state` must become after this scan. */
  readonly nextStoredState: SlaState;
  /** True when the cache row must be written (state differs from stored). */
  readonly cacheChanged: boolean;
}

/** Alerting rank; `none` and the terminal states never emit and never rank below. */
function alertRank(state: SlaState): number | null {
  switch (state) {
    case "ok":
      return 0;
    case "at_risk":
      return 1;
    case "breached":
      return 2;
    default:
      // `none` (no goal), `met`, `missed` (terminal — outside the candidate set per
      // SLA-15a) are cache-sync values, not alert states.
      return null;
  }
}

/**
 * The decision for one (work item, metric) pair at one scan tick (SLA-14).
 *
 * @param stored - the cached state (`work_item_sla_cache.state`).
 * @param computed - `computeMetricState(...).state` recomputed now.
 */
export function scanDecision(
  stored: SlaState,
  computed: SlaState,
): ScanDecision {
  const emit: ScanEvent[] = [];
  const storedRank = alertRank(stored);
  const computedRank = alertRank(computed);

  // Rising into an alerting state emits that state's event only — never a state the
  // scan did not observe (the ok→breached note in this file's header).
  if (
    computedRank !== null &&
    storedRank !== null &&
    computedRank > storedRank
  ) {
    emit.push(computed === "at_risk" ? "sla.at_risk" : "sla.breached");
  } else if (
    computedRank !== null &&
    storedRank === null &&
    computedRank >= 1
  ) {
    // `none` → alerting: a goal appeared (or appeared late) with the clock already at
    // or past its threshold. The cache has never recorded this state, so the crossing
    // is real from the cache's perspective — emit.
    emit.push(computed === "at_risk" ? "sla.at_risk" : "sla.breached");
  }
  // computed `met`/`missed` with an alerting stored state: SLA-15a — not ours; no emit.

  return {
    emit,
    nextStoredState: computed,
    cacheChanged: computed !== stored,
  };
}
