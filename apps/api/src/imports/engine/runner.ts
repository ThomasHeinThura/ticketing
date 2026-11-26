/**
 * Import run executor (IM-3). One transaction per chunk: re-verify authority, stage the preview,
 * `commitImportChunk`, then advance the source cursor, stats and loss rows atomically. A crash or
 * a pause therefore always resumes from the last committed chunk, and a rerun of a committed
 * region is classified `skip` (IM-1).
 *
 * Actor rule: the runner executes AS the administrator who executed the run (`started_by`, and
 * `started_by_api_key_id` when present), bound at `/execute` and rebound by whoever `/resume`s it; the
 * creator is only in the audit trail. Per chunk it re-checks live instance-admin authority, the key's
 * enabled state and capabilities, and project reach (all inside `requireImportInstanceAdmin` /
 * `requireImportProjectCapability`): first in a short transaction that holds the instance-admin lock
 * SHARED, then again at the start of the (serializable) chunk transaction, which holds no lock.
 * Holding the lock exclusively for a whole chunk would block every administrator change for the
 * chunk's duration. A change that commits while a chunk is writing takes effect at the next chunk,
 * exactly as it did when it had to wait for the chunk's lock. Any loss pauses the run (fail closed).
 * The runner never falls back to a system actor.
 */
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import {
  type ImportPausedReason,
  importChunkTable,
  importLossTable,
} from "../../database/schema-imports";
import { lockInstanceAdminSerializationShared } from "../../instance/users/repository";
import {
  assertJobExecutionOwned,
  withJobLease,
} from "../../scheduler/leader-lock";
import { withCreationTransaction } from "../../work-item/create-preparation";
import {
  type ImportActor,
  requireImportInstanceAdmin,
  requireImportProjectCapability,
} from "../access";
import { ensureImportAdaptersRegistered } from "../adapters";
import {
  appendImportAudit,
  commitImportChunk,
  insertImportLossRows,
  publishCommittedImport,
  reconcileImportLossIndex,
  reportImportAuditWriteFailure,
  resumePendingImportAttachments,
  stageImportChunk,
} from "../service";
import {
  createImportWriterContext,
  markMissingImportSourcesStale,
  resolveDeferredImportLinks,
  touchSeenImportSources,
} from "../writer";
import { getImportAdapter, type SourcePage } from "./adapter";
import { loadResolveContext } from "./context";
import { deriveChunkId } from "./derive";
import { decidePage, resolvePage } from "./dry-run";
import {
  type ResolvedRecord,
  WRITER_V2_CAPABILITIES,
  type WriterCapabilities,
} from "./mapping";
import {
  asEngineRun,
  type EngineRun,
  loadConnection,
  loadMapping,
  loadRunActor,
  RUN,
  RUN_APPROVAL_THRESHOLD,
  toAdapterConnection,
} from "./store";

export const EXECUTE_ROUTE_KEY = "POST /api/imports/{id}/execute";
export const IMPORT_RUN_JOB = "import-run";
export const IMPORT_RUN_LEASE_MS = 60 * 60 * 1000;
const APPROVED_PENDING_STATES = ["approved", "executed"];

class EngineStop extends Error {
  constructor(readonly reason: ImportPausedReason) {
    super(reason);
  }
}

/** Retries after the first failure of a chunk or finalize; the next failure pauses as `chunk_failed`. */
const TRANSIENT_RETRIES = 3;
const TRANSIENT_BACKOFF_MS = 100;
const TRANSIENT_NODE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
]);
// 57P01-03 admin/crash shutdown, 53300 too many connections, 53400 config limit, 08xxx connection class.
const TRANSIENT_PG_CODES = new Set([
  "57P01",
  "57P02",
  "57P03",
  "53300",
  "53400",
]);

const BROKEN_CLIENT_MESSAGE =
  /connection terminated|connection ended|not queryable|client was closed/i;

/**
 * A database or connection failure that a fresh attempt can clear. Validation, authority and mapping
 * errors (`EngineStop`, `HTTPException`) carry no such code, so they are never retried.
 */
