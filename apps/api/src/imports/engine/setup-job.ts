/**
 * Background setup job: source discovery and the whole-run dry run (IM-2).
 *
 * Both used to read the whole source inside one HTTP request. They now run here, after the request
 * has returned `202`, with progress persisted on the run (`engine_discovery.job`, shown by the
 * wizard), single-flight per run, and a dry run that resumes from a checkpoint.
 *
 * Rules
 *  - Single flight: the request marks the job `running` under the run row lock and kicks it; a second
 *    request finds it running and only returns its state. The worker holds the per-run lease
 *    `import-setup:<run id>` AND claims the job with a fresh token that every progress write must
 *    match, so a duplicate or superseded worker stops instead of racing. The lease is short and
 *    renewed while the worker makes progress, so a worker killed mid-read frees it within
 *    `IMPORT_SETUP_LEASE_MS` and the next request (or the sweep) resumes the job.
 *  - Resume: the dry run checkpoints its accumulators and the next cursor every few pages. A killed
 *    worker is re-kicked (the same request again, or the sweep) and continues from the checkpoint;
 *    with no usable checkpoint it restarts from the first page, never producing a different report.
 *    Discovery is a single adapter scan and restarts from the beginning (it is read-only).
 *  - Authority: the job runs as the administrator who asked (`job.actor`), re-checks live
 *    instance-admin authority and project reach before every page and again in the completion
 *    transaction, and fails closed. It never acts as the system.
 *  - Nothing in here writes work items. The completion transaction stores the mapping or the report,
 *    exactly as the synchronous implementation did.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Transaction } from "../../database/executor";
import { lockInstanceAdminSerialization } from "../../instance/users/repository";
import { lockPendingActionLifecycle } from "../../pending-action/lifecycle-invalidation";
import { assertJobExecutionOwned } from "../../scheduler/leader-lock";
import {
  claimJobLease,
  releaseJobLease,
  renewJobLease,
} from "../../scheduler/repository";
import {
  type ImportActor,
  requireImportInstanceAdmin,
  requireImportProjectCapability,
} from "../access";
import { ensureImportAdaptersRegistered } from "../adapters";
import { reportImportAuditWriteFailure } from "../service";
import {
  type ConnectFailureReason,
  type DiscoveryResult,
  getImportAdapter,
  type MappingDomain,
} from "./adapter";
import { loadResolveContext } from "./context";
import {
  type DryRunState,
  dryRunPage,
  emptyDryRunState,
  finishDryRun,
  MAX_ENGINE_PAGES,
  pageSizeFor,
} from "./dry-run";
import {
  type MappingEntry,
  mappingDigest,
  mergeDiscovery,
  WRITER_V2_CAPABILITIES,
  type WriterCapabilities,
} from "./mapping";
import { audit, INVALIDATE, invalidateOutstandingApproval } from "./run-ops";
import { importEngineAutoStart } from "./runner";
import {
  activeStaffPerson,
  asEngineRun,
  type EngineRun,
  loadConnection,
  loadMapping,
  peopleByEmail,
  RUN,
  readSetupJob,
  type SetupJob,
  saveMapping,
  toAdapterConnection,
  typeIdsByKey,
} from "./store";

export const IMPORT_SETUP_JOB = "import-setup";
/** Short on purpose: renewed while the worker progresses, it expires soon after a killed worker. */
export const IMPORT_SETUP_LEASE_MS = 60 * 1000;
const LEASE_RENEW_EVERY_MS = 10 * 1000;
const DISCOVER_ROUTE_KEY = "POST /api/imports/{id}/discover";
const DRY_RUN_ROUTE_KEY = "POST /api/imports/{id}/dry-run-all";
const DEFAULT_CHECKPOINT_EVERY_PAGES = 10;
/** A checkpoint larger than this is dropped: a resume then restarts from the first page. */
const CHECKPOINT_MAX_BYTES = 2 * 1024 * 1024;
const PROGRESS_MIN_INTERVAL_MS = 750;

/** Fixed codes a failed job reports (never free text); the wizard turns each into words. */
export type SetupJobFailure =
  | ConnectFailureReason
  | "authority_lost"
  | "project_reach_lost"
  | "run_changed"
  | "mapping_changed"
  | "page_limit"
  | "no_adapter";

class JobFailure extends Error {
  constructor(readonly code: SetupJobFailure) {
    super(code);
  }
}
/** The job was cancelled or taken over: stop without touching it (it is no longer ours). */
class JobSuperseded extends Error {}
/** Test seam: return leaving the job `running`, as a killed worker would. */
class JobStopped extends Error {
  constructor(readonly pages: number) {
    super("stopped");
  }
}

