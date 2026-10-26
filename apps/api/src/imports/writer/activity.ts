import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "../../database";
import type { ImportRecord } from "../schema";
import { resolveImportPerson } from "./people";
import { readSourceTime } from "./time";
import { type ImportWriterContext, recordLoss } from "./types";

const ACTIVITY = schema.activityTable;

/**
 * Give the item's `created` journal row its historical identity (IM-6): the source creation time
 * and the source author, with the `imported` marker and the real write time in `imported_at`.
 * Only a row that is still native (`origin` null) is touched, so a rerun is a no-op. The work item's
 * own `created_at`/SLA columns are deliberately not moved. `audit_log` is never touched.
 */
export async function stampCreatedActivityAsImported(
  ctx: ImportWriterContext,
  input: { workItemId: string; record: ImportRecord },
) {
  const { record } = input;
  const created = readSourceTime(record.sourceCreatedAt, ctx.now, ctx.now);
  if (!created.valid)
    recordLoss(ctx, {
      code: "timestamp_invalid",
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      entity: "work_item",
    });
  let actor: { personId: string } | null = null;
  if (record.sourceAuthorEmail) {
    const person = await resolveImportPerson(ctx, {
      email: record.sourceAuthorEmail,
      name: record.sourceAuthorName,
    });
    if (person) actor = { personId: person.personId };
    else
      recordLoss(ctx, {
        code: "author_unresolved",
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "work_item",
      });
  }
  await ctx.tx
    .update(ACTIVITY)
    .set({
      origin: "imported",
      importedAt: ctx.now,
      ...(created.valid ? { createdAt: created.at } : {}),
      ...(actor ? { actorId: actor.personId, actorType: "person" } : {}),
    })
    .where(
      and(
        eq(ACTIVITY.workItemId, input.workItemId),
        eq(ACTIVITY.workspaceId, ctx.workspaceId),
        eq(ACTIVITY.verb, "created"),
        isNull(ACTIVITY.origin),
      ),
    );
}

export type HistoryWriteCounts = { created: number; duplicate: number };

/**
 * Write the source's change history as journal rows (IM-6: "Activity rows, so the journal
 * survives"). Always `internal`: a historical field name has no CA-7 visibility mapping, and an
 * unmapped pair fails closed. Dedupe key is the entry's source id kept in `payload`, so a rerun adds
 * nothing. Entries with an implausible time are reported and skipped, never stamped with today.
 */
export async function writeImportedHistory(
  ctx: ImportWriterContext,
  input: { workItemId: string; record: ImportRecord },
): Promise<HistoryWriteCounts> {
  const counts: HistoryWriteCounts = { created: 0, duplicate: 0 };
  const { record, workItemId } = input;
  const entries = record.history ?? [];
  if (!entries.length) return counts;
  const existing = await ctx.tx
    .select({ id: sql<string>`${ACTIVITY.payload}->>'importSourceId'` })
    .from(ACTIVITY)
    .where(
      and(
        eq(ACTIVITY.workItemId, workItemId),
        eq(ACTIVITY.workspaceId, ctx.workspaceId),
        eq(ACTIVITY.origin, "imported"),
        sql`${ACTIVITY.payload}->>'importSourceId' IS NOT NULL`,
      ),
    );
  const seen = new Set(existing.map((row) => row.id));
  for (const entry of entries) {
    if (seen.has(entry.sourceId)) {
      counts.duplicate += 1;
      continue;
    }
    const when = readSourceTime(entry.at, ctx.now, ctx.now);
    if (!when.valid) {
      recordLoss(ctx, {
        code: "history_invalid",
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "history",
        entitySourceId: entry.sourceId,
      });
      continue;
    }
    let actorId: string | null = null;
    if (entry.authorEmail) {
      const person = await resolveImportPerson(ctx, {
        email: entry.authorEmail,
        name: entry.authorName,
      });
      if (person) actorId = person.personId;
      else
        recordLoss(ctx, {
          code: "author_unresolved",
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          entity: "history",
          entitySourceId: entry.sourceId,
        });
    }
    try {
      await ctx.tx.transaction(async (savepoint) => {
        await savepoint.insert(ACTIVITY).values({
          workspaceId: ctx.workspaceId,
          workItemId,
          actorId,
          actorType: actorId ? "person" : "system",
          verb: "updated",
          field: entry.field,
          oldValue: entry.from ?? null,
          newValue: entry.to ?? null,
          payload: { importSourceId: entry.sourceId, imported: true },
          visibility: "internal",
          createdAt: when.at,
          origin: "imported",
          importedAt: ctx.now,
        });
      });
      seen.add(entry.sourceId);
      counts.created += 1;
    } catch {
      recordLoss(ctx, {
        code: "history_invalid",
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "history",
        entitySourceId: entry.sourceId,
      });
    }
  }
  return counts;
}