export function isTransientImportError(error: unknown): boolean {
  const chain: { code?: unknown; message?: unknown; cause?: unknown }[] = [];
  for (
    let nested: unknown = error;
    chain.length < 5 && nested && typeof nested === "object";
    nested = (nested as { cause?: unknown }).cause
  )
    chain.push(nested as (typeof chain)[number]);
  // The driver's code decides. Drizzle's query wrapper puts the (imported) query parameters in its
  // message, so message text is never trusted when any error in the chain has a code.
  const coded = chain.find((e) => typeof e.code === "string");
  if (coded) {
    const code = coded.code as string;
    return (
      TRANSIENT_PG_CODES.has(code) ||
      code.startsWith("08") ||
      TRANSIENT_NODE_CODES.has(code)
    );
  }
  // After a connection failure Drizzle's rollback fails and node-postgres throws its own code-less
  // error in place of the original one.
  return chain.some(
    (e) =>
      typeof e.message === "string" &&
      !e.message.startsWith("Failed query") &&
      BROKEN_CLIENT_MESSAGE.test(e.message),
  );
}

const backoff = (attempt: number) =>
  new Promise((resolve) =>
    setTimeout(resolve, TRANSIENT_BACKOFF_MS * 2 ** attempt),
  );

let autoStart = true;
/** Tests drive `runImportRun` directly; production leaves the post-execute kick on. */
export function setImportEngineAutoStart(enabled: boolean) {
  autoStart = enabled;
}
export function importEngineAutoStart() {
  return autoStart;
}

export type RunnerOptions = {
  /** Simulates an interruption: return (leaving the run `running`) after this many chunks. */
  stopAfterChunks?: number;
  capabilities?: WriterCapabilities;
  /**
   * Test seam: awaited inside the chunk transaction after its writes, before it commits, so a test
   * can change an administrator while a chunk is genuinely in flight (and prove it is not blocked).
   */
  duringChunk?: (tx: Transaction) => Promise<void>;
  /** Test seam: awaited at the start of each finalize attempt, just before the attachment recovery read. */
  beforeFinalizeRead?: () => Promise<void>;
  /** Test seam: awaited inside the finalize transaction before it completes the run. */
  duringFinalize?: (tx: Transaction) => Promise<void>;
  /** Test seam: awaited right after a chunk transaction returned, so a test can fail an "uncertain" commit. */
  afterCommit?: () => Promise<void>;
  /** Test seam: awaited at the start of each pending-publish drain ("select") and before each chunk's clear. */
  duringDrain?: (stage: "select" | "clear", chunkId?: string) => Promise<void>;
  /** Test seam: awaited before each run reload, so a test can fail the reload itself. */
  beforeSnapshot?: () => Promise<void>;
  /** Test seam: awaited after a transient failure's backoff, before the run is reloaded for the retry. */
  beforeRetry?: () => Promise<void>;
};

export type RunnerOutcome = {
  status: "completed" | "paused" | "stopped" | "idle";
  chunks: number;
  pausedReason?: ImportPausedReason;
};

/** Server-side trace of a failure that pauses the run; class and message only, never record data. */
function logChunkFailure(runId: string, error: unknown) {
  console.error(
    JSON.stringify({
      job: IMPORT_RUN_JOB,
      runId,
      outcome: "chunk_failed",
      error: error instanceof Error ? error.name : "unknown",
      // Only a SQLSTATE: a query error's message carries the bound parameters (record contents).
      sqlState: sqlStateOf(error),
    }),
  );
}

