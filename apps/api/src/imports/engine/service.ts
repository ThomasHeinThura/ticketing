/**
 * Import engine service: source connections, engine runs, discovery, mapping, whole-run dry run,
 * execute / pause / resume and the loss report. All of it is instance-administrator work that also
 * re-checks live project reach (cross-workspace access is a 404). The retained chunk API in
 * `imports/service.ts` is untouched; this file only calls it through the runner.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../../api-key/enforce";
import db, { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import {
  type ImportPluginId,
  importLossTable,
} from "../../database/schema-imports";
import { lockInstanceAdminSerialization } from "../../instance/users/repository";
import { encryptSecret } from "../../notification-preferences/secrets";
import { lockPendingActionLifecycle } from "../../pending-action/lifecycle-invalidation";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import {
  importActor,
  importOrigin,
  requireImportInstanceAdmin,
  requireImportProjectCapability,
  requireImportWorkspaceRead,
} from "../access";
import { reportImportAuditWriteFailure } from "../service";
import { type ConnectFailureReason, getImportAdapter } from "./adapter";
import type { DryRunReport } from "./dry-run";
import {
  applyMappingEdits,
  completeness,
  type MappingEdit,
  type MappingEntry,
} from "./mapping";
import {
  audit,
  authorizedRun,
  conflict,
  INVALIDATE,
  invalidateOutstandingApproval,
} from "./run-ops";
import { kickImportRun } from "./runner";
import { cancelledJob, kickImportSetupJob, withJob } from "./setup-job";
import {
  activeStaffPerson,
  CONNECTION,
  discoveryDto,
  type EngineRun,
  engineRunDto,
  loadConnection,
  loadEngineRun,
  loadMapping,
  RUN,
  RUN_APPROVAL_THRESHOLD,
  readSetupJob,
  type SetupJob,
  type SetupJobKind,
  saveMapping,
  setupJobDto,
  staffPeopleInWorkspaceOrganisation,
} from "./store";

export type ImportRunApprovalRequest = (
  tx: Transaction,
  input: {
    runId: string;
    digest: string;
    totalCount: number;
    mappingVersion: number;
    /** created + updated in the approved dry run (what exceeds the 50-write threshold). */
    writes: number;
    requesterPersonId: string;
    credentialType: "session" | "api_key";
    credentialId: string | null;
    origin: "web" | "api" | "mcp";
    actorId: string;
    actorType: "person" | "api_key";
    ip: string | null;
    userAgent: string | null;
  },
) => Promise<{ pendingActionId: string; auditFailure?: boolean }>;

// --- source connections -----------------------------------------------------------------------

/** Config keys that carry bulky file contents; never echoed back, only their size. */
const INLINE_TEXT_KEYS = ["csvText", "exportText"] as const;
const SECRET_LIKE_KEY =
  /(?:secret|token|password|credential|api[-_]?key|authorization)/iu;

/**
 * Connection config as returned to a client: no credential, no secret-looking key, and no inline file
 * contents (a 5 MiB CSV would otherwise be sent back on every listing). `inline` says what is stored.
 */
export function redactSourceConfig(config: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  const inline: Record<string, { bytes: number }> = {};
  for (const [key, value] of Object.entries(config)) {
    if ((INLINE_TEXT_KEYS as readonly string[]).includes(key)) {
      if (typeof value === "string")
        inline[key] = { bytes: Buffer.byteLength(value, "utf8") };
      continue;
    }
    if (SECRET_LIKE_KEY.test(key)) continue;
    safe[key] = value;
  }
  return { config: safe, inline };
}

const sourceDto = (row: typeof CONNECTION.$inferSelect) => {
  const redacted = redactSourceConfig(row.config);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    pluginId: row.pluginId,
    name: row.name,
    config: redacted.config,
    inline: redacted.inline,
    hasCredential: row.credentialCiphertext !== null,
    readOnly: true as const,
    createdAt: row.createdAt.toISOString(),
  };
};

