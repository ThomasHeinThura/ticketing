import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { commentTable } from "../../database/schema";
import { builtInRoleHasCapability } from "../../utils/require-workspace-capability";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "../../utils/workspace-member-roles";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../assert-work-item-live";
import {
  lockCommentForMutationQuery,
  lockWorkItemForCommentMutationQuery,
} from "../repository";

/**
 * `DELETE /api/comments/{id}`. `comment:delete_any` is an unconditional override;
 * `comment:delete_own` additionally requires ownership -- no time window (unlike edit,
 * rbac.md's table names no `withinMinutes` for either delete row).
 *
 * `CA-18`: sets `deletedAt`/`deletedBy` and clears the body; the row, its author and its
 * position survive -- the tombstone. Idempotent: deleting an already-deleted comment
 * re-returns the same tombstoned row rather than erroring, matching this codebase's own
 * "clearing an already-cleared state is a no-op 200" convention
 * (`unassign-work-item.ts`'s own `AS-9` comment).
 */
export async function deleteComment(
  commentId: string,
  workspaceId: string,
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const [locked] = await lockCommentForMutationQuery(
      tx,
      commentId,
      workspaceId,
    );

    if (!locked) {
      throw new HTTPException(404, { message: "Comment not found" });
    }

    const roles = await workspaceMemberRoles(tx, workspaceId, actorId);
    if (!isUnambiguousMembership(roles)) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    const hasAny = await builtInRoleHasCapability(
      workspaceId,
      roles[0],
      "comment:delete_any",
      tx,
    );

    if (!hasAny) {
      const isOwner = locked.authorId === actorId;
      const hasOwn =
        isOwner &&
        (await builtInRoleHasCapability(
          workspaceId,
          roles[0],
          "comment:delete_own",
          tx,
        ));

      if (!hasOwn) {
        throw new HTTPException(403, {
          message:
            "Not the author, or missing comment:delete_own/comment:delete_any permission",
        });
      }
    }

    // Check authority before the idempotent return so knowing a tombstone id does not
    // reveal its retained metadata to a member who cannot delete that comment.
    if (locked.deletedAt !== null) {
      return locked;
    }

    const [workItem] = await lockWorkItemForCommentMutationQuery(
      tx,
      locked.workItemId,
      workspaceId,
    );
    assertWorkItemStillLive(workItem);
    await assertProjectStillLive(tx, workItem.projectId);

    const [deleted] = await tx
      .update(commentTable)
      .set({ deletedAt: new Date(), deletedBy: actorId, body: null })
      .where(eq(commentTable.id, commentId))
      .returning();

    if (!deleted) {
      throw new HTTPException(500, { message: "Failed to delete comment" });
    }

    return deleted;
  });
}

export default deleteComment;
