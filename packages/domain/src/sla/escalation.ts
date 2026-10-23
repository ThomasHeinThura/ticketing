/**
 * SLA — the stakeholder escalation walk (SLA-17, NO-22).
 *
 * `sla.breached` notifies the assignee and project leads, "then the escalation path": the
 * project's stakeholders ordered by `escalation_order`. NO-22 states the timing: notify the
 * first immediately; notify each next stakeholder after the previous one's
 * `escalation_wait_minutes` elapses while the work item remains in the triggering condition;
 * a state change, assignment change or staff comment stops the walk. A project with no
 * (active) stakeholders escalates to no one — a no-op, never an error (SLA-17).
 *
 * Pure: no I/O, no clock. The `sla-escalation` job persists the walk (`sla_escalation`),
 * loads facts and calls these functions; this module only answers "who is next, when, and
 * must the walk stop".
 */

export interface EscalationStakeholder {
  readonly personId: string;
  readonly escalationOrder: number;
  /** Minutes to wait after notifying THIS stakeholder before notifying the next one. */
  readonly escalationWaitMinutes: number;
  /** A stood-down stakeholder (PR-12) is skipped, never deleted. */
  readonly active: boolean;
}

/** Active stakeholders, ascending by `escalationOrder` (ties broken by person id). */
export function escalationPath(
  stakeholders: readonly EscalationStakeholder[],
): EscalationStakeholder[] {
  return stakeholders
    .filter((stakeholder) => stakeholder.active)
    .slice()
    .sort(
      (a, b) =>
        a.escalationOrder - b.escalationOrder ||
        (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
    );
}

export interface EscalationStep {
  /** The `escalation_order` this step covers; the walk records it as `lastOrder`. */
  readonly order: number;
  /**
   * Every active stakeholder sharing `order`, to notify now. `escalation_order` is not
   * unique, so stakeholders tied on an order are one level and are notified together.
   */
  readonly notify: readonly EscalationStakeholder[];
  /**
   * When the following level becomes due (`now` + the longest `escalationWaitMinutes` among
   * `notify`), or `null` when this is the last level on the path — the walk is complete.
   */
  readonly nextDueAt: Date | null;
}

/** The level at the first path entry whose order is greater than `afterOrder`. */
function stepAfter(
  path: readonly EscalationStakeholder[],
  afterOrder: number,
  now: Date,
): EscalationStep | null {
  const first = path.find((s) => s.escalationOrder > afterOrder);
  if (!first) return null;
  const order = first.escalationOrder;
  const notify = path.filter((s) => s.escalationOrder === order);
  const hasNext = path.some((s) => s.escalationOrder > order);
  const wait = Math.max(0, ...notify.map((s) => s.escalationWaitMinutes));
  return {
    order,
    notify,
    nextDueAt: hasNext ? new Date(now.getTime() + wait * 60_000) : null,
  };
}

/**
 * NO-22 "notify the first immediately": every stakeholder at the lowest order, or `null`
 * when there is none (SLA-17: escalation is then a no-op).
 */
export function startEscalation(
  stakeholders: readonly EscalationStakeholder[],
  now: Date,
): EscalationStep | null {
  return stepAfter(escalationPath(stakeholders), Number.NEGATIVE_INFINITY, now);
}

/**
 * The next level after `lastOrder` (the `escalation_order` last notified), advancing by
 * DISTINCT order so tied stakeholders are never skipped. Using the order, not a list
 * position, keeps the walk correct when stakeholders are added, reordered or stood down
 * between steps. `null` means the path is exhausted.
 */
export function advanceEscalation(
  stakeholders: readonly EscalationStakeholder[],
  lastOrder: number,
  now: Date,
): EscalationStep | null {
  return stepAfter(escalationPath(stakeholders), lastOrder, now);
}

export type EscalationStopReason =
  | "no_longer_breached"
  | "resolved"
  | "state_changed"
  | "assignment_changed"
  | "staff_commented";

export interface EscalationFacts {
  /** The metric is still `breached` in `work_item_sla_cache` (the triggering condition). */
  readonly stillBreached: boolean;
  readonly resolved: boolean;
  readonly stateIdAtStart: string;
  readonly currentStateId: string;
  readonly assigneeIdAtStart: string | null;
  readonly currentAssigneeId: string | null;
  /** A public or internal comment by a staff member exists after the walk started. */
  readonly staffCommentedSinceStart: boolean;
}

/**
 * NO-22 stop conditions, evaluated in a fixed order so the recorded reason is stable:
 * the item leaving the triggering condition first, then the three named interventions.
 */
export function escalationStopReason(
  facts: EscalationFacts,
): EscalationStopReason | null {
  if (facts.resolved) return "resolved";
  if (!facts.stillBreached) return "no_longer_breached";
  if (facts.currentStateId !== facts.stateIdAtStart) return "state_changed";
  if (facts.currentAssigneeId !== facts.assigneeIdAtStart)
    return "assignment_changed";
  if (facts.staffCommentedSinceStart) return "staff_commented";
  return null;
}
