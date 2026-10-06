import db from "../../database";
import { listAttachmentsForWorkItem } from "../repository";

/**
 * `GET /api/work-items/{key}/attachments`. Excludes soft-deleted rows -- a deleted
 * attachment is recoverable within the GC window (AT-7), but it is gone from the
 * work item's own list the instant it is deleted, not just once the object itself is
 * purged.
 */
export async function listWorkItemAttachments(workItemId: string) {
  return listAttachmentsForWorkItem(db, workItemId);
}

export default listWorkItemAttachments;
