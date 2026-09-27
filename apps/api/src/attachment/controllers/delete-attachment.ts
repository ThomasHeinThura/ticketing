import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { attachmentTable, personTable } from "../../database/schema";
import { recordWorkItemActivity } from "../../work-item/activity";

export type DeleteAttachmentInput = {
  attachmentId: string;
  workspaceId: string;
  workItemId: string;
  userId: string;
  actorId: string;
  actorType: "person" | "api_key";
};

/**
 * `DELETE /api/attachments/{id}` (`attachments.md` AT-7: soft delete; the object
 * itself is removed the following night by `attachment-gc`, out of this route's
 * scope -- see the PR body). Only the uploader may delete via this route --
 * `attachment/policy.ts`'s own comment on why `attachment:delete_own`, not
 * `attachment:delete_any`, is the declared capability here.
 *
 * `attachments.md` AT-7 also calls this a pending action requiring the requester's own
 * confirmation -- this codebase has no pending-action mechanism built anywhere yet (a
 * genuine, disclosed gap, same class as #23/#25's own escalations; see the PR body),
 * so this route performs the soft delete directly rather than queuing one.
 */
export async function deleteAttachment(input: DeleteAttachmentInput) {
  const { attachmentId, workspaceId, workItemId, userId, actorId, actorType } =
    input;

  const [person] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);

  const [attachment] = await db
    .select()
    .from(attachmentTable)
    .where(eq(attachmentTable.id, attachmentId))
    .limit(1);

  if (
    !attachment ||
    attachment.workspaceId !== workspaceId ||
    attachment.workItemId !== workItemId
  ) {
    throw new HTTPException(404, { message: "Attachment not found" });
  }

  // Deleting an already-deleted attachment is a no-op success, matching this
  // codebase's own storage-delete idempotence convention (`filesystem.ts`'s
  // `deleteObject`).
  if (attachment.state === "deleted") {
    return attachment;
  }

  if (!person || attachment.uploadedBy !== person.id) {
    throw new HTTPException(403, {
      message: "Only the attachment's own uploader may delete it",
    });
  }

  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(attachmentTable)
      .set({ state: "deleted", deletedAt: new Date() })
      .where(
        and(
          eq(attachmentTable.id, attachmentId),
          eq(attachmentTable.uploadedBy, person.id),
        ),
      )
      .returning();

    if (rows.length > 0) {
      await recordWorkItemActivity(tx, [
        {
          workspaceId,
          workItemId,
          actorId,
          actorType,
          verb: "attachment.deleted",
          payload: { attachmentId, filename: attachment.filename },
        },
      ]);
    }

    return rows;
  });

  if (!updated) {
    throw new HTTPException(403, {
      message: "Only the attachment's own uploader may delete it",
    });
  }

  return updated;
}

export default deleteAttachment;
