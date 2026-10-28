import type { ResolvedIdentity } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import db, { schema } from "../../database";
import { attachmentDeletionAccess, loadAttachmentCaller } from "../access";
import { listWorkItemAttachments as listRows } from "../repository";

/** Live files and authoritative per-viewer deletion controls; tombstones remain hidden. */
export async function listWorkItemAttachments(
  identity: ResolvedIdentity | null,
  workItemId: string,
  options: {
    allowArchivedForRead?: true;
    lifecycle?: "live" | "recoverable";
  } = {},
) {
  return db.transaction(
    async (tx) => {
      const rows = await listRows(tx, identity, workItemId, options);
      if (rows.length === 0) return [];
      const [item] = await tx
        .select({
          workspaceId: schema.workItemTable.workspaceId,
          projectId: schema.workItemTable.projectId,
          archivedAt: schema.workItemTable.archivedAt,
          deletedAt: schema.workItemTable.deletedAt,
          projectArchivedAt: schema.projectTable.archivedAt,
          projectDeletedAt: schema.projectTable.deletedAt,
        })
        .from(schema.workItemTable)
        .innerJoin(
          schema.projectTable,
          eq(schema.projectTable.id, schema.workItemTable.projectId),
        )
        .where(eq(schema.workItemTable.id, workItemId));
      const caller = item
        ? await loadAttachmentCaller(tx, identity, { ...item, workItemId })
        : null;
      // Read permission may include archives even for a live item. Derive mutability
      // from the persisted lifecycle, never from that broader read admission option.
      const mutable = Boolean(
        item &&
          !item.archivedAt &&
          !item.deletedAt &&
          !item.projectArchivedAt &&
          !item.projectDeletedAt,
      );
      return rows.map((row) => ({
        ...row,
        // Deletion approval resolves work-item parents only (the pending-action target
        // loader rejects comment-parented files), so no delete control is offered for them.
        canDelete:
          mutable &&
          row.commentId === null &&
          attachmentDeletionAccess(caller, row).canDelete,
        canRestore:
          mutable &&
          options.lifecycle === "recoverable" &&
          attachmentDeletionAccess(caller, row).mayDelete,
      }));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export default listWorkItemAttachments;
