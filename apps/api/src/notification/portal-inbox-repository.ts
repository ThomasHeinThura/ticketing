import { formatSubmissionReference } from "@taskdesk/domain";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import db, { schema } from "../database";
import {
  type CustomerPortalScope,
  customerPortalOnFor,
  customerPortalScope,
} from "../feature-flag/enforce";
import { findReadableDirectCaseRefs } from "../intake/portal-cases";
import {
  loadPortalViewer,
  portalSubmissionProjectPredicateForActor,
} from "../intake/repository";
import { listVisibleNotificationInbox } from "./inbox.repository";

type InboxRow = {
  notification: {
    id: string;
    kind: string | null;
    resourceType: string | null;
    resourceId: string | null;
  };
};

export type PortalNotificationTarget = {
  /**
   * What the row opens: an accepted or open submission (`/submissions/{ref}`), a request staff
   * raised for the customer (`/requests/{ref}`, U-12), or the portal Approvals screen.
   */
  targetKind: "submission" | "request" | "approval";
  /** Null for an approval row, which links to the portal Approvals screen (AP-19/AP-21). */
  requestRef: string | null;
  commentId: string | null;
};

/**
 * Resolve safe portal links only through a request the caller may open: their own submission
 * (or the accepted submission behind a work item), else a direct request the case list shows
 * them (`findReadableDirectCaseRefs`, `CP-16`). Anything else gets no target and is not listed.
 */
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
              portalSubmissionProjectPredicateForActor(requesterId, db),
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
            portalSubmissionProjectPredicateForActor(requesterId, db),
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
  // U-12: a work item with no accepted submission of the caller may be a direct request.
  const directCandidates = [...itemIds].filter(
    (id) => !targetByWorkItemId.has(id),
  );
  const directRefByWorkItemId = directCandidates.length
    ? await findReadableDirectCaseRefs(
        await loadPortalViewer(requesterId),
        directCandidates,
      )
    : new Map<string, string>();

  const result = new Map<string, PortalNotificationTarget>();
  for (const { notification } of rows) {
    const resourceId = notification.resourceId;
    if (!resourceId) continue;
    // `P2R1-04`: the inbox read predicate already admits only the addressed customer approver
    // of a reachable customer approval; the row carries no request reference or internal id.
    if (notification.resourceType === "approval") {
      result.set(notification.id, {
        targetKind: "approval",
        requestRef: null,
        commentId: null,
      });
      continue;
    }
    const commentId =
      notification.resourceType === "comment" ? resourceId : null;
    if (notification.resourceType === "submission") {
      const ref = targetBySubmissionId.get(resourceId);
      if (ref)
        result.set(notification.id, {
          targetKind: "submission",
          requestRef: ref,
          commentId,
        });
      continue;
    }
    const workItemId =
      notification.resourceType === "comment"
        ? commentWorkItemById.get(resourceId)
        : notification.resourceType === "work_item"
          ? (itemRefToId.get(resourceId) ?? resourceId)
          : undefined;
    if (!workItemId) continue;
    const submissionRef = targetByWorkItemId.get(workItemId);
    const directRef = directRefByWorkItemId.get(workItemId);
    if (submissionRef)
      result.set(notification.id, {
        targetKind: "submission",
        requestRef: submissionRef,
        commentId,
      });
    else if (directRef)
      result.set(notification.id, {
        targetKind: "request",
        requestRef: directRef,
        commentId,
      });
  }
  return result;
}

type ScopedNotification = {
  id: string;
  resourceType: string | null;
  resourceId: string | null;
};

/**
 * The workspace and (when it has one) project behind each customer notification's resource:
 * a work item (by id or legacy key), a comment's work item, a submission's converted work item
 * or else its request type's workspace, and an approval's work item. Rows whose resource cannot
 * be placed are left out.
 */
