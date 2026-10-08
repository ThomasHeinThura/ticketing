import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { commentTable, commentVersionTable } from "../../database/schema";
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
  countCommentVersionsQuery,
  lockCommentForMutationQuery,
  lockWorkItemForCommentMutationQuery,
} from "../repository";

// `CA-17`: "Editing is allowed for 15 minutes by the author."
const EDIT_WINDOW_MINUTES = 15;

/**
 * `PATCH /api/comments/{id}`. `rbac.md`'s own worked example: `comment:update_any` is an
 * unconditional override; `comment:update_own` additionally requires ownership
 * (`authorId === actorId`) AND the 15-minute window from `comment.createdAt` (`CA-17`) --
 * a conjunction, never a bypass, the same shape `packages/permissions`'s `orOwner` +
 * `withinMinutes` declares for this exact route (`policy.ts`'s own comment). Nothing here
 * calls that declarative evaluator (issue #8's runtime-integration work, not this slice's
 * scope) -- this is the same "declared target, `requireWorkspaceCapability`-family runtime
 * check" split every other route in this codebase already uses.
 *
 * `CA-4`: visibility cannot be changed after posting -- `updateCommentBody` (`comment-
 * schema.ts`) has no `visibility` field at all, so there is nothing here that could change
 * it.
 */
export async function updateComment(
  commentId: string,
  workspaceId: string,
  actorId: string,
  newBody: unknown,
  editorPersonId: string | null,
) {
  return db.transaction(async (tx) => {
    const [locked] = await lockCommentForMutationQuery(
      tx,
      commentId,
      workspaceId,
    );

    if (!locked || locked.deletedAt !== null) {
      throw new HTTPException(404, { message: "Comment not found" });
    }

    const [workItem] = await lockWorkItemForCommentMutationQuery(
      tx,
      locked.workItemId,
      workspaceId,
    );
    assertWorkItemStillLive(workItem);
    await assertProjectStillLive(tx, workItem.projectId);

    const roles = await workspaceMemberRoles(tx, workspaceId, actorId);
    if (!isUnambiguousMembership(roles)) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    const hasAny = await builtInRoleHasCapability(
      workspaceId,
      roles[0],
      "comment:update_any",
      tx,
    );

    if (!hasAny) {
      const isOwner = locked.authorId === actorId;
      const withinWindow =
        Date.now() - locked.createdAt.getTime() <=
        EDIT_WINDOW_MINUTES * 60 * 1000;
      const hasOwn =
        isOwner &&
        withinWindow &&
        (await builtInRoleHasCapability(
          workspaceId,
          roles[0],
          "comment:update_own",
          tx,
        ));

      if (!hasOwn) {
        throw new HTTPException(403, {
          message:
            "Not the author within the 15-minute edit window, or missing comment:update_own/comment:update_any permission",
        });
      }
    }

    // `CA-17`: "Each edit writes a new `comment_version` row" -- the row this writes
    // captures the CURRENT (pre-edit) body, so the version history is every PAST body,
    // not the latest (which lives on `comment.body` itself).
    const [existing] = await countCommentVersionsQuery(tx, commentId);

    await tx.insert(commentVersionTable).values({
      commentId,
      number: (existing?.value ?? 0) + 1,
      body: locked.body,
      editedBy: editorPersonId,
    });

    const [updated] = await tx
      .update(commentTable)
      .set({ body: newBody, editedAt: new Date() })
      .where(eq(commentTable.id, commentId))
      .returning();

    if (!updated) {
      throw new HTTPException(500, { message: "Failed to update comment" });
    }

    return updated;
  });
}

export default updateComment;
