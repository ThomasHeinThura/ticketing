import type { ResolvedIdentity } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workItemTable } from "../../database/schema";
import { logTaskDesk } from "../../instance/observability/runtime";
import {
  attachmentUploadUrlTtlSeconds,
  deleteStorageObject,
  finalizeStorageObject,
  getObjectSizeAndHeader,
  toFinalAttachmentObjectKey,
} from "../../storage";
import { queueVacatedUploadKey } from "../../utils/attachment-object-queue";
import {
  recordReopenRequested,
  requestCustomerReopen,
} from "../../workflow/customer-reopen";
import { magicBytesMatchDeclaredMime } from "../magic-bytes";
import {
  deletePendingSubmissionAttachment,
  findSubmissionCompletionAttachment,
  getSubmissionAttachmentSizeLimit,
  lockSubmissionForCompletion,
  markSubmissionAttachmentReady,
} from "../repository";
import {
  assertOrganisationStorageQuota,
  STORAGE_QUOTA_MESSAGE,
} from "../storage-quota";

const MAX_SNIFF_BYTES = 512;
const FALLBACK_MAX_BYTES = 25 * 1024 * 1024;

export async function completeSubmissionAttachment(input: {
  attachmentId: string;
  submissionId: string;
  submissionWorkItemId: string | null;
  requesterId: string;
  workspaceId: string;
  identity: ResolvedIdentity | null;
}) {
  let authorizedFinalKey: string | undefined;
  const result = await db
    .transaction(async (tx) => {
      const [submission] = await lockSubmissionForCompletion(tx, input);
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
      const [attachment] = await findSubmissionCompletionAttachment(
        tx,
        input.identity,
        {
          id: input.attachmentId,
          workspaceId: input.workspaceId,
          submissionId: input.submissionId,
          acceptedParentId,
          requesterId: input.requesterId,
        },
      );
      if (!attachment)
        throw new HTTPException(404, { message: "Attachment not found" });
      if (attachment.state !== "pending")
        throw new HTTPException(409, {
          message: `Attachment is already "${attachment.state}", not "pending".`,
        });
      authorizedFinalKey = toFinalAttachmentObjectKey(attachment.objectKey);
      const [settings] = await getSubmissionAttachmentSizeLimit(tx);
      const maxBytes = settings?.maxBytes ?? FALLBACK_MAX_BYTES;
      const finalKey = authorizedFinalKey;
      await finalizeStorageObject(attachment.objectKey, finalKey).catch(() => {
        throw new HTTPException(400, {
          message:
            "Upload not found in storage -- the presigned URL was never used, or the upload never finished.",
        });
      });
      // P1R2-6: the vacated pending key is removed once its upload credential has expired.
      await queueVacatedUploadKey(db, {
        objectKey: attachment.objectKey,
        workspaceId: input.workspaceId,
        ttlSeconds: attachmentUploadUrlTtlSeconds(),
      }).catch(() => {});
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
        await deletePendingSubmissionAttachment(tx, attachment.id);
        return {
          finalKey,
          error:
            contentLength === undefined
              ? "The uploaded file's size could not be determined."
              : `The uploaded file is ${Math.ceil(contentLength / (1024 * 1024))} MB; the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
        };
      }
      try {
        await assertOrganisationStorageQuota(tx, {
          workspaceId: input.workspaceId,
          additionalBytes: contentLength,
          excludeAttachmentId: attachment.id,
        });
      } catch (error) {
        if (!(error instanceof HTTPException) || error.status !== 429)
          throw error;
        await deletePendingSubmissionAttachment(tx, attachment.id);
        return { finalKey, error: STORAGE_QUOTA_MESSAGE, status: 429 as const };
      }
      if (!magicBytesMatchDeclaredMime(header, attachment.mimeType)) {
        await deletePendingSubmissionAttachment(tx, attachment.id);
        return {
          finalKey,
          error: `The uploaded file's content does not match its declared type (${attachment.mimeType}).`,
        };
      }
      const [ready] = await markSubmissionAttachmentReady(tx, {
        id: attachment.id,
        size: contentLength,
        objectKey: finalKey,
      });
      if (!ready)
        return {
          finalKey,
          error: "Attachment changed before upload completion",
        };
      // An accepted submission's work item is the only upload parent that can trigger
      // WF-21. Keep the durable customer request beside the ready attachment so a process
      // failure after commit still leaves evidence for staff. The shared system transition
      // runs after commit, through requestCustomerReopen, just as it does for a reply.
      let reopenWorkItemId: string | null = null;
      if (acceptedParentId) {
        const [parent] = await tx
          .select({ resolvedAt: workItemTable.resolvedAt })
          .from(workItemTable)
          .where(eq(workItemTable.id, acceptedParentId))
          .limit(1);
        if (parent?.resolvedAt) {
          reopenWorkItemId = acceptedParentId;
          await recordReopenRequested(tx, {
            workspaceId: input.workspaceId,
            workItemId: acceptedParentId,
            source: "upload",
          });
        }
      }
      return { attachment: ready, finalKey, reopenWorkItemId };
    })
    .catch(async (error: unknown) => {
      if (error instanceof HTTPException && error.status === 400) {
        // Use only the locator captured after the scoped, locked authorization read.
        if (authorizedFinalKey)
          await deleteStorageObject(authorizedFinalKey).catch(() => {});
      }
      throw error;
    });
  if ("error" in result) {
    await deleteStorageObject(result.finalKey).catch(() => {});
    throw new HTTPException("status" in result ? result.status : 400, {
      message: result.error,
    });
  }
  if (result.reopenWorkItemId) {
    try {
      await requestCustomerReopen({
        workItemId: result.reopenWorkItemId,
        source: "upload",
      });
    } catch {
      logTaskDesk({
        module: "jobs",
        message: "jobs.failure",
        level: "error",
        result: "degraded",
      });
    }
  }
  return result.attachment;
}
