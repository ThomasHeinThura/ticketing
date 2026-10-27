/**
 * Whole-run dry run (IM-2). Reads the entire source through the adapter and reports, per source
 * type, what execution would create, update, skip and reject, plus the loss report. Nothing is
 * written. The report digest binds the mapping version and every per-record decision, and is what
 * the run-level approval and `execute` bind to: any mapping change produces a different digest.
 *
 * The dry run is incremental so it can run as a background job (`setup-job.ts`): `DryRunState` is
 * plain JSON (counts, loss map, samples, parent edges and a CHAINED row digest, none of it a live
 * hash object), `dryRunPage` folds one page into it, and `finishDryRun` turns it into the report. A
 * checkpointed state plus the cursor of the next page is therefore enough to resume after a kill.
 */
import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { Transaction } from "../../database/executor";
import { withCreationTransaction } from "../../work-item/create-preparation";
import type { ImportActor } from "../access";
import { sha256Canonical } from "../content";
import type { ImportRecord } from "../schema";
import {
  type ClassifiedRow,
  classifyImportRecords,
  type countOutcomes as countRows,
} from "../service";
import type {
  AdapterConnection,
  ImportSourceAdapter,
  LossInput,
  SourceRecord,
} from "./adapter";
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

/** Pages one run may read; a source that never ends is a source error, not an endless job. */
export const MAX_ENGINE_PAGES = 100_000;
const SAMPLE_LIMIT = 20;
const recordKey = (sourceType: string, sourceId: string) =>
  JSON.stringify([sourceType, sourceId]);

export type PageDecision = {
  resolved: ResolvedRecord;
  /** Final decision for this record. Engine-level rejects carry their own fixed code. */
  row: ClassifiedRow;
};

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

type Counts = ReturnType<typeof countRows>;
const emptyCounts = (): Counts => ({
  created: 0,
  updated: 0,
  skipped: 0,
  rejected: 0,
  processed: 0,
});
function addOutcome(counts: Counts, outcome: string) {
  counts.processed += 1;
  if (outcome === "create") counts.created += 1;
  else if (outcome === "update") counts.updated += 1;
  else if (outcome === "skip") counts.skipped += 1;
  else if (outcome === "reject") counts.rejected += 1;
}

/** Everything a dry run has accumulated so far. Plain JSON: it is the checkpoint a resume reads. */
export type DryRunState = {
  /** Cursor of the NEXT page to read (`null` before the first page and once exhausted). */
  cursor: string | null;
  exhausted: boolean;
  pages: number;
  counts: Counts;
  byType: Record<string, Counts>;
  rejectionCodes: Record<string, number>;
  losses: DryRunLoss[];
  lossRecords: number;
  /** `[sourceType, child source id, parent source id]` for every record that names a parent. */
  parents: Array<[string, string, string]>;
  /** Hash chain over the per-record decisions: sha256(previous + page lines). */
  chain: string;
  samples: DryRunReport["samples"];
};

export function emptyDryRunState(): DryRunState {
  return {
    cursor: null,
    exhausted: false,
    pages: 0,
    counts: emptyCounts(),
    byType: {},
    rejectionCodes: {},
    losses: [],
    lossRecords: 0,
    parents: [],
    chain: "0".repeat(64),
    samples: { rejects: [], losses: [] },
  };
}