export type SetupJobOptions = {
  /** Simulates a kill: stop (leaving the job running) after this many pages in this call. */
  stopAfterPages?: number;
  /** Pages between checkpoints (default 10). */
  checkpointEvery?: number;
  capabilities?: WriterCapabilities;
};

export type SetupJobOutcome = {
  status: "completed" | "failed" | "stopped" | "idle";
  pages: number;
  failure?: string;
};

export function jobActorFor(job: SetupJob): ImportActor {
  return {
    userId: job.actor.userId,
    actorType: job.actor.apiKeyId ? "api_key" : "person",
    apiKeyId: job.actor.apiKeyId,
    ...(job.actor.apiKeyId ? { apiKey: { id: job.actor.apiKeyId } } : {}),
    impersonatedBy: null,
  };
}

/** `engine_discovery` with `patch` merged into its `job` object; null when the run is not that job. */
export function withJob(
  run: Pick<EngineRun, "engineDiscovery">,
  job: SetupJob,
): Record<string, unknown> {
  return { ...(run.engineDiscovery ?? {}), job };
}

// --- kick ------------------------------------------------------------------------------------

export function kickImportSetupJob(runId: string) {
  if (!importEngineAutoStart()) return;
  void runSetupJob(runId).catch((error) =>
    console.error(
      JSON.stringify({
        job: IMPORT_SETUP_JOB,
        runId,
        outcome: "error",
        error: error instanceof Error ? error.name : "unknown",
      }),
    ),
  );
}

/** Registered sweep: picks up every run whose setup job is still `running` (restart recovery). */
export async function sweepRunningSetupJobs() {
  ensureImportAdaptersRegistered();
  const rows = await db
    .select({ id: RUN.id })
    .from(RUN)
    .where(sql`${RUN.engineDiscovery}->'job'->>'status' = 'running'`)
    .limit(25);
  let pages = 0;
  for (const { id } of rows) pages += (await runSetupJob(id)).pages;
  return { runs: rows.length, pages };
}

export async function runSetupJob(
  runId: string,
  options: SetupJobOptions = {},
): Promise<SetupJobOutcome> {
  ensureImportAdaptersRegistered();
  const name = `${IMPORT_SETUP_JOB}:${runId}`;
  const owner = randomUUID();
  const ttl = `${IMPORT_SETUP_LEASE_MS} milliseconds`;
  if (!(await claimJobLease(name, owner, ttl)))
    return { status: "idle", pages: 0 };
  let renewedAt = Date.now();
  /** Set once the lease or the job is no longer ours; the next per-page heartbeat then stops. */
  let lost = false;
  const renew = async () => {
    // A lapsed lease (a slow page) is re-claimed; one another worker has taken is not ours: stop.
    if (
      !(await renewJobLease(name, owner, ttl)) &&
      !(await claimJobLease(name, owner, ttl))
    ) {
      lost = true;
      throw new JobSuperseded();
    }
    renewedAt = Date.now();
  };
  const heartbeat = async () => {
    if (lost) throw new JobSuperseded();
    if (Date.now() - renewedAt < LEASE_RENEW_EVERY_MS) return;
    await renew();
  };
  /**
   * P6-R2-02: liveness independent of page progress. While this worker is alive it renews the
   * lease and stamps `heartbeatAt` on the job every `LEASE_RENEW_EVERY_MS`, even inside one slow
   * adapter call (a long discovery scan or a slow page). The wizard bases its "stalled" warning on
   * that stamp, so a live job never looks abandoned and a killed one does within the threshold.
   */
  const keepAlive = (jobId: string) => {
    let inFlight: Promise<void> | null = null;
    const tick = async () => {
      try {
        if (Date.now() - renewedAt >= LEASE_RENEW_EVERY_MS) await renew();
        if (
          !(await patchJob(runId, jobId, {
            heartbeatAt: new Date().toISOString(),
          }))
        )
          lost = true;
      } catch (error) {
        if (error instanceof JobSuperseded) return;
        // A transient write failure is not proof the job is lost; the next tick retries.
        console.error(
          JSON.stringify({
            job: IMPORT_SETUP_JOB,
            runId,
            outcome: "heartbeat_failed",
            error: error instanceof Error ? error.name : "unknown",
          }),
        );
      }
    };
    const timer = setInterval(() => {
      if (inFlight || lost) return;
      inFlight = tick().finally(() => {
        inFlight = null;
      });
    }, LEASE_RENEW_EVERY_MS);
    timer.unref?.();
    return async () => {
      clearInterval(timer);
      await inFlight;
    };
  };
  try {
    return await executeSetupJob(runId, options, heartbeat, keepAlive);
  } finally {
    await releaseJobLease(name, owner).catch((error) =>
      console.error(
        JSON.stringify({
          job: IMPORT_SETUP_JOB,
          runId,
          outcome: "lease_release_failed",
          error: error instanceof Error ? error.name : "unknown",
        }),
      ),
    );
  }
}

