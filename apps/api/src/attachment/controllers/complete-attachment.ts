import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Executor } from "../../database/executor";
import { workItemTable } from "../../database/schema";
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
import { recordWorkItemActivity } from "../../work-item/activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../../work-item/assert-work-item-live";
import { magicBytesMatchDeclaredMime } from "../magic-bytes";
import {
  deletePendingWorkItemAttachment,
  findPortalRequestUpload,
  findWorkItemAttachment,
  getAttachmentSizeLimit,
  updateAttachmentReady,
} from "../repository";
import { assertOrganisationStorageQuota } from "../storage-quota";

const SNIFF_BYTES = 512;

// Same fallback as `presign-attachment.ts`'s own `FALLBACK_MAX_BYTES` -- only used when
// the singleton `instance_setting` row is somehow missing (never true after a real boot).
const FALLBACK_MAX_BYTES = 25 * 1024 * 1024;

const UPLOAD_UNCONFIRMED_MESSAGE =
  "This upload could not be confirmed; upload the file again.";
const INTENT_UNAVAILABLE_MESSAGE =
  "Could not prepare the upload for completion; try again.";
const STORAGE_UNCONFIRMED_MESSAGE =
  "Storage did not confirm the upload; try again.";
const INTENT_CONSUMED_MESSAGE =
  "Upload cleanup state changed; upload the file again.";

// FOR SHARE, not UPDATE: it still fences archive/delete but stays compatible with the work_item
// KEY SHARE an activity insert takes, so no cycle with an accepted-submission completion.
async function lockLiveWorkItem(
  tx: Executor,
  input: { workItemId: string; workspaceId: string },
) {
  const [locked] = await tx
    .select({
      projectId: workItemTable.projectId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.id, input.workItemId),
        eq(workItemTable.workspaceId, input.workspaceId),
      ),
    )
    .for("share");
  assertWorkItemStillLive(locked);
  await assertProjectStillLive(tx, locked.projectId);
}

async function deleteRejectedPendingAttachmentRow(input: {
  attachmentId: string;
  workspaceId: string;
  workItemId: string;
}) {
  return db.transaction(async (tx) => {
    await lockLiveWorkItem(tx, input);

    return deletePendingWorkItemAttachment(tx, {
      id: input.attachmentId,
      workspaceId: input.workspaceId,
      workItemId: input.workItemId,
    });
  });
}

export type CompleteAttachmentInput = {
  attachmentId: string;
  workspaceId: string;
  workItemId: string;
  actorId: string;
  actorType: "person" | "api_key";
  identity: ResolvedIdentity | null;
  /**
   * A-08: the requester completing their own upload on a request raised by staff. The row is
   * found through the customer finder; every storage, size, quota and content check is shared.
   */
  portal?: true;
};

/**
 * `POST /api/attachments/{id}/complete` (`attachments.md` AT-2's edge case: "Declared
 * MIME does not match magic bytes | Rejected at `complete`; the object is deleted").
 * Reads the object BACK from storage (never trusts the client's own "I uploaded it"
 * claim) and only marks the row `ready` once its bytes actually agree with the
 * declared `mime_type`.
 */
