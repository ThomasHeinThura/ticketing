import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import type { ImportRecord, ImportRelation } from "../schema";
import type { DeferredLinks } from "./provenance";
import { type ImportWriterContext, recordLoss } from "./types";

const WORK_ITEM = schema.workItemTable;
const RELATION = schema.workItemRelationTable;
const RECORD_LINK = schema.importRecordLinkTable;
const PROVENANCE = schema.importProvenanceTable;
const MAX_ANCESTOR_WALK = 1000;

/** Live work item imported from this source identity (ledger lookup), scoped to the workspace. */
export async function resolveImportedWorkItem(
  tx: Transaction,
  input: {
    workspaceId: string;
    pluginId: string;
    sourceRef: string;
    sourceType: string;
    sourceId: string;
  },
): Promise<{ id: string; projectId: string } | null> {
  const [row] = await tx
    .select({ id: WORK_ITEM.id, projectId: WORK_ITEM.projectId })
    .from(RECORD_LINK)
    .innerJoin(WORK_ITEM, eq(WORK_ITEM.id, RECORD_LINK.targetId))
    .where(
      and(
        eq(RECORD_LINK.workspaceId, input.workspaceId),
        eq(RECORD_LINK.pluginId, input.pluginId),
        eq(RECORD_LINK.sourceRef, input.sourceRef),
        eq(RECORD_LINK.sourceType, input.sourceType),
        eq(RECORD_LINK.sourceId, input.sourceId),
        eq(RECORD_LINK.targetType, "work_item"),
        eq(WORK_ITEM.workspaceId, input.workspaceId),
        isNull(WORK_ITEM.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Would making `parentId` the parent of `childId` make `childId` its own ancestor? */
export async function parentWouldCycle(
  tx: Transaction,
  childId: string,
  parentId: string,
): Promise<boolean> {
  let current: string | null = parentId;
  for (let depth = 0; current && depth < MAX_ANCESTOR_WALK; depth += 1) {
    if (current === childId) return true;
    const [row]: { parentId: string | null }[] = await tx
      .select({ parentId: WORK_ITEM.parentId })
      .from(WORK_ITEM)
      .where(eq(WORK_ITEM.id, current))
      .limit(1);
    current = row?.parentId ?? null;
  }
  return current !== null; // an unbounded chain is treated as a cycle
}

type ParentOutcome = "set" | "kept" | "pending" | "cycle" | "unavailable";

/**
 * Set the imported parent. A circular source hierarchy is detected in application code BEFORE the
 * write, the offending link is not created and is reported (`parent_cycle_broken`); the database
 * trigger is only the backstop. An existing parent is never replaced: an import fills a gap, it does
 * not undo what a person did after the first import.
 */
export async function applyImportedParent(
  ctx: ImportWriterContext,
  input: {
    workItemId: string;
    ref: { sourceType: string; sourceId: string };
  },
): Promise<ParentOutcome> {
  const target = await resolveImportedWorkItem(ctx.tx, {
    workspaceId: ctx.workspaceId,
    pluginId: ctx.pluginId,
    sourceRef: ctx.system,
    sourceType: input.ref.sourceType,
    sourceId: input.ref.sourceId,
  });
  if (!target) return "pending";
  if (target.projectId !== ctx.projectId) return "unavailable";
  if (target.id === input.workItemId) return "cycle";
  const [current] = await ctx.tx
    .select({ parentId: WORK_ITEM.parentId, version: WORK_ITEM.version })
    .from(WORK_ITEM)
    .where(eq(WORK_ITEM.id, input.workItemId))
    .limit(1);
  if (!current) return "unavailable";
  if (current.parentId !== null) return "kept";
  if (await parentWouldCycle(ctx.tx, input.workItemId, target.id))
    return "cycle";
  try {
    await ctx.tx.transaction(async (savepoint) => {
      await savepoint
        .update(WORK_ITEM)
        .set({
          parentId: target.id,
          version: sql`${WORK_ITEM.version} + 1`,
        })
        .where(
          and(eq(WORK_ITEM.id, input.workItemId), isNull(WORK_ITEM.parentId)),
        );
    });
  } catch {
    return "cycle"; // the trigger refused: report rather than fail the chunk
  }
  return "set";
}

type RelationOutcome = "created" | "exists" | "pending" | "invalid";

export async function applyImportedRelation(
  ctx: ImportWriterContext,
  input: { workItemId: string; relation: ImportRelation },
): Promise<RelationOutcome> {
  const target = await resolveImportedWorkItem(ctx.tx, {
    workspaceId: ctx.workspaceId,
    pluginId: ctx.pluginId,
    sourceRef: ctx.system,
    sourceType: input.relation.target.sourceType,
    sourceId: input.relation.target.sourceId,
  });
  if (!target) return "pending";
  if (target.id === input.workItemId) return "invalid";
  try {
    return await ctx.tx.transaction(async (savepoint) => {
      const inserted = await savepoint
        .insert(RELATION)
        .values({
          sourceId: input.workItemId,
          targetId: target.id,
          type: input.relation.type,
        })
        .onConflictDoNothing()
        .returning({ id: RELATION.id });
      return inserted.length ? ("created" as const) : ("exists" as const);
    });
  } catch {
    return "invalid";
  }
}

export type RelationWriteCounts = {
  relationsCreated: number;
  relationsExisting: number;
  parentsSet: number;
};

/**
 * Apply a record's parent and relations. Targets that are not imported yet are deferred (stored on
 * the item's provenance row) and resolved later by `resolveDeferredImportLinks`; the returned
 * `deferred` value is what the provenance row must carry.
 */
export async function writeImportedLinks(
  ctx: ImportWriterContext,
  input: { workItemId: string; record: ImportRecord },
): Promise<{ deferred: DeferredLinks | null; counts: RelationWriteCounts }> {
  const { record, workItemId } = input;
  const counts: RelationWriteCounts = {
    relationsCreated: 0,
    relationsExisting: 0,
    parentsSet: 0,
  };
  const deferred: DeferredLinks = {
    self: { sourceType: record.sourceType, sourceId: record.sourceId },
  };
  if (record.parent) {
    const outcome = await applyImportedParent(ctx, {
      workItemId,
      ref: record.parent,
    });
    if (outcome === "set") counts.parentsSet += 1;
    else if (outcome === "pending") deferred.parent = record.parent;
    else if (outcome === "cycle")
      recordLoss(ctx, {
        code: "parent_cycle_broken",
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "parent",
        entitySourceId: `${record.parent.sourceType}:${record.parent.sourceId}`,
      });
    else if (outcome === "unavailable")
      recordLoss(ctx, {
        code: "parent_unavailable",
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "parent",
        entitySourceId: `${record.parent.sourceType}:${record.parent.sourceId}`,
      });
  }
  for (const relation of record.relations ?? []) {
    const outcome = await applyImportedRelation(ctx, { workItemId, relation });
    if (outcome === "created") counts.relationsCreated += 1;
    else if (outcome === "exists") counts.relationsExisting += 1;
    else if (outcome === "pending")
      deferred.relations = [
        ...(deferred.relations ?? []),
        { type: relation.type, target: relation.target },
      ];
    else
      recordLoss(ctx, {
        code: "relation_invalid",
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "relation",
        entitySourceId: `${relation.target.sourceType}:${relation.target.sourceId}`,
      });
  }
  return {
    deferred: deferred.parent || deferred.relations ? deferred : null,
    counts,
  };
}

const MAX_DEFERRED_ROWS = 2000;

/**
 * Retry parents and relations whose target had not been imported when the item was written (the
 * target arrived in a later chunk). Call after each chunk and, with `finalize: true`, once at the end
 * of the run: whatever is still unresolved is then reported as a loss (`parent_unavailable`,
 * `relation_target_unavailable`) and its deferral cleared, so nothing is dropped silently.
 */
export async function resolveDeferredImportLinks(
  ctx: Omit<ImportWriterContext, "tx"> & { tx: Transaction },
  options: { finalize?: boolean } = {},
): Promise<{ resolved: number; remaining: number; processed: number }> {
  const rows = await ctx.tx
    .select({
      id: PROVENANCE.id,
      workItemId: PROVENANCE.workItemId,
      externalId: PROVENANCE.externalId,
      deferred: PROVENANCE.deferredLinks,
    })
    .from(PROVENANCE)
    .where(
      and(
        eq(PROVENANCE.workspaceId, ctx.workspaceId),
        eq(PROVENANCE.system, ctx.system),
        eq(PROVENANCE.entityType, "work_item"),
        isNotNull(PROVENANCE.deferredLinks),
      ),
    )
    .limit(MAX_DEFERRED_ROWS);
  let resolved = 0;
  let remaining = 0;
  for (const row of rows) {
    if (!row.workItemId) continue;
    const deferred = (row.deferred ?? {}) as DeferredLinks;
    const sourceType = deferred.self?.sourceType ?? "unknown";
    const sourceId = deferred.self?.sourceId ?? row.externalId;
    const next: DeferredLinks = {};
    if (deferred.parent) {
      const outcome = await applyImportedParent(ctx, {
        workItemId: row.workItemId,
        ref: deferred.parent,
      });
      const label = `${deferred.parent.sourceType}:${deferred.parent.sourceId}`;
      if (outcome === "pending") {
        if (options.finalize)
          recordLoss(ctx, {
            code: "parent_unavailable",
            sourceType,
            sourceId,
            entity: "parent",
            entitySourceId: label,
          });
        else next.parent = deferred.parent;
      } else if (outcome === "cycle")
        recordLoss(ctx, {
          code: "parent_cycle_broken",
          sourceType,
          sourceId,
          entity: "parent",
          entitySourceId: label,
        });
      else if (outcome === "unavailable")
        recordLoss(ctx, {
          code: "parent_unavailable",
          sourceType,
          sourceId,
          entity: "parent",
          entitySourceId: label,
        });
      else resolved += 1;
    }
    for (const relation of deferred.relations ?? []) {
      const outcome = await applyImportedRelation(ctx, {
        workItemId: row.workItemId,
        relation,
      });
      const label = `${relation.target.sourceType}:${relation.target.sourceId}`;
      if (outcome === "pending") {
        if (options.finalize)
          recordLoss(ctx, {
            code: "relation_target_unavailable",
            sourceType,
            sourceId,
            entity: "relation",
            entitySourceId: label,
          });
        else next.relations = [...(next.relations ?? []), relation];
      } else if (outcome === "invalid")
        recordLoss(ctx, {
          code: "relation_invalid",
          sourceType,
          sourceId,
          entity: "relation",
          entitySourceId: label,
        });
      else resolved += 1;
    }
    const keep = next.parent || next.relations;
    if (keep) {
      remaining += 1;
      next.self = deferred.self;
    }
    await ctx.tx
      .update(PROVENANCE)
      .set({ deferredLinks: keep ? next : null, updatedAt: ctx.now })
      .where(eq(PROVENANCE.id, row.id));
  }
  return { resolved, remaining, processed: rows.length };
}
