/**
 * Automation vocabulary (`feature-contracts-p4.md` "Automations"). One trigger, a flat AND-list
 * of conditions, a flat list of actions: no branching, loops or variables.
 */

/** Event triggers a rule may use. The A column of events.md narrowed to the contract's table. */
export const AUTOMATION_EVENT_TRIGGERS = [
  "work_item.created",
  "work_item.transitioned",
  "work_item.updated",
  "work_item.assigned",
  "work_item.commented",
  "work_item.escalated",
  "sla.at_risk",
  "sla.breached",
  "approval.decided",
  "submission.received",
] as const;

export type AutomationEventTrigger = (typeof AUTOMATION_EVENT_TRIGGERS)[number];

/** The scheduler entry; evaluated by the `automation-schedule` job, never a domain event. */
export const AUTOMATION_SCHEDULE_TRIGGER = "schedule" as const;

export const AUTOMATION_TRIGGERS = [
  ...AUTOMATION_EVENT_TRIGGERS,
  AUTOMATION_SCHEDULE_TRIGGER,
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

const EVENT_TRIGGER_SET: ReadonlySet<string> = new Set(
  AUTOMATION_EVENT_TRIGGERS,
);

export function isAutomationEventTrigger(
  value: string,
): value is AutomationEventTrigger {
  return EVENT_TRIGGER_SET.has(value);
}

/**
 * Triggers whose events carry a work item (`payload.key`). A rule on any other trigger can only
 * run actions that need no work item.
 */
export function triggerCarriesWorkItem(trigger: string): boolean {
  return trigger.startsWith("work_item.") || trigger.startsWith("sla.");
}

/** `AM-9`: dry-run window, in days. */
export const DRY_RUN_DEFAULT_WINDOW_DAYS = 7;
export const DRY_RUN_MAX_WINDOW_DAYS = 30;
/** `AM-9`: candidate cap per dry-run. */
export const DRY_RUN_CANDIDATE_CAP = 1_000;
/** How many sample matches a dry-run lists. */
export const DRY_RUN_SAMPLE_SIZE = 50;

/** `AM-8` / `data-model.md`: `automation_run` rows are retained 30 days. */
export const AUTOMATION_RUN_RETENTION_DAYS = 30;

/** A claimed run holds its lease this long; a run that outlives it is abandoned, never re-run. */
export const AUTOMATION_RUN_LEASE_MS = 120_000;

/** Bounds on a stored rule, so one rule cannot become a large unbounded document. */
export const AUTOMATION_MAX_CONDITIONS = 20;
export const AUTOMATION_MAX_ACTIONS = 10;
export const AUTOMATION_MAX_PROJECT_FILTER = 200;

/** The priority order condition comparisons use (never text collation). */
export const PRIORITY_ORDER = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITY_ORDER)[number];

export const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;
