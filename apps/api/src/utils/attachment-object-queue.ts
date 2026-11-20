import { sql } from "drizzle-orm";
import db from "../database";
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

/**
 * P1R2-6: after `complete` moved an upload to its never-presigned final key, the vacated pending
 * key stays writable through its upload credential until that credential expires. The key is
 * queued for `attachment-gc` with `queued_at` pushed past the credential's lifetime (plus a
 * margin), so a replayed upload after `complete` (bounded by the signed Content-Length) is
 * removed too. The collector skips rows whose `queued_at` is still in the future, and removes
 * the object only while no attachment row names the key.
 */
export async function queueVacatedUploadKey(
  executor: Executor,
  input: { objectKey: string; workspaceId: string; ttlSeconds: number },
): Promise<void> {
  const delaySeconds = Math.max(0, Math.ceil(input.ttlSeconds)) + 60;
  await executor.execute(sql`
    INSERT INTO "attachment_object_gc" ("object_key", "source_workspace_id", "queued_at")
    VALUES (
      ${input.objectKey},
      ${input.workspaceId},
      now() + make_interval(secs => ${delaySeconds})
    )
    ON CONFLICT ("object_key") DO UPDATE
      SET "queued_at" = GREATEST("attachment_object_gc"."queued_at", EXCLUDED."queued_at")
  `);
}

/**
 * PTM-06 durable completion intent. Before a completion moves an upload to its random final key
 * it records that key here, keyed by the authorized attachment id, so a crash or an unknown
 * storage outcome still leaves a locator for `attachment-gc`. The row has no foreign key and
 * carries `queued_at = 'infinity'`, which an older collector's `queued_at <= now()` never selects;
 * its own due time is `retry_at`.
 */
export const MAX_COMPLETION_INTENTS_PER_ATTACHMENT = 3;

/**
 * Reserves one intent for an attachment, serialized per attachment id across both completion
 * routes and every replica: the count and the insert run in one short transaction under a
 * namespaced advisory lock that is released at COMMIT, before the caller touches storage.
 *
 * This helper takes no executor on purpose and always uses the module-level pool. A caller that
 * holds an open transaction must not pass it in, or the advisory lock and the uncommitted row
 * would be held across storage I/O.
 *
 * `"cap"` means the attachment already has {@link MAX_COMPLETION_INTENTS_PER_ATTACHMENT} intents.
 */
export async function reserveCompletionIntent(input: {
  objectKey: string;
  attachmentId: string;
  workspaceId: string;
  backend: string;
}): Promise<"reserved" | "cap"> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attachment-completion-intent:${input.attachmentId}`}, 0))`,
    );
    const counted = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM "attachment_object_gc"
      WHERE "attachment_id" = ${input.attachmentId}
    `);
    if ((counted.rows[0]?.n ?? 0) >= MAX_COMPLETION_INTENTS_PER_ATTACHMENT)
      return "cap";
    await tx.execute(sql`
      INSERT INTO "attachment_object_gc"
        ("object_key", "source_workspace_id", "attachment_id", "storage_driver", "queued_at", "retry_at")
      VALUES (
        ${input.objectKey},
        ${input.workspaceId},
        ${input.attachmentId},
        ${input.backend},
        'infinity'::timestamptz,
        now() + interval '1 day'
      )
    `);
    return "reserved";
  });
}

/**
 * Consumes the intent inside the transaction that commits `ready`. It matches key, id and
 * workspace together; `false` means the intent is gone and the caller must roll back.
 */
export async function consumeCompletionIntent(
  executor: Executor,
  input: { objectKey: string; attachmentId: string; workspaceId: string },
): Promise<boolean> {
  const result = await executor.execute(sql`
    DELETE FROM "attachment_object_gc"
    WHERE "object_key" = ${input.objectKey}
      AND "attachment_id" = ${input.attachmentId}
      AND "source_workspace_id" = ${input.workspaceId}
    RETURNING 1
  `);
  return (result.rowCount ?? result.rows.length) > 0;
}

/**
 * Drops an intent after a provably settled outcome AND a successful in-process delete of the
 * final key, with the backend fingerprint unchanged since reservation. Anything else keeps it.
 */
export async function dropSettledCompletionIntent(
  executor: Executor,
  input: { objectKey: string; attachmentId: string; backend: string },
): Promise<void> {
  await executor.execute(sql`
    DELETE FROM "attachment_object_gc"
    WHERE "object_key" = ${input.objectKey}
      AND "attachment_id" = ${input.attachmentId}
      AND "storage_driver" = ${input.backend}
  `);
}
