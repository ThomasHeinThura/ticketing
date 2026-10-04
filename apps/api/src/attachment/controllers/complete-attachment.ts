import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  attachmentTable,
  instanceSettingTable,
  requestTypeTable,
  submissionTable,
  workItemTable,
} from "../../database/schema";
import {
  deleteStorageObject,
  finalizeStorageObject,
  getObjectSizeAndHeader,
  toFinalAttachmentObjectKey,
} from "../../storage";
import { recordWorkItemActivity } from "../../work-item/activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../../work-item/assert-work-item-live";
import { magicBytesMatchDeclaredMime } from "../magic-bytes";

const SNIFF_BYTES = 512;

// Same fallback as `presign-attachment.ts`'s own `FALLBACK_MAX_BYTES` -- only used when
// the singleton `instance_setting` row is somehow missing (never true after a real boot).
const FALLBACK_MAX_BYTES = 25 * 1024 * 1024;

async function deleteRejectedPendingAttachmentRow(input: {
  attachmentId: string;
  workspaceId: string;
  workItemId?: string;
  submissionId?: string;
}) {
  return db.transaction(async (tx) => {
    if (input.submissionId) {
      const [submission] = await tx
        .select({
          state: submissionTable.state,
          workspaceId: requestTypeTable.workspaceId,
        })
        .from(submissionTable)
        .innerJoin(
          requestTypeTable,
          eq(requestTypeTable.id, submissionTable.requestTypeId),
        )
        .where(eq(submissionTable.id, input.submissionId))
        .for("update", { of: submissionTable });
      if (
        !submission ||
        submission.state !== "draft" ||
        submission.workspaceId !== input.workspaceId
      ) {
        throw new HTTPException(404, { message: "Submission not found" });
      }
      return tx
        .delete(attachmentTable)
        .where(
          and(
            eq(attachmentTable.id, input.attachmentId),
            eq(attachmentTable.workspaceId, input.workspaceId),
            eq(attachmentTable.submissionId, input.submissionId),
            eq(attachmentTable.state, "pending"),
          ),
        )
        .returning({ id: attachmentTable.id });
    }
    const [locked] = await tx
      .select({
        projectId: workItemTable.projectId,
        deletedAt: workItemTable.deletedAt,
        archivedAt: workItemTable.archivedAt,
      })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.id, input.workItemId!),
          eq(workItemTable.workspaceId, input.workspaceId),
        ),
      )
      .for("share");
    assertWorkItemStillLive(locked);
    await assertProjectStillLive(tx, locked.projectId);

    return tx
      .delete(attachmentTable)
      .where(
        and(
          eq(attachmentTable.id, input.attachmentId),
          eq(attachmentTable.workspaceId, input.workspaceId),
          eq(attachmentTable.workItemId, input.workItemId!),
          eq(attachmentTable.state, "pending"),
        ),
      )
      .returning({ id: attachmentTable.id });
  });
}