/** 502 carrying a fixed reason code the wizard turns into words (never free text). */
function connectFailure(reason: ConnectFailureReason | undefined) {
  const body = {
    message: "Source connection failed",
    reason: reason ?? "source_error",
  };
  return new HTTPException(502, {
    res: Response.json(body, { status: 502 }),
    message: body.message,
  });
}

export async function createSourceConnection(
  c: Context,
  input: {
    workspaceId: string;
    pluginId: ImportPluginId;
    name: string;
    config?: Record<string, unknown>;
    credential?: string;
  },
) {
  const actor = importActor(c);
  // Verify the source before keeping it: a file that is too large, a bad credential or an
  // unreachable host is reported now, with a reason, and nothing is stored. A plugin with no
  // registered adapter is stored as before (discovery says so).
  const adapter = getImportAdapter(input.pluginId);
  if (adapter) {
    const connected = await adapter
      .connect({
        pluginId: input.pluginId,
        config: input.config ?? {},
        credential: input.credential ?? null,
        readOnly: true,
      })
      .catch(() => ({ ok: false as const, reason: undefined }));
    if (!connected.ok) throw connectFailure(connected.reason);
  }
  try {
    return await db.transaction(async (tx) => {
      await lockInstanceAdminSerialization(tx);
      await requireImportInstanceAdmin(tx, actor, "POST /api/import-sources");
      await requireImportWorkspaceRead(tx, actor, input.workspaceId);
      const person = await activeStaffPerson(tx, actor.userId);
      const [row] = await tx
        .insert(CONNECTION)
        .values({
          workspaceId: input.workspaceId,
          pluginId: input.pluginId,
          name: input.name,
          config: input.config ?? {},
          credentialCiphertext: input.credential
            ? (encryptSecret(input.credential) ?? null)
            : null,
          createdBy: person.id,
        })
        .returning();
      if (!row)
        throw new HTTPException(500, {
          message: "Source could not be created",
        });
      return sourceDto(row);
    });
  } catch (error) {
    if (isUniqueViolation(error, "import_source_connection_name_key"))
      throw conflict("A source with this name already exists");
    throw error;
  }
}

export async function listSourceConnections(c: Context, workspaceId: string) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    await requireImportInstanceAdmin(tx, actor, "GET /api/import-sources");
    await requireImportWorkspaceRead(tx, actor, workspaceId);
    const rows = await tx
      .select()
      .from(CONNECTION)
      .where(eq(CONNECTION.workspaceId, workspaceId))
      .orderBy(asc(CONNECTION.createdAt), asc(CONNECTION.id));
    return { sources: rows.map(sourceDto) };
  });
}

// --- runs ---------------------------------------------------------------------------------------

export async function createEngineRun(
  c: Context,
  connectionId: string,
  input: { projectId: string; sourceRef: string },
) {
  const actor = importActor(c);
  const outcome = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    await requireImportInstanceAdmin(
      tx,
      actor,
      "POST /api/import-sources/{id}/runs",
    );
    const [found] = await tx
      .select({ workspaceId: CONNECTION.workspaceId })
      .from(CONNECTION)
      .where(eq(CONNECTION.id, connectionId))
      .limit(1);
    if (!found)
      throw new HTTPException(404, { message: "Import source not found" });
    // Project reach is checked against the connection's own workspace: a project of another
    // workspace is "not found", never an accepted mismatch.
    await requireImportProjectCapability(
      tx,
      actor,
      found.workspaceId,
      input.projectId,
      "work_item:create",
    );
    const connection = await loadConnection(
      tx,
      found.workspaceId,
      connectionId,
    );
    const person = await activeStaffPerson(tx, actor.userId);
    const [inserted] = await tx
      .insert(RUN)
      .values({
        workspaceId: connection.workspaceId,
        projectId: input.projectId,
        pluginId: connection.pluginId,
        sourceRef: input.sourceRef,
        sourceConnectionId: connection.id,
        enginePhase: "created",
        startedBy: person.id,
        startedByApiKeyId: actor.apiKeyId,
        state: "queued",
        stats: {},
        log: [],
      })
      .returning();
    if (!inserted)
      throw new HTTPException(500, {
        message: "Import run could not be created",
      });
    const run = await loadEngineRun(tx, inserted.id, "share");
    const auditFailure = await audit(tx, actor, run, "created", {
      pluginId: run.pluginId,
    });
    return { run, auditFailure };
  });
  await reportImportAuditWriteFailure(outcome.auditFailure);
  return engineRunDto(outcome.run, null);
}

