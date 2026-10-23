import type { ResolvedIdentity } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import db, { schema } from "../../database";
import { attachmentDeletionAccess, loadAttachmentCaller } from "../access";
import { listWorkItemAttachments as listRows } from "../repository";

/** Live files and authoritative per-viewer deletion controls; tombstones remain hidden. */
export async function listWorkItemAttachments(
  identity: ResolvedIdentity | null,
  workItemId: string,
) {
  return db.transaction(
    async (tx) => {
      const rows = await listRows(tx, identity, workItemId);
      if (rows.length === 0) return [];
      const [item] = await tx
        .select({
          workspaceId: schema.workItemTable.workspaceId,
          projectId: schema.workItemTable.projectId,
        })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, workItemId));
      const caller = item
        ? await loadAttachmentCaller(tx, identity, { ...item, workItemId })
        : null;
      return rows.map((row) => ({
        ...row,
        canDelete: attachmentDeletionAccess(caller, row).canDelete,
      }));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export default listWorkItemAttachments;
