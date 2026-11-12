import { HttpError } from "./http-error";

const REASON_KEYS: Record<string, string> = {
  "note.required": "reasonNoteRequired",
  "guard.assignee_present": "reasonAssigneePresent",
  "guard.children_closed": "reasonChildrenClosed",
  "guard.no_open_blockers": "reasonNoOpenBlockers",
  "guard.field_required": "reasonFieldRequired",
  "guard.change_risk_at_most": "reasonChangeRisk",
  "approval.pending": "reasonApprovalPending",
  "cab.pending": "reasonCabPending",
};

/** Translate known refusal codes; never render arbitrary server detail as UI text. */
export function workItemTransitionReasonKey(code: string) {
  return `workItems:journey.${REASON_KEYS[code] ?? "reasonUnknown"}`;
}

export class WorkItemTransitionBlockedError extends HttpError {
  constructor(public readonly reasonCodes: string[]) {
    super(422, "Work item transition is blocked");
    this.name = "WorkItemTransitionBlockedError";
  }
}
