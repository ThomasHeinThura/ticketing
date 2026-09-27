import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { attachmentTable, instanceSettingTable } from "../../database/schema";
import {
  deleteStorageObject,
  finalizeStorageObject,
  getObjectSizeAndHeader,
  toFinalAttachmentObjectKey,
} from "../../storage";
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

  // Re-check the actual stored size against `attachment_max_bytes` -- `presign`'s own check
  // only bounds the CLAIMED size, and the S3 driver's presigned PUT has no
  // `content-length-range` condition (`storage/s3.ts`'s own comment), so a caller could
  // otherwise upload an arbitrarily large object and have it recorded as "ready".
  const [settings] = await db
    .select({ maxBytes: instanceSettingTable.attachmentMaxBytes })
    .from(instanceSettingTable)
    .limit(1);
  const maxBytes = settings?.maxBytes ?? FALLBACK_MAX_BYTES;

  // B3 security-review fix (2026-09-27): get the real stored size (no body read at all)
  // and only the first SNIFF_BYTES bytes (a bounded, ranged read) -- NOT the entire object
  // buffered into memory, which is what the previous shape did (`new
  // Response(object.body).arrayBuffer()` before ever checking the size), letting one
  // `complete` call on a multi-GB object exhaust process memory.
  const { contentLength, header } = await getObjectSizeAndHeader(
    attachment.objectKey,
    SNIFF_BYTES,
  ).catch(() => {
    throw new HTTPException(400, {
      message:
        "Upload not found in storage -- the presigned URL was never used, or the upload never finished.",
    });
  });

  // Size is checked BEFORE the magic-byte sniff, and before anything else touches the
  // object's content -- the whole point of B3 is to reject an oversized object without
  // ever reading its bytes.
  if (contentLength === undefined || contentLength > maxBytes) {
    await deleteStorageObject(attachment.objectKey).catch(() => {});
    await db
      .delete(attachmentTable)
      .where(eq(attachmentTable.id, attachmentId));
    throw new HTTPException(400, {
      message:
        contentLength === undefined
          ? "The uploaded file's size could not be determined."
          : `The uploaded file is ${Math.ceil(contentLength / (1024 * 1024))} MB; the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    });
  }

  if (!magicBytesMatchDeclaredMime(header, attachment.mimeType)) {
    await deleteStorageObject(attachment.objectKey).catch(() => {});
    await db
      .delete(attachmentTable)
      .where(eq(attachmentTable.id, attachmentId));
    throw new HTTPException(400, {
      message: `The uploaded file's content does not match its declared type (${attachment.mimeType}).`,
    });
  }

  // B2 security-review fix (2026-09-27): the presigned upload URL (same key, same HMAC
  // token) stays valid for the rest of its TTL even after this validation passes -- a
  // second PUT to it would silently replace the just-checked bytes with anything, on
  // both the filesystem driver (opens with O_TRUNC) and S3/MinIO. Moving the object to a
  // key nothing was ever presigned to write to closes that window; the attachment row's
  // own `object_key` is updated to the new location in the same transaction that marks it
  // `ready`, so nothing ever serves from -- or can overwrite -- the vacated pending key
  // again.
  const finalObjectKey = toFinalAttachmentObjectKey(attachment.objectKey);
  await finalizeStorageObject(attachment.objectKey, finalObjectKey);

  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(attachmentTable)
      .set({ state: "ready", size: contentLength, objectKey: finalObjectKey })
      // L5 security-review fix (2026-09-27): the `WHERE state = 'pending'` condition makes
      // the 409-under-concurrency behaviour a real database-level guard rather than
      // something only observed because of the read-then-write check above -- two
      // concurrent `complete` calls now have exactly one winner at the database, not at
      // whichever request happened to read first.
      .where(
        and(
          eq(attachmentTable.id, attachmentId),
          eq(attachmentTable.state, "pending"),
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
          verb: "attachment.added",
          payload: { attachmentId, filename: attachment.filename },
          // CA-7: `attachment.added` is public only for a customer-visible attachment.
          visibility: attachment.customerVisible ? "public" : "internal",
        },
      ]);
    }

    return rows;
  });

  if (!updated) {
    throw new HTTPException(409, {
      message: `Attachment is already "${attachment.state}", not "pending".`,
    });
  }

  return updated;
}

export default completeAttachment;
