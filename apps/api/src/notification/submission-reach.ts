import { can, type ResolvedIdentity } from "@taskdesk/permissions";

/** The submission notification kinds the inbox may serve (resource-contract.ts). */
export const SUBMISSION_NOTIFICATION_KINDS = [
  "submission.replied",
  "submission.declined",
] as const;

/**
 * Who may read a `submission` inbox row (IQ-12, IQ-15/IQ-16, NO-21), evaluated per row against
 * the identity's current standing:
 *
 * - the customer who owns the request, for either kind (a reply on it, or its decline with the
 *   reason verbatim);
 * - a staff member only for `submission.replied` (the triager who last handled it), and only
 *   while they still hold `intake:triage` in the submission's workspace.
 *
 * The row must also be the caller's own (`row.personId`); a row addressed to another person is
 * never readable, whatever the caller's capability.
 */
export function canReadSubmissionNotification(
  identity: ResolvedIdentity,
  row: { personId: string | null; kind: string | null },
  submission: { requesterId: string; workspaceId: string },
): boolean {
  if (row.personId !== identity.personId) return false;
  if (row.kind === "submission.declined")
    return (
      identity.side === "customer" &&
      submission.requesterId === identity.personId
    );
  if (row.kind !== "submission.replied") return false;
  if (identity.side === "customer")
    return submission.requesterId === identity.personId;
  return can(identity, "intake:triage", "workspace", {
    workspaceId: submission.workspaceId,
  });
}
