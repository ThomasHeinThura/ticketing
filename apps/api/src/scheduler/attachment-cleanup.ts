import { and, asc, eq, gt, ne, or, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import type { Transaction } from "../database/executor";
import {
  assetTable,
  attachmentTable,
  commentTable,
  legalHoldTable,
  submissionTable,
  workItemTable,
} from "../database/schema";
import { logTaskDesk } from "../instance/observability/runtime";
import { deleteStorageObject } from "../storage";
import { contentReferencesAsset } from "../storage/cleanup-assets";
import { dbClockUtc } from "../utils/db-time";
import {
  openHoldOver,
  PROJECT_UNDER_OPEN_HOLD,
  projectOwnPeople,
  WORK_ITEM_UNDER_OPEN_HOLD,
} from "../utils/legal-hold-scope";
import { assertJobExecutionOwned, withJobLease } from "./leader-lock";

type CleanupKind = "pending" | "deleted";
export type AttachmentCleanupOutcome = {
  scanned: number;
  deleted: number;
  retained: number;
  degraded: boolean;
};
const MAX_ROWS_PER_RUN = 100;
// Bounded rounds rotate past held/failing rows instead of starving later attachments.
// This is an optimization only: after a process restart the first round starts again;
// eligibility, holds and item locking remain authoritative in PostgreSQL.
const resumeAfter: Partial<Record<CleanupKind, string>> = {};

function eligibility(kind: CleanupKind) {
  return kind === "pending"
    ? and(
        eq(attachmentTable.state, "pending"),
        sql`${attachmentTable.createdAt} <= ${dbClockUtc()} - interval '1 hour'`,
      )
    : and(
        eq(attachmentTable.state, "deleted"),
        sql`${attachmentTable.deletedAt} <= ${dbClockUtc()} - interval '24 hours'`,
      );
}

/** Follow completion's parent → attachment order, including accepted-submission races. */
async function lockParent(
  tx: Transaction,
  candidate: typeof attachmentTable.$inferSelect,
) {
  let requesterId: string | null = null;
  let itemId = candidate.workItemId;
  if (candidate.submissionId) {
    const [submission] = await tx
      .select()
      .from(submissionTable)
      .where(eq(submissionTable.id, candidate.submissionId))
      .for("update");
    if (!submission) return undefined;
    requesterId = submission.requesterId;
  }
  if (candidate.commentId) {
    const [comment] = await tx
      .select()
      .from(commentTable)
      .where(eq(commentTable.id, candidate.commentId));
    if (!comment) return undefined;
    itemId = comment.workItemId;
  }
  if (itemId) {
    const [item] = await tx
      .select()
      .from(workItemTable)
      .where(eq(workItemTable.id, itemId))
      .for("share");
    if (!item) return undefined;
    requesterId = item.requesterId;
  }
  if (candidate.commentId) {
    const [comment] = await tx
      .select()
      .from(commentTable)
      .where(eq(commentTable.id, candidate.commentId))
      .for("share");
    if (!comment || comment.workItemId !== itemId) return undefined;
  }
  return { requesterId };
}

/**
 * The shared purge predicate (`utils/legal-hold-scope.ts`) applied to one attachment row: a
 * hold on the uploader or the attachment's organisation always fences it. When the owning work
 * item is soft-deleted (a purge released this row; its whole subtree is about to cascade) the
 * row is also fenced by a hold on anything the item's hard delete removes (requester, assignee, participants, watchers, approvers, comment
 * authors/editors/deleters, other attachments' uploaders and organisations, workspace and
 * project organisations), and, once the owning project is itself soft-deleted (a project
 * purge released this row), and by the project-level people (creator, stakeholders, legacy task
 * tree). The caller holds `LOCK TABLE legal_hold IN SHARE MODE`.
 */
async function attachmentUnderOpenHold(
  tx: Transaction,
  attachmentId: string,
): Promise<boolean> {
  const result = await tx.execute<{ held: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM "attachment" a
      LEFT JOIN "comment" pc ON pc."id" = a."comment_id"
      LEFT JOIN "work_item" wi ON wi."id" = COALESCE(a."work_item_id", pc."work_item_id")
      WHERE a."id" = ${attachmentId}
        AND (
          EXISTS (
            SELECT 1 FROM "legal_hold" lh
            WHERE lh."lifted_at" IS NULL
              AND (
                (lh."scope" = 'person' AND lh."scope_id" = a."uploaded_by")
                OR (lh."scope" = 'organisation' AND lh."scope_id" = a."organisation_id")
              )
          )
          OR (wi."id" IS NOT NULL AND wi."deleted_at" IS NOT NULL AND ${WORK_ITEM_UNDER_OPEN_HOLD})
          OR EXISTS (
            SELECT 1 FROM "project" pr
            WHERE pr."id" = wi."project_id" AND pr."deleted_at" IS NOT NULL
              AND ${PROJECT_UNDER_OPEN_HOLD}
          )
        )
    ) AS held
  `);
  return result.rows[0]?.held === true;
}

/**
 * An object is shared while another LIVE (not `deleted`) row names its key: the last live
 * reference collects it. Another `deleted` row sharing the key does not pin it, unless that
 * row is itself under a hold (its holder must not lose the object because a sibling expired).
 */
async function objectSharedByOtherRows(
  tx: Transaction,
  row: typeof attachmentTable.$inferSelect,
): Promise<boolean> {
  const others = await tx
    .select({ id: attachmentTable.id, state: attachmentTable.state })
    .from(attachmentTable)
    .where(
      and(
        eq(attachmentTable.objectKey, row.objectKey),
        ne(attachmentTable.id, row.id),
      ),
    );
  if (others.some((other) => other.state !== "deleted")) return true;
  for (const other of others)
    if (await attachmentUnderOpenHold(tx, other.id)) return true;
  return false;
}

/**
 * Only row-backed objects: no storage-wide listing exists. Keep the locator when deletion
 * fails; successful deletion before a DB rollback is safe to retry on either real adapter.
 */
export async function cleanAttachment(
  id: string,
  kind: CleanupKind,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(attachmentTable)
      .where(eq(attachmentTable.id, id));
    if (!candidate) return false;
    const parent = await lockParent(tx, candidate);
    if (!parent) return false;
    const [row] = await tx
      .select()
      .from(attachmentTable)
      .where(and(eq(attachmentTable.id, id), eligibility(kind)))
      .for("update");
    if (
      !row ||
      row.objectKey !== candidate.objectKey ||
      row.workItemId !== candidate.workItemId ||
      row.commentId !== candidate.commentId ||
      row.submissionId !== candidate.submissionId
    )
      return false;

    // SHARE conflicts with hold INSERT/UPDATE/DELETE, including a hold still uncommitted.
    // Keep it until destructive I/O and metadata deletion finish, so the check cannot race.
    // This deliberately makes a slow storage backend delay hold placement; never release
    // the fence through an uncancellable timeout while storage could still delete later.
    await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
    const people = [row.uploadedBy, parent.requesterId].filter(
      (value): value is string => value !== null,
    );
    const holdScopes = people.map((personId) =>
      and(
        eq(legalHoldTable.scope, "person"),
        eq(legalHoldTable.scopeId, personId),
      ),
    );
    if (row.organisationId)
      holdScopes.push(
        and(
          eq(legalHoldTable.scope, "organisation"),
          eq(legalHoldTable.scopeId, row.organisationId),
        ),
      );
    if (holdScopes.length) {
      const holds = await tx
        .select({ id: legalHoldTable.id })
        .from(legalHoldTable)
        .where(and(sql`${legalHoldTable.liftedAt} IS NULL`, or(...holdScopes)))
        .limit(1);
      if (holds.length) return false;
    }

    if (await attachmentUnderOpenHold(tx, row.id)) return false;
    if (await objectSharedByOtherRows(tx, row)) return false;
    await deleteStorageObject(row.objectKey);
    await tx
      .delete(attachmentTable)
      .where(
        and(
          eq(attachmentTable.id, row.id),
          eq(attachmentTable.objectKey, row.objectKey),
          eligibility(kind),
        ),
      );
    return true;
  });
}

/**
 * Drains `attachment_object_gc` (`utils/attachment-object-queue.ts`): object keys whose
 * attachment rows were cascade-deleted with a hard-deleted workspace. An object is removed only
 * when no attachment row names its key any more (a key a surviving row still uses is dropped
 * from the queue untouched). A failed delete keeps the key queued and counts an attempt.
 */
export async function collectQueuedAttachmentObjects(
  limit = MAX_ROWS_PER_RUN,
): Promise<AttachmentCleanupOutcome> {
  const outcome: AttachmentCleanupOutcome = {
    scanned: 0,
    deleted: 0,
    retained: 0,
    degraded: false,
  };
  let queued: { rows: { object_key: string }[] };
  try {
    queued = await db.execute<{ object_key: string }>(sql`
      SELECT "object_key" FROM "attachment_object_gc"
      WHERE "queued_at" <= now()
      ORDER BY "attempts" ASC, "queued_at" ASC, "object_key" ASC
      LIMIT ${limit}
    `);
  } catch {
    // Table missing or unreadable: report the run as degraded rather than failing the job
    // after the attachment rows were already processed.
    logTaskDesk({
      module: "jobs",
      message: "jobs.failure",
      level: "error",
      result: "degraded",
    });
    return { ...outcome, degraded: true };
  }
  for (const { object_key: objectKey } of queued.rows) {
    await assertJobExecutionOwned();
    outcome.scanned++;
    try {
      const removed = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT 1 FROM "attachment_object_gc"
          WHERE "object_key" = ${objectKey} FOR UPDATE SKIP LOCKED
        `);
        if (locked.rows.length === 0) return false;
        const referenced = await tx
          .select({ id: attachmentTable.id })
          .from(attachmentTable)
          .where(eq(attachmentTable.objectKey, objectKey))
          .limit(1);
        if (referenced.length === 0) await deleteStorageObject(objectKey);
        await tx.execute(
          sql`DELETE FROM "attachment_object_gc" WHERE "object_key" = ${objectKey}`,
        );
        return referenced.length === 0;
      });
      if (removed) outcome.deleted++;
      else outcome.retained++;
    } catch {
      outcome.retained++;
      outcome.degraded = true;
      await db
        .execute(
          sql`UPDATE "attachment_object_gc" SET "attempts" = "attempts" + 1 WHERE "object_key" = ${objectKey}`,
        )
        .catch(() => undefined);
      logTaskDesk({
        module: "jobs",
        message: "jobs.failure",
        level: "error",
        result: "degraded",
      });
    }
  }
  return outcome;
}

