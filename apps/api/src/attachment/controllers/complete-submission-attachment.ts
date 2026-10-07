import { and, eq, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import {
  deleteStorageObject,
  finalizeStorageObject,
  getObjectSizeAndHeader,
  toFinalAttachmentObjectKey,
} from "../../storage";
import { magicBytesMatchDeclaredMime } from "../magic-bytes";

const MAX_SNIFF_BYTES = 512;
const FALLBACK_MAX_BYTES = 25 * 1024 * 1024;

export async function completeSubmissionAttachment(input: {
  attachmentId: string;
  submissionId: string;
  submissionWorkItemId: string | null;
  requesterId: string;
  workspaceId: string;
}) {
  const result = await db
    .transaction(async (tx) => {
      const [submission] = await tx
        .select({
          id: schema.submissionTable.id,
          requesterId: schema.submissionTable.requesterId,
          state: schema.submissionTable.state,
          workItemId: schema.submissionTable.workItemId,
        })
        .from(schema.submissionTable)
        .innerJoin(
          schema.requestTypeTable,
          eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
        )
        .where(
          and(
            eq(schema.submissionTable.id, input.submissionId),
            eq(schema.submissionTable.requesterId, input.requesterId),
            eq(schema.requestTypeTable.workspaceId, input.workspaceId),
          ),
        )
        .for("update", { of: schema.submissionTable })
        .limit(1);
      if (!submission)
        throw new HTTPException(404, { message: "Submission not found" });
      const acceptedParentId =
        submission.state === "accepted" &&
        submission.workItemId === input.submissionWorkItemId
          ? submission.workItemId
          : null;
      if (
        submission.state !== "new" &&
        submission.state !== "clarifying" &&
        !acceptedParentId
      )
        throw new HTTPException(404, { message: "Submission not found" });
      const [attachment] = await tx
        .select()
        .from(schema.attachmentTable)
        .where(
          and(
            eq(schema.attachmentTable.id, input.attachmentId),
            eq(schema.attachmentTable.workspaceId, input.workspaceId),
            acceptedParentId
              ? or(
                  eq(schema.attachmentTable.submissionId, input.submissionId),
                  eq(schema.attachmentTable.workItemId, acceptedParentId),
                )
              : eq(schema.attachmentTable.submissionId, input.submissionId),
          ),
        )
        .for("update")
        .limit(1);
      if (!attachment)
        throw new HTTPException(404, { message: "Attachment not found" });
      if (attachment.state !== "pending")
        throw new HTTPException(409, {
          message: `Attachment is already "${attachment.state}", not "pending".`,
        });
      const [settings] = await tx
        .select({ maxBytes: schema.instanceSettingTable.attachmentMaxBytes })
        .from(schema.instanceSettingTable)
        .limit(1);
      const maxBytes = settings?.maxBytes ?? FALLBACK_MAX_BYTES;
      const finalKey = toFinalAttachmentObjectKey(attachment.objectKey);
      await finalizeStorageObject(attachment.objectKey, finalKey).catch(() => {
        throw new HTTPException(400, {
          message:
            "Upload not found in storage -- the presigned URL was never used, or the upload never finished.",
        });
      });
      const { contentLength, header } = await getObjectSizeAndHeader(
        finalKey,
        MAX_SNIFF_BYTES,
      ).catch(() => {
        throw new HTTPException(400, {
          message:
            "Upload not found in storage -- the presigned URL was never used, or the upload never finished.",
        });
      });
      if (contentLength === undefined || contentLength > maxBytes) {
        await tx
          .delete(schema.attachmentTable)
          .where(
            and(
              eq(schema.attachmentTable.id, attachment.id),
              eq(schema.attachmentTable.state, "pending"),
            ),
          );
        return {
          finalKey,
          error:
            contentLength === undefined
              ? "The uploaded file's size could not be determined."
              : `The uploaded file is ${Math.ceil(contentLength / (1024 * 1024))} MB; the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
        };
      }
      if (!magicBytesMatchDeclaredMime(header, attachment.mimeType)) {
        await tx
          .delete(schema.attachmentTable)
          .where(
            and(
              eq(schema.attachmentTable.id, attachment.id),
              eq(schema.attachmentTable.state, "pending"),
            ),
          );
        return {
          finalKey,
          error: `The uploaded file's content does not match its declared type (${attachment.mimeType}).`,
        };
      }
      const [ready] = await tx
        .update(schema.attachmentTable)
        .set({ state: "ready", size: contentLength, objectKey: finalKey })
        .where(
          and(
            eq(schema.attachmentTable.id, attachment.id),
            eq(schema.attachmentTable.state, "pending"),
          ),
        )
        .returning();
      if (!ready)
        return {
          finalKey,
          error: "Attachment changed before upload completion",
        };
      return { attachment: ready, finalKey };
    })
    .catch(async (error: unknown) => {
      if (error instanceof HTTPException && error.status === 400) {
        // The final object is unreferenced whenever verification fails.
        const [row] = await db
          .select({ objectKey: schema.attachmentTable.objectKey })
          .from(schema.attachmentTable)
          .where(eq(schema.attachmentTable.id, input.attachmentId))
          .limit(1);
        if (row)
          await deleteStorageObject(
            toFinalAttachmentObjectKey(row.objectKey),
          ).catch(() => {});
      }
      throw error;
    });
  if ("error" in result) {
    await deleteStorageObject(result.finalKey).catch(() => {});
    throw new HTTPException(400, { message: result.error });
  }
  return result.attachment;
}
