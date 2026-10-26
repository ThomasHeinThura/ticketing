import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendPendingActionStepUpAudit } from "../auth/step-up-audit";
import { consumePendingActionProof } from "../auth/step-up-service";
import { schema } from "../database";
import { lockInstanceAdminSerialization } from "../instance/users/repository";
import { approveClickDeletion } from "../pending-action/click-deletion-executor";
import { failOnExecutorError } from "../pending-action/execution-failure";
import { resolvePendingActionCredentialIdentity } from "../pending-action/required-access";
import type { PendingActionTransaction } from "../pending-action/service";
import { createPendingActionInTransaction } from "../pending-action/service";
import type { ImportActor } from "./access";
import {
  importOrigin,
  requireImportInstanceAdmin,
  requireImportProjectCapability,
} from "./access";
import { sha256Canonical } from "./content";
import {
  grantRunApproval,
  type ImportRunApprovalRequest,
} from "./engine/service";
import { commitApprovedImportLinks, lockRun as lockImportRun } from "./links";
import {
  type IMPORT_CHUNK_ROUTE,
  IMPORT_CHUNK_TARGET,
  type IMPORT_LINK_CHUNK_ROUTE,
  IMPORT_RUN_ROUTE,
  IMPORT_RUN_TARGET,
  readImportChunkBinding,
  readImportRunBinding,
} from "./pending-action-contract";
import { importRecordsSchema, linkImportBody } from "./schema";
import {
  commitImportChunk,
  type ImportApprovalRequest,
  publishCommittedImport,
} from "./service";

export const requestImportChunkApproval: ImportApprovalRequest = async (
  tx,
  input,
) => {
  const result = await createPendingActionInTransaction(tx, {
    requesterPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
    origin: input.origin,
    action: "mcp_destructive",
    routeKey: input.routeKey as
      | typeof IMPORT_CHUNK_ROUTE
      | typeof IMPORT_LINK_CHUNK_ROUTE,
    targetType: IMPORT_CHUNK_TARGET,
    targetIds: [input.chunkId],
    actorId: input.actorId,
    actorType: input.actorType,
    actorIp: input.ip,
    userAgent: input.userAgent,
    importChunk: {
      routeKey: input.routeKey as
        | typeof IMPORT_CHUNK_ROUTE
        | typeof IMPORT_LINK_CHUNK_ROUTE,
      runId: input.runId,
      chunkId: input.chunkId,
      operation: input.operation,
      digest: input.digest,
      expectedRunVersion: input.expectedRunVersion,
      recordCount: input.recordCount,
    },
  });
  return {
    pendingActionId: result.pendingActionId,
    auditFailure: result.auditFailure,
  };
};

type ApprovedChunkResult = {
  commit: Awaited<ReturnType<typeof commitImportChunk>>;
};

export async function approveImportChunk(input: {
  id: string;
  requesterPersonId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  typedCount?: string;
  stepUpToken?: string;
  routeKey: typeof IMPORT_CHUNK_ROUTE | typeof IMPORT_LINK_CHUNK_ROUTE;
}) {
  return approveClickDeletion<ApprovedChunkResult>(input, {
    action: "mcp_destructive",
    targetType: IMPORT_CHUNK_TARGET,
    routeKey: input.routeKey,
    confirmation: ["typed_count_step_up"],
    beforeLock: (tx) => lockInstanceAdminSerialization(tx),
    confirm: async (tx, row) => {
      const target = readImportChunkBinding(
        row.targetVersions,
        row.targetIds,
        row.routeKey,
      );
      if (!target)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      if (input.typedCount !== String(target.binding.recordCount))
        throw new HTTPException(400, { message: "confirmation_mismatch" });
      const proof = await consumePendingActionProof(tx, {
        token: input.stepUpToken ?? "",
        personId: input.requesterPersonId,
        sessionId: input.sessionId,
        userId: input.userId,
        pendingActionId: row.id,
      });
      if (!proof) {
        await appendPendingActionStepUpAudit(tx, {
          action: "auth.step_up_denied",
          actorId: input.userId,
          personId: input.requesterPersonId,
          pendingActionId: row.id,
          traceId: input.traceId,
        });
        return {
          supplied: {},
          denied: input.stepUpToken
            ? ("step_up_expired" as const)
            : ("step_up_required" as const),
        };
      }
      await appendPendingActionStepUpAudit(tx, {
        action: "auth.step_up_consumed",
        actorId: input.userId,
        personId: input.requesterPersonId,
        pendingActionId: row.id,
        traceId: input.traceId,
      });
      return {
        supplied: { typedCount: target.binding.recordCount, stepUp: true },
        stepUpTokenId: proof.id,
      };
    },
    summaryResult: (result) => ({
      runId: result.commit.runId,
      chunkId: result.commit.chunkId,
      ...(result.commit.kind === "committed"
        ? { counts: result.commit.counts }
        : {}),
    }),
    execute: failOnExecutorError(async (tx, row) => {
      const result = await executeApprovedChunk(tx, row);
      return { commit: result };
    }),
    afterCommit: async (result) => publishCommittedImport(result.commit),
  });
}

