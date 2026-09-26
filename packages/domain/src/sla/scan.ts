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
 *   This includes a retreat: a paused, breached item can drop to `at_risk` (pauses lower
 *   the consumed proportion) and that is a genuine transition into `at_risk`, so it fires
 *   `sla.at_risk` — consumed time is NOT monotonic once pauses are involved (SLA-15,
 *   clarified 2026-09-18).
 * - An `ok` → `breached` jump inside one 5-minute interval emits **`sla.breached` only**
 *   — the scan never observed `at_risk`, and SLA-15 words the rule as "on a transition
 *   INTO" the state. The literal reading is implemented; the alternative (emitting both)
 *   would fabricate an observation the scan did not make.
 * - `sla.met`/`sla.missed` are **never** scan emissions (SLA-15a: they belong to the
 *   transition into a completed-group state). If a computed `met`/`missed` reaches here
 *   anyway (a candidate-set bug upstream), no event fires; the cache still syncs.
 * - A transition to `ok` (from `at_risk` or `breached`, only possible via manual data
 *   change or a pause — `ok` is not an alert state) emits nothing but re-arms the
 *   crossing: a later `ok` → `at_risk` would fire again.
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

  // Any genuine transition INTO an alerting state emits that state's event — rising
  // from `ok`/`none`, or retreating from `breached` down to `at_risk` (SLA-15,
  // clarified 2026-09-18: "a genuine state change re-fires the edge"). A state that
  // merely persists, or moves to a non-alerting state (`ok`, `none`, `met`, `missed`),
  // emits nothing.
  if (
    (computed === "at_risk" || computed === "breached") &&
    computed !== stored
  ) {
    emit.push(computed === "at_risk" ? "sla.at_risk" : "sla.breached");
  }

  return {
    emit,
    nextStoredState: computed,
    cacheChanged: computed !== stored,
  };
}
