import { parseSubmissionReference } from "@taskdesk/domain";
import { can } from "@taskdesk/permissions";
import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import type { NotificationRecipientCandidate } from "./fanout";
import {
  findNotificationPerson,
  findSubmissionNotificationContext,
} from "./repository";

/**
 * `IQ-12` / `NO-21` recipients for `submission.replied` (feature-contracts-p4.md: "Whoever last
 * handled it"; feature-contracts-p2.md IQ-12: a clarification request "notifies the customer").
 *
 * - `by: "staff"` (a clarification or any triager message): the request's requester, who must
 *   still be an active customer with a login.
 * - `by: "customer"` (the reply, IQ-13): the triager who last handled the submission
 *   (`claimed_by`), only while they still hold `intake:triage` in the submission's workspace.
 *   There is no fallback recipient: an unclaimed submission has no "last handler", and the
 *   triage queue is told about new submissions by `submission.received`, not by replies.
 *
 * The payload carries only the reference (`SUB-n`) and the side, so the row text never copies
 * message content or staff names (`EV-5`). The audience is resolved from the stored
 * submission and the recipient's current identity, never from the event payload alone. Inbox
 * only (`channels: []`): there is no external destination registered for a submission yet, and
 * the read path is the dedicated `submission` branch of `inbox.repository.ts`.
 */
export async function resolveSubmissionRepliedRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind === "submission.declined")
    return resolveSubmissionDeclinedRecipients(tx, event);
  if (event.kind !== "submission.replied") return [];
  const ref = event.payload.ref;
  const by = event.payload.by;
  if (typeof ref !== "string" || (by !== "customer" && by !== "staff"))
    return [];
  const number = parseSubmissionReference(ref);
  if (number === null) return [];
  if (!("workspaceId" in event.scope) || !event.scope.workspaceId) return [];
  const submission = await findSubmissionNotificationContext(tx, number);
  if (!submission || submission.workspaceId !== event.scope.workspaceId)
    return [];

  const recipientPersonId =
    by === "staff" ? submission.requesterId : submission.claimedBy;
  if (!recipientPersonId) return [];
  const person = await findNotificationPerson(tx, recipientPersonId);
  if (!person?.active || !person.userId) return [];
  const identity = await resolveIdentity(
    { userId: person.userId, credential: "session" },
    tx,
  );
  if (!identity || identity.personId !== recipientPersonId) return [];
  if (by === "staff") {
    if (identity.side !== "customer") return [];
  } else if (
    identity.side !== "staff" ||
    !can(identity, "intake:triage", "workspace", {
      workspaceId: submission.workspaceId,
    })
  ) {
    return [];
  }

  return [
    {
      personId: recipientPersonId,
      resourceType: "submission",
      resourceId: submission.id,
      title:
        by === "staff" ? "New message on your request" : "Customer replied",
      body:
        by === "staff"
          ? `There is a new message on your request ${ref}.`
          : `The customer replied on ${ref}.`,
      channels: [],
    },
  ];
}

/**
 * `submission.declined` -> the requester, "with the reason verbatim" (NO-21, IQ-16; the same
 * path carries IQ-15's auto-decline message). The reason is the customer-facing text the
 * decliner wrote, so it is the one place message content is copied into a notification body;
 * it is bounded to keep the inbox row small. A missing or deactivated requester, or one who is
 * not a customer, receives nothing.
 */
async function resolveSubmissionDeclinedRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  const ref = event.payload.ref;
  const reason = event.payload.reason;
  if (typeof ref !== "string" || typeof reason !== "string" || !reason.trim())
    return [];
  const number = parseSubmissionReference(ref);
  if (number === null) return [];
  if (!("workspaceId" in event.scope) || !event.scope.workspaceId) return [];
  const submission = await findSubmissionNotificationContext(tx, number);
  if (!submission || submission.workspaceId !== event.scope.workspaceId)
    return [];
  const person = await findNotificationPerson(tx, submission.requesterId);
  if (!person?.active || !person.userId) return [];
  const identity = await resolveIdentity(
    { userId: person.userId, credential: "session" },
    tx,
  );
  if (
    !identity ||
    identity.personId !== submission.requesterId ||
    identity.side !== "customer"
  )
    return [];
  return [
    {
      personId: submission.requesterId,
      resourceType: "submission",
      resourceId: submission.id,
      title: `Your request ${ref} was declined`,
      body: reason.trim().slice(0, 1000),
      channels: [],
    },
  ];
}
