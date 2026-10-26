import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../api-key/enforce";
import {
  type AppendAuditLogInput,
  appendAuditLog,
} from "../audit/audit-writer";
import db, { schema } from "../database";
import type { Transaction } from "../database/executor";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { lockInstanceAdminSerialization } from "../instance/users/repository";
import { lockPendingActionLifecycle } from "../pending-action/lifecycle-invalidation";
import { isUniqueViolation } from "../utils/is-unique-violation";
import {
  type CreatedWorkItemTransactionResult,
  createWorkItemInTransaction,
  publishCreatedWorkItem,
} from "../work-item/controllers/create-work-item";
import {
  prepareWorkItemCreation,
  withCreationTransaction,
} from "../work-item/create-preparation";
import {
  type ImportActor,
  importActor,
  importOrigin,
  requireImportInstanceAdmin,
  requireImportProjectCapability,
  requireImportWorkspaceRead,
} from "./access";
import {
  normalizeImportItemAgainstCurrent,
  readWorkItemContentHash,
  sha256Canonical,
} from "./content";
import {
  publishImportedWorkItemUpdate,
  updateImportedWorkItemInTransaction,
} from "./reconcile";
import {
  type ImportRecord,
  type ImportRunRequest,
  importRecordsSchema,
} from "./schema";

const RUN = schema.importRunTable;
const CHUNK = schema.importChunkTable;
const PROFILE = schema.importMappingProfileTable;
const LINK = schema.importRecordLinkTable;
const MAX_PREVIEW_AGE_MS = 30 * 60 * 1000;

export type ImportApprovalRequest = (
  tx: Transaction,
  input: {
    runId: string;
    chunkId: string;
    expectedRunVersion: number;
    operation: "records" | "links";
    routeKey: string;
    digest: string;
    recordCount: number;
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

export type ImportAccessContext = { context: Context; actor: ImportActor };

export async function appendImportAudit(
  tx: Transaction,
  input: AppendAuditLogInput,
): Promise<boolean> {
  try {
    await tx.transaction(async (auditTx) => appendAuditLog(auditTx, input));
    return false;
  } catch {
    return true;
  }
}

export async function reportImportAuditWriteFailure(failed: boolean) {
  if (!failed) return;
  recordAuditWriteFailure("mutation");
  await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
}

function canonicalRecords(records: ImportRecord[]) {
  return records.map((record) => ({
    ...record,
    item: {
      ...record.item,
      startDate: record.item.startDate?.toISOString() ?? null,
      dueDate: record.item.dueDate?.toISOString() ?? null,
    },
  }));
}

function fixedRejectCode(error: unknown): string {
  if (error instanceof HTTPException) {
    if (error.status === 404) return "target_not_available";
    if (error.status === 403) return "target_permission_denied";
  }
  return "invalid_target_record";
}

async function assertProfile(tx: Transaction, request: ImportRunRequest) {
  if (!request.profileId) return { id: null, version: 0, mappingVersion: 0 };
  const [profile] = await tx
    .select()
    .from(PROFILE)
    .where(
      and(
        eq(PROFILE.id, request.profileId),
        eq(PROFILE.workspaceId, request.workspaceId),
        eq(PROFILE.pluginId, request.pluginId),
        eq(PROFILE.sourceRef, request.sourceRef),
      ),
    )
    .for("share")
    .limit(1);
  if (!profile)
    throw new HTTPException(404, { message: "Mapping profile not found" });
  const mapping = profile.mapping;
  if (
    profile.mappingVersion !== 1 ||
    !mapping ||
    typeof mapping !== "object" ||
    Array.isArray(mapping) ||
    Object.keys(mapping).length !== 2 ||
    mapping.version !== 1 ||
    mapping.mode !== "canonical"
  )
    throw new HTTPException(400, { message: "Unsupported mapping profile" });
  return {
    id: profile.id,
    version: profile.version,
    mappingVersion: profile.mappingVersion,
  };
}

async function profileVersionStillMatches(
  tx: Transaction,
  run: typeof RUN.$inferSelect,
) {
  if (!run.profileId) return run.profileId === null;
  const [profile] = await tx
    .select({
      version: PROFILE.version,
      mappingVersion: PROFILE.mappingVersion,
      mapping: PROFILE.mapping,
    })
    .from(PROFILE)
    .where(
      and(
        eq(PROFILE.id, run.profileId),
        eq(PROFILE.workspaceId, run.workspaceId),
        eq(PROFILE.pluginId, run.pluginId),
        eq(PROFILE.sourceRef, run.sourceRef),
      ),
    )
    .for("share")
    .limit(1);
  return (
    !!profile &&
    profile.version === (run.stats.profileVersion ?? -1) &&
    profile.mappingVersion === 1 &&
    profile.mapping?.version === 1 &&
    profile.mapping?.mode === "canonical"
  );
}

export async function createImportRun(c: Context, request: ImportRunRequest) {
  const actor = importActor(c);
  const outcome = await db.transaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    await requireImportInstanceAdmin(tx, actor, "POST /api/imports");
    await requireImportProjectCapability(
      tx,
      actor,
      request.workspaceId,
      request.projectId,
      "work_item:create",
    );
    const origin = await importOrigin(tx, actor);
    const profile = await assertProfile(tx, request);
    const [person] = await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, actor.userId),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
        ),
      )
      .limit(1);
    if (!person) throw new HTTPException(403, { message: "Forbidden" });
    const [inserted] = await tx
      .insert(RUN)
      .values({
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        pluginId: request.pluginId,
        sourceRef: request.sourceRef,
        profileId: profile.id,
        startedBy: person.id,
        startedByApiKeyId: actor.apiKeyId,
        state: "running",
        stats: {
          profileVersion: profile.version,
          mappingVersion: profile.mappingVersion,
        },
        log: [],
      })
      .returning();
    if (!inserted)
      throw new HTTPException(500, {
        message: "Import run could not be created",
      });
    const auditFailure = await appendImportAudit(tx, {
      actorId: actor.userId,
      actorType: actor.actorType,
      apiKeyId: actor.apiKeyId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      action: "import.run",
      entityType: "import_run",
      entityId: inserted.id,
      before: null,
      after: {
        operation: "created",
        runId: inserted.id,
        pluginId: "import.mcp",
        ...(origin ? { origin } : {}),
      },
    });
    return { run: inserted, auditFailure };
  });
  await reportImportAuditWriteFailure(outcome.auditFailure);
  return safeRun(outcome.run);
}