/** Recovery window for an inline image that no content references any more (P0R1-01). */
const DETACHED_ASSET_RECOVERY_WINDOW = "24 hours";

/** The creator, the project's people and the workspace/project organisations of an asset (`a` alias). */
const ASSET_UNDER_OPEN_HOLD = openHoldOver(
  sql`SELECT pe."id" FROM "person" pe WHERE pe."user_id" = a."created_by"
      UNION ALL ${projectOwnPeople(sql`SELECT a."project_id"`)}`,
  sql`SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = a."workspace_id"
      UNION ALL SELECT p."organisation_id" FROM "project" p WHERE p."id" = a."project_id"`,
);

/**
 * Removes one detached inline asset once its recovery window passed. It re-checks, under the
 * asset row lock and the legal-hold table lock, that the asset is still detached, that no
 * description, comment or activity of its task references it again (a reference that was added
 * by any path restores it instead of deleting it), and that no open hold covers it. The object
 * is deleted before the row, so a failed storage call keeps the row for the next run.
 */
export async function cleanDetachedAsset(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(assetTable)
      .where(
        and(
          eq(assetTable.id, id),
          sql`${assetTable.detachedAt} <= ${dbClockUtc()} - interval '${sql.raw(DETACHED_ASSET_RECOVERY_WINDOW)}'`,
        ),
      )
      .for("update");
    if (!row) return false;
    await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
    const held = await tx.execute<{ held: boolean }>(sql`
      SELECT ${ASSET_UNDER_OPEN_HOLD} AS held FROM "asset" a WHERE a."id" = ${row.id}
    `);
    if (held.rows[0]?.held === true) return false;
    if (row.taskId) {
      const pattern = `%/api/asset/${row.id}%`;
      const refs = await tx.execute<{ content: string | null }>(sql`
        SELECT t."description" AS content FROM "task" t
          WHERE t."id" = ${row.taskId} AND t."description" LIKE ${pattern}
        UNION ALL
        SELECT c."content" FROM "task_comment" c
          WHERE c."task_id" = ${row.taskId} AND c."content" LIKE ${pattern}
        UNION ALL
        SELECT ta."content" FROM "task_activity" ta
          WHERE ta."task_id" = ${row.taskId} AND ta."content" LIKE ${pattern}
      `);
      if (
        refs.rows.some((ref) => contentReferencesAsset(ref.content, row.id))
      ) {
        await tx
          .update(assetTable)
          .set({ detachedAt: null })
          .where(eq(assetTable.id, row.id));
        return false;
      }
    }
    // P0R2-02: one `asset.purged` row (system actor) records which asset was collected. It is
    // written in the same transaction, so a failed storage call rolls the record back too.
    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      action: "asset.purged",
      entityType: "asset",
      entityId: row.id,
      before: {
        taskId: row.taskId,
        filename: row.filename,
        mimeType: row.mimeType,
        size: row.size,
        detachedAt: row.detachedAt?.toISOString() ?? null,
      },
      after: null,
    });
    await deleteStorageObject(row.objectKey);
    await tx.delete(assetTable).where(eq(assetTable.id, row.id));
    return true;
  });
}

