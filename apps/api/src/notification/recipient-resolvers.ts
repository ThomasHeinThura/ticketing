import { can, type ProjectReachFacts, reaches } from "@taskdesk/permissions";
import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import type { NotificationRecipientCandidate } from "./fanout";
import {
  findApprovalNotificationContext,
  findNotificationPerson,
  findNotificationWorkspace,
  isApprovalApproverStillValid,
  listApprovalParticipantPersonIds,
  listApprovalWatcherPersonIds,
} from "./repository";

export type EnabledNotificationChannels = (input: {
  tx: DbTransaction;
  personId: string;
  workspaceId: string;
  eventKind: string;
}) => Promise<readonly string[]>;

/**
 * Current-reach, current-visibility recipient resolver for the approval lifecycle. The
 * event's own workspace scopes the lookup (an approval of another workspace is never read),
 * recipients are only the approval's requester, approver and, for a decision, the work
 * item's staff watchers, and a named approver must still be a valid approver of the workspace.
 */
export async function resolveApprovalEventRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (!event.kind.startsWith("approval.")) return [];
  const approvalId = event.payload.approvalId;
  if (typeof approvalId !== "string" || !approvalId) return [];
  if (!("workspaceId" in event.scope) || !event.scope.workspaceId) return [];
  const row = await findApprovalNotificationContext(
    tx,
    approvalId,
    event.scope.workspaceId,
  );
  if (!row || row.workspaceId !== event.scope.workspaceId) return [];

  let personIds: string[];
  switch (event.kind) {
    case "approval.requested":
    case "approval.expiring":
    case "approval.withdrawn":
      personIds = [row.approverId];
      break;
    case "approval.expired":
      personIds = [row.requestedBy];
      break;
    case "approval.decided": {
      const watchers = await listApprovalWatcherPersonIds(tx, row.workItemId);
      personIds = [
        row.requestedBy,
        ...watchers.map(({ personId }) => personId),
      ];
      break;
    }
    default:
      return [];
  }

  const visibleToPersonIds =
    row.customerVisibility === "private"
      ? [
          ...(row.requesterId ? [row.requesterId] : []),
          ...(await listApprovalParticipantPersonIds(tx, row.workItemId)).map(
            ({ personId }) => personId,
          ),
        ]
      : null;
  const reachFacts: ProjectReachFacts = {
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    organisationId: row.organisationId,
    visibleToPersonIds,
  };
  const candidates: NotificationRecipientCandidate[] = [];
  for (const personId of new Set(personIds)) {
    const person = await findNotificationPerson(tx, personId);
    if (!person?.active || !person.userId) continue;
    // Only staff are written an inbox row: the approval inbox read predicate admits staff
    // recipients only, so a customer's row could never be read. A customer approver is
    // served by the portal approvals list instead.
    if (person.side !== "staff") continue;
    // A named approver must still be valid for this workspace (0120 check 4).
    if (
      personId === row.approverId &&
      !(await isApprovalApproverStillValid(tx, row))
    )
      continue;
    const identity = await resolveIdentity(
      { userId: person.userId, credential: "session" },
      tx,
    );
    if (!identity || !reaches(identity, reachFacts)) continue;
    candidates.push({
      personId,
      resourceType: "approval",
      resourceId: row.id,
      title:
        event.kind === "approval.requested"
          ? "Approval requested"
          : event.kind === "approval.expiring"
            ? "Approval expiring soon"
            : event.kind === "approval.expired"
              ? "Approval expired"
              : event.kind === "approval.withdrawn"
                ? "Approval withdrawn"
                : "Approval decision recorded",
      body:
        event.kind === "approval.requested"
          ? "A work item needs your approval."
          : event.kind === "approval.expiring"
            ? "An approval request is nearing its expiry."
            : event.kind === "approval.expired"
              ? "An approval request has expired."
              : event.kind === "approval.withdrawn"
                ? "An approval request was withdrawn."
                : "An approval request was decided.",
      // External channel adapters and their registry stay with the notification worker slice.
      channels: [],
    });
  }
  return candidates;
}

/**
 * Canonical recipient/resource resolver for `workspace.created` (NO-8). The
 * event's owner is a better-auth user id; the notification recipient is the
 * corresponding person id. Current workspace capability is re-evaluated from
 * persisted identity and membership facts in the caller's transaction.
 */
export async function resolveWorkspaceCreatedRecipient(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
  enabledChannels: EnabledNotificationChannels,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind !== "workspace.created") return [];

  const workspaceId = event.payload.workspaceId;
  const ownerUserId = event.payload.ownerId;
  if (
    typeof workspaceId !== "string" ||
    typeof ownerUserId !== "string" ||
    !workspaceId ||
    !ownerUserId ||
    !("workspaceId" in event.scope) ||
    event.scope.workspaceId !== workspaceId
  ) {
    return [];
  }

  const workspace = await findNotificationWorkspace(tx, workspaceId);
  if (!workspace) return [];

  const identity = await resolveIdentity(
    { userId: ownerUserId, credential: "session" },
    tx,
  );
  if (
    !identity ||
    !can(identity, "workspace:read", "workspace", { workspaceId })
  ) {
    return [];
  }

  return [
    {
      personId: identity.personId,
      resourceType: "workspace",
      resourceId: workspace.id,
      title: "Workspace created",
      body: "A workspace was created for you.",
      channels: await enabledChannels({
        tx,
        personId: identity.personId,
        workspaceId,
        eventKind: event.kind,
      }),
    },
  ];
}