function safeRun(run: typeof RUN.$inferSelect) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    pluginId: "import.mcp" as const,
    sourceRef: run.sourceRef,
    profileId: run.profileId,
    state: run.state,
    stats: safeCounts(run.stats),
    log: safeLog(run.log),
    version: run.version,
    nextCursor: run.nextCursor,
    lastCommittedChunk: run.lastCommittedChunk,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function safeCounts(value: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of [
    "created",
    "updated",
    "skipped",
    "rejected",
    "processed",
  ]) {
    const count = value[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
      result[key] = count;
  }
  return result;
}

function safeLog(value: { code: string; at: string; chunkId?: string }[]) {
  const allowed = new Set([
    "chunk_previewed",
    "chunk_committed",
    "chunk_rejected",
    "approval_requested",
    "target_project_purged",
  ]);
  return value
    .filter((entry) => allowed.has(entry.code))
    .slice(-100)
    .map((entry) => ({
      code: entry.code,
      at: entry.at,
      ...(entry.chunkId ? { chunkId: entry.chunkId } : {}),
    }));
}

export async function listImportRuns(
  c: Context,
  input: {
    workspaceId: string;
    projectId?: string;
    state?: string;
    cursor?: string;
    limit: number;
  },
) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    if (input.projectId) {
      await requireImportProjectCapability(
        tx,
        actor,
        input.workspaceId,
        input.projectId,
        "work_item:read",
      );
    } else {
      await requireImportWorkspaceRead(tx, actor, input.workspaceId);
    }
    const filters = [eq(RUN.workspaceId, input.workspaceId)];
    if (input.projectId) filters.push(eq(RUN.projectId, input.projectId));
    if (input.state)
      filters.push(eq(RUN.state, input.state as typeof RUN.$inferSelect.state));
    if (input.cursor) {
      const [cursor] = await tx
        .select({ id: RUN.id, createdAt: RUN.createdAt })
        .from(RUN)
        .where(
          and(eq(RUN.id, input.cursor), eq(RUN.workspaceId, input.workspaceId)),
        )
        .limit(1);
      if (!cursor) throw new HTTPException(400, { message: "Invalid cursor" });
      const afterCursor = or(
        lt(RUN.createdAt, cursor.createdAt),
        and(eq(RUN.createdAt, cursor.createdAt), lt(RUN.id, cursor.id)),
      );
      if (afterCursor) filters.push(afterCursor);
    }
    const rows = await tx
      .select()
      .from(RUN)
      .where(and(...filters))
      .orderBy(desc(RUN.createdAt), desc(RUN.id))
      .limit(input.limit + 1);
    const selected = rows.slice(0, input.limit);
    const visible = input.projectId
      ? selected
      : await Promise.all(
          selected.map(async (run) => {
            if (!run.projectId) return run;
            try {
              await requireImportProjectCapability(
                tx,
                actor,
                run.workspaceId,
                run.projectId,
                "work_item:read",
              );
              return run;
            } catch {
              return null;
            }
          }),
        );
    return {
      runs: visible.filter((run) => run !== null).map(safeRun),
      nextCursor:
        rows.length > input.limit ? (selected.at(-1)?.id ?? null) : null,
    };
  });
}

