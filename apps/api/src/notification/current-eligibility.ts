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
  listApprovalWatcherPersonIds,
} from "./repository";

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

function eventPayload(
  delivery: ClaimedNotificationDelivery,
): Record<string, unknown> | null {
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
  if (
    envelope.id !== delivery.eventId ||
    envelope.kind !== delivery.eventKind ||
    !scope ||
    typeof scope !== "object" ||
    Array.isArray(scope) ||
    (scope as Record<string, unknown>).workspaceId !== delivery.workspaceId
  )
    return null;
  const envelopePayload = envelope.payload;
  return envelopePayload &&
    typeof envelopePayload === "object" &&
    !Array.isArray(envelopePayload)
    ? (envelopePayload as Record<string, unknown>)
    : null;
}

function matchesCanonicalResource(
  delivery: ClaimedNotificationDelivery,
): boolean {
  const payload = eventPayload(delivery);
  if (!payload) return false;
  if (delivery.resourceType === "approval")
    return payload.approvalId === delivery.resourceId;
  if (delivery.resourceType === "workspace")
    return payload.workspaceId === delivery.resourceId;
  if (delivery.resourceType === "comment")
    return payload.commentId === delivery.resourceId;
  if (
    delivery.resourceType === "work_item" &&
    delivery.eventKind === "work_item.mentioned" &&
    typeof payload.commentId === "string"
  )
    return false;
  if (
    delivery.resourceType === "work_item" &&
    [
      "work_item.assigned",
      "work_item.unassigned",
      "work_item.mentioned",
      "work_item.transitioned",
      "work_item.escalated",
      "work_item.due_soon",
      "work_item.overdue",
      "work_item.unblocked",
      "sla.at_risk",
      "sla.breached",
    ].includes(delivery.eventKind)
  )
    return (
      payload.workItemId === delivery.resourceId ||
      payload.key === delivery.resourceId
    );
  return true;
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
  if (!matchesCanonicalResource(delivery))
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
  });
  if (!resource) return { kind: "suppress", reason: "resource_unavailable" };
  if (resource.projectId === null && delivery.resourceType !== "workspace")
    return { kind: "suppress", reason: "resource_unavailable" };
  if (
    resource.workspaceId !== delivery.workspaceId ||
    (delivery.organisationId !== null &&
      resource.organisationId !== delivery.organisationId)
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
  }

  if (delivery.resourceType === "approval") {
    const approval = await findApprovalNotificationContext(
      tx,
      delivery.resourceId,
    );
    if (!approval)
      return {
        kind: "suppress",
        reason: "approval_not_addressed_to_recipient",
      };
    let currentRecipient = false;
    switch (delivery.eventKind) {
      case "approval.requested":
      case "approval.expiring":
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
