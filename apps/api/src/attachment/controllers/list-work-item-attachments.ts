import { and, eq, isNull, ne } from "drizzle-orm";
import db from "../../database";
import { attachmentTable } from "../../database/schema";

/**
 * `GET /api/work-items/{key}/attachments`. Excludes soft-deleted rows -- a deleted
 * attachment is recoverable within the GC window (AT-7), but it is gone from the
 * work item's own list the instant it is deleted, not just once the object itself is
 * purged.
 */
export async function listWorkItemAttachments(workItemId: string) {
  return db
    .select()
    .from(attachmentTable)
    .where(
      and(
        eq(attachmentTable.workItemId, workItemId),
        ne(attachmentTable.state, "deleted"),
        isNull(attachmentTable.deletedAt),
      ),
    )
    .orderBy(attachmentTable.createdAt);
}

export default listWorkItemAttachments;
