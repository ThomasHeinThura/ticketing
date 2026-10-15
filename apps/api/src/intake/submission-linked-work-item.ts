import { findWorkItemProjectOwner } from "./linked-work-item.repository";

/**
 * ONE rule for every staff exposure of a submission's converted work item (#740): once a
 * submission is linked to a work item, the work item's data (its id, comments, attachments,
 * fields) is shown to a staff caller only if the caller reaches the work item's project. When
 * the caller does not, the link behaves as if it were ABSENT, exactly like a submission that was
 * never converted: nothing about the work item is read, listed, served or confirmed.
 *
 * Every staff route that dereferences `submission.work_item_id` takes the work item id through
 * this function (the staff detail and the staff attachment list and download). The structural
 * guard (`tests/permissions/project-reach-guard.test.ts`) requires those routes to declare the
 * reach context. The portal requester's own view of their own request does NOT use it: it is the
 * requester's own item, governed by the portal predicate.
 */
export type LinkedWorkItemReach = {
  reaches(row: {
    projectId: string;
    workspaceId: string;
    organisationId: string | null;
  }): Promise<boolean>;
};

export async function reachableLinkedWorkItemId(
  reach: LinkedWorkItemReach,
  workItemId: string | null,
): Promise<string | null> {
  if (!workItemId) return null;
  const owner = await findWorkItemProjectOwner(workItemId);
  return owner && (await reach.reaches(owner)) ? workItemId : null;
}
