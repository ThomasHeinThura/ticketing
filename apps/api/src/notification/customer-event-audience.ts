/** Customer event rules from notifications.md (NO-18/19) and events.md (EV-5).
 * Resource visibility is still checked separately for the current request audience.
 */
export function isCustomerEligibleNotificationEvent(
  resourceType: string,
  eventKind: string,
  customerVisible: boolean,
): boolean {
  if (!customerVisible) return false;
  if (resourceType === "comment") {
    return (
      eventKind === "work_item.commented" || eventKind === "work_item.mentioned"
    );
  }
  if (resourceType === "approval") {
    // Notifications' approval recipient rules and customer-portal permissions allow only
    // the addressed approver/requester; current eligibility checks that person/resource
    // relationship after this audience gate.
    return [
      "approval.requested",
      "approval.decided",
      "approval.expiring",
      "approval.expired",
      "approval.withdrawn",
    ].includes(eventKind);
  }
  // A direct description mention has no comment resource. A state transition is public
  // activity under CA-7 and is a default requester notification under notifications.md.
  // Assignment and other internal/staff activity remain excluded by NO-19.
  return (
    resourceType === "work_item" &&
    (eventKind === "work_item.mentioned" ||
      eventKind === "work_item.transitioned")
  );
}