export async function completeAttachment(input: CompleteAttachmentInput) {
  const {
    attachmentId,
    workspaceId,
    workItemId,
    actorId,
    actorType,
    identity,
  } = input;

  const find = input.portal ? findPortalRequestUpload : findWorkItemAttachment;
  const [attachment] = await find(db, identity, {
    id: attachmentId,
    workspaceId,
    workItemId,
  });

  if (
    !attachment ||
    attachment.workspaceId !== workspaceId ||
    attachment.parentWorkItemId !== workItemId
  ) {
    throw new HTTPException(404, { message: "Attachment not found" });
  }

  if (attachment.state !== "pending") {
    throw new HTTPException(409, {
      message: `Attachment is already "${attachment.state}", not "pending".`,
    });
  }

  // P1R2-13: only the person who requested the upload completes it (the portal route already
  // binds completion to the requester). A pending row with no resolved uploader stays open to
  // any caller who reaches the item, as before.
  if (attachment.uploadedBy && identity?.personId !== attachment.uploadedBy) {
    throw new HTTPException(404, { message: "Attachment not found" });
  }

  // Re-check the actual stored size against `attachment_max_bytes` -- `presign`'s own check
  // only bounds the CLAIMED size, and the S3 driver's presigned PUT has no
  // `content-length-range` condition (`storage/s3.ts`'s own comment), so a caller could
  // otherwise upload an arbitrarily large object and have it recorded as "ready".
  const [settings] = await getAttachmentSizeLimit(db);
  const maxBytes = settings?.maxBytes ?? FALLBACK_MAX_BYTES;

  const NOT_FOUND_MESSAGE =
    "Upload not found in storage -- the presigned URL was never used, or the upload never finished.";

  // N1/N2 security-review fix (2026-09-27, delta 2): B2's original fix moved the object to
  // a final key only AFTER reading/checking it at the PENDING key -- leaving a real
  // time-of-check-to-time-of-use gap on both drivers (a slow write still in flight, or a
  // fresh PUT racing in, when the pending key was read could still change what later got
  // moved and served). The object is now moved to the final key FIRST, sight unseen, and
  // checked ONLY there:
  //  - filesystem: the upload writer itself now only ever publishes a finished write via an
  //    atomic rename onto the pending key (`writeStreamToFile`), so nothing ever holds a
  //    live handle on a path this finalize renames away -- the rename moves a complete file.
  //  - S3: `CopyObject` creates an independent, immutable snapshot at the final key; no PUT
  //    to the pending key after that call can retroactively change what was copied.
  // A stray/racing PUT still lands somewhere after this -- the now-vacated pending key,
  // never the final one -- which is the accepted, non-blocking N4 finding (an orphan
  // object, not a served one).
  const finalObjectKey = toFinalAttachmentObjectKey(attachment.objectKey);

  // PTM-06: record a durable intent for the final key BEFORE any storage call, so a crash or an
  // unknown outcome after the copy still leaves a locator for `attachment-gc`. The reservation
  // is its own short transaction (released before storage I/O); a failure here touches no
  // storage and the pending upload stays intact for a retry.
  let backend: string;
  try {
    backend = getStorageBackendFingerprint();
    const reserved = await reserveCompletionIntent({
      objectKey: finalObjectKey,
      attachmentId,
      workspaceId,
      backend,
    });
    if (reserved === "cap") {
      throw new HTTPException(409, { message: UPLOAD_UNCONFIRMED_MESSAGE });
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(503, { message: INTENT_UNAVAILABLE_MESSAGE });
  }
  // The intent may be dropped only after a settled outcome, a successful in-process delete and
  // an unchanged backend fingerprint; anything else leaves it for the collector.
  let settled = true;
  const backendUnchanged = () => {
    try {
      return getStorageBackendFingerprint() === backend;
    } catch {
      return false;
    }
  };
  let stable = true;
  // One catch deletes only this call's own random final key, whichever step failed.
  try {
    await finalizeStorageObject(attachment.objectKey, finalObjectKey).catch(
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
      objectKey: attachment.objectKey,
      workspaceId,
      ttlSeconds: attachmentUploadUrlTtlSeconds(),
    }).catch(() => {});

    // B3 security-review fix (2026-09-27): get the real stored size (no body read at all)
    // and only the first SNIFF_BYTES bytes (a bounded, ranged read) -- NOT the entire object
    // buffered into memory, which is what the previous shape did (`new
    // Response(object.body).arrayBuffer()` before ever checking the size), letting one
    // `complete` call on a multi-GB object exhaust process memory. Read from the FINAL key
    // (see above), never the pending one.
    const { contentLength, header } = await getObjectSizeAndHeader(
      finalObjectKey,
      SNIFF_BYTES,
    ).catch(() => {
      throw new HTTPException(400, { message: NOT_FOUND_MESSAGE });
    });

    // Size is checked BEFORE the magic-byte sniff so an oversized object is never read (B3).
    if (contentLength === undefined || contentLength > maxBytes) {
      await deleteRejectedPendingAttachmentRow({
        attachmentId,
        workspaceId,
        workItemId,
      });
      throw new HTTPException(400, {
        message:
          contentLength === undefined
            ? "The uploaded file's size could not be determined."
            : `The uploaded file is ${Math.ceil(contentLength / (1024 * 1024))} MB; the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
      });
    }

    if (!magicBytesMatchDeclaredMime(header, attachment.mimeType)) {
      await deleteRejectedPendingAttachmentRow({
        attachmentId,
        workspaceId,
        workItemId,
      });
      throw new HTTPException(400, {
        message: `The uploaded file's content does not match its declared type (${attachment.mimeType}).`,
      });
    }

    const updatedRows = await db.transaction(async (tx) => {
      // Issue #493: liveness re-check in the transaction that writes `ready`. Lock order:
      // work_item -> project -> attachment -> quota advisory (last) -> activity.
      await lockLiveWorkItem(tx, { workItemId, workspaceId });

      // L5: `WHERE state = 'pending'` makes exactly one concurrent `complete` the winner.
      const rows = await updateAttachmentReady(tx, {
        id: attachmentId,
        size: contentLength,
        objectKey: finalObjectKey,
      });
      if (rows.length === 0) return rows;

      // Real size must fit the organisation quota; the advisory lock serialises distinct rows
      // here, and a 429 rolls the ready update back.
      await assertOrganisationStorageQuota(tx, {
        workspaceId,
        additionalBytes: contentLength,
        excludeAttachmentId: attachmentId,
      });

      // PTM-06: the intent is consumed atomically with `ready`. Order: work_item SHARE ->
      // project -> attachment -> quota advisory -> gc row -> activity. A missing intent rolls
      // the ready update back (the bytes may already be gone).
      if (
        !(await consumeCompletionIntent(tx, {
          objectKey: finalObjectKey,
          attachmentId,
          workspaceId,
        }))
      ) {
        throw new HTTPException(409, { message: INTENT_CONSUMED_MESSAGE });
      }

      await recordWorkItemActivity(tx, [
        {
          workspaceId,
          workItemId,
          actorId,
          actorType,
          verb: "attachment.added",
          payload: {
            attachmentId,
            filename: attachment.filename,
            ...(attachment.commentId
              ? { commentId: attachment.commentId }
              : {}),
          },
          // CA-7: `attachment.added` is public only for a customer-visible attachment.
          // AT-4: an attachment on an internal comment is internal whatever its own flag says.
          visibility:
            attachment.customerVisible &&
            attachment.commentVisibility !== "internal"
              ? "public"
              : "internal",
        },
      ]);

      return rows;
    });

    const [updated] = updatedRows;
    if (!updated) {
      throw new HTTPException(409, {
        message: `Attachment is already "${attachment.state}", not "pending".`,
      });
    }
    return updated;
  } catch (error) {
    // A 429 rolled the ready update back; drop the still-pending row (state-guarded).
    if (error instanceof HTTPException && error.status === 429) {
      await deleteRejectedPendingAttachmentRow({
        attachmentId,
        workspaceId,
        workItemId,
      }).catch(() => {
        // The pending-row cleanup job owns its expiry if the item froze first.
      });
    }
    const deleted = await deleteStorageObject(finalObjectKey).then(
      () => true,
      () => false,
    );
    if (settled && deleted && stable && backendUnchanged()) {
      await dropSettledCompletionIntent(db, {
        objectKey: finalObjectKey,
        attachmentId,
        backend,
      }).catch(() => {});
    }
    throw error;
  }
}

export default completeAttachment;