async function executeApprovedChunk(
  tx: PendingActionTransaction,
  row: typeof schema.pendingActionTable.$inferSelect,
): Promise<Awaited<ReturnType<typeof commitImportChunk>>> {
  const target = readImportChunkBinding(
    row.targetVersions,
    row.targetIds,
    row.routeKey,
  );
  if (
    !target ||
    row.action !== "mcp_destructive" ||
    row.origin !== "mcp" ||
    row.credentialType !== "api_key" ||
    !row.credentialId ||
    row.workspaceId === null ||
    row.projectId === null
  )
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  const currentIdentity = await resolvePendingActionCredentialIdentity(
    tx,
    row,
    { existingPendingAction: true },
  );
  if (!("authority" in currentIdentity))
    throw new HTTPException(403, { message: "Forbidden" });

  const binding = target.binding;
  const [run] = await tx
    .select()
    .from(schema.importRunTable)
    .where(
      and(
        eq(schema.importRunTable.id, binding.runId),
        eq(schema.importRunTable.workspaceId, row.workspaceId),
        eq(schema.importRunTable.projectId, row.projectId),
      ),
    )
    .for("update")
    .limit(1);
  if (!run?.projectId)
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  const [chunk] = await tx
    .select()
    .from(schema.importChunkTable)
    .where(
      and(
        eq(schema.importChunkTable.importRunId, run.id),
        eq(schema.importChunkTable.chunkId, target.chunkId),
      ),
    )
    .for("update")
    .limit(1);
  if (
    !chunk ||
    chunk.state !== "pending_approval" ||
    chunk.pendingActionId !== row.id ||
    chunk.inputDigest !== binding.digest ||
    chunk.recordCount !== binding.recordCount ||
    chunk.expectedRunVersion !== binding.expectedRunVersion - 1 ||
    run.version !== binding.expectedRunVersion ||
    chunk.report.operation !== binding.operation
  )
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });

  const actor: ImportActor = {
    userId: currentIdentity.userId,
    actorType: "api_key",
    apiKeyId: row.credentialId,
    apiKey: { id: row.credentialId },
    impersonatedBy: null,
  };
  await requireImportInstanceAdmin(tx, actor, row.routeKey);
  await requireImportProjectCapability(
    tx,
    actor,
    run.workspaceId,
    run.projectId,
    "work_item:create",
  );
  const payload = chunk.inputPayload;
  if (binding.operation === "records") {
    const parsed = importRecordsSchema.safeParse(payload?.records);
    if (
      !parsed.success ||
      parsed.data.length !== binding.recordCount ||
      !Array.isArray(chunk.report.rows) ||
      chunk.report.rows.length !== parsed.data.length
    )
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    await tx
      .update(schema.importChunkTable)
      .set({
        state: "previewed",
        pendingActionId: null,
        expectedRunVersion: run.version,
      })
      .where(eq(schema.importChunkTable.id, chunk.id));
    const commit = await commitImportChunk(tx, {
      actor,
      runId: run.id,
      chunkId: chunk.chunkId,
      expectedVersion: run.version,
      previewDigest: binding.digest,
      records: parsed.data,
      approvedLarge: true,
    });
    if (commit.kind !== "committed")
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return commit;
  }
  const parsedLinks = linkImportBody.safeParse({ links: payload?.links });
  if (
    !parsedLinks.success ||
    parsedLinks.data.links.length !== binding.recordCount
  )
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  const expectedDigest = sha256Canonical({
    runId: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    pluginId: run.pluginId,
    sourceRef: run.sourceRef,
    operation: "links",
    routeKey: row.routeKey,
    links: parsedLinks.data.links,
  });
  if (expectedDigest !== binding.digest)
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  const origin = await importOrigin(tx, actor);
  const writableRun = await lockImportRun(
    tx,
    actor,
    run.id,
    "work_item:create",
    "update",
  );
  const committed = await commitApprovedImportLinks(tx, {
    actor,
    run: writableRun,
    chunk,
    entries: parsedLinks.data.links,
    origin,
  });
  return {
    kind: "committed" as const,
    runId: committed.runId,
    chunkId: committed.chunkId,
    runVersion: committed.runVersion,
    counts: {
      created: 0,
      updated: 0,
      skipped: 0,
      rejected: 0,
      processed: parsedLinks.data.links.length,
    },
    rows: [],
    createdResults: [],
    updateResults: [],
    ...(committed.auditFailure ? { auditFailure: true } : {}),
  } as Awaited<ReturnType<typeof commitImportChunk>>;
}