function sqlStateOf(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 3; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function kickImportRun(runId: string) {
  if (!autoStart) return;
  void runImportRunJob(runId).catch((error) =>
    console.error(
      JSON.stringify({
        job: IMPORT_RUN_JOB,
        runId,
        outcome: "error",
        error: error instanceof Error ? error.name : "unknown",
      }),
    ),
  );
}

export async function runImportRunJob(
  runId: string,
  options: RunnerOptions = {},
): Promise<RunnerOutcome> {
  ensureImportAdaptersRegistered();
  return withJobLease(
    `${IMPORT_RUN_JOB}:${runId}`,
    () => runImportRun(runId, options),
    () => ({ status: "idle" as const, chunks: 0 }),
    IMPORT_RUN_LEASE_MS,
  );
}

/** Registered job body: picks up every `running` engine run (restart recovery, manual run). */
export async function sweepRunningImportRuns() {
  ensureImportAdaptersRegistered();
  const rows = await db
    .select({ id: RUN.id })
    .from(RUN)
    .where(
      and(
        eq(RUN.state, "running"),
        eq(RUN.enginePhase, "executing"),
        sql`${RUN.sourceConnectionId} IS NOT NULL`,
      ),
    )
    .limit(25);
  let chunks = 0;
  for (const { id } of rows) chunks += (await runImportRunJob(id)).chunks;
  return { runs: rows.length, chunks };
}

async function pauseRun(
  runId: string,
  reason: ImportPausedReason,
  actor: ImportActor | null,
) {
  let auditFailure = false;
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(RUN)
      .where(eq(RUN.id, runId))
      .for("update")
      .limit(1);
    if (run?.state !== "running") return;
    await tx
      .update(RUN)
      .set({
        state: "paused",
        pausedReason: reason,
        version: run.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(RUN.id, run.id));
    auditFailure = await appendImportAudit(tx, {
      actorId: actor?.userId ?? null,
      actorType: actor?.actorType ?? "system",
      apiKeyId: actor?.apiKeyId ?? null,
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      action: "import.run",
      entityType: "import_run",
      entityId: run.id,
      before: null,
      after: { operation: "paused", runId: run.id, reason },
    });
  });
  await reportImportAuditWriteFailure(auditFailure);
}

function bindingFailure(
  run: EngineRun,
  mappingVersion: number,
): ImportPausedReason | null {
  if (
    !run.approvedDigest ||
    run.approvedDigest !== run.engineDryRunDigest ||
    run.approvedMappingVersion !== run.engineDryRunMappingVersion
  )
    return "approval_invalid";
  if (mappingVersion !== run.approvedMappingVersion) return "mapping_changed";
  return null;
}

function writesFor(run: EngineRun) {
  const counts = (
    run.engineDryRunReport as {
      counts?: { created?: number; updated?: number };
    } | null
  )?.counts;
  return (counts?.created ?? 0) + (counts?.updated ?? 0);
}

/**
 * Live authority of the run's executor: still an active staff person, an instance administrator (key
 * enabled and capable when the run executes under a key) with reach into the project. Any loss is a
 * fail-closed stop with its own reason. Takes no lock: callers that need a consistent read of an
 * administrator change in flight wrap it in `recheckAuthorityUnderSharedLock`.
 */
async function assertAuthority(tx: Transaction, run: EngineRun) {
  const actor = await loadRunActor(tx, run);
  if (!actor) throw new EngineStop("authority_lost");
  try {
    await requireImportInstanceAdmin(tx, actor, EXECUTE_ROUTE_KEY);
  } catch (error) {
    if (error instanceof HTTPException) throw new EngineStop("authority_lost");
    throw error;
  }
  try {
    await requireImportProjectCapability(
      tx,
      actor,
      run.workspaceId,
      run.projectId,
      "work_item:create",
    );
  } catch (error) {
    if (error instanceof HTTPException)
      throw new EngineStop("project_reach_lost");
    throw error;
  }
  return actor;
}

/**
 * The per-chunk authority gate, taken BEFORE the chunk transaction. The instance-admin lock is held
 * in SHARED mode for this short transaction only: it observes a role change in flight (those hold the
 * lock exclusively) without keeping one waiting while the chunk writes. The chunk itself then runs
 * lock-free; its own authority check at the start reads the snapshot it writes under. A revocation
 * that commits while the chunk writes is seen by the next chunk's gate, so the run stops there.
 */
async function recheckAuthorityUnderSharedLock(runId: string) {
  await db.transaction(async (tx) => {
    await lockInstanceAdminSerializationShared(tx);
    const [row] = await tx
      .select()
      .from(RUN)
      .where(eq(RUN.id, runId))
      .for("share")
      .limit(1);
    await assertAuthority(tx, asEngineRun(row));
  });
}

type ChunkOutcome =
  | { kind: "stopped" }
  | { kind: "advanced"; auditFailure: boolean };

type PendingPublish = Record<string, unknown> & {
  createdResults?: Array<Record<string, any>>;
  updateResults?: Array<Record<string, any>>;
};

