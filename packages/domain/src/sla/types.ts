/**
 * SLA — pure data types.
 *
 * Mirrors `sla_policy`/`sla_goal`/`sla_pause`/`work_item_sla_cache` as plain data
 * (`docs/01-architecture/data-model.md`; `docs/03-features/sla.md`). Database ids,
 * workspace scoping and row loading never appear here — a policy is passed into this
 * module as plain data, never fetched by it, exactly like `../calendar`. The one
 * deliberate flattening: a policy arrives carrying its resolved `service_calendar`
 * and the goals of its effective version (`SLA-3`'s version pinning is the caller's
 * concern — it owns which version row was effective at the work item's creation).
 */

import type { ServiceCalendar } from "../calendar/types.js";

/** The two metrics an SLA goal can target (`sla.md` § Concepts). */
export const SLA_METRICS = ["first_response", "resolution"] as const;

export type SlaMetric = (typeof SLA_METRICS)[number];

/**
 * The six SLA states (`sla.md` § States) — the same vocabulary, and only these six
 * values, as `work_item_sla_cache.state` (snake_case there, as everywhere).
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
 * One `sla_goal` row: (metric × optional work item type × optional priority) →
 * target minutes of covered time. `null` on a dimension means "every".
 */
export interface SlaGoal {
  metric: SlaMetric;
  /** `sla_goal.work_item_type_id`; null = applies to every type. */
  workItemTypeId: string | null;
  /** `sla_goal.priority`; null = applies to every priority. */
  priority: string | null;
  /** `sla_goal.target_minutes` — covered minutes, never wall-clock (`SLA-4`). */
  targetMinutes: number;
}

/**
 * The policy as plain data — exactly what a computation needs and nothing else:
 * the calendar its `calendar_id` resolves to, its at-risk threshold, and the goals
 * of the version effective at the work item's creation (`SLA-3`).
 */
export interface SlaPolicy {
  calendar: ServiceCalendar;
  /** `sla_policy.at_risk_threshold_pct` (default 75). */
  atRiskThresholdPct: number;
  goals: SlaGoal[];
}

/**
 * An `sla_pause` row as plain data. An open pause has `endedAt: null` — its interval
 * runs until the caller's `now`, so the computation itself never reads a clock.
 */
export interface SlaPause {
  metric: SlaMetric;
  startedAt: Date;
  endedAt: Date | null;
  /** `waiting_customer` | `resolved` | `manual` | … — never a `kind` column (`SLA-11`). */
  reason: string;
}

/** The stored work-item facts an SLA computation reads — never a database row. */
export interface SlaWorkItemFacts {
  /**
   * `work_item.sla_started_at` — the clock's zero. Copied from the accepted
   * submission's `created_at`, otherwise the work item's `created_at`
   * (data-model.md; the intake-queue review's resolution).
   */
  startedAt: Date;
  /**
   * `work_item.first_response_at` — set once by the first public comment by a
   * staff-side person (`SLA-7`). The stored fact `first_response` is computed from.
   */
  firstResponseAt: Date | null;
  /**
   * `work_item.resolved_at` — set on entering a `completed`-group state (`SLA-8`);
   * cleared on reopen, which resumes the clock from where it stopped (`SLA-9`).
   */
  resolvedAt: Date | null;
  /** The item's pauses for the metric being computed, oldest first. */
  pauses: SlaPause[];
}

/** The per-metric answer — what `GET /api/work-items/{key}/sla` reports per metric. */
export interface SlaMetricState {
  metric: SlaMetric;
  state: SlaState;
  /**
   * The instant at which `target_minutes` of covered time elapse (`SLA-4`) —
   * `null` while an open pause freezes the clock, or when no goal applies.
   */
  dueAt: Date | null;
  /** The matched goal's target; null when no goal applies. */
  targetMinutes: number | null;
  /** Covered minutes consumed so far (up to the stop fact for a closed metric). */
  consumedMinutes: number;
  /** Consumed as a percentage of target; 0 when no goal applies. */
  consumedPct: number;
  /** Target minus consumed, floored at 0; null when no goal applies. */
  remainingMinutes: number | null;
}
