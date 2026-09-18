/**
 * SLA policy resolution, version pinning, pause-open validation, and scan-event
 * edges — the pure decision layer between stored SLA configuration and the
 * computation in `./sla`. No I/O, no ambient clock, no database import: every
 * candidate, version, and pause row arrives as plain data; the caller owns
 * loading rows and mapping refusals onto status codes.
 *
 * Storage note: the shapes here mirror `data-model.md` §7 exactly —
 * `sla_policy` (`active_version_id`, `at_risk_threshold_pct`),
 * `sla_policy_version` (`policy_id`, `number`, `effective_from` — no
 * `effective_to`), `sla_pause` (`reason` carries the why, there is no `kind`
 * column), `work_item_sla_cache` (keyed by `(work_item_id, metric)`).
 */

import type {
  PauseConflict,
  SlaMetric,
  SlaPolicy,
  SlaPolicyCandidates,
  SlaPolicyVersion,
  SlaState,
} from "./types.js";

/**
 * `SLA-1`/`SLA-2`: resolve which policy governs a work item — work item type
 * override → request type → project → workspace default, **first match wins**;
 * `null` when no source has one (the caller then reports the `none` state).
 * Each candidate is the caller's already-loaded, already-pinned policy for that
 * source; this function never loads, never guesses, and never reorders the
 * spec's precedence.
 */
export function resolveSlaPolicy(
  candidates: SlaPolicyCandidates,
): SlaPolicy | null {
  return (
    candidates.workItemType ??
    candidates.requestType ??
    candidates.project ??
    candidates.workspaceDefault ??
    null
  );
}

/**
 * `SLA-3`: the version **effective at the work item's creation** is used, and
 * changing a policy never rewrites whether past work was met. With no
 * `effective_to` column, a version is effective from its `effective_from` until
 * the next-later version's — so the pinned version is the one with the GREATEST
 * `number` whose `effective_from` is at or before `createdAt` (versions of one
 * policy share a `number` uniqueness; ties cannot occur in stored data, and if
 * malformed data ever supplies them the highest `effectiveFrom` wins, then the
 * first encountered — deterministic, and the caller's data problem to fix).
 *
 * Returns `null` when no version was effective yet at `createdAt` — a policy
 * published entirely after the item's creation governs nothing about it.
 */
export function pinPolicyVersion(
  versions: SlaPolicyVersion[],
  createdAt: Date,
): SlaPolicyVersion | null {
  let pinned: SlaPolicyVersion | null = null;
  for (const version of versions) {
    if (version.effectiveFrom.getTime() > createdAt.getTime()) {
      continue;
    }
    if (
      pinned === null ||
      version.number > pinned.number ||
      (version.number === pinned.number &&
        version.effectiveFrom.getTime() > pinned.effectiveFrom.getTime())
    ) {
      pinned = version;
    }
  }
  return pinned;
}

/** `SLA-11`'s automatic reasons — opened and closed by transition effects (`WF-17`–`WF-19`). */
const AUTOMATIC_PAUSE_REASONS = new Set(["waiting_customer", "resolved"]);

/** Whether an `sla_pause` row was opened automatically (a transition effect) rather than manually. */
export function isAutomaticPause(reason: string): boolean {
  return AUTOMATIC_PAUSE_REASONS.has(reason);
}

/**
 * `SLA-11`: may a new `sla_pause` row open for this metric, given the open rows
 * that already exist for the work item? At most one open row may exist per
 * `(work_item, metric)` — the data model's partial unique index — so ANY open
 * row for the metric refuses. When the refusal is a *manual* open against an
 * *automatic* one, the conflict is the spec's named 409 case
 * (`manual_over_automatic`); every other refusal is the plain uniqueness
 * violation (`pause_already_open`). The caller maps both onto status codes.
 */
export function validateOpenPause(
  openPauses: Array<{ metric: SlaMetric; reason: string }>,
  metric: SlaMetric,
  nextReason: string,
): PauseConflict | null {
  const existing = openPauses.find((p) => p.metric === metric);
  if (!existing) {
    return null;
  }
  if (nextReason === "manual" && isAutomaticPause(existing.reason)) {
    return "manual_over_automatic";
  }
  return "pause_already_open";
}

/**
 * `SLA-11`: may the close this reason performs land on the given open row? An
 * **automatic** close (a transition effect) never closes a *manual* pause — a
 * manual pause outlives the transition that would have closed its automatic
 * sibling and must be closed explicitly. An automatic close closes its own
 * automatic row; a manual close (the resume route's own act) closes whatever
 * open row exists.
 */
export function canClosePause(
  openReason: string,
  closingReason: string,
): boolean {
  if (isAutomaticPause(openReason)) {
    return true;
  }
  // The open row is manual: only an explicit manual close may end it.
  return closingReason === "manual";
}

/**
 * `SLA-15`/`SLA-15a`: which event, if any, must fire when a metric's cached
 * state is seen to move from `previous` to `next`? `sla.at_risk` and
 * `sla.breached` fire **once each, per work item, per metric** — only on the
 * transition INTO the state from a different state; re-observing the same state
 * emits nothing, and at_risk → breached is a new edge (breached fires).
 * `met`/`missed` are never this function's answer: they are emitted by the
 * transition into a `completed`-group state, not by `sla-scan`, and a scan that
 * observes them is looking at a stale cache row.
 */
export function scanEventForTransition(
  previous: SlaState,
  next: SlaState,
): "sla.at_risk" | "sla.breached" | null {
  if (previous === next) {
    return null;
  }
  if (next === "at_risk") {
    return "sla.at_risk";
  }
  if (next === "breached") {
    return "sla.breached";
  }
  return null;
}

