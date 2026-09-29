import { and, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  attachmentTable,
  personTable,
  workItemTable,
} from "../../database/schema";
import { recordWorkItemActivity } from "../../work-item/activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../../work-item/assert-work-item-live";

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

  if (!person || attachment.uploadedBy !== person.id) {
    throw new HTTPException(403, {
      message: "Only the attachment's own uploader may delete it",
    });
  }

  // Check uploader authority before the idempotent return so knowing a tombstone id
  // does not reveal retained attachment metadata to another workspace member.
  if (attachment.state === "deleted") {
    return attachment;
  }

  const [updated] = await db.transaction(async (tx) => {
    const [lockedWorkItem] = await tx
      .select({
        id: workItemTable.id,
        projectId: workItemTable.projectId,
        deletedAt: workItemTable.deletedAt,
        archivedAt: workItemTable.archivedAt,
      })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.id, workItemId),
          eq(workItemTable.workspaceId, workspaceId),
        ),
      )
      .for("share");
    assertWorkItemStillLive(lockedWorkItem);
    await assertProjectStillLive(tx, lockedWorkItem.projectId);

    const rows = await tx
      .update(attachmentTable)
      .set({ state: "deleted", deletedAt: new Date() })
      // #454 fix: guard on `state <> 'deleted'`, mirroring `complete-attachment.ts`'s own
      // `WHERE state = 'pending'` guard (L5 security-review fix, PR #450) for the identical
      // reason -- without this, N concurrent DELETE calls on the same attachment each match
      // the row (id + uploadedBy alone is not exclusive), so every call returns 200, records
      // its own `attachment.deleted` activity row, and `deletedAt` is overwritten by
      // whichever call commits last. This guard makes exactly one call the winner at the
      // database, not at whichever request happened to read `attachment.state` first.
      //
      // `<> 'deleted'`, NOT `= 'ready'`: the pre-transaction check above (line 55) accepts
      // BOTH `pending` and `ready` -- only `deleted` short-circuits early -- so the guarded
      // UPDATE must accept the same two states its own pre-check already allowed through,
      // or an uploader deleting their own still-`pending` (never completed) attachment
      // would match the pre-check, then match zero rows here, and fall into the `!updated`
      // branch below with a wrong 403 (Opus security review, first pass on this fix: B1).
      // `<> 'deleted'` closes the concurrency race identically to a narrower `= 'ready'`
      // check regardless of which state the row is actually in when a call arrives, and
      // is also safe against a concurrent `complete` (guarded on `state = 'pending'`):
      // whichever of `complete`/`delete` commits first decides the row's next state, and
      // the loser's own guard (this one, or `complete`'s `= 'pending'`) simply no longer
      // matches on retry -- never a double-write on either side.
      .where(
        and(
          eq(attachmentTable.id, attachmentId),
          eq(attachmentTable.uploadedBy, person.id),
          ne(attachmentTable.state, "deleted"),
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
    // #454: with the state guard above, a concurrent DELETE (or a concurrent `complete`
    // that raced it, though that case is not itself a bug) that already won the race lands
    // here too (0 rows matched because `state` was already `"deleted"`, not because of
    // ownership). Re-check the current row and, if it's already deleted, treat it the same
    // idempotent no-op as the early check above -- not a 403, which would misreport a losing
    // racer's own valid delete as a permissions failure.
    const [current] = await db
      .select()
      .from(attachmentTable)
      .where(eq(attachmentTable.id, attachmentId))
      .limit(1);
    if (current?.state === "deleted") {
      return current;
    }
    throw new HTTPException(403, {
      message: "Only the attachment's own uploader may delete it",
    });
  }

  return updated;
}

export default deleteAttachment;