async function portalNotificationScopes(
  rows: readonly ScopedNotification[],
): Promise<Map<string, { workspaceId: string; projectId: string | null }>> {
  const ids = (type: string) => [
    ...new Set(
      rows.flatMap((row) =>
        row.resourceType === type && row.resourceId ? [row.resourceId] : [],
      ),
    ),
  ];
  const workItemRefs = ids("work_item");
  const commentIds = ids("comment");
  const submissionIds = ids("submission");
  const approvalIds = ids("approval");
  const [items, comments, submissions, approvals] = await Promise.all([
    workItemRefs.length
      ? db
          .select({
            id: schema.workItemTable.id,
            key: schema.workItemTable.key,
            workspaceId: schema.workItemTable.workspaceId,
            projectId: schema.workItemTable.projectId,
          })
          .from(schema.workItemTable)
          .where(
            or(
              inArray(schema.workItemTable.id, workItemRefs),
              inArray(schema.workItemTable.key, workItemRefs),
            ),
          )
      : [],
    commentIds.length
      ? db
          .select({
            id: schema.commentTable.id,
            workspaceId: schema.workItemTable.workspaceId,
            projectId: schema.workItemTable.projectId,
          })
          .from(schema.commentTable)
          .innerJoin(
            schema.workItemTable,
            eq(schema.workItemTable.id, schema.commentTable.workItemId),
          )
          .where(inArray(schema.commentTable.id, commentIds))
      : [],
    submissionIds.length
      ? db
          .select({
            id: schema.submissionTable.id,
            workspaceId: schema.requestTypeTable.workspaceId,
            projectId: schema.workItemTable.projectId,
          })
          .from(schema.submissionTable)
          .innerJoin(
            schema.requestTypeTable,
            eq(
              schema.requestTypeTable.id,
              schema.submissionTable.requestTypeId,
            ),
          )
          .leftJoin(
            schema.workItemTable,
            eq(schema.workItemTable.id, schema.submissionTable.workItemId),
          )
          .where(inArray(schema.submissionTable.id, submissionIds))
      : [],
    approvalIds.length
      ? db
          .select({
            id: schema.approvalTable.id,
            workspaceId: schema.approvalTable.workspaceId,
            projectId: schema.workItemTable.projectId,
          })
          .from(schema.approvalTable)
          .innerJoin(
            schema.workItemTable,
            eq(schema.workItemTable.id, schema.approvalTable.workItemId),
          )
          .where(inArray(schema.approvalTable.id, approvalIds))
      : [],
  ]);
  const byKey = new Map<string, { workspaceId: string; projectId: string }>();
  for (const item of items) {
    byKey.set(item.id, item);
    byKey.set(item.key, item);
  }
  const placed = new Map<
    string,
    { workspaceId: string; projectId: string | null }
  >();
  const of = new Map<
    string,
    Map<string, { workspaceId: string; projectId: string | null }>
  >([
    ["work_item", byKey],
    ["comment", new Map(comments.map((row) => [row.id, row]))],
    ["submission", new Map(submissions.map((row) => [row.id, row]))],
    ["approval", new Map(approvals.map((row) => [row.id, row]))],
  ]);
  for (const row of rows) {
    if (!row.resourceType || !row.resourceId) continue;
    const scope = of.get(row.resourceType)?.get(row.resourceId);
    if (scope) placed.set(row.id, scope);
  }
  return placed;
}

/**
 * P4R2-M2 (round 3): the notifications a customer may see on the portal are those whose
 * resource sits in a project (or workspace) with `feature.customer_portal` on. Returns the
 * admitted notification ids; an unreadable flag set admits none (fail closed).
 */
export async function admitPortalNotifications(
  rows: ReadonlyArray<{ notification: ScopedNotification }>,
  scope?: CustomerPortalScope | null,
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const flags = scope === undefined ? await customerPortalScope() : scope;
  if (!flags) return new Set();
  const placed = await portalNotificationScopes(
    rows.map((row) => row.notification),
  );
  const admitted = new Set<string>();
  for (const [id, where] of placed)
    if (customerPortalOnFor(flags, where.workspaceId, where.projectId))
      admitted.add(id);
  return admitted;
}

/** How far back the realtime check looks for the notification that triggered a push. */
const RECENT_NOTIFICATION_WINDOW_MS = 60_000;

/**
 * Whether a payload-free realtime invalidation may be pushed to this customer: at least one of
 * their readable notifications from the last minute belongs to a project they reach with the
 * customer portal on. A push caused only by an off workspace or ungranted project is dropped.
 */
export async function portalRealtimeAdmitted(userId: string): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - RECENT_NOTIFICATION_WINDOW_MS);
    const inbox = await listVisibleNotificationInbox({
      userId,
      credentialCanReadTask: false,
      filter: "all",
      limit: 20,
      admit: (rows) => admitPortalNotifications(rows),
    });
    const recent = inbox.rows.filter(
      ({ notification }) => notification.createdAt >= cutoff,
    );
    return recent.length > 0;
  } catch {
    return false;
  }
}
