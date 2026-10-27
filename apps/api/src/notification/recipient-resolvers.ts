import { can, type ProjectReachFacts, reaches } from "@taskdesk/permissions";
import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import { CUSTOMER_APPROVAL_EVENT_KINDS } from "./customer-event-audience";
import type { NotificationRecipientCandidate } from "./fanout";
import { configuredMentionChannels } from "./fanout.repository";
import {
  findPendingActionNotificationContext,
  type PendingActionNotificationContext,
} from "./pending-action-recipient.repository";
import {
  findApiKeyAutoDisableOwner,
  findApprovalNotificationContext,
  findCurrentNotificationResource,
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

/** Resolves only the person explicitly named by a native comment mention. */
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
      ancestorProjectIds: await projectAncestryFor(
        tx,
        identity,
        resource.workspaceId,
        resource.projectId,
      ),
      ownerTeamId: await projectOwnerTeamFor(
        tx,
        identity,
        resource.workspaceId,
        resource.projectId,
      ),
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
      channels: await configuredMentionChannels(tx),
    },
  ];
}

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
  const channels = await configuredMentionChannels(tx);
  for (const personId of new Set(personIds)) {
    const person = await findNotificationPerson(tx, personId);
    if (!person?.active || !person.userId) continue;
    // AP-21 / AP-13 (`P2R1-04`): a customer is notified only as the addressed approver of a
    // customer approval. Their reach is the approval's own customer rule (the portal Approvals
    // list's check), and their inbox row is read through the portal inbox.
    if (person.side !== "staff") {
      if (
        person.side !== "customer" ||
        !CUSTOMER_APPROVAL_EVENT_KINDS.has(event.kind) ||
        personId !== row.approverId ||
        row.kind !== "customer" ||
        !(await isApprovalApproverStillValid(tx, row))
      )
        continue;
      const customer = await resolveIdentity(
        { userId: person.userId, credential: "session" },
        tx,
      );
      if (customer?.side !== "customer" || customer.personId !== personId)
        continue;
      // Loaded lazily: the approval repository builds table aliases at import time, and this
      // resolver module is imported by notification code that runs without the full schema.
      const { loadApprovalTargetByApprovalId } = await import(
        "../approval/repository"
      );
      if (
        !(await loadApprovalTargetByApprovalId(row.id, customer, {
          executor: tx,
        }))
      )
        continue;
      candidates.push(
        approvalCandidate(event.kind, personId, row.id, channels, true),
      );
      continue;
    }
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
    if (!identity) continue;
    const ancestorProjectIds = await projectAncestryFor(
      tx,
      identity,
      reachFacts.workspaceId,
      reachFacts.projectId,
    );
    const ownerTeamId = await projectOwnerTeamFor(
      tx,
      identity,
      reachFacts.workspaceId,
      reachFacts.projectId,
    );
    if (!reaches(identity, { ...reachFacts, ancestorProjectIds, ownerTeamId }))
      continue;
    candidates.push(approvalCandidate(event.kind, personId, row.id, channels));
  }
  return candidates;
}

/** The approval inbox row; the configured email channel follows the recipient's preference. */
function approvalCandidate(
  kind: string,
  personId: string,
  approvalId: string,
  channels: readonly string[],
  customer = false,
): NotificationRecipientCandidate {
  const event = { kind };
  // A customer's copy never uses the internal "work item" term (EV-5).
  const subject = customer ? "A request" : "A work item";
  return {
    personId,
    resourceType: "approval",
    resourceId: approvalId,
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
        ? `${subject} needs your approval.`
        : event.kind === "approval.expiring"
          ? "An approval request is nearing its expiry."
          : event.kind === "approval.expired"
            ? "An approval request has expired."
            : event.kind === "approval.withdrawn"
              ? "An approval request was withdrawn."
              : "An approval request was decided.",
    // AP-21: pending approvals reach the inbox and, per preference, email.
    channels,
  };
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

/**
 * WH-7: notify the webhook's current stored owner. Current capability and reach are
 * eligibility gates; workspace managers are not added as recipients by this event.
 */
export async function resolveWebhookAutoDisabledRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind !== "webhook.auto_disabled") return [];
  const webhookId = event.payload.webhookId;
  if (
    typeof webhookId !== "string" ||
    !webhookId ||
    !("workspaceId" in event.scope) ||
    !event.scope.workspaceId
  )
    return [];

  const workspaceId = event.scope.workspaceId;
  const resource = await findCurrentNotificationResource(tx, {
    resourceType: "webhook",
    resourceId: webhookId,
    eventKind: event.kind,
    workspaceId,
  });
  if (
    !resource ||
    resource.workspaceId !== workspaceId ||
    resource.projectId !== null ||
    resource.customerVisible ||
    !resource.staffUrl ||
    (event.scope.organisationId ?? null) !== resource.organisationId
  )
    return [];

  if (!resource.ownerPersonId) return [];
  const channels = await configuredMentionChannels(tx);
  const recipients: NotificationRecipientCandidate[] = [];

  const person = await findNotificationPerson(tx, resource.ownerPersonId);
  if (!person?.active || !person.userId || person.side !== "staff") return [];
  const identity = await resolveIdentity(
    { userId: person.userId, credential: "session" },
    tx,
  );
  if (
    !identity ||
    identity.personId !== resource.ownerPersonId ||
    identity.side !== "staff" ||
    !can(identity, "workspace:read", "workspace", { workspaceId }) ||
    !can(identity, "webhook:manage", "workspace", { workspaceId })
  )
    return [];

  recipients.push({
    personId: resource.ownerPersonId,
    resourceType: "webhook",
    resourceId: webhookId,
    title: "Webhook disabled",
    body: "A webhook was disabled and needs your attention.",
    channels,
  });
  return recipients;
}

