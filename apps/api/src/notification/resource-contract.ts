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
  ],
  comment: ["work_item.commented", "work_item.mentioned"],
  workspace: ["workspace.created"],
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
