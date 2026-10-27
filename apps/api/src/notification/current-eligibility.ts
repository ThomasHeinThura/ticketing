import { can, type ProjectReachFacts, reaches } from "@taskdesk/permissions";
import type { ClaimedNotificationDelivery } from "../database/repositories/notification-delivery.repository";
import type { DbTransaction } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  parseNotificationCopyDescriptor,
  renderNotificationCopyDescriptor,
} from "../terminology/notification-copy";
import {
  requireTerminologyLocale,
  resolveTermForm,
} from "../terminology/service";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import { isActiveTeamNotificationRecipient } from "./automation-team-recipients";
import { isCustomerEligibleNotificationEvent } from "./customer-event-audience";
import { isCurrentCustomerOwnRequest } from "./customer-request-scope";
import type { NotificationProjection } from "./outbox-drain";
import { resolveNotificationPreference } from "./preferences";
import {
  evaluateQuietHours,
  QUIET_HOURS_EXEMPT_EVENT_KINDS,
} from "./quiet-hours";
import {
  findApprovalNotificationContext,
  findCurrentNotificationResource,
  findInstanceTimezone,
  findNotificationPerson,
  isApprovalApproverStillValid,
  listApprovalWatcherPersonIds,
} from "./repository";
import { isSupportedNotificationResourceEvent } from "./resource-contract";
import { isCurrentSubmissionNotificationRecipient } from "./submission-recipients";

