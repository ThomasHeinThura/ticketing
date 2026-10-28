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
  // IQ-12 / IQ-16 / IQ-15: a staff message or a decline on the customer's own submission
  // (`P2R1-05`); the send-time check confirms the customer is still its requester.
  if (resourceType === "submission")
    return (
      eventKind === "submission.replied" || eventKind === "submission.declined"
    );
  // A direct description mention has no comment resource. A state transition is public
  // activity under CA-7 and is a default requester notification under notifications.md.
  // Assignment and other internal/staff activity remain excluded by NO-19.
  return (
    resourceType === "work_item" &&
    (eventKind === "work_item.mentioned" ||
      eventKind === "work_item.transitioned")
  );
}

/**
 * The approval kinds a customer approver is told about: exactly the kinds the portal inbox
 * shows (`portal-inbox.ts` `customerEventSchema`, AP-21). `approval.decided` and
 * `approval.expired` are staff-side outcomes (requester and watchers); a customer approver who
 * also watches the item gets neither an invisible inbox row nor an email for them (`P2R2-04`).
 */
export const CUSTOMER_APPROVAL_EVENT_KINDS: ReadonlySet<string> = new Set([
  "approval.requested",
  "approval.expiring",
  "approval.withdrawn",
]);