export async function getEngineRun(c: Context, runId: string) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "GET /api/imports/{id}/engine",
      "work_item:read",
      "share",
    );
    const mapping = await loadMapping(tx, run);
    return engineRunDto(run, mapping.version || null);
  });
}

// --- discovery and mapping ---------------------------------------------------------------------

function mappingDto(
  run: EngineRun,
  mapping: { version: number; entries: MappingEntry[] },
) {
  return {
    runId: run.id,
    mappingVersion: mapping.version,
    entries: mapping.entries,
    completeness: completeness(mapping.entries),
    discovery: discoveryDto(run, mapping.entries),
  };
}

/**
 * A run may be (re)discovered or dry-run while it is being set up. A run PAUSED mid-execution may
 * return to this stage too: whatever stopped it (a stale approval, the approved count, lost authority)
 * is resolved by a fresh dry run and approval, and the records already committed stay committed and
 * are skipped by the new one. A running or completed run may not.
 */
function requireSetupState(run: EngineRun) {
  if (run.state !== "queued" && run.state !== "paused")
    throw conflict("Import run is not in a setup state");
  if (run.enginePhase === "completed")
    throw conflict("Import run is not in a setup state");
}

/**
 * Starts (or reports) the run's background setup step. The request only records the job under the
 * run row lock and kicks it; the source is read by `setup-job.ts`. Single flight: a request that
 * finds the same step already running returns its state and never starts a second read.
 */
async function startSetupJob(c: Context, runId: string, kind: SetupJobKind) {
  const actor = importActor(c);
  const routeKey =
    kind === "discover"
      ? "POST /api/imports/{id}/discover"
      : "POST /api/imports/{id}/dry-run-all";
  const outcome = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    await lockPendingActionLifecycle(tx);
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      routeKey,
      "work_item:create",
      "update",
    );
    const existing = readSetupJob(run);
    if (existing?.status === "running") {
      if (existing.kind !== kind)
        throw conflict("Another setup step is already running");
      return {
        run,
        started: false,
        auditFailure: false,
        mappingVersion: null as number | null,
      };
    }
    requireSetupState(run);
    if (
      kind === "dry_run" &&
      (!run.enginePhase || run.enginePhase === "created")
    )
      throw conflict("Discover the source before a dry run");
    const mapping = await loadMapping(tx, run);
    const leavingExecution = run.enginePhase === "executing";
    if (leavingExecution && run.state !== "paused")
      throw conflict("Import run is not in a setup state");
    const normalise = leavingExecution || run.state === "paused";
    const version = run.version + (normalise ? 1 : 0);
    const now = new Date().toISOString();
    const job: SetupJob = {
      id: randomUUID(),
      kind,
      status: "running",
      startedAt: now,
      updatedAt: now,
      actor: { userId: actor.userId, apiKeyId: actor.apiKeyId },
      runVersion: version,
      mappingVersion: kind === "dry_run" ? mapping.version : null,
      pagesRead: 0,
      recordsProcessed: 0,
    };
    if (leavingExecution) await invalidateOutstandingApproval(tx, run);
    await tx
      .update(RUN)
      .set({
        engineDiscovery: withJob(run, job),
        ...(leavingExecution
          ? { ...INVALIDATE, enginePhase: "discovered" as const }
          : {}),
        ...(normalise
          ? { state: "queued" as const, pausedReason: null, version }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(RUN.id, run.id));
    const auditFailure = await audit(
      tx,
      actor,
      run,
      kind === "discover" ? "discovery_started" : "dry_run_started",
      leavingExecution
        ? { returnedToSetup: true, pausedReason: run.pausedReason }
        : {},
    );
    return {
      run: await loadEngineRun(tx, run.id, "share"),
      started: true,
      auditFailure,
      mappingVersion: mapping.version || null,
    };
  });
  await reportImportAuditWriteFailure(outcome.auditFailure);
  // Also for a job already running: the worker holds a per-run lease, so this is a no-op unless the
  // previous worker died (a restart), in which case the job resumes from its checkpoint.
  kickImportSetupJob(outcome.run.id);
  const run = outcome.run;
  return {
    status: outcome.started ? ("accepted" as const) : ("running" as const),
    job: setupJobDto(run),
    run: engineRunDto(run, outcome.mappingVersion),
  };
}