const DATE_FIELDS = new Set(["startDate", "dueDate"]);

/**
 * JSON turned the stored Dates into ISO strings and the publishers call Date methods on
 * `occurredAt` (and publish `startDate`/`dueDate` changes as Dates). Revive exactly those fields:
 * source identifiers and attachment jobs are plain strings that can look like dates and must stay.
 */
export function revivePendingPublish(pending: PendingPublish): PendingPublish {
  const date = (value: unknown) =>
    typeof value === "string" ? new Date(value) : value;
  const event = (e: any) =>
    e && typeof e === "object" ? { ...e, occurredAt: date(e.occurredAt) } : e;
  const changes = (list: any) =>
    Array.isArray(list)
      ? list.map((c) =>
          DATE_FIELDS.has(c?.field)
            ? { ...c, from: date(c.from), to: date(c.to) }
            : c,
        )
      : list;
  return {
    ...pending,
    createdResults: pending.createdResults?.map((r) => ({
      ...r,
      realtimeEvent: event(r.realtimeEvent),
      initialEvents: r.initialEvents?.map((i: any) => ({
        ...i,
        event: event(i.event),
        payload: i.payload
          ? { ...i.payload, changes: changes(i.payload.changes) }
          : i.payload,
      })),
    })),
    updateResults: pending.updateResults?.map((r) => ({
      ...r,
      realtimeEvent: event(r.realtimeEvent),
      changes: changes(r.changes),
    })),
  };
}

/**
 * Dispatch every chunk's stored publish events in sequence order and clear each only after its
 * dispatch succeeded. A crash between dispatch and clear republishes (duplicates are allowed). The
 * clear is a compare-and-clear against the stored payload as read: a payload rewritten since is
 * kept, and a concurrent drain of the same chunk only republishes.
 */
export async function drainPendingPublish(
  runId: string,
  options: RunnerOptions = {},
) {
  await options.duringDrain?.("select");
  const rows = await db
    .select({
      id: importChunkTable.id,
      pending: importChunkTable.pendingPublish,
    })
    .from(importChunkTable)
    .where(
      and(
        eq(importChunkTable.importRunId, runId),
        isNotNull(importChunkTable.pendingPublish),
      ),
    )
    .orderBy(asc(importChunkTable.sequence));
  for (const row of rows) {
    // The original stored value, before any revival, is what the clear compares against.
    const stored = JSON.stringify(row.pending);
    await publishCommittedImport(
      {
        kind: "committed",
        ...revivePendingPublish(row.pending as PendingPublish),
      } as Parameters<typeof publishCommittedImport>[0],
      { alertKey: row.id },
    );
    await options.duringDrain?.("clear", row.id);
    await db
      .update(importChunkTable)
      .set({ pendingPublish: null })
      .where(
        and(
          eq(importChunkTable.id, row.id),
          sql`${importChunkTable.pendingPublish} = ${stored}::jsonb`,
        ),
      );
  }
}