/** Drains detached inline assets past the recovery window (`attachment-gc`). */
export async function collectDetachedAssets(
  limit = MAX_ROWS_PER_RUN,
): Promise<AttachmentCleanupOutcome> {
  const outcome: AttachmentCleanupOutcome = {
    scanned: 0,
    deleted: 0,
    retained: 0,
    degraded: false,
  };
  const candidates = await db
    .select({ id: assetTable.id })
    .from(assetTable)
    .where(
      sql`${assetTable.detachedAt} <= ${dbClockUtc()} - interval '${sql.raw(DETACHED_ASSET_RECOVERY_WINDOW)}'`,
    )
    .orderBy(asc(assetTable.detachedAt), asc(assetTable.id))
    .limit(Math.max(0, limit));
  for (const candidate of candidates) {
    await assertJobExecutionOwned();
    outcome.scanned++;
    try {
      if (await cleanDetachedAsset(candidate.id)) outcome.deleted++;
      else outcome.retained++;
    } catch {
      outcome.retained++;
      outcome.degraded = true;
      logTaskDesk({
        module: "jobs",
        message: "jobs.failure",
        level: "error",
        result: "degraded",
      });
    }
  }
  return outcome;
}

async function runCleanup(
  kind: CleanupKind,
): Promise<AttachmentCleanupOutcome> {
  const job =
    kind === "pending" ? "attachment-pending-cleanup" : "attachment-gc";
  const startedAt = Date.now();
  return withJobLease(
    job,
    async () => {
      const outcome: AttachmentCleanupOutcome = {
        scanned: 0,
        deleted: 0,
        retained: 0,
        degraded: false,
      };
      let cursor = resumeAfter[kind];
      const initialCursor = cursor;
      let wrapped = false;
      while (outcome.scanned < MAX_ROWS_PER_RUN) {
        const candidates = await db
          .select({ id: attachmentTable.id })
          .from(attachmentTable)
          .where(
            and(
              eligibility(kind),
              cursor ? gt(attachmentTable.id, cursor) : undefined,
              wrapped && initialCursor
                ? sql`${attachmentTable.id} <= ${initialCursor}`
                : undefined,
            ),
          )
          .orderBy(asc(attachmentTable.id))
          .limit(Math.min(20, MAX_ROWS_PER_RUN - outcome.scanned));
        if (!candidates.length) {
          if (!wrapped && initialCursor) {
            cursor = undefined;
            wrapped = true;
            continue;
          }
          resumeAfter[kind] = undefined;
          break;
        }
        for (const candidate of candidates) {
          await assertJobExecutionOwned();
          cursor = candidate.id;
          resumeAfter[kind] = cursor;
          outcome.scanned++;
          try {
            if (await cleanAttachment(candidate.id, kind)) outcome.deleted++;
            else outcome.retained++;
          } catch {
            outcome.retained++;
            outcome.degraded = true;
            logTaskDesk({
              module: "jobs",
              message: "jobs.failure",
              level: "error",
              result: "degraded",
            });
          }
        }
      }
      if (kind === "deleted") {
        const queue = await collectQueuedAttachmentObjects(
          MAX_ROWS_PER_RUN - Math.min(outcome.scanned, MAX_ROWS_PER_RUN - 20),
        );
        outcome.scanned += queue.scanned;
        outcome.deleted += queue.deleted;
        outcome.retained += queue.retained;
        outcome.degraded ||= queue.degraded;
        const assets = await collectDetachedAssets(MAX_ROWS_PER_RUN);
        outcome.scanned += assets.scanned;
        outcome.deleted += assets.deleted;
        outcome.retained += assets.retained;
        outcome.degraded ||= assets.degraded;
      }
      console.log(
        JSON.stringify({ job, durationMs: Date.now() - startedAt, ...outcome }),
      );
      return outcome;
    },
    () => ({ scanned: 0, deleted: 0, retained: 0, degraded: false }),
    kind === "pending" ? 5 * 60_000 : 30 * 60_000,
  );
}

export function cleanupPendingAttachments() {
  return runCleanup("pending");
}
export function collectDeletedAttachments() {
  return runCleanup("deleted");
}