export type CurrentNotificationEligibility =
  | { kind: "suppress"; reason: string }
  | { kind: "eligible"; projection: NotificationProjection }
  | {
      /** `NO-3`: the recipient is inside their quiet hours; retry at `until`. */
      kind: "defer";
      until: Date;
      reason: "quiet_hours";
    }
  | {
      /**
       * Configured quiet hours are malformed (unparseable time, equal start and end, unknown
       * zone) and cannot be evaluated. Never translated into provider authorization.
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
  if (
    delivery.resourceType === "webhook" &&
    isSupportedNotificationResourceEvent("webhook", delivery.eventKind) &&
    payload.webhookId === delivery.resourceId
  )
    return { payload, projectId };
  // `P2R1-05`: submission events carry only the `SUB-n` reference; the stored submission is
  // resolved by the delivery's resource id and re-checked below.
  if (
    delivery.resourceType === "submission" &&
    isSupportedNotificationResourceEvent("submission", delivery.eventKind) &&
    typeof payload.ref === "string"
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
  if (
    resource.projectId === null &&
    delivery.resourceType !== "workspace" &&
    delivery.resourceType !== "webhook" &&
    delivery.resourceType !== "submission"
  )
    return { kind: "suppress", reason: "resource_unavailable" };
  if (
    resource.workspaceId !== delivery.workspaceId ||
    resource.organisationId !== delivery.organisationId ||
    (binding.projectId !== null && resource.projectId !== binding.projectId)
  )
    return { kind: "suppress", reason: "resource_scope_changed" };
  if (
    identity.side === "customer" &&
    !isCustomerEligibleNotificationEvent(
      delivery.resourceType,
      delivery.eventKind,
      resource.customerVisible,
    )
  )
    return { kind: "suppress", reason: "customer_event_not_eligible" };
  if (
    identity.side === "customer" &&
    (delivery.resourceType === "work_item" ||
      delivery.resourceType === "comment") &&
    (!resource.workItemId ||
      !(await isCurrentCustomerOwnRequest(tx, identity, resource.workItemId)))
  )
    return { kind: "suppress", reason: "customer_request_not_owned" };

  if (delivery.eventKind === "automation.notification_sent") {
    const teamId = binding.payload.teamId;
    if (
      identity.side !== "staff" ||
      typeof teamId !== "string" ||
      !(await isActiveTeamNotificationRecipient(tx, {
        teamId,
        workspaceId: delivery.workspaceId,
        userId: person.userId,
        personId: identity.personId,
      }))
    )
      return { kind: "suppress", reason: "team_membership_lost" };
  }

  if (delivery.resourceType === "workspace") {
    if (
      !can(identity, "workspace:read", "workspace", {
        workspaceId: resource.workspaceId,
      })
    )
      return { kind: "suppress", reason: "reach_lost" };
  } else if (delivery.resourceType === "webhook") {
    if (
      identity.side !== "staff" ||
      !resource.staffUrl ||
      !can(identity, "workspace:read", "workspace", {
        workspaceId: resource.workspaceId,
      }) ||
      !can(identity, "webhook:manage", "workspace", {
        workspaceId: resource.workspaceId,
      })
    )
      return { kind: "suppress", reason: "reach_lost" };
  } else if (delivery.resourceType === "submission") {
    if (
      !(await isCurrentSubmissionNotificationRecipient(tx, identity, {
        submissionId: delivery.resourceId,
        workspaceId: delivery.workspaceId,
      }))
    )
      return { kind: "suppress", reason: "reach_lost" };
  } else {
    if (resource.projectId === null)
      return { kind: "suppress", reason: "resource_unavailable" };
    // PR-2/PR-3: reach and read authority both follow the ancestor chain.
    const ancestorProjectIds = await projectAncestryFor(
      tx,
      identity,
      resource.workspaceId,
      resource.projectId,
    );
    const reachFacts: ProjectReachFacts = {
      projectId: resource.projectId,
      workspaceId: resource.workspaceId,
      organisationId: resource.organisationId,
      ancestorProjectIds,
      ownerTeamId: await projectOwnerTeamFor(
        tx,
        identity,
        resource.workspaceId,
        resource.projectId,
      ),
      visibleToPersonIds:
        identity.side === "customer" ? resource.visibleToPersonIds : null,
    };
    if (!reaches(identity, reachFacts))
      return { kind: "suppress", reason: "reach_lost" };
    // Reach and authority are separate axes (rbac.md section 2): the recipient must also
    // currently hold work_item:read, the same rule as GET /api/work-items/{key}.
    // A customer's role is organisation-scoped. Check the organisation grant after the
    // current resource-reach check, which still enforces the individual request boundary.
    const canRead =
      identity.side === "customer"
        ? can(identity, "work_item:read", "organisation", {
            organisationId: resource.organisationId ?? undefined,
          })
        : can(identity, "work_item:read", "work_item", {
            workspaceId: resource.workspaceId,
            organisationId: resource.organisationId ?? undefined,
            workItemProjectId: resource.projectId,
            projectId: resource.projectId,
            ancestorProjectIds,
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

  if (!QUIET_HOURS_EXEMPT_EVENT_KINDS.has(delivery.eventKind)) {
    const quiet = evaluateQuietHours(
      {
        start: person.quietHoursStart,
        end: person.quietHoursEnd,
        timezone: person.quietHoursTimezone,
      },
      person.quietHoursStart === null && person.quietHoursEnd === null
        ? "UTC"
        : await findInstanceTimezone(tx),
      new Date(),
    );
    if (quiet.kind === "unresolved") return { kind: "quiet_hours_unresolved" };
    if (quiet.kind === "quiet")
      return { kind: "defer", until: quiet.until, reason: "quiet_hours" };
  }

  const authenticatedUrl =
    identity.side === "staff" ? resource.staffUrl : resource.portalUrl;
  if (!authenticatedUrl) return { kind: "destination_unresolved" };

  let projectionTitle = delivery.title;
  let projectionBody = delivery.body;
  const eventData = delivery.eventData;
  const systemCopy =
    eventData && typeof eventData === "object" && !Array.isArray(eventData)
      ? parseNotificationCopyDescriptor(eventData.systemCopy)
      : null;
  if (systemCopy) {
    let locale = "en-US";
    try {
      locale = requireTerminologyLocale(person.locale ?? "en-US");
    } catch {
      // Older/unrecognized account locale falls back to the shipped English default.
    }
    const rendered = await renderNotificationCopyDescriptor(
      systemCopy,
      (termKey, count) =>
        resolveTermForm({
          locale,
          audience: identity.side === "staff" ? "agent" : "customer",
          termKey,
          count,
          workspaceId: resource.workspaceId,
          executor: tx,
        }),
    ).catch(() => null);
    if (rendered) {
      projectionTitle = rendered.title;
      projectionBody = rendered.body;
    }
  }

  // The inbox projection was created for this recipient in the originating
  // transaction. Return it only after rechecking current resource visibility.
  return {
    kind: "eligible",
    projection: {
      title: projectionTitle,
      body: projectionBody,
      url: authenticatedUrl,
      audience: identity.side === "staff" ? "agent" : "customer",
    },
  };
}
