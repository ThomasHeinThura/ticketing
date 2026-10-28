/**
 * `CP-7` (pure, no I/O): a customer may only raise a request's priority. A null priority is
 * below `low`, so the first assignment of any priority is an escalation.
 */
export const PORTAL_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type PortalPriority = (typeof PORTAL_PRIORITIES)[number];

export function priorityRank(priority: string | null): number {
  if (priority === null) return -1;
  return (PORTAL_PRIORITIES as readonly string[]).indexOf(priority);
}

export type EscalationVerdict = "raise" | "same" | "lower";

export function judgeEscalation(
  current: string | null,
  requested: PortalPriority,
): EscalationVerdict {
  const from = priorityRank(current);
  const to = priorityRank(requested);
  if (to > from) return "raise";
  return to === from ? "same" : "lower";
}

/** The priorities a customer could still raise to (empty at `urgent`). */
export function raisablePriorities(current: string | null): PortalPriority[] {
  return PORTAL_PRIORITIES.filter(
    (candidate) => judgeEscalation(current, candidate) === "raise",
  );
}
