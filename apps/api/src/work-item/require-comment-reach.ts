import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

/**
 * `PATCH|DELETE /api/comments/{id}` middleware -- resolves the addressed `comment` row
 * (issue #27, `docs/03-features/comments-and-activity.md`) by its cuid2 id, sets
 * `workspaceId`/`workItemId`/`commentId` in context, and requires workspace membership.
 *
 * A LOCAL middleware, not an addition to `workspace-access-middleware.ts`'s
 * `workspaceAccess.from*` family -- same reasoning `require-work-item-reach.ts` gives for
 * its own local middleware (partition-by-file; `AGENTS.md` do-not 20).
 *
 * Missing row and out-of-reach row both answer 404, never 403 -- following issue #290's
 * precedent (`workspace-access-middleware.ts`'s own file comment) and
 * `require-work-item-reach.ts`'s identical choice: distinguishing "doesn't exist" from
 * "exists, but not yours" would be an existence oracle across every tenant. `comment.id` is
 * a cuid2 (high entropy, unlike `work_item.key`), so this is a defence-in-depth choice here,
 * not the same guessable-identifier necessity that route has -- but it keeps this route's
 * answer consistent with every other row lookup in this codebase.
 */
export function requireCommentReach(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const id = c.req.param(idKey);
    if (!id) {
      throw new HTTPException(400, { message: "Missing comment id" });
    }
    rejectNulByte(id, "Comment id");

    // Only enough to resolve reach -- the handler re-loads (and, for `PATCH`, locks) the
    // full row itself, the same "middleware resolves reach, handler re-scopes its own
    // write" split `update-work-item.ts`/`assign-work-item.ts` already use, rather than
    // trusting a row read here across the gap to the handler's own transaction.
    //
    // #202 / PR #204's freeze invariant (same as `require-work-item-reach.ts`'s identical
    // join): a comment belonging to a soft-deleted project's work item is frozen for that
    // project's 30-day recovery window, so it must 404 here exactly like a nonexistent
    // comment id -- never distinguishing the two from the outside. Joined through
    // `workItemTable` to `projectTable` and filtered on `isNull(projectTable.deletedAt)`.
    //
    // Issue #480: the work item's OWN `deleted_at`/`archived_at` are checked too, not
    // only its project's -- same gap `require-work-item-reach.ts` closed for #276, here
    // for the comment-reach path, which has its own local lookup rather than going
    // through that middleware.
    const [comment] = await db
      .select({
        id: schema.commentTable.id,
        workItemId: schema.commentTable.workItemId,
        workspaceId: schema.commentTable.workspaceId,
        authorId: schema.commentTable.authorId,
      })
      .from(schema.commentTable)
      .innerJoin(
        schema.workItemTable,
        eq(schema.commentTable.workItemId, schema.workItemTable.id),
      )
      .innerJoin(
        schema.projectTable,
        eq(schema.workItemTable.projectId, schema.projectTable.id),
      )
      .where(
        and(
          eq(schema.commentTable.id, id),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.workItemTable.archivedAt),
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .limit(1);

    if (!comment) {
      throw new HTTPException(404, { message: "Comment not found" });
    }

    const apiKey = c.get("apiKey");
    try {
      await validateWorkspaceAccess(userId, comment.workspaceId, apiKey?.id);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        throw new HTTPException(404, { message: "Comment not found" });
      }
      throw error;
    }

    c.set("workspaceId", comment.workspaceId);
    // #400 F1 (Opus review): row-derived, never from the caller's request -- label it
    // so shadow mode's evidence gate keeps it instead of always nulling it.
    c.set("workspaceIdSource", "row");
    c.set("workItemId", comment.workItemId);
    c.set("policyScopeResource", "comment");
    c.set("policyRowFacts", { personId: comment.authorId });

    return next();
  };
}
