import type { ResolvedIdentity } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workItemTable } from "../../database/schema";
import { logTaskDesk } from "../../instance/observability/runtime";
import {
  attachmentUploadUrlTtlSeconds,
  deleteStorageObject,
  FinalizeOutcomeUnknownError,
  finalizeStorageObject,
  getObjectSizeAndHeader,
  getStorageBackendFingerprint,
  toFinalAttachmentObjectKey,
} from "../../storage";
import {
  consumeCompletionIntent,
  dropSettledCompletionIntent,
  queueVacatedUploadKey,
  reserveCompletionIntent,
} from "../../utils/attachment-object-queue";
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

const NOT_FOUND_MESSAGE =
  "Upload not found in storage -- the presigned URL was never used, or the upload never finished.";
const UPLOAD_UNCONFIRMED_MESSAGE =
  "This upload could not be confirmed; upload the file again.";
const INTENT_UNAVAILABLE_MESSAGE =
  "Could not prepare the upload for completion; try again.";
const STORAGE_UNCONFIRMED_MESSAGE =
  "Storage did not confirm the upload; try again.";
const INTENT_CONSUMED_MESSAGE =
  "Upload cleanup state changed; upload the file again.";

type CompleteSubmissionAttachmentInput = {
  attachmentId: string;
  submissionId: string;
  submissionWorkItemId: string | null;
  requesterId: string;
  workspaceId: string;
  identity: ResolvedIdentity | null;
};

/**
 * The scoped, locked authorization read shared by Phase A and Phase D: the submission row, then
 * the attachment row (both FOR UPDATE), with the accepted parent recomputed from the CURRENT
 * submission state and work item.
 */
async function authorizeSubmissionCompletion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: CompleteSubmissionAttachmentInput,
) {
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
  return { attachment, acceptedParentId };
}

/**
 * Submission upload completion, in four phases that each hold at most one pooled connection and
 * release it before the next (PTM-06; no phase acquires a second connection while holding one):
 *  A. a short authorization transaction (no storage call);
 *  B. the durable intent reservation, its own short transaction on the module pool;
 *  C. storage I/O with no connection and no lock held;
 *  D. a ready transaction that re-validates everything before it writes.
 * Phase D rejects, and never deletes the pending row, when the caller is no longer authorized:
 * the hourly pending cleanup owns that row.
 */
