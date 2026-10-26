/**
 * Whole-run dry run (IM-2). Reads the entire source through the adapter and reports, per source
 * type, what execution would create, update, skip and reject, plus the loss report. Nothing is
 * written. The report digest binds the mapping version and every per-record decision, and is what
 * the run-level approval and `execute` bind to: any mapping change produces a different digest.
 */
import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Transaction } from "../../database/executor";
import { withCreationTransaction } from "../../work-item/create-preparation";
import type { ImportActor } from "../access";
import { sha256Canonical } from "../content";
import type { ImportRecord } from "../schema";
import {
  type ClassifiedRow,
  classifyImportRecords,
  countOutcomes as countRows,
} from "../service";
import type {
  AdapterConnection,
  ImportSourceAdapter,
  LossInput,
  SourceRecord,
} from "./adapter";
import { loadResolveContext } from "./context";
import { detectParentCycles } from "./derive";
import {
  type Completeness,
  completeness,
  indexMapping,
  type MappingEntry,
  mappingDigest,
  type ResolveContext,
  type ResolvedRecord,
  resolveRecord,
  type WriterCapabilities,
} from "./mapping";

export const MAX_ENGINE_PAGES = 100_000;
const SAMPLE_LIMIT = 20;
const recordKey = (sourceType: string, sourceId: string) =>
  JSON.stringify([sourceType, sourceId]);

export type PageDecision = {
  resolved: ResolvedRecord;
  /** Final decision for this record. Engine-level rejects carry their own fixed code. */
  row: ClassifiedRow;
};