export async function getImportReport(c: Context, runId: string) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(RUN).where(eq(RUN.id, runId)).limit(1);
    if (!run) throw new HTTPException(404, { message: "Import run not found" });
    if (run.projectId) {
      await requireImportProjectCapability(
        tx,
        actor,
        run.workspaceId,
        run.projectId,
        "work_item:read",
      );
    } else {
      await requireImportWorkspaceRead(tx, actor, run.workspaceId);
    }
    const chunks = await tx
      .select({
        sequence: CHUNK.sequence,
        chunkId: CHUNK.chunkId,
        state: CHUNK.state,
        recordCount: CHUNK.recordCount,
        report: CHUNK.report,
        createdAt: CHUNK.createdAt,
        committedAt: CHUNK.committedAt,
      })
      .from(CHUNK)
      .where(eq(CHUNK.importRunId, run.id))
      .orderBy(asc(CHUNK.sequence));
    return {
      runId: run.id,
      counts: safeCounts(run.stats),
      log: safeLog(run.log),
      chunks: chunks.map((chunk) => {
        const rows = Array.isArray(chunk.report.rows)
          ? (chunk.report.rows as Array<{ outcome?: string; code?: string }>)
          : [];
        const rejectionCodes = safeRejectionCodes(
          chunk.report.rejectionCodes,
          rows,
        );
        return {
          sequence: chunk.sequence,
          chunkId: chunk.chunkId,
          state: chunk.state,
          recordCount: chunk.recordCount,
          counts: isSafeCountsObject(chunk.report.counts)
            ? safeCounts(chunk.report.counts)
            : countOutcomes(
                rows.map((row) => ({ outcome: row.outcome ?? "reject" })),
              ),
          rejectionCodes,
          createdAt: chunk.createdAt.toISOString(),
          committedAt: chunk.committedAt?.toISOString() ?? null,
        };
      }),
    };
  });
}

export async function getImportRun(c: Context, runId: string) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(RUN).where(eq(RUN.id, runId)).limit(1);
    if (!run) throw new HTTPException(404, { message: "Import run not found" });
    if (run.projectId) {
      await requireImportProjectCapability(
        tx,
        actor,
        run.workspaceId,
        run.projectId,
        "work_item:read",
      );
    } else {
      await requireImportWorkspaceRead(tx, actor, run.workspaceId);
    }
    return safeRun(run);
  });
}

