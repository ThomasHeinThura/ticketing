import { can, type ProjectReachFacts, reaches } from "@taskdesk/permissions";
import type { ClaimedNotificationDelivery } from "../database/repositories/notification-delivery.repository";
import type { DbTransaction } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import type { NotificationProjection } from "./outbox-drain";
import { resolveNotificationPreference } from "./preferences";
import {
  findApprovalNotificationContext,
  findCurrentNotificationResource,
  findNotificationPerson,
  isApprovalApproverStillValid,
  listApprovalWatcherPersonIds,
} from "./repository";
import { isSupportedNotificationResourceEvent } from "./resource-contract";

export type CurrentNotificationEligibility =
  | { kind: "suppress"; reason: string }
  | { kind: "eligible"; projection: NotificationProjection }
  | {
      /**
       * The current reach and channel preference passed, but configured quiet hours
       * cannot be evaluated until the approved timezone/DST contract is resolved.
       * This result must never be translated into provider authorization.
       */
      kind: "quiet_hours_unresolved";
    }
  | {
      /** The resource has no already-registered exact authenticated destination. */
      kind: "destination_unresolved";
    };

type CanonicalBinding = {
  payload: Record<string, unknown>;
  projectId: string | null;
  workItemId?: string;
  workItemKey?: string;
};

function canonicalBinding(
  delivery: ClaimedNotificationDelivery,
): CanonicalBinding | null {
  let parsed = delivery.payload;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const envelope = parsed as Record<string, unknown>;
  const scope = envelope.scope;
  const scopeRecord =
    scope && typeof scope === "object" && !Array.isArray(scope)
      ? (scope as Record<string, unknown>)
      : null;
  if (
    envelope.id !== delivery.eventId ||
    envelope.kind !== delivery.eventKind ||
    !scopeRecord ||
    scopeRecord.workspaceId !== delivery.workspaceId ||
    (scopeRecord.organisationId ?? null) !== delivery.organisationId ||
    (scopeRecord.projectId !== undefined &&
      (typeof scopeRecord.projectId !== "string" ||
        scopeRecord.projectId.length === 0))
  )
    return null;
  const envelopePayload = envelope.payload;
  if (
    !envelopePayload ||
    typeof envelopePayload !== "object" ||
    Array.isArray(envelopePayload)
  )
    return null;
  const payload = envelopePayload as Record<string, unknown>;
  const scopeProjectId = scopeRecord.projectId;
  const projectId = typeof scopeProjectId === "string" ? scopeProjectId : null;
  const workItemId = payload.workItemId;
  const workItemKey = payload.key;
  const hasWorkItemId = Object.hasOwn(payload, "workItemId");
  const hasWorkItemKey = Object.hasOwn(payload, "key");
  if (
    (hasWorkItemId &&
      (typeof workItemId !== "string" || workItemId.length === 0)) ||
    (hasWorkItemKey &&
      (typeof workItemKey !== "string" || workItemKey.length === 0))
  )
    return null;
  const hasWorkItemIdentity =
    (typeof workItemId === "string" && workItemId.length > 0) ||
    (typeof workItemKey === "string" && workItemKey.length > 0);

  if (delivery.resourceType === "work_item") {
    if (
      !isSupportedNotificationResourceEvent("work_item", delivery.eventKind) ||
      (delivery.eventKind === "work_item.mentioned" &&
        Object.hasOwn(payload, "commentId")) ||
      !hasWorkItemIdentity ||
      (delivery.resourceId !== workItemId &&
        delivery.resourceId !== workItemKey)
    )
      return null;
    return {
      payload,
      projectId,
      ...(typeof workItemId === "string" ? { workItemId } : {}),
      ...(typeof workItemKey === "string" ? { workItemKey } : {}),
    };
  }
  if (delivery.resourceType === "comment") {
    if (
      !isSupportedNotificationResourceEvent("comment", delivery.eventKind) ||
      typeof payload.commentId !== "string" ||
      payload.commentId !== delivery.resourceId
    )
      return null;
    return {
      payload,
      projectId,
      ...(typeof workItemId === "string" ? { workItemId } : {}),
      ...(typeof workItemKey === "string" ? { workItemKey } : {}),
    };
  }
  if (
    delivery.resourceType === "approval" &&
    isSupportedNotificationResourceEvent("approval", delivery.eventKind) &&
    payload.approvalId === delivery.resourceId
  )
    return { payload, projectId };
  if (
    delivery.resourceType === "workspace" &&
    isSupportedNotificationResourceEvent("workspace", delivery.eventKind) &&
    payload.workspaceId === delivery.resourceId
  )
    return { payload, projectId };
  return null;
}

/**
 * Re-evaluates only the already-materialized immediate child's current recipient
 * reach and channel preference. It intentionally does not register a worker or
 * decide configured quiet-hour behavior; see `quiet_hours_unresolved`.
 */
