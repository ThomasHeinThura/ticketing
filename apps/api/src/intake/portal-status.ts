/**
 * `CP-5`: the ONE place a portal request's customer-facing status is computed. List rows, the
 * home page and the detail page all render this value and never the submission state or the
 * workflow state name (`Triage`, `Waiting for L2` ...), which are internal.
 */
export const PORTAL_CUSTOMER_STATUSES = [
  "received",
  "need_more_info",
  "in_progress",
  "resolved",
  "declined",
  "closed",
  "withdrawn",
] as const;

export type PortalCustomerStatus = (typeof PORTAL_CUSTOMER_STATUSES)[number];

export type PortalStatusWorkItem = {
  resolvedAt: Date | null;
  /** `state_template.group`: backlog | unstarted | started | completed | cancelled. */
  stateGroup: string;
};

export function portalCustomerStatus(
  submissionState: string,
  workItem: PortalStatusWorkItem | null,
): PortalCustomerStatus {
  switch (submissionState) {
    case "new":
      return "received";
    case "clarifying":
      return "need_more_info";
    case "declined":
      return "declined";
    case "withdrawn":
      return "withdrawn";
    case "accepted":
    case "duplicate": {
      if (!workItem) return "in_progress";
      if (workItem.stateGroup === "cancelled") return "closed";
      if (workItem.resolvedAt || workItem.stateGroup === "completed")
        return "resolved";
      return "in_progress";
    }
    default:
      return "received";
  }
}