export function discoverRun(c: Context, runId: string) {
  return startSetupJob(c, runId, "discover");
}

export async function getMapping(c: Context, runId: string) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "GET /api/imports/{id}/mapping",
      "work_item:read",
      "share",
    );
    return mappingDto(run, await loadMapping(tx, run));
  });
}

export async function saveMappingEdits(
  c: Context,
  runId: string,
  input: {
    expectedMappingVersion: number;
    entries: MappingEdit[];
    confirmProposals?: boolean;
  },
) {
  const actor = importActor(c);
  const outcome = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    await lockPendingActionLifecycle(tx);
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "POST /api/imports/{id}/mapping",
      "work_item:create",
      "update",
    );
    if (run.state === "completed" || run.enginePhase === "completed")
      throw conflict("Import run is completed");
    if (!run.enginePhase || run.enginePhase === "created")
      throw conflict("Discover the source before editing the mapping");
    const current = await loadMapping(tx, run, "update");
    if (current.version !== input.expectedMappingVersion)
      throw conflict("Mapping version conflict");
    const edited = applyMappingEdits(
      current.entries,
      input.entries,
      input.confirmProposals === true,
    );
    if (!edited.ok) throw new HTTPException(400, { message: edited.code });
    // A person target must be someone of the run's own organisation: an id copied from another
    // tenant is refused here, never stored (and never resolved to an email at execution time).
    const personIds = input.entries.flatMap((edit) =>
      edit.domain === "person" && edit.target?.kind === "target"
        ? [edit.target.id]
        : [],
    );
    if (personIds.length) {
      const valid = await staffPeopleInWorkspaceOrganisation(
        tx,
        run.workspaceId,
        personIds,
      );
      if (personIds.some((id) => !valid.has(id)))
        throw new HTTPException(422, {
          message: "mapping_person_not_in_organisation",
        });
    }
    if (!edited.changed) return { run, saved: current, auditFailure: false };
    const person = await activeStaffPerson(tx, actor.userId);
    const saved = await saveMapping(tx, run, edited.entries, {
      bump: true,
      createdBy: person.id,
    });
    await invalidateOutstandingApproval(tx, run);
    // A mapping change makes a running setup step's result meaningless: cancel it, so its worker
    // stops (its next progress write finds the job gone) rather than finishing against a stale mapping.
    const running = readSetupJob(run);
    // A mapping change makes the dry run and any approval stale, and stops an executing run.
    await tx
      .update(RUN)
      .set({
        ...INVALIDATE,
        ...(running?.status === "running"
          ? {
              engineDiscovery: withJob(
                run,
                cancelledJob(running, "mapping_changed"),
              ),
            }
          : {}),
        enginePhase: "discovered",
        ...(run.state === "running"
          ? {
              state: "paused" as const,
              pausedReason: "mapping_changed" as const,
            }
          : {}),
        version: run.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(RUN.id, run.id));
    const auditFailure = await audit(tx, actor, run, "mapping_changed", {
      mappingVersion: saved.version,
    });
    return {
      run: await loadEngineRun(tx, run.id, "share"),
      saved,
      auditFailure,
    };
  });
  await reportImportAuditWriteFailure(outcome.auditFailure);
  return mappingDto(outcome.run, outcome.saved);
}

// --- whole-run dry run -------------------------------------------------------------------------

export function dryRunWholeRun(c: Context, runId: string) {
  return startSetupJob(c, runId, "dry_run");
}

function publicReport(report: DryRunReport) {
  const { cycleBreaks, ...rest } = report;
  return { ...rest, cycleBreaks: cycleBreaks.length };
}