async function chunkTransaction(
  tx: Transaction,
  input: {
    runId: string;
    cursor: string | null;
    page: SourcePage;
    resolved: ResolvedRecord[];
    needsApproval: boolean;
    duringChunk?: ((tx: Transaction) => Promise<void>) | undefined;
  },
): Promise<ChunkOutcome> {
  const [locked] = await tx
    .select()
    .from(RUN)
    .where(eq(RUN.id, input.runId))
    .for("update")
    .limit(1);
  const run = asEngineRun(locked);
  if (run.state !== "running" || run.enginePhase !== "executing")
    return { kind: "stopped" };
  // Compare-and-set on the cursor: a second worker (or a stale lease) cannot double-advance.
  const stored = run.sourceCursor;
  if (!stored || stored.exhausted || stored.cursor !== input.cursor)
    return { kind: "stopped" };

  const mapping = await loadMapping(tx, run, "share");
  const bound = bindingFailure(run, mapping.version);
  if (bound) throw new EngineStop(bound);
  if (input.needsApproval) {
    const [pending] = run.approvalPendingActionId
      ? await tx
          .select({ state: schema.pendingActionTable.state })
          .from(schema.pendingActionTable)
          .where(eq(schema.pendingActionTable.id, run.approvalPendingActionId))
          .limit(1)
      : [];
    if (!pending || !APPROVED_PENDING_STATES.includes(pending.state))
      throw new EngineStop("approval_invalid");
  }
  if (
    (run.stats.processed ?? 0) + input.page.records.length >
    (run.approvedCount ?? 0)
  )
    throw new EngineStop("approved_count_exceeded");

  const actor = await assertAuthority(tx, run);

  const decisions = await decidePage(tx, run, actor, input.resolved);
  // The approval covers the writes the approved dry run saw. A self-approved run (<= 50 writes)
  // must stay within the threshold even if the source changed since the dry run; an approved one
  // must stay within the approved write count. Either way, exceeding it pauses before writing.
  const chunkWrites = decisions.filter(
    (d) => d.row.outcome === "create" || d.row.outcome === "update",
  ).length;
  const writesSoFar = (run.stats.created ?? 0) + (run.stats.updated ?? 0);
  const allowedWrites = input.needsApproval
    ? writesFor(run)
    : RUN_APPROVAL_THRESHOLD;
  if (writesSoFar + chunkWrites > allowedWrites)
    throw new EngineStop(
      input.needsApproval ? "approved_count_exceeded" : "approval_invalid",
    );
  const writable = decisions.filter((d) => d.resolved.record !== null);
  const engineRejected = decisions.length - writable.length;
  let commit: Awaited<ReturnType<typeof commitImportChunk>> | null = null;
  let chunkRowId: string | null = null;
  const records = writable.flatMap((d) =>
    d.resolved.record ? [d.resolved.record] : [],
  );
  if (records.length > 0) {
    const chunkId = deriveChunkId(
      run.id,
      input.cursor,
      run.approvedDigest ?? "",
    );
    const staged = await stageImportChunk(tx, {
      actor,
      run,
      chunkId,
      records,
      rows: writable.map((d) => d.row),
      sourceCursor: input.page.nextCursor,
    });
    chunkRowId = staged.chunkRowId;
    commit = await commitImportChunk(tx, {
      actor,
      runId: run.id,
      chunkId,
      expectedVersion: staged.expectedVersion,
      previewDigest: staged.digest,
      records,
      ...(records.length > 50 ? { approvedLarge: true } : {}),
      skipAdminSerialization: true,
    });
    if (commit.kind !== "committed")
      throw new HTTPException(409, { message: "Import chunk not committed" });
    if (!staged.chunkRowId) throw new Error("Import chunk row missing");
    // Durable publication: the events are stored with the commit and cleared only after dispatch.
    await tx
      .update(importChunkTable)
      .set({
        pendingPublish: {
          createdResults: commit.createdResults,
          updateResults: commit.updateResults,
          attachmentJobs: commit.attachmentJobs ?? [],
          auditFailure: commit.auditFailure === true,
        },
      })
      .where(eq(importChunkTable.id, staged.chunkRowId));
    // Losses the writer recorded for this chunk's members (comments, relations, custom fields...).
    if (commit.writerLosses?.length)
      await insertImportLossRows(
        tx,
        {
          workspaceId: run.workspaceId,
          importRunId: run.id,
          importChunkId: chunkRowId,
        },
        commit.writerLosses,
      );
  }
  // A record that exists in the source but was rejected is still present: do not let the
  // end-of-run stale marking treat it as deleted at the source.
  const rejectedSeen = decisions
    .filter((d) => d.row.outcome === "reject")
    .map((d) => ({
      sourceType: d.resolved.sourceType,
      sourceId: d.resolved.sourceId,
    }));
  if (rejectedSeen.length)
    await touchSeenImportSources(tx, {
      workspaceId: run.workspaceId,
      pluginId: run.pluginId,
      sourceRef: run.sourceRef,
      currentRunId: run.id,
      records: rejectedSeen,
    });

  // Loss rows (idempotent per run/source/code/detail) for everything this page lost or rejected.
  const lossRows = decisions.flatMap(({ resolved, row }) => {
    const own = [...resolved.losses];
    if (row.outcome === "reject")
      own.push({ code: "record_rejected", detailCode: row.code });
    return own.map((loss) => ({
      workspaceId: run.workspaceId,
      importRunId: run.id,
      importChunkId: chunkRowId,
      sourceType: resolved.sourceType,
      sourceId: resolved.sourceId,
      code: loss.code,
      detailCode: loss.detailCode ?? "",
      sourceUrl: resolved.sourceUrl ?? null,
    }));
  });
  for (let offset = 0; offset < lossRows.length; offset += 500)
    await tx
      .insert(importLossTable)
      .values(lossRows.slice(offset, offset + 500))
      .onConflictDoNothing();

  await input.duringChunk?.(tx);

  // Advance the cursor and engine-level rejects in the same transaction as the commit. The run stays
  // `running` when the source is exhausted: `finalizeRun` closes it (attachments, deferred links,
  // stale marking, completion), so a crash between the last chunk and completion resumes there.
  const [after] = await tx
    .select()
    .from(RUN)
    .where(eq(RUN.id, run.id))
    .for("update")
    .limit(1);
  const current = asEngineRun(after);
  const exhausted = input.page.nextCursor === null;
  const stats: Record<string, number> = {
    ...current.stats,
    rejected: (current.stats.rejected ?? 0) + engineRejected,
    processed: (current.stats.processed ?? 0) + engineRejected,
  };
  await tx
    .update(RUN)
    .set({
      stats,
      sourceCursor: { cursor: input.page.nextCursor, exhausted },
      nextCursor: input.page.nextCursor,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(RUN.id, run.id));
  return { kind: "advanced", auditFailure: false };
}

type FinalizeOutcome =
  | { kind: "completed"; auditFailure: boolean }
  | { kind: "stopped" };

/**
 * End-of-run obligations, run once the source is exhausted and idempotent so a crash anywhere
 * resumes safely: (1) finish attachments a committed chunk planned but did not store, outside any
 * transaction; then in one transaction (2) resolve every still-deferred parent and relation, reporting
 * what never arrived as a loss, (3) mark records missing from this full enumeration stale, and (4)
 * complete the run.
 */
async function finalizeRun(
  runId: string,
  options: RunnerOptions = {},
): Promise<RunnerOutcome | "done"> {
  let paused: ImportPausedReason | null = null;
  let outcome: FinalizeOutcome | null = null;
  // Every step is idempotent and the transaction re-reads the run: a retry after an uncertain commit
  // finds the run completed and returns `stopped`.
  for (let attempt = 0; ; attempt += 1) {
    paused = null;
    try {
      await options.beforeFinalizeRead?.();
      await resumePendingImportAttachments(runId);
      await reconcileImportLossIndex(runId);
      await recheckAuthorityUnderSharedLock(runId);
      outcome = await withCreationTransaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(RUN)
          .where(eq(RUN.id, runId))
          .for("update")
          .limit(1);
        const run = asEngineRun(locked);
        if (
          run.state !== "running" ||
          run.enginePhase !== "executing" ||
          !run.sourceCursor?.exhausted
        )
          return { kind: "stopped" as const };
        const mapping = await loadMapping(tx, run, "share");
        const bound = bindingFailure(run, mapping.version);
        if (bound) throw new EngineStop(bound);
        const actor = await assertAuthority(tx, run);
        const writer = await createImportWriterContext(tx, run);
        for (let pass = 0; pass < 500; pass += 1) {
          const step = await resolveDeferredImportLinks(writer, {
            finalize: true,
          });
          if (step.processed === 0) break;
        }
        await options.duringFinalize?.(tx);
        if (writer.losses.length)
          await insertImportLossRows(
            tx,
            {
              workspaceId: run.workspaceId,
              importRunId: run.id,
              importChunkId: null,
            },
            writer.losses,
          );
        // Reached only after the cursor is exhausted: the source was enumerated in full.
        await markMissingImportSourcesStale(tx, {
          workspaceId: run.workspaceId,
          pluginId: run.pluginId,
          sourceRef: run.sourceRef,
          currentRunId: run.id,
        });
        const stats = run.stats;
        await tx
          .update(RUN)
          .set({
            state: "completed",
            enginePhase: "completed",
            version: run.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(RUN.id, run.id));
        const auditFailure = await appendImportAudit(tx, {
          actorId: actor.userId,
          actorType: actor.actorType,
          apiKeyId: actor.apiKeyId,
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          action: "import.run",
          entityType: "import_run",
          entityId: run.id,
          before: null,
          after: {
            operation: "completed",
            runId: run.id,
            counts: {
              created: stats.created ?? 0,
              updated: stats.updated ?? 0,
              skipped: stats.skipped ?? 0,
              rejected: stats.rejected ?? 0,
              processed: stats.processed ?? 0,
            },
          },
        });
        return { kind: "completed" as const, auditFailure };
      });
      await options.afterCommit?.();
    } catch (error) {
      if (error instanceof EngineStop) paused = error.reason;
      else if (error instanceof HTTPException && error.status === 409)
        paused = "conflict";
      else if (isTransientImportError(error) && attempt < TRANSIENT_RETRIES) {
        await backoff(attempt);
        await options.beforeRetry?.();
        continue;
      } else {
        logChunkFailure(runId, error);
        paused = "chunk_failed";
      }
    }
    break;
  }
  if (paused) {
    const [row] = await db.select().from(RUN).where(eq(RUN.id, runId)).limit(1);
    const actor = row?.projectId
      ? await db.transaction((tx) => loadRunActor(tx, asEngineRun(row)))
      : null;
    await pauseRun(runId, paused, actor);
    return { status: "paused", chunks: 0, pausedReason: paused };
  }
  if (outcome?.kind === "completed")
    await reportImportAuditWriteFailure(outcome.auditFailure);
  return "done";
}

