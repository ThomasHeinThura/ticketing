import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { attachmentTable, instanceSettingTable } from "../../database/schema";
import { deleteStorageObject, getPrivateObject } from "../../storage";
import { recordWorkItemActivity } from "../../work-item/activity";
import { magicBytesMatchDeclaredMime } from "../magic-bytes";

const SNIFF_BYTES = 512;

// Same fallback as `presign-attachment.ts`'s own `FALLBACK_MAX_BYTES` -- only used when
// the singleton `instance_setting` row is somehow missing (never true after a real boot).
const FALLBACK_MAX_BYTES = 25 * 1024 * 1024;

export type CompleteAttachmentInput = {
  attachmentId: string;
  workspaceId: string;
  workItemId: string;
  actorId: string;
  actorType: "person" | "api_key";
};

/**
 * `POST /api/attachments/{id}/complete` (`attachments.md` AT-2's edge case: "Declared
 * MIME does not match magic bytes | Rejected at `complete`; the object is deleted").
 * Reads the object BACK from storage (never trusts the client's own "I uploaded it"
 * claim) and only marks the row `ready` once its bytes actually agree with the
 * declared `mime_type`.
 */
export async function completeAttachment(input: CompleteAttachmentInput) {
  const { attachmentId, workspaceId, workItemId, actorId, actorType } = input;

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

  if (attachment.state !== "pending") {
    throw new HTTPException(409, {
      message: `Attachment is already "${attachment.state}", not "pending".`,
    });
  }

  const object = await getPrivateObject(attachment.objectKey).catch(() => {
    throw new HTTPException(400, {
      message:
        "Upload not found in storage -- the presigned URL was never used, or the upload never finished.",
    });
  });

  const buffer = Buffer.from(
    await new Response(object.body as BodyInit).arrayBuffer(),
  );

  if (
    !magicBytesMatchDeclaredMime(
      buffer.subarray(0, SNIFF_BYTES),
      attachment.mimeType,
    )
  ) {
    await deleteStorageObject(attachment.objectKey).catch(() => {});
    await db
      .delete(attachmentTable)
      .where(eq(attachmentTable.id, attachmentId));
    throw new HTTPException(400, {
      message: `The uploaded file's content does not match its declared type (${attachment.mimeType}).`,
    });
  }

  // Re-check the actual stored size against `attachment_max_bytes` -- `presign`'s own
  // check only bounds the CLAIMED size, and the S3 driver's presigned PUT has no
  // `content-length-range` condition (`storage/s3.ts`'s own comment), so a caller could
  // otherwise upload an arbitrarily large object and have it recorded as "ready".
  const [settings] = await db
    .select({ maxBytes: instanceSettingTable.attachmentMaxBytes })
    .from(instanceSettingTable)
    .limit(1);
  const maxBytes = settings?.maxBytes ?? FALLBACK_MAX_BYTES;

  if (buffer.length > maxBytes) {
    await deleteStorageObject(attachment.objectKey).catch(() => {});
    await db
      .delete(attachmentTable)
      .where(eq(attachmentTable.id, attachmentId));
    throw new HTTPException(400, {
      message: `The uploaded file is ${Math.ceil(buffer.length / (1024 * 1024))} MB; the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    });
  }

  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(attachmentTable)
      .set({ state: "ready", size: buffer.length })
      .where(eq(attachmentTable.id, attachmentId))
      .returning();

    await recordWorkItemActivity(tx, [
      {
        workspaceId,
        workItemId,
        actorId,
        actorType,
        verb: "attachment.added",
        payload: { attachmentId, filename: attachment.filename },
        // CA-7: `attachment.added` is public only for a customer-visible attachment.
        visibility: attachment.customerVisible ? "public" : "internal",
      },
    ]);

    return rows;
  });

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to complete attachment" });
  }

  return updated;
}

export default completeAttachment;