export async function evaluateCurrentNotificationReachAndPreference(
  tx: DbTransaction,
  delivery: ClaimedNotificationDelivery,
): Promise<CurrentNotificationEligibility> {
  if (
    !delivery.resourceType ||
    !delivery.resourceId ||
    !delivery.title ||
    !delivery.body
  )
    return { kind: "suppress", reason: "resource_mapping_missing" };
  const binding = canonicalBinding(delivery);
  if (!binding)
    return { kind: "suppress", reason: "resource_mapping_mismatch" };

  const person = await findNotificationPerson(tx, delivery.recipientPersonId);
  if (!person?.active || !person.userId)
    return { kind: "suppress", reason: "recipient_inactive" };

  const identity = await resolveIdentity(
    { userId: person.userId, credential: "session" },
    tx,
  );
  if (!identity || identity.personId !== delivery.recipientPersonId)
    return { kind: "suppress", reason: "recipient_identity_unavailable" };

  const resource = await findCurrentNotificationResource(tx, {
    resourceType: delivery.resourceType,
    resourceId: delivery.resourceId,
    eventKind: delivery.eventKind,
    workspaceId: delivery.workspaceId,
    canonicalWorkItem: {
      ...(binding.workItemId ? { id: binding.workItemId } : {}),
      ...(binding.workItemKey ? { key: binding.workItemKey } : {}),
    },
  });
  if (!resource) return { kind: "suppress", reason: "resource_unavailable" };
  if (resource.projectId === null && delivery.resourceType !== "workspace")
    return { kind: "suppress", reason: "resource_unavailable" };
  if (
    resource.workspaceId !== delivery.workspaceId ||
    resource.organisationId !== delivery.organisationId ||
    (binding.projectId !== null && resource.projectId !== binding.projectId)
  )
    return { kind: "suppress", reason: "resource_scope_changed" };
  if (identity.side === "customer" && !resource.customerVisible)
    return { kind: "suppress", reason: "resource_not_customer_visible" };

  if (delivery.resourceType === "workspace") {
    if (
      !can(identity, "workspace:read", "workspace", {
        workspaceId: resource.workspaceId,
      })
    )
      return { kind: "suppress", reason: "reach_lost" };
  } else {
    if (resource.projectId === null)
      return { kind: "suppress", reason: "resource_unavailable" };
    const reachFacts: ProjectReachFacts = {
      projectId: resource.projectId,
      workspaceId: resource.workspaceId,
      organisationId: resource.organisationId,
      visibleToPersonIds: resource.visibleToPersonIds,
    };
    if (!reaches(identity, reachFacts))
      return { kind: "suppress", reason: "reach_lost" };
    // Reach and authority are separate axes (rbac.md section 2): the recipient must also
    // currently hold work_item:read, the same rule as GET /api/work-items/{key}.
    // A customer's role is organisation-scoped, so for an approval addressed to or raised
    // by a customer the read authority is evaluated at the organisation, not at work-item
    // scope where no organisation grant applies.
    const canRead =
      delivery.resourceType === "approval" && identity.side === "customer"
        ? can(identity, "work_item:read", "organisation", {
            organisationId: resource.organisationId ?? undefined,
          })
        : can(identity, "work_item:read", "work_item", {
            workspaceId: resource.workspaceId,
            organisationId: resource.organisationId ?? undefined,
            workItemProjectId: resource.projectId,
            projectId: resource.projectId,
          });
    if (!canRead) return { kind: "suppress", reason: "read_authority_lost" };
  }

  if (delivery.resourceType === "approval") {
    const approval = await findApprovalNotificationContext(
      tx,
      delivery.resourceId,
      delivery.workspaceId,
    );
    if (!approval || approval.workspaceId !== delivery.workspaceId)
      return { kind: "suppress", reason: "resource_unavailable" };
    let currentRecipient = false;
    switch (delivery.eventKind) {
      case "approval.requested":
      case "approval.expiring":
        // Only a still-pending approval needs the approver's attention.
        if (approval.state !== "pending")
          return { kind: "suppress", reason: "approval_not_pending" };
        currentRecipient = identity.personId === approval.approverId;
        break;
      case "approval.withdrawn":
        currentRecipient = identity.personId === approval.approverId;
        break;
      case "approval.expired":
        currentRecipient = identity.personId === approval.requestedBy;
        break;
      case "approval.decided":
        currentRecipient = identity.personId === approval.requestedBy;
        if (!currentRecipient && identity.side === "staff") {
          const watchers = await listApprovalWatcherPersonIds(
            tx,
            approval.workItemId,
          );
          currentRecipient = watchers.some(
            ({ personId }) => personId === identity.personId,
          );
        }
        break;
    }
    if (!currentRecipient)
      return {
        kind: "suppress",
        reason: "approval_not_addressed_to_recipient",
      };
    // A named approver must still be valid for this workspace at send time.
    if (
      identity.personId === approval.approverId &&
      !(await isApprovalApproverStillValid(tx, approval))
    )
      return { kind: "suppress", reason: "approver_no_longer_valid" };
  }

  const preference = await resolveNotificationPreference(tx, {
    personId: identity.personId,
    workspaceId: resource.workspaceId,
    projectId: resource.projectId,
    eventKind: delivery.eventKind,
    channel: delivery.channel,
  });
  if (!preference.enabled)
    return { kind: "suppress", reason: "channel_disabled" };

  if (
    person.quietHoursStart !== null ||
    person.quietHoursEnd !== null ||
    person.quietHoursTimezone !== null
  )
    return { kind: "quiet_hours_unresolved" };

  if (identity.side !== "staff" || !resource.staffUrl)
    return { kind: "destination_unresolved" };

  // The inbox projection was created for this recipient in the originating
  // transaction. Return it only after rechecking current resource visibility.
  return {
    kind: "eligible",
    projection: {
      title: delivery.title,
      body: delivery.body,
      url: resource.staffUrl,
    },
  };
}
