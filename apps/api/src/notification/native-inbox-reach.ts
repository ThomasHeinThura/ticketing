import { can, type ResolvedIdentity, reaches } from "@taskdesk/permissions";
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
): boolean {
  if (
    !identity ||
    !resource ||
    candidate.personId === null ||
    candidate.personId !== identity.personId ||
    candidate.resourceId === null ||
    candidate.kind === null ||
    (candidate.resourceType !== "work_item" &&
      candidate.resourceType !== "comment") ||
    !isSupportedNotificationResourceEvent(
      candidate.resourceType,
      candidate.kind,
    ) ||
    resource.projectId === null ||
    resource.workItemId === undefined
  ) {
    return false;
  }

  if (identity.side === "customer" && !resource.customerVisible) return false;

  const visibleToPersonIds =
    identity.side === "customer" ? resource.visibleToPersonIds : null;
  return (
    reaches(identity, {
      projectId: resource.projectId,
      workspaceId: resource.workspaceId,
      organisationId: resource.organisationId,
      visibleToPersonIds,
    }) &&
    can(identity, "work_item:read", "work_item", {
      workItemId: resource.workItemId,
      workItemProjectId: resource.projectId,
      projectId: resource.projectId,
      workspaceId: resource.workspaceId,
    })
  );
}