// --- job row access ---------------------------------------------------------------------------

/** Takes the running job over with a fresh fencing token; null when there is nothing to run. */
async function claimJob(runId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(RUN)
      .where(eq(RUN.id, runId))
      .for("update")
      .limit(1);
    if (!row?.projectId || !row.sourceConnectionId) return null;
    const run = asEngineRun(row);
    const job = readSetupJob(run);
    if (job?.status !== "running") return null;
    const claimed: SetupJob = {
      ...job,
      id: randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    await tx
      .update(RUN)
      .set({ engineDiscovery: withJob(run, claimed) })
      .where(eq(RUN.id, run.id));
    return { run, job: claimed };
  });
}

/** Merges `patch` into the job while it is still ours and running; false when it no longer is. */
async function patchJob(
  runId: string,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const updated = await db
    .update(RUN)
    .set({
      engineDiscovery: sql`jsonb_set(coalesce(${RUN.engineDiscovery}, '{}'::jsonb), '{job}', coalesce(${RUN.engineDiscovery}->'job', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
    })
    .where(
      sql`${RUN.id} = ${runId} AND ${RUN.engineDiscovery}->'job'->>'id' = ${jobId} AND ${RUN.engineDiscovery}->'job'->>'status' = 'running'`,
    )
    .returning({ id: RUN.id });
  return updated.length > 0;
}

async function failJob(runId: string, jobId: string, code: string) {
  await patchJob(runId, jobId, {
    status: "failed",
    failure: code,
    checkpoint: null,
    updatedAt: new Date().toISOString(),
  });
}

/** Marks the run's running job failed (a mapping edit made its result meaningless). Caller holds the row lock. */
export function cancelledJob(job: SetupJob, code: SetupJobFailure): SetupJob {
  const { checkpoint: _dropped, ...rest } = job;
  return {
    ...rest,
    status: "failed",
    failure: code,
    updatedAt: new Date().toISOString(),
  };
}

// --- authority --------------------------------------------------------------------------------

async function assertAuthority(
  tx: Transaction,
  run: EngineRun,
  job: SetupJob,
  actor: ImportActor,
) {
  try {
    await requireImportInstanceAdmin(
      tx,
      actor,
      job.kind === "discover" ? DISCOVER_ROUTE_KEY : DRY_RUN_ROUTE_KEY,
    );
  } catch (error) {
    if (error instanceof HTTPException) throw new JobFailure("authority_lost");
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
      throw new JobFailure("project_reach_lost");
    throw error;
  }
}

// --- the job ----------------------------------------------------------------------------------

async function executeSetupJob(
  runId: string,
  options: SetupJobOptions,
  heartbeat: () => Promise<void>,
  keepAlive: (jobId: string) => () => Promise<void>,
): Promise<SetupJobOutcome> {
  const claimed = await claimJob(runId);
  if (!claimed) return { status: "idle", pages: 0 };
  const { run, job } = claimed;
  const stopKeepAlive = keepAlive(job.id);
  let pages = 0;
  try {
    const adapter = getImportAdapter(run.pluginId);
    if (!adapter) throw new JobFailure("no_adapter");
    const loaded = await db.transaction(async (tx) => ({
      connection: await loadConnection(
        tx,
        run.workspaceId,
        run.sourceConnectionId,
      ),
      mapping: await loadMapping(tx, run, "share"),
    }));
    const connection = toAdapterConnection(loaded.connection);
    if (job.kind === "discover") {
      pages = await discoverJob({ run, job, adapter, connection, heartbeat });
    } else {
      pages = await dryRunJob({
        run,
        job,
        adapter,
        connection,
        heartbeat,
        entries: loaded.mapping.entries,
        mappingVersion: loaded.mapping.version,
        options,
      });
    }
    return { status: "completed", pages };
  } catch (error) {
    if (error instanceof JobSuperseded) return { status: "idle", pages };
    if (error instanceof JobStopped)
      return { status: "stopped", pages: error.pages };
    const code = failureCode(error);
    await failJob(run.id, job.id, code);
    return { status: "failed", pages, failure: code };
  } finally {
    await stopKeepAlive();
  }
}

function failureCode(error: unknown): SetupJobFailure {
  if (error instanceof JobFailure) return error.code;
  if (error instanceof HTTPException && error.status === 409)
    return "run_changed";
  return "source_error";
}

type JobInput = {
  run: EngineRun;
  job: SetupJob;
  adapter: NonNullable<ReturnType<typeof getImportAdapter>>;
  connection: ReturnType<typeof toAdapterConnection>;
  /** Renews the worker's lease; throws `JobSuperseded` once another worker holds it. */
  heartbeat: () => Promise<void>;
};

/**
 * Progress writer, called once per page: renews the lease, and writes progress at most once per
 * interval. Throws `JobSuperseded` once the job or the lease is not ours.
 */
function progressWriter(
  runId: string,
  jobId: string,
  heartbeat: () => Promise<void>,
) {
  let last = 0;
  return async (
    progress: { pagesRead: number; recordsProcessed: number },
    force = false,
  ) => {
    await heartbeat();
    const now = Date.now();
    if (!force && now - last < PROGRESS_MIN_INTERVAL_MS) return;
    last = now;
    const ok = await patchJob(runId, jobId, {
      ...progress,
      updatedAt: new Date(now).toISOString(),
    });
    if (!ok) throw new JobSuperseded();
  };
}

async function discoverJob(input: JobInput): Promise<number> {
  const { run, job, adapter, connection } = input;
  const actor = jobActorFor(job);
  await db.transaction((tx) => assertAuthority(tx, run, job, actor));
  const connected = await adapter.connect(connection).catch(() => ({
    ok: false as const,
    reason: undefined,
  }));
  if (!connected.ok) throw new JobFailure(connected.reason ?? "source_error");
  const write = progressWriter(run.id, job.id, input.heartbeat);
  let pages = 0;
  let discovery: DiscoveryResult;
  try {
    discovery = await adapter.discover(connection, {
      onProgress: async (progress) => {
        pages = progress.pages;
        await write({
          pagesRead: progress.pages,
          recordsProcessed: progress.records,
        });
      },
    });
  } catch (error) {
    if (error instanceof JobSuperseded) throw error;
    throw new JobFailure("source_error");
  }
  const proposals = await db.transaction(async (tx) => {
    const emails = discovery.facets
      .filter((f) => f.domain === ("person" satisfies MappingDomain))
      .map((f) => f.value);
    return adapter.proposeMapping(discovery, {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      peopleByEmail: await peopleByEmail(tx, run.workspaceId, emails),
      typeIdsByKey: await typeIdsByKey(tx, run.workspaceId),
    });
  });

  const auditFailure = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    await lockPendingActionLifecycle(tx);
    const locked = await lockedRun(tx, run.id, job);
    await assertAuthority(tx, locked, job, actor);
    if (locked.version !== job.runVersion) throw new JobFailure("run_changed");
    const existing = await loadMapping(tx, locked, "update");
    const entries: MappingEntry[] = mergeDiscovery(
      existing.entries,
      discovery.facets,
      proposals,
    );
    const changed = mappingDigest(entries) !== mappingDigest(existing.entries);
    const person = await activeStaffPerson(tx, actor.userId);
    await saveMapping(tx, locked, entries, {
      bump: changed && existing.profileId !== null,
      createdBy: person.id,
    });
    if (changed) await invalidateOutstandingApproval(tx, locked);
    const { checkpoint: _dropped, ...rest } = job;
    const done: SetupJob = {
      ...rest,
      status: "completed",
      pagesRead: pages,
      recordsProcessed: discovery.totalRecords,
      updatedAt: new Date().toISOString(),
    };
    await tx
      .update(RUN)
      .set({
        engineDiscovery: {
          counts: discovery.counts,
          totalRecords: discovery.totalRecords,
          unreadable: discovery.unreadable ?? {},
          facets: discovery.facets.length,
          at: new Date().toISOString(),
          job: done,
        },
        enginePhase:
          changed || locked.enginePhase === "created"
            ? "discovered"
            : locked.enginePhase,
        ...(changed ? INVALIDATE : {}),
        version: locked.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(RUN.id, locked.id));
    return audit(tx, actor, locked, "discovered", {
      facets: discovery.facets.length,
      unreadable: discovery.unreadable ?? {},
    });
  });
  await reportImportAuditWriteFailure(auditFailure);
  return pages;
}

/** Locks the run row and checks the job on it is still this one (running, same token). */
async function lockedRun(tx: Transaction, runId: string, job: SetupJob) {
  const [row] = await tx
    .select()
    .from(RUN)
    .where(eq(RUN.id, runId))
    .for("update")
    .limit(1);
  const run = asEngineRun(row);
  const current = readSetupJob(run);
  if (!current || current.id !== job.id || current.status !== "running")
    throw new JobSuperseded();
  return run;
}

function resumableState(job: SetupJob): DryRunState | null {
  const raw = job.checkpoint as Partial<DryRunState> | null | undefined;
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.pages !== "number" ||
    typeof raw.chain !== "string" ||
    !raw.counts ||
    !Array.isArray(raw.parents) ||
    !Array.isArray(raw.losses) ||
    raw.exhausted === true
  )
    return null;
  return raw as DryRunState;
}

async function dryRunJob(
  input: JobInput & {
    entries: MappingEntry[];
    mappingVersion: number;
    options: SetupJobOptions;
  },
): Promise<number> {
  const { run, job, adapter, connection, entries, mappingVersion, options } =
    input;
  if (job.mappingVersion !== mappingVersion)
    throw new JobFailure("mapping_changed");
  const actor = jobActorFor(job);
  const capabilities = options.capabilities ?? WRITER_V2_CAPABILITIES;
  const checkpointEvery =
    options.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY_PAGES;
  const state = resumableState(job) ?? emptyDryRunState();
  const context = await loadResolveContext(db, run, entries);
  const pageSize = pageSizeFor(adapter);
  const write = progressWriter(run.id, job.id, input.heartbeat);
  let pagesThisCall = 0;

  while (!state.exhausted) {
    if (
      options.stopAfterPages !== undefined &&
      pagesThisCall >= options.stopAfterPages
    )
      throw new JobStopped(pagesThisCall);
    await assertJobExecutionOwned();
    if (state.pages >= MAX_ENGINE_PAGES) throw new JobFailure("page_limit");
    await db.transaction((tx) => assertAuthority(tx, run, job, actor));
    try {
      await dryRunPage(state, {
        actor,
        run,
        entries,
        adapter,
        connection,
        capabilities,
        context,
        pageSize,
      });
    } catch (error) {
      if (error instanceof JobFailure) throw error;
      throw new JobFailure("source_error");
    }
    pagesThisCall += 1;
    await write(
      { pagesRead: state.pages, recordsProcessed: state.counts.processed },
      state.exhausted,
    );
    if (state.pages % checkpointEvery === 0 && !state.exhausted) {
      const serialised = JSON.stringify(state);
      const ok = await patchJob(run.id, job.id, {
        pagesRead: state.pages,
        recordsProcessed: state.counts.processed,
        checkpoint:
          Buffer.byteLength(serialised, "utf8") > CHECKPOINT_MAX_BYTES
            ? null
            : state,
        updatedAt: new Date().toISOString(),
      });
      if (!ok) throw new JobSuperseded();
    }
  }

  const report = finishDryRun(state, {
    run,
    entries,
    mappingVersion,
    capabilities,
  });
  const auditFailure = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    await lockPendingActionLifecycle(tx);
    const locked = await lockedRun(tx, run.id, job);
    await assertAuthority(tx, locked, job, actor);
    if (locked.version !== job.runVersion) throw new JobFailure("run_changed");
    const mapping = await loadMapping(tx, locked);
    if (mapping.version !== report.mappingVersion)
      throw new JobFailure("mapping_changed");
    // A new dry run replaces the one any outstanding approval was requested for.
    await invalidateOutstandingApproval(tx, locked);
    const { checkpoint: _dropped, ...rest } = job;
    const done: SetupJob = {
      ...rest,
      status: "completed",
      pagesRead: state.pages,
      recordsProcessed: state.counts.processed,
      updatedAt: new Date().toISOString(),
    };
    await tx
      .update(RUN)
      .set({
        ...INVALIDATE,
        engineDryRunDigest: report.digest,
        engineDryRunMappingVersion: report.mappingVersion,
        engineDryRunReport: report as unknown as Record<string, unknown>,
        engineDryRunAt: new Date(),
        enginePhase: "dry_run_ready",
        engineDiscovery: withJob(locked, done),
        version: locked.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(RUN.id, locked.id));
    return audit(tx, actor, locked, "dry_run", { counts: report.counts });
  });
  await reportImportAuditWriteFailure(auditFailure);
  return state.pages;
}