export type CompleteAttachmentInput = {
  attachmentId: string;
  workspaceId: string;
  workItemId?: string;
  submissionId?: string;
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
  const {
    attachmentId,
    workspaceId,
    workItemId,
    submissionId,
    actorId,
    actorType,
  } = input;
  if ((workItemId === undefined) === (submissionId === undefined)) {
    throw new HTTPException(400, {
      message: "Exactly one upload parent is required",
    });
  }

  const [attachment] = await db
    .select()
    .from(attachmentTable)
    .where(eq(attachmentTable.id, attachmentId))
    .limit(1);

  if (
    !attachment ||
    attachment.workspaceId !== workspaceId ||
    (submissionId
      ? attachment.submissionId !== submissionId
      : attachment.workItemId !== workItemId)
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
  await finalizeStorageObject(attachment.objectKey, finalObjectKey).catch(
    () => {
      throw new HTTPException(400, { message: NOT_FOUND_MESSAGE });
    },
  );

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

  // Size is checked BEFORE the magic-byte sniff, and before anything else touches the
  // object's content -- the whole point of B3 is to reject an oversized object without
  // ever reading its bytes.
  if (contentLength === undefined || contentLength > maxBytes) {
    try {
      await deleteRejectedPendingAttachmentRow({
        attachmentId,
        workspaceId,
        workItemId,
        submissionId,
      });
    } catch (error) {
      // Preserve the pending row if the project/work item froze first. The invalid
      // upload object is still discarded; the pending-row cleanup job owns its expiry.
      await deleteStorageObject(finalObjectKey).catch(() => {});
      throw error;
    }
    await deleteStorageObject(finalObjectKey).catch(() => {});
    throw new HTTPException(400, {
      message:
        contentLength === undefined
          ? "The uploaded file's size could not be determined."
          : `The uploaded file is ${Math.ceil(contentLength / (1024 * 1024))} MB; the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    });
  }

  if (!magicBytesMatchDeclaredMime(header, attachment.mimeType)) {
    try {
      await deleteRejectedPendingAttachmentRow({
        attachmentId,
        workspaceId,
        workItemId,
        submissionId,
      });
    } catch (error) {
      // Preserve the pending row if the project/work item froze first. The invalid
      // upload object is still discarded; the pending-row cleanup job owns its expiry.
      await deleteStorageObject(finalObjectKey).catch(() => {});
      throw error;
    }
    await deleteStorageObject(finalObjectKey).catch(() => {});
    throw new HTTPException(400, {
      message: `The uploaded file's content does not match its declared type (${attachment.mimeType}).`,
    });
  }

  let updatedRows: (typeof attachmentTable.$inferSelect)[];
  try {
    updatedRows = await db.transaction(async (tx) => {
      // Issue #493: this route had NO in-transaction liveness re-check at all before
      // marking the attachment `ready` -- `requireAttachmentReach()` checks the work
      // item's `deletedAt`/`archivedAt` before this request reaches here, but a
      // soft-delete/archive landing in the window between that check and this UPDATE
      // would otherwise still leave a `ready` attachment (plus its `attachment.added`
      // activity row) on a dead item. `.for("share")` locks the row so a concurrent
      // soft-delete blocks until this transaction finishes; read-only here, so a shared
      // lock is enough.
      if (submissionId) {
        const [submission] = await tx
          .select({
            state: submissionTable.state,
            workspaceId: requestTypeTable.workspaceId,
          })
          .from(submissionTable)
          .innerJoin(
            requestTypeTable,
            eq(requestTypeTable.id, submissionTable.requestTypeId),
          )
          .where(eq(submissionTable.id, submissionId))
          .for("update", { of: submissionTable });
        if (
          !submission ||
          submission.state !== "draft" ||
          submission.workspaceId !== workspaceId
        ) {
          throw new HTTPException(404, { message: "Submission not found" });
        }
      } else {
        const [locked] = await tx
          .select({
            projectId: workItemTable.projectId,
            deletedAt: workItemTable.deletedAt,
            archivedAt: workItemTable.archivedAt,
          })
          .from(workItemTable)
          .where(eq(workItemTable.id, workItemId!))
          .for("share");
        assertWorkItemStillLive(locked);
        await assertProjectStillLive(tx, locked.projectId);
      }

      const rows = await tx
        .update(attachmentTable)
        .set({ state: "ready", size: contentLength, objectKey: finalObjectKey })
        // L5 security-review fix (2026-09-27): the `WHERE state = 'pending'` condition
        // makes the 409-under-concurrency behaviour a real database-level guard rather
        // than something only observed because of the read-then-write check above -- two
        // concurrent `complete` calls now have exactly one winner at the database, not at
        // whichever request happened to read first.
        .where(
          and(
            eq(attachmentTable.id, attachmentId),
            eq(attachmentTable.state, "pending"),
          ),
        )
        .returning();

      if (rows.length > 0 && workItemId) {
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
  } catch (error) {
    // Issue #493: whether this is the new liveness check above (404) or any other error
    // out of the transaction, the object was already moved to `finalObjectKey` before this
    // transaction ever ran (finalize runs before any guard, not after -- see this
    // function's own doc comment) -- nothing will ever reference it now, so clean it up
    // rather than orphaning it silently, same as the `!updated` 409 branch below already
    // does for its own case.
    await deleteStorageObject(finalObjectKey).catch(() => {});
    throw error;
  }

  const [updated] = updatedRows;

  if (!updated) {
    // The object was already moved to `finalObjectKey` above (finalize now runs before
    // this guard, not after it) -- if this request lost the race for the row, nothing will
    // ever reference that final object, so clean it up rather than orphaning it silently.
    await deleteStorageObject(finalObjectKey).catch(() => {});
    throw new HTTPException(409, {
      message: `Attachment is already "${attachment.state}", not "pending".`,
    });
  }

  return updated;
}

export default completeAttachment;
