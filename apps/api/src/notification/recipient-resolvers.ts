import { can, type ProjectReachFacts, reaches } from "@taskdesk/permissions";
import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import type { NotificationRecipientCandidate } from "./fanout";
import {
  findApprovalNotificationContext,
  findCurrentNotificationResource,
  findNotificationPerson,
  findNotificationWorkspace,
  listApprovalParticipantPersonIds,
  listApprovalWatcherPersonIds,
} from "./repository";

export type EnabledNotificationChannels = (input: {
  tx: DbTransaction;
  personId: string;
  workspaceId: string;
  eventKind: string;
}) => Promise<readonly string[]>;

/** Resolves only the person named by a native comment mention, with current reach. */
export async function resolveMentionEventRecipient(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind !== "work_item.mentioned") return [];
  const { commentId, key, mentionedPersonId, workItemId } = event.payload;
  if (
    typeof mentionedPersonId !== "string" ||
    typeof commentId !== "string" ||
    typeof workItemId !== "string" ||
    typeof key !== "string" ||
    !("workspaceId" in event.scope) ||
    !event.scope.workspaceId ||
    !event.scope.projectId
  )
    return [];

  const person = await findNotificationPerson(tx, mentionedPersonId);
  if (
    !person?.active ||
    !person.userId ||
    (event.actor.id !== null && event.actor.id === person.userId)
  )
    return [];
  const identity = await resolveIdentity(
    { userId: person.userId, credential: "session" },
    tx,
  );
  if (!identity || identity.personId !== mentionedPersonId) return [];

  const resource = await findCurrentNotificationResource(tx, {
    resourceType: "comment",
    resourceId: commentId,
    eventKind: event.kind,
    canonicalWorkItem: { id: workItemId, key },
  });
  if (
    !resource ||
    resource.workspaceId !== event.scope.workspaceId ||
    resource.projectId !== event.scope.projectId ||
    resource.organisationId !== (event.scope.organisationId ?? null)
  )
    return [];

  if (
    !reaches(identity, {
      projectId: resource.projectId,
      workspaceId: resource.workspaceId,
      organisationId: resource.organisationId,
      visibleToPersonIds:
        identity.side === "customer" ? resource.visibleToPersonIds : null,
    })
  )
    return [];

  return [
    {
      personId: mentionedPersonId,
      resourceType: "comment",
      resourceId: commentId,
      title: "You were mentioned",
      body: `You were mentioned in a comment on ${key}.`,
      channels: [],
    },
  ];
}

/** Current-reach, current-visibility recipient resolver for the AP approval lifecycle. */
export async function resolveApprovalEventRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (!event.kind.startsWith("approval.")) return [];
  const approvalId = event.payload.approvalId;
  if (typeof approvalId !== "string" || !approvalId) return [];
  const row = await findApprovalNotificationContext(tx, approvalId);
  if (
    !row ||
    !("workspaceId" in event.scope) ||
    event.scope.workspaceId !== row.workspaceId
  )
    return [];

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
    // Customers are notified only about approvals directly addressed to or raised by them.
    if (
      person.side === "customer" &&
      personId !== row.approverId &&
      personId !== row.requestedBy
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
      // External channel adapters and their registry are a separate notifications slice.
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
