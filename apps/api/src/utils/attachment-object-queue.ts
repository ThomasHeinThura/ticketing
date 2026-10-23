import { sql } from "drizzle-orm";
import type { Executor } from "../database/executor";

/**
 * Durable hand-off of stored attachment objects to `attachment-gc` when the rows naming them
 * are about to disappear with a hard delete (PA-12). `attachment` rows cascade away with their
 * work items, so once a workspace is hard-deleted nothing would point at the objects any more:
 * the files would stay in storage forever (a storage leak and an erasure failure).
 *
 * `queueAttachmentObjectsForWorkspaces` copies every object key of the workspaces into
 * `attachment_object_gc` inside the SAME transaction as the delete, so the keys survive the
 * cascade or the whole delete rolls back. `attachment-gc` drains the queue
 * (`collectQueuedAttachmentObjects` in `scheduler/attachment-cleanup.ts`) and removes an object
 * only when no attachment row names its key any more.
 *
 * The queue is raw SQL on purpose until the table lands in `database/schema.ts` (migration owned
 * by the database layer); it needs: `object_key text primary key`, `source_workspace_id text`,
 * `queued_at timestamptz not null default now()`, `attempts integer not null default 0`.
 */
export const ATTACHMENT_OBJECT_GC_TABLE = "attachment_object_gc";

export async function queueAttachmentObjectsForWorkspaces(
  executor: Executor,
  workspaceIds: readonly string[],
): Promise<number> {
  if (workspaceIds.length === 0) return 0;
  const result = await executor.execute(sql`
    INSERT INTO "attachment_object_gc" ("object_key", "source_workspace_id")
    SELECT DISTINCT ON (a."object_key") a."object_key", a."workspace_id"
    FROM "attachment" a
    WHERE a."workspace_id" IN (${sql.join(
      workspaceIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    ORDER BY a."object_key"
    ON CONFLICT ("object_key") DO NOTHING
  `);
  return result.rowCount ?? 0;
}