export async function getWholeRunDryRun(c: Context, runId: string) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "GET /api/imports/{id}/dry-run-all",
      "work_item:read",
      "share",
    );
    if (!run.engineDryRunReport)
      throw new HTTPException(404, {
        message: "No dry run for this import run",
      });
    const report = run.engineDryRunReport as unknown as DryRunReport;
    return {
      ...publicReport(report),
      approvalRequired: report.writes > RUN_APPROVAL_THRESHOLD,
    };
  });
}

// --- approval, execute, pause, resume ---------------------------------------------------------

/**
 * Hook for the pending-action executor of the run-level approval (D2). Binds the approval to the
 * exact dry-run digest, total count and mapping version; any mismatch (for example after a mapping
 * change) is refused and leaves the run unapproved.
 */
export async function grantRunApproval(
  tx: Transaction,
  input: {
    runId: string;
    pendingActionId: string;
    digest: string;
    totalCount: number;
    mappingVersion: number;
  },
) {
  const run = await loadEngineRun(tx, input.runId, "update");
  const report = run.engineDryRunReport as {
    counts?: { processed?: number };
  } | null;
  const mapping = await loadMapping(tx, run);
  if (
    run.approvalPendingActionId !== input.pendingActionId ||
    run.engineDryRunDigest !== input.digest ||
    report?.counts?.processed !== input.totalCount ||
    mapping.version !== input.mappingVersion ||
    run.engineDryRunMappingVersion !== input.mappingVersion
  )
    throw conflict("pending_action_target_changed");
  await tx
    .update(RUN)
    .set({
      approvedDigest: input.digest,
      approvedCount: input.totalCount,
      approvedMappingVersion: input.mappingVersion,
      version: run.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(RUN.id, run.id));
}

export async function executeRun(
  c: Context,
  runId: string,
  input: { dryRunDigest: string; mappingVersion: number; totalCount: number },
  requestApproval?: ImportRunApprovalRequest,
) {
  const actor = importActor(c);
  const sessionId = (c.get("session") as { id?: string } | null)?.id ?? null;
  const outcome = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    await lockPendingActionLifecycle(tx);
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "POST /api/imports/{id}/execute",
      "work_item:create",
      "update",
    );
    if (run.state !== "queued" && run.state !== "paused")
      throw conflict("Import run cannot be executed in its current state");
    if (readSetupJob(run)?.status === "running")
      throw conflict("A setup step is still running");
    if (run.enginePhase !== "dry_run_ready" || !run.engineDryRunDigest)
      throw conflict("A current dry run is required before execution");
    const mapping = await loadMapping(tx, run, "share");
    const state = completeness(mapping.entries);
    // Unmapped (or unconfirmed) values block execution; nothing is guessed (IM-4).
    if (!state.complete) throw conflict("Mapping is incomplete");
    const report = run.engineDryRunReport as {
      counts: { created: number; updated: number; processed: number };
    };
    if (
      input.dryRunDigest !== run.engineDryRunDigest ||
      input.mappingVersion !== mapping.version ||
      run.engineDryRunMappingVersion !== mapping.version ||
      input.totalCount !== report.counts.processed
    )
      throw conflict("Dry run is stale");
    const writes = report.counts.created + report.counts.updated;
    let approved =
      run.approvedDigest === run.engineDryRunDigest &&
      run.approvedCount === report.counts.processed &&
      run.approvedMappingVersion === mapping.version;
    if (writes <= RUN_APPROVAL_THRESHOLD && !approved) {
      // Small runs need no approval; the binding is recorded so the runner has one source of truth.
      await tx
        .update(RUN)
        .set({
          approvedDigest: run.engineDryRunDigest,
          approvedCount: report.counts.processed,
          approvedMappingVersion: mapping.version,
        })
        .where(eq(RUN.id, run.id));
      approved = true;
    }
    if (!approved) {
      if (run.approvalPendingActionId) {
        const [pending] = await tx
          .select({ state: schema.pendingActionTable.state })
          .from(schema.pendingActionTable)
          .where(
            and(
              eq(schema.pendingActionTable.id, run.approvalPendingActionId),
              gt(schema.pendingActionTable.expiresAt, sql`clock_timestamp()`),
            ),
          )
          .limit(1);
        if (pending?.state === "pending")
          return {
            kind: "pending_approval" as const,
            pendingActionId: run.approvalPendingActionId,
            run,
            auditFailure: false,
          };
      }
      if (!requestApproval)
        throw new HTTPException(503, {
          message: "Import approval is unavailable",
        });
      const person = await activeStaffPerson(tx, actor.userId);
      const origin =
        (await importOrigin(tx, actor)) ?? (actor.apiKeyId ? "api" : "web");
      const request = await requestApproval(tx, {
        runId: run.id,
        digest: run.engineDryRunDigest,
        totalCount: report.counts.processed,
        mappingVersion: mapping.version,
        writes,
        requesterPersonId: person.id,
        credentialType: actor.apiKeyId ? "api_key" : "session",
        credentialId: actor.apiKeyId ?? sessionId,
        origin,
        actorId: actor.userId,
        actorType: actor.actorType,
        ip: clientIpForContext(c),
        userAgent: c.req.header("user-agent") ?? null,
      });
      await tx
        .update(RUN)
        .set({
          approvalPendingActionId: request.pendingActionId,
          version: run.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(RUN.id, run.id));
      const auditFailure = await audit(tx, actor, run, "approval_requested", {
        totalCount: report.counts.processed,
      });
      return {
        kind: "pending_approval" as const,
        pendingActionId: request.pendingActionId,
        run: await loadEngineRun(tx, run.id, "share"),
        auditFailure: auditFailure || request.auditFailure === true,
      };
    }
    // The run executes AS the administrator who executes it (not whoever created it): `started_by`
    // is bound here, and both identities are audited. The approval binding is unchanged.
    const executor = await activeStaffPerson(tx, actor.userId);
    // Start (or restart) from the beginning of the source: committed records classify as skip.
    await tx
      .update(RUN)
      .set({
        state: "running",
        enginePhase: "executing",
        pausedReason: null,
        stats: {},
        sourceCursor: { cursor: null, exhausted: false },
        nextCursor: null,
        startedBy: executor.id,
        startedByApiKeyId: actor.apiKeyId,
        version: run.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(RUN.id, run.id));
    // Until the first execute `started_by` still names the creator; afterwards it names whoever
    // executed (or resumed) last, so a re-execute after a return to the dry run records that
    // person as the previous executor, never as the creator (the `created` row keeps the creator).
    const firstExecution = run.sourceCursor === null;
    const auditFailure = await audit(tx, actor, run, "executing", {
      totalCount: report.counts.processed,
      ...(firstExecution
        ? { createdByPersonId: run.startedBy }
        : { previousExecutorPersonId: run.startedBy }),
      executedByPersonId: executor.id,
    });
    return {
      kind: "started" as const,
      run: await loadEngineRun(tx, run.id, "share"),
      auditFailure,
    };
  });
  await reportImportAuditWriteFailure(outcome.auditFailure);
  if (outcome.kind === "started") kickImportRun(outcome.run.id);
  return outcome.kind === "started"
    ? {
        status: "started" as const,
        run: engineRunDto(outcome.run, outcome.run.approvedMappingVersion),
      }
    : {
        status: "pending_approval" as const,
        pendingActionId: outcome.pendingActionId,
        run: engineRunDto(outcome.run, null),
      };
}