export async function completeSubmissionAttachment(
  input: CompleteSubmissionAttachmentInput,
) {
  // Phase A: authorize, capture the pending key and the size limit, then COMMIT.
  const authorized = await db.transaction(async (tx) => {
    const { attachment } = await authorizeSubmissionCompletion(tx, input);
    const [settings] = await getSubmissionAttachmentSizeLimit(tx);
    return {
      attachmentId: attachment.id,
      pendingKey: attachment.objectKey,
      mimeType: attachment.mimeType,
      maxBytes: settings?.maxBytes ?? FALLBACK_MAX_BYTES,
    };
  });
  const { pendingKey, mimeType, maxBytes } = authorized;
  const attachmentId = authorized.attachmentId;
  // Only the locator captured after the scoped, locked authorization read is ever deleted.
  const finalKey = toFinalAttachmentObjectKey(pendingKey);

  // Phase B: reserve the durable intent (its own short transaction, outside any other).
  let backend: string;
  try {
    backend = getStorageBackendFingerprint();
    const reserved = await reserveCompletionIntent({
      objectKey: finalKey,
      attachmentId,
      workspaceId: input.workspaceId,
      backend,
    });
    if (reserved === "cap")
      throw new HTTPException(409, { message: UPLOAD_UNCONFIRMED_MESSAGE });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(503, { message: INTENT_UNAVAILABLE_MESSAGE });
  }
  let settled = true;
  let stable = true;
  const backendUnchanged = () => {
    try {
      return getStorageBackendFingerprint() === backend;
    } catch {
      return false;
    }
  };
  // Every exit below deletes only this call's own random final key; the intent is dropped only
  // after a settled outcome, a successful delete and an unchanged backend fingerprint.
  const cleanUp = async () => {
    const deleted = await deleteStorageObject(finalKey).then(
      () => true,
      () => false,
    );
    if (settled && deleted && stable && backendUnchanged())
      await dropSettledCompletionIntent(db, {
        objectKey: finalKey,
        attachmentId,
        backend,
      }).catch(() => {});
  };

  let result: Awaited<ReturnType<typeof readyTransaction>>;
  try {
    // Phase C: storage I/O, no connection held.
    await finalizeStorageObject(pendingKey, finalKey).catch(
      (error: unknown) => {
        stable = backendUnchanged();
        if (error instanceof FinalizeOutcomeUnknownError) {
          settled = false;
          throw new HTTPException(503, {
            message: STORAGE_UNCONFIRMED_MESSAGE,
          });
        }
        throw new HTTPException(400, { message: NOT_FOUND_MESSAGE });
      },
    );
    stable = stable && backendUnchanged();
    // P1R2-6: the vacated pending key is removed once its upload credential has expired.
    await queueVacatedUploadKey(db, {
      objectKey: pendingKey,
      workspaceId: input.workspaceId,
      ttlSeconds: attachmentUploadUrlTtlSeconds(),
    }).catch(() => {});
    const { contentLength, header } = await getObjectSizeAndHeader(
      finalKey,
      MAX_SNIFF_BYTES,
    ).catch(() => {
      throw new HTTPException(400, { message: NOT_FOUND_MESSAGE });
    });
    // Phase D: re-validate and write.
    result = await readyTransaction({
      input,
      attachmentId,
      pendingKey,
      finalKey,
      mimeType,
      maxBytes,
      contentLength,
      header,
    });
  } catch (error) {
    await cleanUp();
    throw error;
  }
  if ("error" in result) {
    await cleanUp();
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

/**
 * Phase D. Lock order: submission U -> attachment U -> quota advisory -> attachment UPDATE (the
 * pending-only CAS) -> gc row (consume) -> work_item read (no lock) -> activity insert. A missing
 * row, revoked reach, changed parent or state, a non-pending row or a changed pending key
 * rejects without touching the pending row.
 */
async function readyTransaction(args: {
  input: CompleteSubmissionAttachmentInput;
  attachmentId: string;
  pendingKey: string;
  finalKey: string;
  mimeType: string;
  maxBytes: number;
  contentLength: number | undefined;
  header: Buffer;
}) {
  const { input, attachmentId, pendingKey, finalKey, maxBytes, contentLength } =
    args;
  return await db.transaction(async (tx) => {
    const { attachment, acceptedParentId } =
      await authorizeSubmissionCompletion(tx, input);
    if (attachment.id !== attachmentId || attachment.objectKey !== pendingKey)
      throw new HTTPException(409, {
        message: "Attachment changed before upload completion",
      });
    if (contentLength === undefined || contentLength > maxBytes) {
      await deletePendingSubmissionAttachment(tx, attachment.id);
      return {
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
      return { error: STORAGE_QUOTA_MESSAGE, status: 429 as const };
    }
    if (!magicBytesMatchDeclaredMime(args.header, args.mimeType)) {
      await deletePendingSubmissionAttachment(tx, attachment.id);
      return {
        error: `The uploaded file's content does not match its declared type (${args.mimeType}).`,
      };
    }
    const [ready] = await markSubmissionAttachmentReady(tx, {
      id: attachment.id,
      size: contentLength,
      objectKey: finalKey,
    });
    if (!ready) return { error: "Attachment changed before upload completion" };
    // PTM-06: consume the intent atomically with `ready`; a missing intent rolls this back.
    if (
      !(await consumeCompletionIntent(tx, {
        objectKey: finalKey,
        attachmentId: attachment.id,
        workspaceId: input.workspaceId,
      }))
    )
      throw new HTTPException(409, { message: INTENT_CONSUMED_MESSAGE });
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
    return { attachment: ready, reopenWorkItemId };
  });
}