export async function dryRunImport(
  c: Context,
  runId: string,
  input: { chunkId: string; expectedVersion: number; records: ImportRecord[] },
) {
  const actor = importActor(c);
  const outcome = await withCreationTransaction(async (tx) => {
    await lockInstanceAdminSerialization(tx);
    await requireImportInstanceAdmin(
      tx,
      actor,
      "POST /api/imports/{id}/dry-run",
    );
    const origin = await importOrigin(tx, actor);
    const [run] = await tx
      .select()
      .from(RUN)
      .where(eq(RUN.id, runId))
      .for("update")
      .limit(1);
    if (!run?.projectId)
      throw new HTTPException(404, { message: "Import run not found" });
    await requireImportProjectCapability(
      tx,
      actor,
      run.workspaceId,
      run.projectId,
      "work_item:create",
    );
    if (run.version !== input.expectedVersion)
      throw new HTTPException(409, { message: "Import run version conflict" });
    if (run.state !== "running")
      throw new HTTPException(409, { message: "Import run is not writable" });
    if (!(await profileVersionStillMatches(tx, run)))
      throw new HTTPException(409, { message: "Mapping profile changed" });
    const [active] = await tx
      .select({ id: CHUNK.id })
      .from(CHUNK)
      .innerJoin(
        schema.pendingActionTable,
        eq(CHUNK.pendingActionId, schema.pendingActionTable.id),
      )
      .where(
        and(
          eq(CHUNK.importRunId, run.id),
          eq(CHUNK.state, "pending_approval"),
          eq(schema.pendingActionTable.state, "pending"),
        ),
      )
      .limit(1);
    if (active)
      throw new HTTPException(409, {
        message: "An import chunk is awaiting approval",
      });
    const stored = await tx
      .select({ id: CHUNK.id, expiresAt: CHUNK.expiresAt })
      .from(CHUNK)
      .where(
        and(
          eq(CHUNK.importRunId, run.id),
          eq(CHUNK.state, "previewed"),
          gt(CHUNK.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .limit(1);
    if (stored.length)
      throw new HTTPException(409, {
        message: "An import preview is still active",
      });

    const normalized = canonicalRecords(input.records);
    const digest = sha256Canonical({
      runId: run.id,
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      pluginId: "import.mcp",
      sourceRef: run.sourceRef,
      profileId: run.profileId,
      profileVersion: run.profileId ? run.stats.profileVersion : null,
      mappingVersion: run.profileId ? run.stats.mappingVersion : null,
      chunkId: input.chunkId,
      records: normalized,
    });
    const rows: Array<{
      sourceType: string;
      sourceId: string;
      outcome: "create" | "update" | "skip" | "reject";
      code?: string;
    }> = [];
    for (const record of input.records) {
      if (record.sourceCreatedAt || record.sourceAuthorEmail) {
        rows.push({
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          outcome: "reject",
          code: "unsupported_authorship_or_timestamp",
        });
        continue;
      }
      try {
        await prepareWorkItemCreation(tx, {
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          typeId: record.item.typeId,
          startDate: record.item.startDate,
          dueDate: record.item.dueDate,
          labelIds: record.item.labelIds,
          assigneeId: record.item.assigneeId,
          authorization: {
            userId: actor.userId,
            ...(actor.apiKey ? { apiKey: actor.apiKey } : {}),
            impersonatedBy: actor.impersonatedBy,
          },
        });
      } catch (error) {
        rows.push({
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          outcome: "reject",
          code: fixedRejectCode(error),
        });
        continue;
      }
      const [link] = await tx
        .select()
        .from(LINK)
        .where(
          and(
            eq(LINK.workspaceId, run.workspaceId),
            eq(LINK.pluginId, run.pluginId),
            eq(LINK.sourceRef, run.sourceRef),
            eq(LINK.sourceType, record.sourceType),
            eq(LINK.sourceId, record.sourceId),
            eq(LINK.targetType, "work_item"),
          ),
        )
        .for("share")
        .limit(1);
      if (!link) {
        rows.push({
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          outcome: "create",
        });
        continue;
      }
      const current = await readWorkItemContentHash(tx, {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        targetId: link.targetId,
      });
      if (!current) {
        rows.push({
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          outcome: "reject",
          code: "linked_target_unavailable",
        });
        continue;
      }
      if (
        record.item.assigneeId !== undefined &&
        record.item.assigneeId !== current.row.assigneeId
      ) {
        rows.push({
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          outcome: "reject",
          code: "assignment_update_requires_manual_action",
        });
        continue;
      }
      const targetCandidate = sha256Canonical(
        normalizeImportItemAgainstCurrent(record.item, current),
      );
      if (current.hash === targetCandidate) {
        rows.push({
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          outcome: "skip",
        });
      } else {
        rows.push({
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          outcome: "update",
        });
      }
    }
    const report = {
      runId: run.id,
      chunkId: input.chunkId,
      operation: "records" as const,
      previewDigest: digest,
      counts: countOutcomes(rows),
      rejectionCodes: safeRejectionCodes(null, rows),
      rows,
    };
    const sequence =
      (
        await tx
          .select({ max: sql<number>`coalesce(max(${CHUNK.sequence}), -1)` })
          .from(CHUNK)
          .where(eq(CHUNK.importRunId, run.id))
      )[0]?.max ?? -1;
    const expiresAt = new Date(Date.now() + MAX_PREVIEW_AGE_MS);
    await tx.insert(CHUNK).values({
      importRunId: run.id,
      chunkId: input.chunkId,
      sequence: sequence + 1,
      state: "previewed",
      expectedRunVersion: run.version + 1,
      inputDigest: digest,
      inputPayload: { operation: "records", records: normalized },
      report,
      recordCount: input.records.length,
      expiresAt,
    });
    await tx
      .update(RUN)
      .set({
        version: run.version + 1,
        dryRunDigest: digest,
        dryRunExpiresAt: expiresAt,
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
        operation: "previewed",
        runId: run.id,
        chunkId: input.chunkId,
        counts: countOutcomes(rows),
        ...(origin ? { origin } : {}),
      },
    });
    return {
      result: {
        ...report,
        runVersion: run.version + 1,
        expiresAt: expiresAt.toISOString(),
      },
      auditFailure,
    };
  });
  await reportImportAuditWriteFailure(outcome.auditFailure);
  return outcome.result;
}

export function countOutcomes(rows: Array<{ outcome: string }>) {
  return {
    created: rows.filter((row) => row.outcome === "create").length,
    updated: rows.filter((row) => row.outcome === "update").length,
    skipped: rows.filter((row) => row.outcome === "skip").length,
    rejected: rows.filter((row) => row.outcome === "reject").length,
    processed: rows.length,
  };
}

function isSafeCountsObject(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    )
  );
}

