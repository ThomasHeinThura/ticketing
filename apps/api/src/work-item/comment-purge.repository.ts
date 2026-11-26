import { eq, sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { commentVersionTable } from "../database/schema";
import { openHoldOver, workItemPeople } from "../utils/legal-hold-scope";

// A hold on the action's own requester, decider or organisation keeps its preview text.
const pendingActionHeld = () =>
  openHoldOver(
    sql`SELECT pa."requested_by_person_id" UNION ALL SELECT pa."decided_by_person_id"`,
    sql`SELECT pa."organisation_id"`,
  );

/**
 * Purges a deleted comment's retained text unless an open hold covers the work item's people or
 * organisations. Returns whether a hold applied (nothing purged). Callers fence legal holds first.
 */
export async function purgeDeletedCommentText(
  executor: Executor,
  input: {
    commentId: string;
    workItemId: string;
    workspaceId: string;
    projectId: string;
  },
): Promise<boolean> {
  const heldRows = await executor.execute<{ held: boolean }>(
    sql`SELECT ${openHoldOver(
      workItemPeople(sql`SELECT ${input.workItemId}::text`),
      sql`SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = ${input.workspaceId}
      UNION ALL SELECT p."organisation_id" FROM "project" p WHERE p."id" = ${input.projectId}`,
    )} AS held`,
  );
  if (heldRows.rows[0]?.held) return true;
  await executor
    .delete(commentVersionTable)
    .where(eq(commentVersionTable.commentId, input.commentId));
  // Earlier cancelled confirmations keep the full text in their preview summary, except those a hold
  // covers through their own requester, decider or organisation (workItemPeople omits them).
  await executor.execute(
    sql`UPDATE "pending_action" pa SET "payload_summary" = pa."payload_summary" || '{"commentBody": null}'::jsonb
      WHERE pa."payload_summary"->>'commentId' = ${input.commentId} AND pa."payload_summary" ? 'commentBody'
      AND NOT ${pendingActionHeld()}`,
  );
  return false;
}

/** Marks a confirmed comment deletion's preview as done and drops its text unless held. */
export async function markCommentDeletionPreviewDone(
  executor: Executor,
  pendingActionId: string,
) {
  await executor.execute(
    sql`UPDATE "pending_action" pa SET "payload_summary" = pa."payload_summary" || '{"alreadyDeleted": true}'::jsonb
      || CASE WHEN ${pendingActionHeld()} THEN '{}'::jsonb ELSE '{"commentBody": null}'::jsonb END
      WHERE pa."id" = ${pendingActionId}`,
  );
}
