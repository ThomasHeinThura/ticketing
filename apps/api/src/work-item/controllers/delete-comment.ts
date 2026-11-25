import type { JsonValue } from "@taskdesk/domain";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import {
  commentTable,
  commentVersionTable,
  workItemTable,
} from "../../database/schema";
import type { ApiKey } from "../../openapi";
import type { PendingActionTransaction } from "../../pending-action/service";
import { fenceLegalHolds } from "../../scheduler/soft-delete-purge.repository";
import { openHoldOver, workItemPeople } from "../../utils/legal-hold-scope";
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

  // Purge the retained text unless an open hold covers the item's people or organisations.
  await fenceLegalHolds(tx);
  const heldRows = await tx.execute<{ held: boolean }>(
    sql`SELECT ${openHoldOver(
      workItemPeople(sql`SELECT ${locked.workItemId}::text`),
      sql`SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = ${workspaceId}
      UNION ALL SELECT p."organisation_id" FROM "project" p WHERE p."id" = ${workItem.projectId}`,
    )} AS held`,
  );
  const held = Boolean(heldRows.rows[0]?.held);
  if (!held) {
    await tx
      .delete(commentVersionTable)
      .where(eq(commentVersionTable.commentId, commentId));
    // Earlier cancelled confirmations keep the full text in their preview summary, except those a hold
    // covers through their own requester, decider or organisation (workItemPeople omits them).
    await tx.execute(
      sql`UPDATE "pending_action" pa SET "payload_summary" = pa."payload_summary" || '{"commentBody": null}'::jsonb
        WHERE pa."payload_summary"->>'commentId' = ${commentId} AND pa."payload_summary" ? 'commentBody'
        AND NOT ${openHoldOver(
          sql`SELECT pa."requested_by_person_id" UNION ALL SELECT pa."decided_by_person_id"`,
          sql`SELECT pa."organisation_id"`,
        )}`,
    );
  }

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
      // shortcut: audit rows written before this change keep comment text (chain is append-only); a redaction column needs a contract change
      body: held ? ((locked.body ?? null) as JsonValue) : null,
      bodyRedacted: !held,
      deletedAt: null,
    },
    after: {
      body: null,
      deletedAt: deleted.deletedAt?.toISOString() ?? null,
    },
  });

  return deleted;
}
