import type { JsonValue } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import { commentTable, workItemTable } from "../../database/schema";
import type { ApiKey } from "../../openapi";
import type { PendingActionTransaction } from "../../pending-action/service";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../assert-work-item-live";
import {
  commentAccess,
  loadCommentCaller,
  resolveCommentAuthors,
} from "../comment-access";

/** Executor-only CA-18 tombstone, inside the locked and freshly authorized pending-action transaction.
 * Retains the row/history and existing user-ID deletedBy convention; repeated execution is write-free.
 */
export async function deleteCommentInTransaction(
  tx: PendingActionTransaction,
  commentId: string,
  workspaceId: string,
  actorId: string,
  apiKey?: ApiKey,
  impersonated = false,
) {
  const [locked] = await tx
    .select()
    .from(commentTable)
    .where(
      and(
        eq(commentTable.id, commentId),
        eq(commentTable.workspaceId, workspaceId),
      ),
    )
    .for("update");

  if (!locked) {
    throw new HTTPException(404, { message: "Comment not found" });
  }

  const [workItem] = await tx
    .select({
      id: workItemTable.id,
      projectId: workItemTable.projectId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.id, locked.workItemId),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .for("share");
  if (!workItem) throw new HTTPException(404, { message: "Comment not found" });
  const caller = await loadCommentCaller(
    tx,
    { userId: actorId, apiKey, impersonated },
    {
      workspaceId,
      projectId: workItem.projectId,
      workItemId: locked.workItemId,
    },
  );
  const authors = await resolveCommentAuthors(tx, [locked.authorId]);
  if (
    !commentAccess(
      caller,
      locked.authorId ? (authors.get(locked.authorId) ?? null) : null,
      locked,
    ).mayDelete
  ) {
    throw new HTTPException(403, {
      message:
        "Not the author, or missing comment:delete_own/comment:delete_any permission",
    });
  }
  // Authorize before the idempotent return: retained metadata is not an existence oracle.
  if (locked.deletedAt !== null) return locked;
  assertWorkItemStillLive(workItem);
  await assertProjectStillLive(tx, workItem.projectId);

  const [deleted] = await tx
    .update(commentTable)
    .set({
      deletedAt: new Date(),
      deletedBy: actorId,
      body: null,
    })
    .where(eq(commentTable.id, commentId))
    .returning();

  if (!deleted) {
    throw new HTTPException(500, { message: "Failed to delete comment" });
  }

  await appendAuditLog(tx, {
    actorId,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
    workspaceId,
    projectId: workItem.projectId,
    action: "comment.deleted",
    entityType: "comment",
    entityId: deleted.id,
    before: {
      body: (locked.body ?? null) as JsonValue,
      deletedAt: null,
    },
    after: {
      body: null,
      deletedAt: deleted.deletedAt?.toISOString() ?? null,
    },
  });

  return deleted;
}