/** One read-only view of the run, its connection, mapping, actor and resolve context. */
async function loadSnapshot(runId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(RUN).where(eq(RUN.id, runId)).limit(1);
    if (!row?.projectId || !row.sourceConnectionId) return null;
    const run = asEngineRun(row);
    if (run.state !== "running" || run.enginePhase !== "executing")
      return { run, inactive: true as const };
    const connection = await loadConnection(
      tx,
      run.workspaceId,
      run.sourceConnectionId,
    );
    const mapping = await loadMapping(tx, run, "share");
    return {
      run,
      inactive: false as const,
      connection,
      mapping,
      actor: await loadRunActor(tx, run),
      context: await loadResolveContext(tx, run, mapping.entries),
    };
  });
}

/** Core loop (lease-free so tests can drive it). Safe to call repeatedly: it resumes from the cursor. */
export async function runImportRun(
  runId: string,
  options: RunnerOptions = {},
): Promise<RunnerOutcome> {
  const capabilities = options.capabilities ?? WRITER_V2_CAPABILITIES;
  let chunks = 0;
  let retries = 0;
  // Set when the budget is spent but the last attempt may have committed: reload once, then decide.
  let reconcileOnly = false;
  // The last chunk attempt's target cursor, to tell after a lost commit response whether it landed.
  const unpublished: { current: { nextCursor: string | null } | null } = {
    current: null,
  };
  for (;;) {
    await assertJobExecutionOwned();
    let snapshot: Awaited<ReturnType<typeof loadSnapshot>>;
    try {
      await options.beforeSnapshot?.();
      snapshot = await loadSnapshot(runId);
      // Publish events are durable on the chunk row: drain whatever earlier commits (this process's,
      // a lost response's or a crashed one's) left before advancing, finalizing or pausing again.
      // A transient failure keeps them stored and the retry drains again.
      if (snapshot) await drainPendingPublish(runId, options);
    } catch (error) {
      // A connection still unavailable right after a transient failure belongs to the same budget.
      if (!isTransientImportError(error)) throw error;
      if (retries >= TRANSIENT_RETRIES) {
        logChunkFailure(runId, error);
        await pauseRun(runId, "chunk_failed", null);
        return { status: "paused", chunks, pausedReason: "chunk_failed" };
      }
      await backoff(retries);
      retries += 1;
      await options.beforeRetry?.();
      continue;
    }
    if (snapshot && unpublished.current) {
      const stored = snapshot.run.sourceCursor;
      // When the commit's response was lost, the persisted cursor tells whether it landed.
      if (
        stored?.cursor === unpublished.current.nextCursor &&
        stored.exhausted === (unpublished.current.nextCursor === null)
      ) {
        chunks += 1;
        retries = 0; // reconciliation confirmed progress: fresh budget for the next chunk
      }
      unpublished.current = null;
      if (reconcileOnly && retries >= TRANSIENT_RETRIES && !snapshot.inactive) {
        // The cursor did not advance: the last attempt rolled back, so the bound applies.
        await pauseRun(runId, "chunk_failed", snapshot.actor);
        return { status: "paused", chunks, pausedReason: "chunk_failed" };
      }
      reconcileOnly = false;
    }
    if (!snapshot) return { status: "idle", chunks };
    if (snapshot.inactive && snapshot.run.state === "completed")
      return { status: "completed", chunks };
    if (snapshot.inactive)
      return {
        status: snapshot.run.state === "paused" ? "paused" : "idle",
        chunks,
        ...(snapshot.run.pausedReason
          ? { pausedReason: snapshot.run.pausedReason }
          : {}),
      };
    const { run, connection, mapping, actor, context } = snapshot;
    const pause = async (
      reason: ImportPausedReason,
    ): Promise<RunnerOutcome> => {
      await pauseRun(run.id, reason, actor);
      return { status: "paused", chunks, pausedReason: reason };
    };
    if (!actor) return pause("authority_lost");
    const cursor = run.sourceCursor ?? { cursor: null, exhausted: false };
    if (
      options.stopAfterChunks !== undefined &&
      chunks >= options.stopAfterChunks
    )
      return { status: "stopped", chunks };
    const bound = bindingFailure(run, mapping.version);
    if (bound) return pause(bound);
    if (cursor.exhausted) {
      const finalized = await finalizeRun(run.id, options);
      if (finalized !== "done") return { ...finalized, chunks };
      return { status: "completed", chunks };
    }

    const adapter = getImportAdapter(run.pluginId);
    if (!adapter) return pause("source_error");
    const needsApproval = writesFor(run) > RUN_APPROVAL_THRESHOLD;
    const pageSize = Math.min(
      Math.max(adapter.chunkSize, 1),
      needsApproval ? 500 : RUN_APPROVAL_THRESHOLD,
    );
    let page: SourcePage;
    try {
      page = await adapter.readPage(
        toAdapterConnection(connection),
        cursor.cursor,
        pageSize,
      );
      if (page.nextCursor !== null && page.nextCursor === cursor.cursor)
        throw new Error("cursor did not advance");
    } catch {
      return pause("source_error");
    }

    const report = run.engineDryRunReport as { cycleBreaks?: string[] } | null;
    const resolved = resolvePage(mapping.entries, page.records, {
      capabilities,
      brokenParents: new Set(report?.cycleBreaks ?? []),
      context,
    });
    let outcome: ChunkOutcome;
    try {
      await recheckAuthorityUnderSharedLock(run.id);
      outcome = await withCreationTransaction(async (tx) => {
        unpublished.current = null;
        const done = await chunkTransaction(tx, {
          runId: run.id,
          cursor: cursor.cursor,
          page,
          resolved,
          needsApproval,
          duringChunk: options.duringChunk,
        });
        if (done.kind === "advanced")
          unpublished.current = { nextCursor: page.nextCursor };
        return done;
      });
      await options.afterCommit?.();
    } catch (error) {
      if (error instanceof EngineStop) return pause(error.reason);
      if (error instanceof HTTPException && error.status === 409)
        return pause("conflict");
      if (isTransientImportError(error) && retries < TRANSIENT_RETRIES) {
        // Reloading the run at the top of the loop is the reconciliation: a paused or cancelled run,
        // lost authority or reach, or a cursor that already advanced (the commit did succeed) is
        // seen there, and the chunk's compare-and-set on the cursor refuses a double write.
        await backoff(retries);
        retries += 1;
        await options.beforeRetry?.();
        continue;
      }
      if (isTransientImportError(error) && unpublished.current) {
        // Budget spent, yet this attempt's commit may have landed with its response lost: reconcile
        // against the persisted cursor before pausing, or its events would never be published.
        reconcileOnly = true;
        continue;
      }
      logChunkFailure(runId, error);
      return pause("chunk_failed");
    }
    retries = 0;
    unpublished.current = null;
    if (outcome.kind === "stopped") return { status: "idle", chunks };
    await reportImportAuditWriteFailure(outcome.auditFailure);
    chunks += 1;
  }
}
