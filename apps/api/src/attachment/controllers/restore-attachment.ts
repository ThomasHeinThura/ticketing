import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../../instance/observability/runtime";
import { getObjectSizeAndHeader } from "../../storage";
import { attachmentDeletionAccess, loadAttachmentCaller } from "../access";
import {
  lockAttachmentRestoreParent,
  lockRecoverableAttachment,
  restoreAttachmentRow,
} from "../repository";

export type RestoreAttachmentInput = {
  attachmentId: string;
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
  identity: ResolvedIdentity | null;
};

/**
 * AT-7: recover a soft-deleted file within 24 hours. The parent/comment/attachment locks
 * match `attachment-gc`'s order so either GC removes the row/object first, or restore makes
 * the row ineligible before GC can delete the object. Storage locators never leave here.
 */
export async function restoreAttachment(input: RestoreAttachmentInput) {
  let auditFailed = false;
  const restored = await db.transaction(async (tx) => {
    const target = await lockAttachmentRestoreParent(tx, {
      attachmentId: input.attachmentId,
    });
    if (!target)
      throw new HTTPException(404, { message: "Attachment not found" });

    const [attachment] = await lockRecoverableAttachment(tx, {
      id: input.attachmentId,
      workItemId: target.item.id,
      workspaceId: target.item.workspaceId,
      commentId: target.attachment.commentId,
    });
    if (!attachment || attachment.objectKey !== target.attachment.objectKey)
      throw new HTTPException(404, { message: "Attachment not found" });
    // A `pending` upload can itself be soft-deleted by the legacy endpoint. Its original
    // upload key was never checked against size/magic bytes and must not become downloadable.
    if (!attachment.objectKey.includes(`/attachment/${attachment.id}/final/`))
      throw new HTTPException(409, {
        message: "Attachment upload was not completed",
      });

    const caller = await loadAttachmentCaller(tx, input.identity, {
      workspaceId: target.item.workspaceId,
      projectId: target.item.projectId,
      workItemId: target.item.id,
    });
    if (!attachmentDeletionAccess(caller, attachment).mayDelete)
      throw new HTTPException(403, {
        message: "Insufficient attachment restore permission",
      });

    let storedSize: number | undefined;
    try {
      // Head-only check: never mint a download URL or return the internal object key.
      storedSize = (await getObjectSizeAndHeader(attachment.objectKey, 0))
        .contentLength;
    } catch {
      throw new HTTPException(409, {
        message: "Attachment is no longer recoverable",
      });
    }
    if (storedSize === undefined || storedSize !== attachment.size)
      throw new HTTPException(409, {
        message: "Attachment is no longer recoverable",
      });

    const [restored] = await restoreAttachmentRow(tx, { id: attachment.id });
    if (!restored)
      throw new HTTPException(409, {
        message: "Attachment recovery window has expired",
      });

    try {
      // AU-14: the audit write has its own savepoint; failure never rolls back restore.
      await tx.transaction(async (auditTx) =>
        appendAuditLog(auditTx, {
          actorId: input.actorId,
          actorType: input.actorType,
          apiKeyId: input.apiKeyId,
          workspaceId: target.item.workspaceId,
          projectId: target.item.projectId,
          organisationId: target.project.organisationId,
          action: "attachment.restored",
          entityType: "attachment",
          entityId: restored.id,
          after: {
            attachmentId: restored.id,
            workItemId: target.item.id,
            workspaceId: target.item.workspaceId,
          },
        }),
      );
    } catch {
      auditFailed = true;
      recordAuditWriteFailure("mutation");
    }
    return {
      ...restored,
      parentWorkItemId: target.item.id,
      canDelete: attachmentDeletionAccess(caller, restored).canDelete,
      canRestore: false,
    };
  });
  if (auditFailed) await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return restored;
}

export default restoreAttachment;
