const RESOURCE_EVENT_KINDS = {
  work_item: [
    "work_item.assigned",
    "work_item.unassigned",
    "work_item.mentioned",
    "work_item.transitioned",
    "work_item.escalated",
    "work_item.due_soon",
    "work_item.overdue",
    "work_item.unblocked",
    "sla.at_risk",
    "sla.breached",
    "automation.notification_sent",
  ],
  comment: ["work_item.commented", "work_item.mentioned"],
  approval: [
    "approval.requested",
    "approval.decided",
    "approval.expiring",
    "approval.expired",
    "approval.withdrawn",
  ],
  workspace: ["workspace.created"],
  webhook: ["webhook.auto_disabled"],
  api_key: ["api_key.auto_disabled"],
  // TC-18: the project manager is told when a budget crosses 75% or 90% (time-tracking/budget-notify.ts).
  project: ["budget.threshold_reached"],
  // IQ-12 / IQ-15: a clarification reply reaches the customer who owns the request (or the
  // triager who last handled it); a decline reaches the requester with its reason. Read access is the dedicated submission branch in `inbox.repository.ts`.
  submission: ["submission.replied", "submission.declined"],
} as const satisfies Record<string, readonly string[]>;

export function isSupportedNotificationResourceEvent(
  resourceType: string,
  eventKind: string,
): boolean {
  const eventKinds = (
    RESOURCE_EVENT_KINDS as Record<string, readonly string[] | undefined>
  )[resourceType];
  return eventKinds?.includes(eventKind) ?? false;
}