/** Pages from the adapter, bounded and cursor-checked (a stuck cursor is a source error). */
export async function* readAllPages(
  adapter: ImportSourceAdapter,
  connection: AdapterConnection,
  startCursor: string | null,
  pageSize: number,
) {
  const seen = new Set<string>();
  let cursor = startCursor;
  for (let pages = 0; pages < MAX_ENGINE_PAGES; pages += 1) {
    const page = await adapter.readPage(connection, cursor, pageSize);
    yield { cursor, page };
    if (page.nextCursor === null) return;
    if (page.nextCursor === cursor || seen.has(page.nextCursor))
      throw new HTTPException(502, {
        message: "Source cursor did not advance",
      });
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new HTTPException(502, { message: "Source exceeded the page limit" });
}

/** Resolves a page in order; a repeated source identity inside one page is rejected, not merged. */
export function resolvePage(
  entries: readonly MappingEntry[],
  records: readonly SourceRecord[],
  options: {
    capabilities: WriterCapabilities;
    brokenParents?: ReadonlySet<string>;
    context?: ResolveContext;
  },
): ResolvedRecord[] {
  const index = indexMapping(entries);
  const seen = new Set<string>();
  return records.map((source) => {
    const key = recordKey(source.sourceType, source.sourceId);
    const resolved = resolveRecord(index, source, options);
    if (seen.has(key))
      return {
        ...resolved,
        record: null,
        rejects: ["duplicate_source_record"],
      };
    seen.add(key);
    return resolved;
  });
}

/** Classifies one resolved page: engine rejects first-class, writable records via the writer rules. */
export async function decidePage(
  tx: Transaction,
  run: Parameters<typeof classifyImportRecords>[1],
  actor: ImportActor,
  resolved: ResolvedRecord[],
): Promise<PageDecision[]> {
  const writable = resolved.filter(
    (r): r is ResolvedRecord & { record: ImportRecord } => r.record !== null,
  );
  const rows = await classifyImportRecords(
    tx,
    run,
    actor,
    writable.map((r) => r.record),
  );
  const byKey = new Map(
    writable.map((r, i) => [recordKey(r.sourceType, r.sourceId), rows[i]]),
  );
  return resolved.map((r) => ({
    resolved: r,
    row: r.record
      ? (byKey.get(recordKey(r.sourceType, r.sourceId)) as ClassifiedRow)
      : {
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          outcome: "reject" as const,
          code: r.rejects[0] ?? "invalid_record",
        },
  }));
}

export type DryRunLoss = {
  sourceType: string;
  code: string;
  detailCode: string;
  count: number;
};

export type DryRunReport = {
  digest: string;
  mappingVersion: number;
  complete: boolean;
  generatedAt: string;
  counts: ReturnType<typeof countRows>;
  /** created + updated: the records execution would write. */
  writes: number;
  byType: Record<string, ReturnType<typeof countRows>>;
  rejectionCodes: Record<string, number>;
  losses: DryRunLoss[];
  lossRecords: number;
  /** Source records whose parent edge is broken to resolve a cycle. */
  cycleBreaks: string[];
  samples: {
    rejects: Array<{ sourceType: string; sourceId: string; code: string }>;
    losses: Array<{
      sourceType: string;
      sourceId: string;
      code: string;
      detailCode: string;
    }>;
  };
  completeness: Completeness;
};

function addLoss(
  map: Map<string, DryRunLoss>,
  sourceType: string,
  loss: LossInput,
  delta = 1,
) {
  const detailCode = loss.detailCode ?? "";
  const key = JSON.stringify([sourceType, loss.code, detailCode]);
  const current = map.get(key);
  if (current) current.count += delta;
  else map.set(key, { sourceType, code: loss.code, detailCode, count: delta });
}

export async function computeWholeRunDryRun(input: {
  actor: ImportActor;
  run: Parameters<typeof classifyImportRecords>[1];
  entries: MappingEntry[];
  mappingVersion: number;
  adapter: ImportSourceAdapter;
  connection: AdapterConnection;
  capabilities: WriterCapabilities;
}): Promise<DryRunReport> {
  const { actor, run, entries, adapter, connection, capabilities } = input;
  const rows: ClassifiedRow[] = [];
  const byTypeRows = new Map<string, ClassifiedRow[]>();
  const losses = new Map<string, DryRunLoss>();
  const rejectionCodes: Record<string, number> = {};
  const parents = new Map<string, string>();
  const rowHash = createHash("sha256");
  const samples: DryRunReport["samples"] = { rejects: [], losses: [] };
  let lossRecords = 0;
  const pageSize = Math.min(Math.max(adapter.chunkSize, 1), 500);
  const context = await loadResolveContext(db, run, entries);

  for await (const { page } of readAllPages(
    adapter,
    connection,
    null,
    pageSize,
  )) {
    const sources = new Map(
      page.records.map((s) => [recordKey(s.sourceType, s.sourceId), s]),
    );
    const resolved = resolvePage(entries, page.records, {
      capabilities,
      context,
    });
    const decisions = await withCreationTransaction((tx) =>
      decidePage(tx, run, actor, resolved),
    );
    for (const { resolved: r, row } of decisions) {
      rows.push(row);
      const typed = byTypeRows.get(r.sourceType) ?? [];
      typed.push(row);
      byTypeRows.set(r.sourceType, typed);
      const own = [...r.losses];
      if (row.outcome === "reject") {
        rejectionCodes[row.code ?? "invalid_record"] =
          (rejectionCodes[row.code ?? "invalid_record"] ?? 0) + 1;
        own.push({ code: "record_rejected", detailCode: row.code });
        if (samples.rejects.length < SAMPLE_LIMIT)
          samples.rejects.push({
            sourceType: r.sourceType,
            sourceId: r.sourceId,
            code: row.code ?? "invalid_record",
          });
      }
      if (own.length) lossRecords += 1;
      for (const loss of own) {
        addLoss(losses, r.sourceType, loss);
        if (samples.losses.length < SAMPLE_LIMIT)
          samples.losses.push({
            sourceType: r.sourceType,
            sourceId: r.sourceId,
            code: loss.code,
            detailCode: loss.detailCode ?? "",
          });
      }
      const source = sources.get(recordKey(r.sourceType, r.sourceId));
      if (source?.parentSourceId)
        parents.set(
          recordKey(r.sourceType, r.sourceId),
          recordKey(r.sourceType, source.parentSourceId),
        );
      rowHash.update(
        `${r.sourceType}\u0000${r.sourceId}\u0000${r.sourceHash}\u0000${row.outcome}\u0000${row.code ?? ""}\n`,
      );
    }
  }

  const cycleBreaks = detectParentCycles(parents);
  for (const key of cycleBreaks) {
    const [sourceType] = JSON.parse(key) as [string, string];
    addLoss(losses, sourceType, { code: "parent_cycle_broken" });
    // The broken edge is no longer a parent the writer would be asked to persist.
    if (!capabilities.parent)
      addLoss(
        losses,
        sourceType,
        { code: "writer_unavailable", detailCode: "parent" },
        -1,
      );
  }
  const lossList = [...losses.values()]
    .filter((l) => l.count > 0)
    .sort((a, b) =>
      JSON.stringify([a.sourceType, a.code, a.detailCode]).localeCompare(
        JSON.stringify([b.sourceType, b.code, b.detailCode]),
      ),
    );
  const counts = countRows(rows);
  const byType = Object.fromEntries(
    [...byTypeRows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, list]) => [type, countRows(list)]),
  );
  const mappingState = completeness(entries);
  const digest = sha256Canonical({
    runId: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    pluginId: run.pluginId,
    sourceRef: run.sourceRef,
    mappingVersion: input.mappingVersion,
    mapping: mappingDigest(entries),
    total: counts.processed,
    counts,
    rows: rowHash.digest("hex"),
    cycleBreaks,
  });
  return {
    digest,
    mappingVersion: input.mappingVersion,
    complete: mappingState.complete,
    generatedAt: new Date().toISOString(),
    counts,
    writes: counts.created + counts.updated,
    byType,
    rejectionCodes,
    losses: lossList,
    lossRecords,
    cycleBreaks,
    samples,
    completeness: mappingState,
  };
}
