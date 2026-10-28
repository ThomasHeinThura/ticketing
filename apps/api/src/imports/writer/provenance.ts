import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import type { ImportRecord } from "../schema";
import { type ImportWriterContext, recordLoss } from "./types";

const LINK = schema.importProvenanceTable;
const RECORD_LINK = schema.importRecordLinkTable;

/**
 * The provenance namespace (P6-R1-09): workspace, plugin, source reference (`system`), entity type
 * and external id. The plugin id keeps two plugins that share a source reference apart.
 */
const PROVENANCE_KEY = [
  LINK.workspaceId,
  LINK.pluginId,
  LINK.system,
  LINK.entityType,
  LINK.externalId,
];

export type DeferredLinks = {
  /** The item's own source identity, so a deferred loss can be reported against it. */
  self?: { sourceType: string; sourceId: string };
  parent?: { sourceType: string; sourceId: string };
  relations?: Array<{
    type: "relates" | "blocks" | "duplicates" | "precedes" | "requires";
    target: { sourceType: string; sourceId: string };
  }>;
};

export function workItemExternalId(sourceType: string, sourceId: string) {
  return `${sourceType}:${sourceId}`;
}

export function commentExternalId(
  sourceType: string,
  sourceId: string,
  commentSourceId: string,
) {
  return `${sourceType}:${sourceId}#comment:${commentSourceId}`;
}

export function attachmentExternalId(
  sourceType: string,
  sourceId: string,
  attachmentSourceId: string,
) {
  return `${sourceType}:${sourceId}#attachment:${attachmentSourceId}`;
}