export async function pauseRun(c: Context, runId: string) {
  const actor = importActor(c);
  const outcome = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "POST /api/imports/{id}/pause",
      "work_item:create",
      "update",
    );
    if (run.state === "paused") return { run, auditFailure: false };
    if (run.state !== "running") throw conflict("Import run is not running");
    await tx
      .update(RUN)
      .set({
        state: "paused",
        pausedReason: "operator",
        version: run.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(RUN.id, run.id));
    const auditFailure = await audit(tx, actor, run, "paused", {
      reason: "operator",
    });
    return { run: await loadEngineRun(tx, run.id, "share"), auditFailure };
  });
  await reportImportAuditWriteFailure(outcome.auditFailure);
  return engineRunDto(outcome.run, outcome.run.approvedMappingVersion);
}

export async function resumeRun(c: Context, runId: string) {
  const actor = importActor(c);
  const outcome = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "POST /api/imports/{id}/resume",
      "work_item:create",
      "update",
    );
    // A run left `running` (for example by a process restart) is re-kicked; the per-run lease and
    // the cursor compare-and-set fence a duplicate worker.
    if (run.state === "running")
      return {
        run,
        auditFailure: false,
        started: run.enginePhase === "executing",
      };
    if (run.state !== "paused") throw conflict("Import run is not paused");
    // These pauses are not cured by resuming (the runner would pause again at the next chunk): the
    // recovery is a fresh dry run (`POST /dry-run-all` returns the run to setup) and approval.
    if (
      run.enginePhase !== "executing" ||
      !run.sourceCursor ||
      run.pausedReason === "approved_count_exceeded" ||
      run.pausedReason === "approval_invalid" ||
      run.pausedReason === "mapping_changed"
    )
      throw conflict(
        "Run needs a new dry run and approval before it can resume",
      );
    const mapping = await loadMapping(tx, run, "share");
    if (
      !run.approvedDigest ||
      run.approvedDigest !== run.engineDryRunDigest ||
      run.approvedMappingVersion !== mapping.version
    )
      throw conflict("Approval no longer matches the mapping");
    // Whoever resumes takes the run over: it continues AS this administrator. That is how another
    // instance administrator recovers a run whose starter lost authority (`authority_lost`); the
    // approval binding is untouched, and the previous and new executor are both audited.
    const resumer = await activeStaffPerson(tx, actor.userId);
    await tx
      .update(RUN)
      .set({
        state: "running",
        pausedReason: null,
        startedBy: resumer.id,
        startedByApiKeyId: actor.apiKeyId,
        version: run.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(RUN.id, run.id));
    const auditFailure = await audit(tx, actor, run, "resumed", {
      pausedReason: run.pausedReason,
      previousExecutorPersonId: run.startedBy,
      executedByPersonId: resumer.id,
    });
    return {
      run: await loadEngineRun(tx, run.id, "share"),
      auditFailure,
      started: true,
    };
  });
  await reportImportAuditWriteFailure(outcome.auditFailure);
  if (outcome.started) kickImportRun(outcome.run.id);
  return engineRunDto(outcome.run, outcome.run.approvedMappingVersion);
}

