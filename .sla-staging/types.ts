/**
 * SLA — pure data types.
 *
 * Mirrors the SLA vocabulary of `docs/03-features/sla.md` and the `sla_policy` /
 * `sla_goal` / `sla_pause` / `work_item_sla_cache` columns of
 * `docs/01-architecture/data-model.md`. As with the calendar module, database
 * identity (`workspace_id`, `id`) never appears here — a policy is passed in as
 * plain data, never loaded by this module.
 *
 * The six states are exactly the six values of `sla.md` § States and
 * `work_item_sla_cache.state` — nowhere else (do-not 11: the vocabulary's
 * authority is the spec; this file is its code shape, not a second registration).
 */

/** The two metrics an SLA goal can be about (`sla_goal.metric`). */
export const SLA_METRICS = ["first_response", "resolution"] as const;

export type SlaMetric = (typeof SLA_METRICS)[number];

/**
 * The six SLA states (`sla.md` § States; `work_item_sla_cache.state`).
 * `none` is a first-class answer, not an error.
 */
export const SLA_STATES = [
  "none",
  "ok",
  "at_risk",
  "breached",
  "met",
  "missed",
] as const;

export type SlaState = (typeof SLA_STATES)[number];

/**
 * One goal row: for this work item type at this priority, this many covered
 * minutes. `workItemTypeKey` and `priority` are `null` for the wildcard rows a
 * policy falls back to — a goal with both null is the policy's unconditional
 * default. Matching is most-specific-first (see `resolveGoal`).
 */
export interface SlaGoal {
  /** `null` = applies to every work item type. */
  workItemTypeKey: string | null;
  /** `null` = applies to every priority. */
  priority: string | null;
  /** Covered minutes allowed for this goal to be met. */
  targetMinutes: number;
}

/**
 * A policy version as plain data — the goals effective at some point in time
 * (`SLA-3`: the version effective at the work item's creation is used).
 */
export interface SlaPolicyVersion {
  goals: SlaGoal[];
  /**
   * The percentage of the target at which an open item becomes `at_risk`
   * (`sla_policy.at_risk_threshold_pct`, default 75).
   */
  atRiskThresholdPct: number;
}

/**
 * A pause interval that does not consume the clock (`SLA-12`). Mirrors an
 * `sla_pause` row: at most one open row per `(work_item_id, metric)` — the
 * open row is identified by the metric alone, `reason` says why.
 */
export interface SlaPause {
  metric: SlaMetric;
  /**
   * Why the clock stopped — `waiting_customer` (`pause_sla` effect), `resolved`
   * (entered a `completed`-group state), `manual`, or another reason the data
   * model's open set allows. A `manual` pause is closed only by a manual
   * resume; an automatic close never closes it (`SLA-11`).
   */
  reason: string;
  startedAt: Date;
  /** `null` = still open (never closed). */
  endedAt: Date | null;
}

/**
 * The stored facts about a work item that SLA state is computed from — never
 * stored SLA state itself (ADR 0009). `slaStartedAt` is `sla_started_at`
 * (copied from the accepted submission's `created_at`, otherwise the work
 * item's `created_at`); `firstResponseAt` is `first_response_at` (set once by
 * the first public staff comment, `SLA-7`); `resolvedAt` is `resolved_at`
 * (set when the item enters a `completed`-group state, `SLA-8`).
 */
export interface SlaWorkItemFacts {
  slaStartedAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
}

/** The computed answer for one metric — the thing every surface reports. */
export interface SlaComputation {
  state: SlaState;
  /** The instant the target's covered time runs out. `null` when `state === "none"`. */
  dueAt: Date | null;
  /** Covered minutes consumed so far (pauses subtracted). */
  consumedMinutes: number;
  /** The goal's target, for rendering the consumed proportion (`SLA-19`). */
  targetMinutes: number | null;
  /** Consumed / target, 0..∞ — the bar's proportion. `null` when `state === "none"`. */
  consumedRatio: number | null;
  /**
   * The still-open pause at the evaluation instant, if any — what `SLA-13`'s
   * "Paused — waiting on customer since Tuesday" renders from. `null` when the
   * clock is running.
   */
  openPause: SlaPause | null;
}

/** The result of validating a policy version's goals before it is saved. */
export interface SlaPolicyValidationResult {
  valid: boolean;
  errors: string[];
}