/** Folds one page's decisions into `state` (mutates it) and advances its cursor. */
export function foldDryRunPage(
  state: DryRunState,
  input: {
    cursor: string | null;
    nextCursor: string | null;
    records: readonly SourceRecord[];
    decisions: readonly PageDecision[];
  },
) {
  const sources = new Map(
    input.records.map((s) => [recordKey(s.sourceType, s.sourceId), s]),
  );
  const losses = new Map<string, DryRunLoss>(
    state.losses.map((l) => [
      JSON.stringify([l.sourceType, l.code, l.detailCode]),
      { ...l },
    ]),
  );
  const lines: string[] = [];
  for (const { resolved: r, row } of input.decisions) {
    addOutcome(state.counts, row.outcome);
    const typed = state.byType[r.sourceType] ?? emptyCounts();
    addOutcome(typed, row.outcome);
    state.byType[r.sourceType] = typed;
    const own = [...r.losses];
    if (row.outcome === "reject") {
      const code = row.code ?? "invalid_record";
      state.rejectionCodes[code] = (state.rejectionCodes[code] ?? 0) + 1;
      own.push({ code: "record_rejected", detailCode: row.code });
      if (state.samples.rejects.length < SAMPLE_LIMIT)
        state.samples.rejects.push({
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          code,
        });
    }
    if (own.length) state.lossRecords += 1;
    for (const loss of own) {
      addLoss(losses, r.sourceType, loss);
      if (state.samples.losses.length < SAMPLE_LIMIT)
        state.samples.losses.push({
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          code: loss.code,
          detailCode: loss.detailCode ?? "",
        });
    }
    const source = sources.get(recordKey(r.sourceType, r.sourceId));
    if (source?.parentSourceId)
      state.parents.push([r.sourceType, r.sourceId, source.parentSourceId]);
    lines.push(
      `${r.sourceType}\u0000${r.sourceId}\u0000${r.sourceHash}\u0000${row.outcome}\u0000${row.code ?? ""}\n`,
    );
  }
  state.losses = [...losses.values()];
  state.chain = createHash("sha256")
    .update(state.chain)
    .update(lines.join(""))
    .digest("hex");
  state.pages += 1;
  state.cursor = input.nextCursor;
  state.exhausted = input.nextCursor === null;
}

/** Reads, resolves and classifies one page, then folds it into `state`. */
export async function dryRunPage(
  state: DryRunState,
  input: {
    actor: ImportActor;
    run: Parameters<typeof classifyImportRecords>[1];
    entries: MappingEntry[];
    adapter: ImportSourceAdapter;
    connection: AdapterConnection;
    capabilities: WriterCapabilities;
    context: ResolveContext;
    pageSize: number;
  },
) {
  const cursor = state.cursor;
  const page = await input.adapter.readPage(
    input.connection,
    cursor,
    input.pageSize,
  );
  if (page.nextCursor !== null && page.nextCursor === cursor)
    throw new HTTPException(502, { message: "Source cursor did not advance" });
  const resolved = resolvePage(input.entries, page.records, {
    capabilities: input.capabilities,
    context: input.context,
  });
  const decisions = await withCreationTransaction((tx) =>
    decidePage(tx, input.run, input.actor, resolved),
  );
  foldDryRunPage(state, {
    cursor,
    nextCursor: page.nextCursor,
    records: page.records,
    decisions,
  });
  return { records: page.records.length };
}

export function pageSizeFor(adapter: ImportSourceAdapter) {
  return Math.min(Math.max(adapter.chunkSize, 1), 500);
}

/** The report for a finished (exhausted) state. */
export function finishDryRun(
  state: DryRunState,
  input: {
    run: Pick<
      Parameters<typeof classifyImportRecords>[1],
      "id" | "workspaceId" | "projectId" | "pluginId" | "sourceRef"
    >;
    entries: MappingEntry[];
    mappingVersion: number;
    capabilities: WriterCapabilities;
  },
): DryRunReport {
  const { run, entries, capabilities } = input;
  const losses = new Map<string, DryRunLoss>(
    state.losses.map((l) => [
      JSON.stringify([l.sourceType, l.code, l.detailCode]),
      { ...l },
    ]),
  );
  const parents = new Map(
    state.parents.map(([type, child, parent]) => [
      recordKey(type, child),
      recordKey(type, parent),
    ]),
  );
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
  const counts = state.counts;
  const byType = Object.fromEntries(
    Object.entries(state.byType).sort(([a], [b]) => a.localeCompare(b)),
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
    rows: state.chain,
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
    rejectionCodes: state.rejectionCodes,
    losses: lossList,
    lossRecords: state.lossRecords,
    cycleBreaks,
    samples: state.samples,
    completeness: mappingState,
  };
}
