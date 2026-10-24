import { eq, inArray, or } from "drizzle-orm";
import db, { schema } from "../database";

type LinkRow = {
  id: string;
  resourceType: string | null;
  resourceId: string | null;
};

/**
 * `NO-14`: the work item a notification is about, so the client can deep-link to the exact
 * thing (the comment, not just the item). Rows reaching here are already reach-filtered by the
 * inbox read; this only maps the resource to its work-item key. A `work_item` resource id may
 * be the item's id or its key; a `comment` or `approval` resolves through its owning item.
 * Anything else (workspace, pending action, instance, person) has no work item and is absent
 * from the result. Keyed by notification id.
 */
export async function resolveNotificationWorkItemKeys(
  rows: readonly LinkRow[],
): Promise<Map<string, string>> {
  const resourceIds = (type: string) => [
    ...new Set(
      rows
        .filter((r) => r.resourceType === type && r.resourceId)
        .map((r) => r.resourceId as string),
    ),
  ];
  const workItemRefs = resourceIds("work_item");
  const commentIds = resourceIds("comment");
  const approvalIds = resourceIds("approval");

  const [items, comments, approvals] = await Promise.all([
    workItemRefs.length
      ? db
          .select({
            id: schema.workItemTable.id,
            key: schema.workItemTable.key,
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
            key: schema.workItemTable.key,
          })
          .from(schema.commentTable)
          .innerJoin(
            schema.workItemTable,
            eq(schema.commentTable.workItemId, schema.workItemTable.id),
          )
          .where(inArray(schema.commentTable.id, commentIds))
      : [],
    approvalIds.length
      ? db
          .select({
            id: schema.approvalTable.id,
            key: schema.workItemTable.key,
          })
          .from(schema.approvalTable)
          .innerJoin(
            schema.workItemTable,
            eq(schema.approvalTable.workItemId, schema.workItemTable.id),
          )
          .where(inArray(schema.approvalTable.id, approvalIds))
      : [],
  ]);

  const byWorkItemRef = new Map<string, string>();
  for (const item of items) {
    byWorkItemRef.set(item.id, item.key);
    byWorkItemRef.set(item.key, item.key);
  }
  const byComment = new Map(comments.map((c) => [c.id, c.key]));
  const byApproval = new Map(approvals.map((a) => [a.id, a.key]));

  const result = new Map<string, string>();
  for (const row of rows) {
    if (!row.resourceId) continue;
    const key =
      row.resourceType === "work_item"
        ? byWorkItemRef.get(row.resourceId)
        : row.resourceType === "comment"
          ? byComment.get(row.resourceId)
          : row.resourceType === "approval"
            ? byApproval.get(row.resourceId)
            : undefined;
    if (key) result.set(row.id, key);
  }
  return result;
}
