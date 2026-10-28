import { can, type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { isCustomerEligibleNotificationEvent } from "./customer-event-audience";
import type { CurrentNotificationResource } from "./repository";
import { isSupportedNotificationResourceEvent } from "./resource-contract";

export type NativeInboxCandidate = {
  userId: string;
  personId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  kind: string | null;
};

export function nativeInboxResourceKey(
  resourceType: string,
  resourceId: string,
) {
  return `${resourceType}\u0000${resourceId}`;
}

/** Native inbox rows use the same identity, reach, and capability evaluators as API reads. */
export function canReadNativeInboxCandidate(
  identity: ResolvedIdentity | null,
  candidate: NativeInboxCandidate,
  resource: CurrentNotificationResource | undefined,
  /**
   * The resource project's ancestors, nearest first (PR-2/PR-3), from
   * `projectAncestryFor`. Omitted means no inheritance is applied: every caller that has a
   * database handle must supply it, or an ancestor-only member falls back to their workspace
   * role.
   */
  ancestorProjectIds?: readonly string[],
  /** `project.owner_team_id` (reach step 5, `TM-4`); omitted means owner-team reach is not applied. */
  ownerTeamId?: string | null,
): boolean {
  if (
    !identity ||
    !resource ||
    candidate.personId === null ||
    candidate.personId !== identity.personId ||
    candidate.resourceId === null ||
    candidate.kind === null
  ) {
    return false;
  }

  if (candidate.resourceType === "webhook") {
    if (
      identity.side !== "staff" ||
      candidate.kind !== "webhook.auto_disabled" ||
      !isSupportedNotificationResourceEvent("webhook", candidate.kind) ||
      resource.projectId !== null ||
      resource.customerVisible ||
      !resource.staffUrl ||
      !can(identity, "workspace:read", "workspace", {
        workspaceId: resource.workspaceId,
      })
    )
      return false;
    return can(identity, "webhook:manage", "workspace", {
      workspaceId: resource.workspaceId,
    });
  }

  if (
    (candidate.resourceType !== "work_item" &&
      candidate.resourceType !== "comment") ||
    !isSupportedNotificationResourceEvent(
      candidate.resourceType,
      candidate.kind,
    ) ||
    resource.projectId === null ||
    resource.workItemId === undefined
  )
    return false;

  if (
    identity.side === "customer" &&
    !isCustomerEligibleNotificationEvent(
      candidate.resourceType,
      candidate.kind,
      resource.customerVisible,
    )
  ) {
    return false;
  }

  const visibleToPersonIds =
    identity.side === "customer" ? resource.visibleToPersonIds : null;
  const inCurrentReach = reaches(identity, {
    projectId: resource.projectId,
    workspaceId: resource.workspaceId,
    organisationId: resource.organisationId,
    visibleToPersonIds,
    ancestorProjectIds,
    ownerTeamId: ownerTeamId ?? null,
  });
  if (!inCurrentReach) return false;

  if (identity.side === "customer") {
    if (!resource.customerRequestOwnerPersonIds?.includes(identity.personId))
      return false;
    // Customer read authority is organisation-scoped. The evaluator deliberately does not
    // let an organisation grant satisfy a work-item policy scope; preserve that boundary and
    // check the built-in customer capability at the serving project's organisation instead.
    return can(identity, "work_item:read", "organisation", {
      organisationId: resource.organisationId ?? undefined,
    });
  }

  return can(identity, "work_item:read", "work_item", {
    workItemId: resource.workItemId,
    workItemProjectId: resource.projectId,
    projectId: resource.projectId,
    workspaceId: resource.workspaceId,
    ancestorProjectIds,
  });
}