// --- Run-level approval (P6 D2) ----------------------------------------------------------------

/**
 * Opens the run-level approval for an engine run that would write more than 50 records. Bound to the
 * dry-run digest, the total record count and the mapping version; any change to any of them (a new
 * dry run, a mapping edit) invalidates it (`engine/service.ts` marks the row `invalidated`).
 */
export const requestImportRunApproval: ImportRunApprovalRequest = async (
  tx,
  input,
) => {
  const result = await createPendingActionInTransaction(tx, {
    requesterPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
    origin: input.origin,
    action: "mcp_destructive",
    routeKey: IMPORT_RUN_ROUTE,
    targetType: IMPORT_RUN_TARGET,
    targetIds: [input.runId],
    actorId: input.actorId,
    actorType: input.actorType,
    actorIp: input.ip,
    userAgent: input.userAgent,
    importRun: {
      runId: input.runId,
      digest: input.digest,
      totalCount: input.totalCount,
      mappingVersion: input.mappingVersion,
      writes: input.writes,
    },
  });
  return {
    pendingActionId: result.pendingActionId,
    auditFailure: result.auditFailure,
  };
};

/**
 * Approval of a run-level request: the requester types the exact total record count and supplies a
 * fresh step-up proof (same contract as an import chunk). Executing it only GRANTS the approval to the
 * run, bound again to the digest, count and mapping version; the run is then started by the operator's
 * `execute` call, or by the wizard.
 */
export async function approveImportRun(input: {
  id: string;
  requesterPersonId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  typedCount?: string;
  stepUpToken?: string;
}) {
  return approveClickDeletion<{ runId: string; totalCount: number }>(input, {
    action: "mcp_destructive",
    targetType: IMPORT_RUN_TARGET,
    routeKey: IMPORT_RUN_ROUTE,
    confirmation: ["typed_count_step_up"],
    beforeLock: (tx) => lockInstanceAdminSerialization(tx),
    confirm: async (tx, row) => {
      const binding = readImportRunBinding(
        row.targetVersions,
        row.targetIds,
        row.routeKey,
      );
      if (!binding)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      if (input.typedCount !== String(binding.totalCount))
        throw new HTTPException(400, { message: "confirmation_mismatch" });
      const proof = await consumePendingActionProof(tx, {
        token: input.stepUpToken ?? "",
        personId: input.requesterPersonId,
        sessionId: input.sessionId,
        userId: input.userId,
        pendingActionId: row.id,
      });
      if (!proof) {
        await appendPendingActionStepUpAudit(tx, {
          action: "auth.step_up_denied",
          actorId: input.userId,
          personId: input.requesterPersonId,
          pendingActionId: row.id,
          traceId: input.traceId,
        });
        return {
          supplied: {},
          denied: input.stepUpToken
            ? ("step_up_expired" as const)
            : ("step_up_required" as const),
        };
      }
      await appendPendingActionStepUpAudit(tx, {
        action: "auth.step_up_consumed",
        actorId: input.userId,
        personId: input.requesterPersonId,
        pendingActionId: row.id,
        traceId: input.traceId,
      });
      return {
        supplied: { typedCount: binding.totalCount, stepUp: true },
        stepUpTokenId: proof.id,
      };
    },
    summaryResult: (result) => ({
      runId: result.runId,
      totalCount: result.totalCount,
    }),
    execute: failOnExecutorError(async (tx, row) => {
      const binding = readImportRunBinding(
        row.targetVersions,
        row.targetIds,
        row.routeKey,
      );
      if (!binding || row.workspaceId === null || row.projectId === null)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      await grantRunApproval(tx, {
        runId: binding.runId,
        pendingActionId: row.id,
        digest: binding.digest,
        totalCount: binding.totalCount,
        mappingVersion: binding.mappingVersion,
      });
      return { runId: binding.runId, totalCount: binding.totalCount };
    }),
  });
}