// --- losses ------------------------------------------------------------------------------------

export async function listLosses(
  c: Context,
  runId: string,
  query: { code?: string; sourceType?: string; cursor?: string; limit: number },
) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "GET /api/imports/{id}/losses",
      "work_item:read",
      "share",
    );
    const filters = [eq(importLossTable.importRunId, run.id)];
    if (query.code) filters.push(eq(importLossTable.code, query.code));
    if (query.sourceType)
      filters.push(eq(importLossTable.sourceType, query.sourceType));
    const summary = await tx
      .select({
        sourceType: importLossTable.sourceType,
        code: importLossTable.code,
        detailCode: importLossTable.detailCode,
        count: sql<number>`count(*)::int`,
      })
      .from(importLossTable)
      .where(and(...filters))
      .groupBy(
        importLossTable.sourceType,
        importLossTable.code,
        importLossTable.detailCode,
      )
      .orderBy(
        asc(importLossTable.sourceType),
        asc(importLossTable.code),
        asc(importLossTable.detailCode),
      );
    const pageFilters = [...filters];
    if (query.cursor) pageFilters.push(gt(importLossTable.id, query.cursor));
    const rows = await tx
      .select()
      .from(importLossTable)
      .where(and(...pageFilters))
      .orderBy(asc(importLossTable.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      runId: run.id,
      summary,
      losses: page.map((row) => ({
        id: row.id,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        code: row.code,
        detailCode: row.detailCode,
        sourceUrl: row.sourceUrl,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  });
}