function safeRejectionCodes(
  stored: unknown,
  rows: Array<{ code?: string }>,
): Record<string, number> {
  const allowed = new Set([
    "unsupported_authorship_or_timestamp",
    "invalid_target_record",
    "target_not_available",
    "target_permission_denied",
    "linked_target_unavailable",
    "assignment_update_requires_manual_action",
    "target_project_purged",
  ]);
  const result: Record<string, number> = {};
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
    for (const [code, count] of Object.entries(stored))
      if (
        allowed.has(code) &&
        typeof count === "number" &&
        Number.isSafeInteger(count) &&
        count >= 0
      )
        result[code] = count;
    return result;
  }
  for (const row of rows)
    if (row.code && allowed.has(row.code))
      result[row.code] = (result[row.code] ?? 0) + 1;
  return result;
}

export async function commitImportChunk(
  tx: Transaction,
  input: {
    actor: ImportActor;
    runId: string;
    chunkId: string;
    expectedVersion: number;
    previewDigest: string;
    records: ImportRecord[];
    /** Internal-only bypass used after the requester has approved a staged >50 chunk. */
    approvedLarge?: boolean;
    requestApproval?: ImportApprovalRequest;
    ip?: string | null;
    userAgent?: string | null;
  },
) {
  const { actor } = input;
  if (!input.approvedLarge) await lockInstanceAdminSerialization(tx);
  await requireImportInstanceAdmin(tx, actor, "POST /api/imports/{id}/records");
  if (input.records.length > 50 && !input.approvedLarge)
    await lockPendingActionLifecycle(tx);
  const origin = await importOrigin(tx, actor);
  const [run] = await tx
    .select()
    .from(RUN)
    .where(eq(RUN.id, input.runId))
    .for("update")
    .limit(1);
  if (!run?.projectId)
    throw new HTTPException(404, { message: "Import run not found" });
  await requireImportProjectCapability(
    tx,
    actor,
    run.workspaceId,
    run.projectId,
    "work_item:create",
  );
  const submittedDigest = sha256Canonical({
    runId: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    pluginId: run.pluginId,
    sourceRef: run.sourceRef,
    profileId: run.profileId,
    profileVersion: run.profileId ? run.stats.profileVersion : null,
    mappingVersion: run.profileId ? run.stats.mappingVersion : null,
    chunkId: input.chunkId,
    records: canonicalRecords(input.records),
  });
  const [chunk] = await tx
    .select()
    .from(CHUNK)
    .where(and(eq(CHUNK.importRunId, run.id), eq(CHUNK.chunkId, input.chunkId)))
    .for("update")
    .limit(1);
  if (
    chunk &&
    chunk.inputDigest === submittedDigest &&
    input.previewDigest === submittedDigest &&
    chunk.recordCount === input.records.length
  ) {
    if (chunk.state === "committed") {
      const rows = Array.isArray(chunk.report.rows) ? chunk.report.rows : [];
      const counts = isSafeCountsObject(chunk.report.counts)
        ? chunk.report.counts
        : null;
      if (!counts || rows.length !== input.records.length)
        throw new HTTPException(409, {
          message: "Import retry result is unavailable",
        });
      return {
        kind: "committed" as const,
        runId: run.id,
        chunkId: chunk.chunkId,
        runVersion: run.version,
        counts,
        rows,
        createdResults: [],
        updateResults: [],
        auditFailure: false,
      };
    }
    if (chunk.state === "pending_approval" && chunk.pendingActionId) {
      const [pending] = await tx
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(
          and(
            eq(schema.pendingActionTable.id, chunk.pendingActionId),
            gt(schema.pendingActionTable.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .limit(1);
      if (pending?.state === "pending")
        return {
          kind: "pending_approval" as const,
          pendingActionId: chunk.pendingActionId,
          runId: run.id,
          chunkId: chunk.chunkId,
          runVersion: run.version,
        };
    }
    if (chunk.state !== "previewed")
      throw new HTTPException(409, {
        message: "Import chunk is no longer executable",
      });
  }
  if (run.version !== input.expectedVersion)
    throw new HTTPException(409, { message: "Import run version conflict" });
  const [activePreview] = await tx
    .select({ id: RUN.id })
    .from(RUN)
    .where(
      and(
        eq(RUN.id, run.id),
        eq(RUN.dryRunDigest, input.previewDigest),
        gt(RUN.dryRunExpiresAt, sql`clock_timestamp()`),
      ),
    )
    .limit(1);
  if (run.dryRunDigest !== input.previewDigest || !activePreview)
    throw new HTTPException(409, { message: "Import preview is stale" });
  if (!(await profileVersionStillMatches(tx, run)))
    throw new HTTPException(409, { message: "Mapping profile changed" });
  if (
    chunk?.state !== "previewed" ||
    !(
      await tx
        .select({ id: CHUNK.id })
        .from(CHUNK)
        .where(
          and(
            eq(CHUNK.id, chunk.id),
            gt(CHUNK.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .limit(1)
    ).length ||
    chunk.expectedRunVersion !== run.version ||
    chunk.inputDigest !== input.previewDigest
  )
    throw new HTTPException(409, {
      message: "Import chunk is no longer executable",
    });
  const parsedStored = importRecordsSchema.safeParse(
    (chunk.inputPayload as { records?: unknown } | null)?.records,
  );
  if (!parsedStored.success)
    throw new HTTPException(409, {
      message: "Stored import preview is invalid",
    });
  if (
    submittedDigest !== input.previewDigest ||
    sha256Canonical(canonicalRecords(parsedStored.data)) !==
      sha256Canonical(canonicalRecords(input.records))
  )
    throw new HTTPException(409, {
      message: "Import preview does not match submitted records",
    });
  if (input.records.length !== chunk.recordCount)
    throw new HTTPException(409, {
      message: "Import preview does not match submitted records",
    });
  if (
    !Array.isArray(chunk.report.rows) ||
    chunk.report.rows.length !== input.records.length
  )
    throw new HTTPException(409, {
      message: "Import preview report is invalid",
    });

  if (input.records.length > 50 && !input.approvedLarge) {
    if (!input.requestApproval)
      throw new HTTPException(503, {
        message: "Import approval is unavailable",
      });
    const [person] = await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, actor.userId),
          eq(schema.personTable.active, true),
        ),
      )
      .limit(1);
    if (!person) throw new HTTPException(403, { message: "Forbidden" });
    const approval = await input.requestApproval(tx, {
      runId: run.id,
      chunkId: chunk.chunkId,
      expectedRunVersion: run.version,
      operation: "records",
      routeKey: "POST /api/imports/{id}/records",
      digest: chunk.inputDigest,
      recordCount: chunk.recordCount,
      requesterPersonId: person.id,
      credentialType: actor.apiKeyId ? "api_key" : "session",
      credentialId: actor.apiKeyId,
      origin: origin ?? (actor.apiKeyId ? "api" : "web"),
      actorId: actor.userId,
      actorType: actor.actorType,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
    await tx
      .update(CHUNK)
      .set({
        state: "pending_approval",
        pendingActionId: approval.pendingActionId,
        inputPayload: { records: canonicalRecords(input.records) },
      })
      .where(eq(CHUNK.id, chunk.id));
    const log = [
      ...run.log,
      {
        code: "approval_requested",
        at: new Date().toISOString(),
        chunkId: chunk.chunkId,
      },
    ].slice(-100);
    await tx
      .update(RUN)
      .set({ version: run.version + 1, log, updatedAt: new Date() })
      .where(eq(RUN.id, run.id));
    return {
      kind: "pending_approval" as const,
      pendingActionId: approval.pendingActionId,
      runId: run.id,
      chunkId: chunk.chunkId,
      runVersion: run.version + 1,
      ...(approval.auditFailure ? { auditFailure: true } : {}),
    };
  }

  const createdResults: CreatedWorkItemTransactionResult[] = [];
  const updateResults: import("./reconcile").ImportUpdateResult[] = [];
  const rows: Array<{
    sourceType: string;
    sourceId: string;
    targetId?: string;
    key?: string;
    outcome: "create" | "update" | "skip" | "reject";
    code?: string;
  }> = [];
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index];
    if (!record)
      throw new HTTPException(409, { message: "Import preview is invalid" });
    const preview = chunk.report.rows[index] as {
      sourceType: string;
      sourceId: string;
      outcome: "create" | "update" | "skip" | "reject";
      code?: string;
    };
    if (
      preview.sourceType !== record.sourceType ||
      preview.sourceId !== record.sourceId
    )
      throw new HTTPException(409, { message: "Import preview order changed" });
    if (preview.outcome === "reject") {
      rows.push({
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        outcome: "reject",
        code: preview.code ?? "invalid_target_record",
      });
      continue;
    }
    const [existingLink] = await tx
      .select()
      .from(LINK)
      .where(
        and(
          eq(LINK.workspaceId, run.workspaceId),
          eq(LINK.pluginId, run.pluginId),
          eq(LINK.sourceRef, run.sourceRef),
          eq(LINK.sourceType, record.sourceType),
          eq(LINK.sourceId, record.sourceId),
          eq(LINK.targetType, "work_item"),
        ),
      )
      .for("update")
      .limit(1);
    if (preview.outcome === "skip") {
      if (!existingLink)
        throw new HTTPException(409, {
          message: "Import link changed after preview",
        });
      rows.push({
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        targetId: existingLink.targetId,
        outcome: "skip",
      });
      await updateImportLink(
        tx,
        run,
        record,
        existingLink.targetId,
        existingLink.firstImportRunId,
        existingLink.targetContentHash,
        existingLink.id,
      );
      continue;
    }
    if (preview.outcome === "update") {
      if (!existingLink)
        throw new HTTPException(409, {
          message: "Import link changed after preview",
        });
      await prepareWorkItemCreation(tx, {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        typeId: record.item.typeId,
        startDate: record.item.startDate,
        dueDate: record.item.dueDate,
        labelIds: record.item.labelIds,
        authorization: {
          userId: actor.userId,
          ...(actor.apiKey ? { apiKey: actor.apiKey } : {}),
          impersonatedBy: actor.impersonatedBy,
        },
      });
      await requireImportProjectCapability(
        tx,
        actor,
        run.workspaceId,
        run.projectId,
        "work_item:update",
      );
      const updated = await updateImportedWorkItemInTransaction(tx, {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        targetId: existingLink.targetId,
        actorId: actor.userId,
        actorType: actor.actorType,
        apiKeyId: actor.apiKeyId,
        origin,
        item: record.item,
      });
      updateResults.push(updated);
      const content = await readWorkItemContentHash(tx, {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        targetId: existingLink.targetId,
      });
      if (!content)
        throw new HTTPException(409, {
          message: "Linked target is no longer available",
        });
      await updateImportLink(
        tx,
        run,
        record,
        existingLink.targetId,
        existingLink.firstImportRunId,
        content.hash,
        existingLink.id,
      );
      rows.push({
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        targetId: content.row.id,
        key: content.row.key,
        outcome: "update",
      });
      continue;
    }
    if (existingLink)
      throw new HTTPException(409, {
        message: "Import link changed after preview",
      });
    const created = await createWorkItemInTransaction(tx, {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      typeId: record.item.typeId,
      title: record.item.title,
      description: record.item.description,
      priority: record.item.priority,
      startDate: record.item.startDate,
      dueDate: record.item.dueDate,
      labelIds: record.item.labelIds,
      assigneeId: record.item.assigneeId ?? undefined,
      actorId: actor.userId,
      actorType: actor.actorType,
      eventSource: "import",
      authorization: {
        userId: actor.userId,
        ...(actor.apiKey ? { apiKey: actor.apiKey } : {}),
        impersonatedBy: actor.impersonatedBy,
      },
    });
    createdResults.push(created);
    const contentHash = await readWorkItemContentHash(tx, {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      targetId: created.created.id,
    });
    if (!contentHash)
      throw new HTTPException(500, {
        message: "Created import target could not be verified",
      });
    await updateImportLink(
      tx,
      run,
      record,
      created.created.id,
      run.id,
      contentHash.hash,
    );
    rows.push({
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      targetId: created.created.id,
      key: created.created.key,
      outcome: "create",
    });
  }

  const counts = countOutcomes(rows);
  const rejectionCodes = safeRejectionCodes(null, rows);
  const auditAfter = {
    runId: run.id,
    chunkId: chunk.chunkId,
    counts,
    ...(origin ? { origin } : {}),
  };
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
    after: auditAfter,
  });
  const now = new Date();
  const newStats = addCounts(run.stats, counts);
  const newLog = [
    ...run.log,
    { code: "chunk_committed", at: now.toISOString(), chunkId: chunk.chunkId },
  ].slice(-100);
  await tx
    .update(CHUNK)
    .set({
      state: "committed",
      inputPayload: null,
      report: { counts, rejectionCodes, rows },
      committedAt: now,
    })
    .where(eq(CHUNK.id, chunk.id));
  await tx
    .update(RUN)
    .set({
      state: "running",
      stats: newStats,
      log: newLog,
      version: run.version + 1,
      dryRunDigest: null,
      dryRunExpiresAt: null,
      lastCommittedChunk: chunk.sequence,
      updatedAt: now,
    })
    .where(eq(RUN.id, run.id));
  const actorName = actor.userId;
  await enqueueOutboxEvent(tx, {
    id: createId(),
    kind: "import.chunk_completed",
    occurredAt: now.toISOString(),
    actor: { type: actor.actorType, id: actor.userId, name: actorName },
    scope: eventScope({
      workspaceId: null,
      organisationId: null,
      projectId: null,
    }),
    payload: {
      importRunId: run.id,
      chunk: chunk.sequence + 1,
      chunks: chunk.sequence + 1,
      rowsDone: counts.processed,
      rowsTotal: chunk.recordCount,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  return {
    kind: "committed" as const,
    runId: run.id,
    chunkId: chunk.chunkId,
    runVersion: run.version + 1,
    counts,
    rows,
    createdResults,
    updateResults,
    ...(auditFailure ? { auditFailure: true } : {}),
  };
}

async function updateImportLink(
  tx: Transaction,
  run: typeof RUN.$inferSelect,
  record: ImportRecord,
  targetId: string,
  firstRunId: string,
  targetContentHash: string | null,
  existingLinkId?: string,
) {
  const values = {
    importRunId: run.id,
    sourceHash: record.sourceHash ?? null,
    targetContentHash,
    sourceUrl: record.sourceUrl ?? null,
    lastSeenAt: new Date(),
    staleAt: null,
  };
  if (existingLinkId) {
    await tx.update(LINK).set(values).where(eq(LINK.id, existingLinkId));
    return;
  }
  await tx.insert(LINK).values({
    workspaceId: run.workspaceId,
    pluginId: run.pluginId,
    sourceRef: run.sourceRef,
    importRunId: run.id,
    firstImportRunId: firstRunId,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    sourceHash: record.sourceHash ?? null,
    targetContentHash,
    targetType: "work_item",
    targetId,
    sourceUrl: record.sourceUrl ?? null,
    lastSeenAt: new Date(),
    staleAt: null,
  });
}

function addCounts(
  current: Record<string, number>,
  incoming: ReturnType<typeof countOutcomes>,
) {
  return {
    created: (current.created ?? 0) + incoming.created,
    updated: (current.updated ?? 0) + incoming.updated,
    skipped: (current.skipped ?? 0) + incoming.skipped,
    rejected: (current.rejected ?? 0) + incoming.rejected,
    processed: (current.processed ?? 0) + incoming.processed,
    profileVersion: current.profileVersion ?? 0,
    mappingVersion: current.mappingVersion ?? 0,
  };
}

export async function publishCommittedImport(
  result: Awaited<ReturnType<typeof commitImportChunk>>,
) {
  if (result.kind !== "committed") return;
  await reportImportAuditWriteFailure(result.auditFailure === true);
  for (const created of result.createdResults)
    await publishCreatedWorkItem(created);
  for (const updated of result.updateResults)
    await publishImportedWorkItemUpdate(updated);
}

export async function commitImportChunkRoute(
  c: Context,
  input: {
    runId: string;
    chunkId: string;
    expectedVersion: number;
    previewDigest: string;
    records: ImportRecord[];
  },
  requestApproval?: ImportApprovalRequest,
) {
  const actor = importActor(c);
  let result: Awaited<ReturnType<typeof commitImportChunk>>;
  try {
    result = await db.transaction((tx) =>
      commitImportChunk(tx, {
        actor,
        ...input,
        requestApproval,
        ip: clientIpForContext(c),
        userAgent: c.req.header("user-agent") ?? null,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error, "import_link_stable_source_key"))
      throw new HTTPException(409, {
        message: "An import source identity changed concurrently",
      });
    if (isUniqueViolation(error, "work_item_key_claim_pkey"))
      throw new HTTPException(409, {
        message: "A work item key was claimed concurrently",
      });
    throw error;
  }
  await publishCommittedImport(result);
  if (result.kind === "pending_approval") {
    if (result.auditFailure) {
      recordAuditWriteFailure("mutation");
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    }
    const { auditFailure: _auditFailure, ...safe } = result;
    return safe;
  }
  const {
    createdResults: _created,
    updateResults: _updated,
    auditFailure: _auditFailure,
    ...safe
  } = result;
  return safe;
}