function dateOrNull(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The work item's provenance row (IM-5): source system, id and URL, plus the SOURCE created,
 * updated and resolved times. The work item's own created/updated/resolved columns are not moved:
 * SLA and metrics read them. The journal row `created` carries the historical time instead.
 * Idempotent: a rerun refreshes the row and clears any stale marker. Returns false (and reports
 * `provenance_duplicate`) when the same source identity is already claimed by another work item.
 */
export async function upsertWorkItemProvenance(
  ctx: ImportWriterContext,
  input: {
    workItemId: string;
    record: ImportRecord;
    deferred: DeferredLinks | null;
  },
): Promise<boolean> {
  const { record } = input;
  const values = {
    resourceType: "import",
    externalId: workItemExternalId(record.sourceType, record.sourceId),
    url: record.sourceUrl ?? null,
    title: record.item.title.slice(0, 500),
    workspaceId: ctx.workspaceId,
    workItemId: input.workItemId,
    entityType: "work_item" as const,
    entityId: input.workItemId,
    system: ctx.system,
    pluginId: ctx.pluginId,
    projectId: ctx.projectId,
    organisationId: ctx.organisationId,
    origin: "imported" as const,
    importRunId: ctx.runId,
    sourceCreatedAt: dateOrNull(record.sourceCreatedAt),
    sourceUpdatedAt: dateOrNull(record.sourceUpdatedAt),
    sourceResolvedAt: dateOrNull(record.sourceResolvedAt),
    lastSeenAt: ctx.now,
    staleAt: null,
    deferredLinks: input.deferred,
  };
  const written = await ctx.tx
    .insert(LINK)
    .values(values)
    .onConflictDoUpdate({
      target: PROVENANCE_KEY,
      targetWhere: sql`${LINK.origin} = 'imported'`,
      // A row already claimed for a DIFFERENT work item is never taken over (P6-R1-09).
      setWhere: eq(LINK.workItemId, input.workItemId),
      set: {
        url: values.url,
        title: values.title,
        workItemId: values.workItemId,
        entityId: values.entityId,
        projectId: values.projectId,
        importRunId: values.importRunId,
        sourceCreatedAt: values.sourceCreatedAt,
        sourceUpdatedAt: values.sourceUpdatedAt,
        sourceResolvedAt: values.sourceResolvedAt,
        lastSeenAt: values.lastSeenAt,
        staleAt: null,
        deferredLinks: values.deferredLinks,
        updatedAt: ctx.now,
      },
    })
    .returning({ id: LINK.id });
  if (!written.length) {
    recordLoss(ctx, {
      code: "provenance_duplicate",
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      entity: "work_item",
    });
    return false;
  }
  return true;
}

/**
 * Claim the provenance row of one imported sub-entity (comment or attachment) BEFORE writing the
 * entity. Returns `claimed: true` for the first time this source entity is seen (the caller then
 * writes it with `entityId`) and `claimed: false` on a rerun, so reruns never duplicate comments or
 * attachments. Run inside the caller's savepoint so a failed entity write rolls the claim back.
 * `conflict: true` means the source entity is already claimed for a DIFFERENT work item: nothing is
 * refreshed or written and the caller reports `provenance_duplicate`.
 */
export async function claimEntityProvenance(
  ctx: ImportWriterContext,
  input: {
    entityType: "comment" | "attachment";
    externalId: string;
    entityId: string;
    workItemId: string;
    url?: string | undefined;
    title?: string | undefined;
    sourceCreatedAt?: Date | null;
    sourceUpdatedAt?: Date | null;
  },
): Promise<{ claimed: boolean; conflict: boolean; entityId: string }> {
  const [row] = await ctx.tx
    .insert(LINK)
    .values({
      resourceType: "import",
      externalId: input.externalId,
      url: input.url ?? null,
      title: input.title?.slice(0, 500) ?? null,
      workspaceId: ctx.workspaceId,
      workItemId: input.workItemId,
      entityType: input.entityType,
      entityId: input.entityId,
      system: ctx.system,
      pluginId: ctx.pluginId,
      projectId: ctx.projectId,
      organisationId: ctx.organisationId,
      origin: "imported",
      importRunId: ctx.runId,
      sourceCreatedAt: input.sourceCreatedAt ?? null,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      lastSeenAt: ctx.now,
    })
    .onConflictDoUpdate({
      target: PROVENANCE_KEY,
      targetWhere: sql`${LINK.origin} = 'imported'`,
      setWhere: eq(LINK.workItemId, input.workItemId),
      set: { lastSeenAt: ctx.now, staleAt: null, importRunId: ctx.runId },
    })
    .returning({
      entityId: LINK.entityId,
      inserted: sql<boolean>`(xmax = 0)`,
    });
  if (!row) return { claimed: false, conflict: true, entityId: input.entityId };
  return {
    claimed: row.inserted === true,
    conflict: false,
    entityId: row.entityId ?? input.entityId,
  };
}

/**
 * Whether a sub-entity's provenance row already exists, used before an out-of-transaction download.
 * A row that exists is also MARKED SEEN by this run (import run id, last seen, stale cleared), the
 * way a comment's claim does, so a rerun that skips the download does not leave the attachment
 * looking deleted at the source (P6-R1-05). A row absent from the source is never touched, so it
 * is marked stale by `markMissingImportSourcesStale`.
 */
export async function touchEntityProvenance(
  ctx: ImportWriterContext,
  input: {
    entityType: "comment" | "attachment";
    externalId: string;
  },
): Promise<boolean> {
  const rows = await ctx.tx
    .update(LINK)
    .set({ importRunId: ctx.runId, lastSeenAt: ctx.now, staleAt: null })
    .where(
      and(
        eq(LINK.workspaceId, ctx.workspaceId),
        eq(LINK.pluginId, ctx.pluginId),
        eq(LINK.system, ctx.system),
        eq(LINK.entityType, input.entityType),
        eq(LINK.externalId, input.externalId),
        eq(LINK.origin, "imported"),
      ),
    )
    .returning({ id: LINK.id });
  return rows.length > 0;
}

/**
 * Mark the provenance of everything a COMPLETE enumeration of the source did not touch as stale
 * (edge case: "Source record deleted after import - target retained; the provenance link is marked
 * stale"). A record is "touched" when its ledger link and provenance rows carry `currentRunId`.
 * Never deletes the work item. Lane A's runner calls this once per run, and only when the source was
 * enumerated in full: a partial run would otherwise mark the rest of the source stale.
 */
export async function markMissingImportSourcesStale(
  tx: Transaction,
  input: {
    workspaceId: string;
    pluginId: string;
    sourceRef: string;
    currentRunId: string;
    now?: Date;
  },
): Promise<{ links: number; provenance: number }> {
  const now = input.now ?? new Date();
  const links = await tx
    .update(RECORD_LINK)
    .set({ staleAt: now })
    .where(
      and(
        eq(RECORD_LINK.workspaceId, input.workspaceId),
        eq(RECORD_LINK.pluginId, input.pluginId),
        eq(RECORD_LINK.sourceRef, input.sourceRef),
        ne(RECORD_LINK.importRunId, input.currentRunId),
        isNull(RECORD_LINK.staleAt),
      ),
    )
    .returning({ id: RECORD_LINK.id });
  const provenance = await tx
    .update(LINK)
    .set({ staleAt: now, updatedAt: now })
    .where(
      and(
        eq(LINK.workspaceId, input.workspaceId),
        eq(LINK.pluginId, input.pluginId),
        eq(LINK.system, input.sourceRef),
        eq(LINK.origin, "imported"),
        ne(LINK.importRunId, input.currentRunId),
        isNull(LINK.staleAt),
        isNotNull(LINK.importRunId),
      ),
    )
    .returning({ id: LINK.id });
  return { links: links.length, provenance: provenance.length };
}

/**
 * A source record that was seen in this run but not written (rejected by the engine or the target)
 * is still PRESENT in the source. Mark its existing ledger link and provenance rows as seen by this
 * run, so `markMissingImportSourcesStale` does not report it as deleted at the source. A record that
 * was never imported has nothing to touch.
 */
export async function touchSeenImportSources(
  tx: Transaction,
  input: {
    workspaceId: string;
    pluginId: string;
    sourceRef: string;
    currentRunId: string;
    records: ReadonlyArray<{ sourceType: string; sourceId: string }>;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  for (const record of input.records) {
    await tx
      .update(RECORD_LINK)
      .set({ importRunId: input.currentRunId, lastSeenAt: now })
      .where(
        and(
          eq(RECORD_LINK.workspaceId, input.workspaceId),
          eq(RECORD_LINK.pluginId, input.pluginId),
          eq(RECORD_LINK.sourceRef, input.sourceRef),
          eq(RECORD_LINK.sourceType, record.sourceType),
          eq(RECORD_LINK.sourceId, record.sourceId),
        ),
      );
    const externalId = workItemExternalId(record.sourceType, record.sourceId);
    await tx
      .update(LINK)
      .set({ importRunId: input.currentRunId, lastSeenAt: now })
      .where(
        and(
          eq(LINK.workspaceId, input.workspaceId),
          eq(LINK.pluginId, input.pluginId),
          eq(LINK.system, input.sourceRef),
          eq(LINK.origin, "imported"),
          sql`(${LINK.externalId} = ${externalId} OR starts_with(${LINK.externalId}, ${`${externalId}#`}))`,
        ),
      );
  }
}
