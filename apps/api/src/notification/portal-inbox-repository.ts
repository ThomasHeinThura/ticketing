import { formatSubmissionReference } from "@taskdesk/domain";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import db, { schema } from "../database";

type InboxRow = {
  notification: {
    id: string;
    kind: string | null;
    resourceType: string | null;
    resourceId: string | null;
  };
};

export type PortalNotificationTarget = {
  /** Null for an approval row, which links to the portal Approvals screen (AP-19/AP-21). */
  requestRef: string | null;
  commentId: string | null;
};

/** Resolve safe portal request links only through an accepted request owned by the caller. */
export async function resolvePortalNotificationTargets(
  rows: readonly InboxRow[],
  requesterId: string,
): Promise<Map<string, PortalNotificationTarget>> {
  const directSubmissionIds = new Set<string>();
  const commentIds = new Set<string>();
  const workItemRefs = new Set<string>();
  for (const { notification } of rows) {
    if (!notification.resourceId) continue;
    if (notification.resourceType === "submission")
      directSubmissionIds.add(notification.resourceId);
    else if (notification.resourceType === "comment")
      commentIds.add(notification.resourceId);
    else if (notification.resourceType === "work_item")
      workItemRefs.add(notification.resourceId);
  }

  const [directSubmissions, comments, referencedWorkItems] = await Promise.all([
    directSubmissionIds.size
      ? db
          .select({
            id: schema.submissionTable.id,
            number: schema.submissionTable.number,
          })
          .from(schema.submissionTable)
          .where(
            and(
              inArray(schema.submissionTable.id, [...directSubmissionIds]),
              eq(schema.submissionTable.requesterId, requesterId),
            ),
          )
      : [],
    commentIds.size
      ? db
          .select({
            id: schema.commentTable.id,
            workItemId: schema.commentTable.workItemId,
          })
          .from(schema.commentTable)
          .where(
            and(
              inArray(schema.commentTable.id, [...commentIds]),
              eq(schema.commentTable.visibility, "public"),
              isNull(schema.commentTable.deletedAt),
            ),
          )
      : [],
    workItemRefs.size
      ? db
          .select({
            id: schema.workItemTable.id,
            key: schema.workItemTable.key,
          })
          .from(schema.workItemTable)
          .where(
            or(
              inArray(schema.workItemTable.id, [...workItemRefs]),
              inArray(schema.workItemTable.key, [...workItemRefs]),
            ),
          )
      : [],
  ]);

  const itemIds = new Set([
    ...referencedWorkItems.map((row) => row.id),
    ...comments.map((row) => row.workItemId),
  ]);
  const linkedSubmissions = itemIds.size
    ? await db
        .select({
          id: schema.submissionTable.id,
          number: schema.submissionTable.number,
          workItemId: schema.submissionTable.workItemId,
        })
        .from(schema.submissionTable)
        .where(
          and(
            eq(schema.submissionTable.requesterId, requesterId),
            eq(schema.submissionTable.state, "accepted"),
            inArray(schema.submissionTable.workItemId, [...itemIds]),
          ),
        )
    : [];

  const targetBySubmissionId = new Map(
    [...directSubmissions, ...linkedSubmissions].map((submission) => [
      submission.id,
      formatSubmissionReference(submission.number),
    ]),
  );
  const targetByWorkItemId = new Map(
    linkedSubmissions.flatMap((submission) =>
      submission.workItemId
        ? [
            [
              submission.workItemId,
              formatSubmissionReference(submission.number),
            ] as const,
          ]
        : [],
    ),
  );
  // Resolve both canonical ids and legacy keys without returning either to the portal.
  const itemRefToId = new Map<string, string>();
  for (const item of referencedWorkItems) {
    itemRefToId.set(item.id, item.id);
    itemRefToId.set(item.key, item.id);
  }

  const commentWorkItemById = new Map(
    comments.map((comment) => [comment.id, comment.workItemId]),
  );
  const result = new Map<string, PortalNotificationTarget>();
  for (const { notification } of rows) {
    const resourceId = notification.resourceId;
    if (!resourceId) continue;
    // `P2R1-04`: the inbox read predicate already admits only the addressed customer approver
    // of a reachable customer approval; the row carries no request reference or internal id.
    if (notification.resourceType === "approval") {
      result.set(notification.id, { requestRef: null, commentId: null });
      continue;
    }
    const ref =
      notification.resourceType === "submission"
        ? targetBySubmissionId.get(resourceId)
        : notification.resourceType === "comment"
          ? targetByWorkItemId.get(commentWorkItemById.get(resourceId) ?? "")
          : notification.resourceType === "work_item"
            ? targetByWorkItemId.get(itemRefToId.get(resourceId) ?? resourceId)
            : undefined;
    if (!ref) continue;
    result.set(notification.id, {
      requestRef: ref,
      commentId: notification.resourceType === "comment" ? resourceId : null,
    });
  }
  return result;
}