/** MC-22: the current owner of a personal MCP key is the sole auto-disable recipient. */
export async function resolveApiKeyAutoDisabledRecipient(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind !== "api_key.auto_disabled") return [];
  if (
    !event.scope ||
    typeof event.scope !== "object" ||
    Object.keys(event.scope).length !== 0
  )
    return [];

  const apiKeyId = event.payload.apiKeyId;
  if (
    typeof apiKeyId !== "string" ||
    !apiKeyId ||
    event.payload.key !== apiKeyId ||
    event.payload.url !== "/agent/settings/profile/api-keys" ||
    event.payload.reason !== "mcp_burst_threshold_exceeded"
  )
    return [];

  const owner = await findApiKeyAutoDisableOwner(tx, apiKeyId);
  if (!owner) return [];
  const identity = await resolveIdentity(
    { userId: owner.userId, credential: "session" },
    tx,
  );
  if (identity?.side !== "staff" || identity.personId !== owner.personId)
    return [];

  return [
    {
      personId: owner.personId,
      resourceType: "api_key",
      resourceId: apiKeyId,
      title: "MCP API key disabled",
      body: "An MCP API key was automatically disabled after a burst of write attempts.",
      channels: [],
    },
  ];
}

const MAX_KEY_NAME_LENGTH = 80;

function pendingActionTargetLabel(
  context: PendingActionNotificationContext,
): string {
  const summary =
    context.payloadSummary &&
    typeof context.payloadSummary === "object" &&
    !Array.isArray(context.payloadSummary)
      ? (context.payloadSummary as Record<string, unknown>)
      : {};
  const count = context.targetIds.length;
  // Only the work item's own key is named; no titles, bodies or comment text.
  if (
    context.targetType === "work_item" &&
    count === 1 &&
    typeof summary.key === "string" &&
    summary.key
  )
    return summary.key;
  const noun = context.targetType.replaceAll("_", " ");
  return count === 1 ? `a ${noun}` : `${count} ${noun}s`;
}

export type PendingActionRecipientDependencies = {
  findContext: typeof findPendingActionNotificationContext;
  resolveRequesterIdentity: (
    tx: DbTransaction,
    userId: string,
  ) => Promise<{ personId: string } | null>;
};

const defaultPendingActionRecipientDependencies: PendingActionRecipientDependencies =
  {
    findContext: findPendingActionNotificationContext,
    resolveRequesterIdentity: (tx, userId) =>
      resolveIdentity({ userId, credential: "session" }, tx),
  };

/**
 * NO-21 `pending_action` recipients (feature-contracts-p4.md): the requester only.
 * `pending_action.requested` notifies only for an `api`/`mcp` origin made with the
 * requester's own key ("An agent using your key … asked to delete …"), never for `web`;
 * `pending_action.executed` notifies only on `outcome: failed`. An unresolved requester,
 * key or row fails closed; no administrator or event actor is ever substituted.
 */
export async function resolvePendingActionEventRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
  dependencies: PendingActionRecipientDependencies = defaultPendingActionRecipientDependencies,
): Promise<readonly NotificationRecipientCandidate[]> {
  const pendingActionId = event.payload.pendingActionId;
  if (typeof pendingActionId !== "string" || !pendingActionId) return [];
  if (event.kind === "pending_action.requested") {
    if (event.payload.origin !== "api" && event.payload.origin !== "mcp")
      return [];
  } else if (event.kind === "pending_action.executed") {
    if (event.payload.outcome !== "failed") return [];
  } else {
    return [];
  }

  const context = await dependencies.findContext(tx, pendingActionId);
  if (!context) return [];
  const eventWorkspaceId =
    "workspaceId" in event.scope ? (event.scope.workspaceId ?? null) : null;
  if ((context.workspaceId ?? null) !== eventWorkspaceId) return [];
  if (
    !context.requesterActive ||
    !context.requesterUserId ||
    context.requesterSide !== "staff"
  )
    return [];

  let keyName: string | null = null;
  if (event.kind === "pending_action.requested") {
    if (
      context.origin !== event.payload.origin ||
      context.credentialType !== "api_key" ||
      !context.credentialId ||
      context.keyOwnerUserId !== context.requesterUserId
    )
      return [];
    keyName = context.keyName?.trim().slice(0, MAX_KEY_NAME_LENGTH) || null;
  } else if (context.state !== "failed") {
    return [];
  }

  const identity = await dependencies.resolveRequesterIdentity(
    tx,
    context.requesterUserId,
  );
  if (!identity || identity.personId !== context.requestedByPersonId) return [];

  const target = pendingActionTargetLabel(context);
  return [
    event.kind === "pending_action.requested"
      ? {
          personId: context.requestedByPersonId,
          resourceType: "pending_action",
          resourceId: context.id,
          title: "Deletion awaiting your approval",
          body: keyName
            ? `An agent using your key ${keyName} asked to delete ${target}.`
            : `An agent using one of your API keys asked to delete ${target}.`,
          channels: [],
        }
      : {
          personId: context.requestedByPersonId,
          resourceType: "pending_action",
          resourceId: context.id,
          title: "Approved deletion failed",
          body: `The deletion of ${target} you approved could not be completed. Nothing was deleted.`,
          channels: [],
        },
  ];
}
