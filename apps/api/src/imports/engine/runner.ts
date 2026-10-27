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
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import {
  type ImportPausedReason,
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
  duringChunk?: () => Promise<void>;
};

export type RunnerOutcome = {
  status: "completed" | "paused" | "stopped" | "idle";
  chunks: number;
  pausedReason?: ImportPausedReason;
};

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
  | {
      kind: "advanced";
      commit: Awaited<ReturnType<typeof commitImportChunk>> | null;
      auditFailure: boolean;
    };

async function chunkTransaction(
  tx: Transaction,
  input: {
    runId: string;
    cursor: string | null;
    page: SourcePage;
    resolved: ResolvedRecord[];
    needsApproval: boolean;
    duringChunk?: (() => Promise<void>) | undefined;
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

  await input.duringChunk?.();

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
  return { kind: "advanced", commit, auditFailure: false };
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
async function finalizeRun(runId: string): Promise<RunnerOutcome | "done"> {
  await resumePendingImportAttachments(runId);
  let paused: ImportPausedReason | null = null;
  let outcome: FinalizeOutcome | null = null;
  try {
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
  } catch (error) {
    if (error instanceof EngineStop) paused = error.reason;
    else if (error instanceof HTTPException && error.status === 409)
      paused = "conflict";
    else paused = "chunk_failed";
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

/** Core loop (lease-free so tests can drive it). Safe to call repeatedly: it resumes from the cursor. */
export async function runImportRun(
  runId: string,
  options: RunnerOptions = {},
): Promise<RunnerOutcome> {
  const capabilities = options.capabilities ?? WRITER_V2_CAPABILITIES;
  let chunks = 0;
  for (;;) {
    await assertJobExecutionOwned();
    const snapshot = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(RUN)
        .where(eq(RUN.id, runId))
        .limit(1);
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
      const finalized = await finalizeRun(run.id);
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
      outcome = await withCreationTransaction((tx) =>
        chunkTransaction(tx, {
          runId: run.id,
          cursor: cursor.cursor,
          page,
          resolved,
          needsApproval,
          duringChunk: options.duringChunk,
        }),
      );
    } catch (error) {
      if (error instanceof EngineStop) return pause(error.reason);
      if (error instanceof HTTPException && error.status === 409)
        return pause("conflict");
      return pause("chunk_failed");
    }
    if (outcome.kind === "stopped") return { status: "idle", chunks };
    if (outcome.commit) await publishCommittedImport(outcome.commit);
    await reportImportAuditWriteFailure(outcome.auditFailure);
    chunks += 1;
  }
}
