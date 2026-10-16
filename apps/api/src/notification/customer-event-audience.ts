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
  // A direct description mention has no comment resource. Other work-item events include
  // assignment or internal activity and are not customer-facing notification events.
  return resourceType === "work_item" && eventKind === "work_item.mentioned";
}
