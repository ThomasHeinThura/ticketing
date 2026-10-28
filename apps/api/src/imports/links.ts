import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../api-key/enforce";
import db, { schema } from "../database";
import type { Transaction } from "../database/executor";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { lockInstanceAdminSerialization } from "../instance/users/repository";
import { lockPendingActionLifecycle } from "../pending-action/lifecycle-invalidation";
import { isUniqueViolation } from "../utils/is-unique-violation";
import {
  importActor,
  importOrigin,
  requireImportInstanceAdmin,
  requireImportProjectCapability,
  requireImportWorkspaceRead,
} from "./access";
import { readWorkItemContentHash, sha256Canonical } from "./content";
import {
  appendImportAudit,
  assertRetainedChunkRun,
  type ImportApprovalRequest,
  reportImportAuditWriteFailure,
} from "./service";

const RUN = schema.importRunTable;
const CHUNK = schema.importChunkTable;
const LINK = schema.importRecordLinkTable;
const LINK_PREVIEW_AGE_MS = 30 * 60 * 1000;

function addLinkStats(
  current: Record<string, number>,
  linked: number,
  processed: number,
) {
  return {
    ...current,
    linked: (current.linked ?? 0) + linked,
    processed: (current.processed ?? 0) + processed,
  };
}

export type ImportLinkEntry = {
  sourceType: string;
  sourceId: string;
  targetType: "work_item";
  targetId: string;
  sourceHash?: string;
};

export async function lockRun(
  tx: Transaction,
  actor: ReturnType<typeof importActor>,
  runId: string,
  capability: "work_item:read" | "work_item:create",
  lock: "share" | "update" = "share",
) {
  const query = tx.select().from(RUN).where(eq(RUN.id, runId));
  const [run] = await (lock === "update"
    ? query.for("update")
    : query.for("share")
  ).limit(1);
  if (!run) throw new HTTPException(404, { message: "Import run not found" });
  if (run.projectId) {
    await requireImportProjectCapability(
      tx,
      actor,
      run.workspaceId,
      run.projectId,
      capability,
    );
  } else if (capability === "work_item:read") {
    await requireImportWorkspaceRead(tx, actor, run.workspaceId);
  } else {
    throw new HTTPException(409, {
      message: "Import run is no longer writable",
    });
  }
  return { ...run, projectId: run.projectId };
}

async function requesterPersonId(tx: Transaction, userId: string) {
  const [person] = await tx
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!person) throw new HTTPException(403, { message: "Forbidden" });
  return person.id;
}

async function validateImportLinks(
  tx: Transaction,
  run: Awaited<ReturnType<typeof lockRun>>,
  entries: ImportLinkEntry[],
) {
  if (!run.projectId)
    throw new HTTPException(409, {
      message: "Import run is no longer writable",
    });
  const identityTargets = new Map<string, string>();
  for (const entry of entries) {
    const identity = JSON.stringify([entry.sourceType, entry.sourceId]);
    const previousTarget = identityTargets.get(identity);
    if (previousTarget && previousTarget !== entry.targetId)
      throw new HTTPException(409, {
        message: "Source record is already linked",
      });
    identityTargets.set(identity, entry.targetId);
    const targetContent = await readWorkItemContentHash(tx, {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      targetId: entry.targetId,
    });
    if (!targetContent)
      throw new HTTPException(404, { message: "Target work item not found" });
    const [existing] = await tx
      .select({ targetId: LINK.targetId })
      .from(LINK)
      .where(
        and(
          eq(LINK.workspaceId, run.workspaceId),
          eq(LINK.pluginId, run.pluginId),
          eq(LINK.sourceRef, run.sourceRef),
          eq(LINK.sourceType, entry.sourceType),
          eq(LINK.sourceId, entry.sourceId),
          eq(LINK.targetType, entry.targetType),
        ),
      )
      .for("update")
      .limit(1);
    if (existing && existing.targetId !== entry.targetId)
      throw new HTTPException(409, {
        message: "Source record is already linked",
      });
  }
}

export async function applyImportLinks(
  tx: Transaction,
  actor: ReturnType<typeof importActor>,
  run: Awaited<ReturnType<typeof lockRun>>,
  entries: ImportLinkEntry[],
  origin: "mcp" | undefined,
) {
  if (!run.projectId)
    throw new HTTPException(409, {
      message: "Import run is no longer writable",
    });
  const results: Array<{
    sourceType: string;
    sourceId: string;
    targetType: "work_item";
    targetId: string;
  }> = [];
  let changedCount = 0;
  for (const entry of entries) {
    const targetContent = await readWorkItemContentHash(tx, {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      targetId: entry.targetId,
    });
    if (!targetContent)
      throw new HTTPException(404, { message: "Target work item not found" });
    const [existing] = await tx
      .select()
      .from(LINK)
      .where(
        and(
          eq(LINK.workspaceId, run.workspaceId),
          eq(LINK.pluginId, run.pluginId),
          eq(LINK.sourceRef, run.sourceRef),
          eq(LINK.sourceType, entry.sourceType),
          eq(LINK.sourceId, entry.sourceId),
          eq(LINK.targetType, entry.targetType),
        ),
      )
      .for("update")
      .limit(1);
    if (existing && existing.targetId !== entry.targetId)
      throw new HTTPException(409, {
        message: "Source record is already linked",
      });
    if (
      existing &&
      existing.importRunId === run.id &&
      existing.targetId === entry.targetId &&
      existing.sourceHash === (entry.sourceHash ?? null) &&
      existing.targetContentHash === targetContent.hash
    ) {
      results.push({
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        targetType: entry.targetType,
        targetId: entry.targetId,
      });
      continue;
    }
    if (existing) {
      await tx
        .update(LINK)
        .set({
          importRunId: run.id,
          sourceHash: entry.sourceHash ?? null,
          targetContentHash: targetContent.hash,
          lastSeenAt: new Date(),
          staleAt: null,
        })
        .where(eq(LINK.id, existing.id));
      changedCount += 1;
    } else {
      const [inserted] = await tx
        .insert(LINK)
        .values({
          workspaceId: run.workspaceId,
          pluginId: run.pluginId,
          sourceRef: run.sourceRef,
          importRunId: run.id,
          firstImportRunId: run.id,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          sourceHash: entry.sourceHash ?? null,
          targetContentHash: targetContent.hash,
          targetType: entry.targetType,
          targetId: entry.targetId,
        })
        .onConflictDoNothing({
          target: [
            LINK.workspaceId,
            LINK.pluginId,
            LINK.sourceRef,
            LINK.sourceType,
            LINK.sourceId,
            LINK.targetType,
          ],
        })
        .returning({ id: LINK.id });
      if (!inserted) {
        const [winner] = await tx
          .select()
          .from(LINK)
          .where(
            and(
              eq(LINK.workspaceId, run.workspaceId),
              eq(LINK.pluginId, run.pluginId),
              eq(LINK.sourceRef, run.sourceRef),
              eq(LINK.sourceType, entry.sourceType),
              eq(LINK.sourceId, entry.sourceId),
              eq(LINK.targetType, entry.targetType),
            ),
          )
          .limit(1);
        if (
          !winner ||
          winner.targetId !== entry.targetId ||
          winner.sourceHash !== (entry.sourceHash ?? null)
        )
          throw new HTTPException(409, {
            message: "Source record is already linked",
          });
      } else {
        changedCount += 1;
      }
    }
    results.push({
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      targetType: entry.targetType,
      targetId: entry.targetId,
    });
  }
  const auditFailure =
    changedCount > 0
      ? await appendImportAudit(tx, {
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
            runId: run.id,
            linkedCount: results.length,
            ...(origin ? { origin } : {}),
          },
        })
      : false;
  return {
    runId: run.id,
    links: results,
    linkedCount: changedCount,
    auditFailure,
  };
}

export async function commitApprovedImportLinks(
  tx: Transaction,
  input: {
    actor: ReturnType<typeof importActor>;
    run: Awaited<ReturnType<typeof lockRun>>;
    chunk: typeof CHUNK.$inferSelect;
    entries: ImportLinkEntry[];
    origin: "mcp" | undefined;
  },
) {
  const applied = await applyImportLinks(
    tx,
    input.actor,
    input.run,
    input.entries,
    input.origin,
  );
  const counts = {
    linked: applied.linkedCount,
    processed: input.entries.length,
  };
  const now = new Date();
  await tx
    .update(CHUNK)
    .set({
      state: "committed",
      pendingActionId: null,
      inputPayload: null,
      report: { operation: "links", counts, rejectionCodes: {}, rows: [] },
      committedAt: now,
    })
    .where(eq(CHUNK.id, input.chunk.id));
  await tx
    .update(RUN)
    .set({
      state: "running",
      stats: addLinkStats(input.run.stats, counts.linked, counts.processed),
      log: [
        ...input.run.log,
        {
          code: "chunk_committed",
          at: now.toISOString(),
          chunkId: input.chunk.chunkId,
        },
      ].slice(-100),
      version: input.run.version + 1,
      dryRunDigest: null,
      dryRunExpiresAt: null,
      lastCommittedChunk: input.chunk.sequence,
      updatedAt: now,
    })
    .where(eq(RUN.id, input.run.id));
  await enqueueOutboxEvent(tx, {
    id: createId(),
    kind: "import.chunk_completed",
    occurredAt: now.toISOString(),
    actor: {
      type: input.actor.actorType,
      id: input.actor.userId,
      name: input.actor.userId,
    },
    scope: eventScope({
      workspaceId: null,
      organisationId: null,
      projectId: null,
    }),
    payload: {
      importRunId: input.run.id,
      chunk: input.chunk.sequence + 1,
      chunks: input.chunk.sequence + 1,
      rowsDone: counts.processed,
      rowsTotal: input.chunk.recordCount,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  return {
    runId: input.run.id,
    chunkId: input.chunk.chunkId,
    runVersion: input.run.version + 1,
    counts,
    links: applied.links,
    ...(applied.auditFailure ? { auditFailure: true } : {}),
  };
}

export async function createImportLinks(
  c: Context,
  runId: string,
  entries: ImportLinkEntry[],
  requestApproval?: ImportApprovalRequest,
) {
  const actor = importActor(c);
  try {
    const result = await db.transaction(async (tx) => {
      await lockInstanceAdminSerialization(tx);
      await requireImportInstanceAdmin(
        tx,
        actor,
        "POST /api/imports/{id}/links",
      );
      if (entries.length > 50) await lockPendingActionLifecycle(tx);
      const origin = await importOrigin(tx, actor);
      const run = await lockRun(tx, actor, runId, "work_item:create", "update");
      assertRetainedChunkRun(run);
      if (!run.projectId)
        throw new HTTPException(409, {
          message: "Import run is no longer writable",
        });
      if (entries.length <= 50) {
        const applied = await applyImportLinks(tx, actor, run, entries, origin);
        return {
          kind: "committed" as const,
          result: {
            runId: run.id,
            links: applied.links,
            auditFailure: applied.auditFailure,
          },
        };
      }
      if (!requestApproval)
        throw new HTTPException(503, {
          message: "Import approval is unavailable",
        });
      await validateImportLinks(tx, run, entries);
      const chunkId = createId();
      const digest = sha256Canonical({
        runId: run.id,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        pluginId: run.pluginId,
        sourceRef: run.sourceRef,
        operation: "links",
        routeKey: "POST /api/imports/{id}/links",
        links: entries,
      });
      const [existingChunk] = await tx
        .select()
        .from(CHUNK)
        .where(
          and(
            eq(CHUNK.importRunId, run.id),
            eq(CHUNK.inputDigest, digest),
            eq(CHUNK.recordCount, entries.length),
          ),
        )
        .for("update")
        .limit(1);
      if (existingChunk?.report.operation === "links") {
        if (
          existingChunk.state === "pending_approval" &&
          existingChunk.pendingActionId
        ) {
          const [pending] = await tx
            .select({ state: schema.pendingActionTable.state })
            .from(schema.pendingActionTable)
            .where(
              and(
                eq(schema.pendingActionTable.id, existingChunk.pendingActionId),
                gt(schema.pendingActionTable.expiresAt, sql`clock_timestamp()`),
              ),
            )
            .limit(1);
          if (pending?.state !== "pending")
            throw new HTTPException(409, {
              message: "Import link chunk is no longer active",
            });
          return {
            kind: "pending_approval" as const,
            pendingActionId: existingChunk.pendingActionId,
            runId: run.id,
            chunkId: existingChunk.chunkId,
            runVersion: run.version,
          };
        }
        if (existingChunk.state === "committed") {
          const replay = await Promise.all(
            entries.map(async (entry) => {
              const [link] = await tx
                .select({
                  targetId: LINK.targetId,
                  sourceHash: LINK.sourceHash,
                })
                .from(LINK)
                .where(
                  and(
                    eq(LINK.workspaceId, run.workspaceId),
                    eq(LINK.pluginId, run.pluginId),
                    eq(LINK.sourceRef, run.sourceRef),
                    eq(LINK.sourceType, entry.sourceType),
                    eq(LINK.sourceId, entry.sourceId),
                    eq(LINK.targetType, entry.targetType),
                  ),
                )
                .limit(1);
              if (
                link?.targetId !== entry.targetId ||
                link.sourceHash !== (entry.sourceHash ?? null)
              )
                throw new HTTPException(409, {
                  message:
                    "Import link retry no longer matches committed result",
                });
              return {
                sourceType: entry.sourceType,
                sourceId: entry.sourceId,
                targetType: entry.targetType,
                targetId: entry.targetId,
              };
            }),
          );
          return {
            kind: "committed" as const,
            result: { runId: run.id, links: replay, auditFailure: false },
          };
        }
        throw new HTTPException(409, {
          message: "Import link chunk is no longer active",
        });
      }
      const [activePreview] = await tx
        .select({ id: CHUNK.id })
        .from(CHUNK)
        .where(
          and(
            eq(CHUNK.importRunId, run.id),
            eq(CHUNK.state, "previewed"),
            eq(CHUNK.expectedRunVersion, run.version),
            gt(CHUNK.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .limit(1);
      if (activePreview)
        throw new HTTPException(409, {
          message: "An import preview is active; dry-run the current run first",
        });
      const expiresAt = new Date(Date.now() + LINK_PREVIEW_AGE_MS);
      const [chunk] = await tx
        .insert(CHUNK)
        .values({
          importRunId: run.id,
          chunkId,
          sequence:
            ((
              await tx
                .select({
                  max: sql<number>`coalesce(max(${CHUNK.sequence}), -1)`,
                })
                .from(CHUNK)
                .where(eq(CHUNK.importRunId, run.id))
            )[0]?.max ?? -1) + 1,
          state: "previewed",
          expectedRunVersion: run.version,
          inputDigest: digest,
          inputPayload: { operation: "links", links: entries },
          report: {
            operation: "links",
            counts: { linked: 0, processed: entries.length },
            rejectionCodes: {},
            rows: [],
          },
          recordCount: entries.length,
          expiresAt,
        })
        .returning();
      if (!chunk)
        throw new HTTPException(500, {
          message: "Import chunk could not be staged",
        });
      const approval = await requestApproval(tx, {
        runId: run.id,
        chunkId,
        expectedRunVersion: run.version,
        operation: "links",
        routeKey: "POST /api/imports/{id}/links",
        digest,
        recordCount: entries.length,
        requesterPersonId: await requesterPersonId(tx, actor.userId),
        credentialType: actor.apiKeyId ? "api_key" : "session",
        credentialId: actor.apiKeyId,
        origin: origin ?? (actor.apiKeyId ? "api" : "web"),
        actorId: actor.userId,
        actorType: actor.actorType,
        ip: clientIpForContext(c),
        userAgent: c.req.header("user-agent") ?? null,
      });
      await tx
        .update(CHUNK)
        .set({
          state: "pending_approval",
          pendingActionId: approval.pendingActionId,
        })
        .where(eq(CHUNK.id, chunk.id));
      await tx
        .update(RUN)
        .set({
          version: run.version + 1,
          dryRunDigest: null,
          dryRunExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(RUN.id, run.id));
      return {
        kind: "pending_approval" as const,
        pendingActionId: approval.pendingActionId,
        runId: run.id,
        chunkId,
        runVersion: run.version + 1,
        ...(approval.auditFailure ? { auditFailure: true } : {}),
      };
    });
    if (result.kind === "pending_approval")
      await reportImportAuditWriteFailure(result.auditFailure === true);
    if (result.kind === "committed") {
      await reportImportAuditWriteFailure(result.result.auditFailure === true);
      const { auditFailure: _auditFailure, ...safe } = result.result;
      return safe;
    }
    const { auditFailure: _auditFailure, ...safe } = result;
    return safe;
  } catch (error) {
    if (isUniqueViolation(error, "import_link_stable_source_key"))
      throw new HTTPException(409, {
        message: "Source record is already linked",
      });
    throw error;
  }
}

export async function listImportLinks(
  c: Context,
  runId: string,
  input: {
    sourceType?: string;
    sourceId?: string;
    cursor?: string;
    limit: number;
  },
) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, importActor(c), runId, "work_item:read");
    const filters = [
      eq(LINK.workspaceId, run.workspaceId),
      eq(LINK.pluginId, run.pluginId),
      eq(LINK.sourceRef, run.sourceRef),
    ];
    if (input.sourceType) filters.push(eq(LINK.sourceType, input.sourceType));
    if (input.sourceId) filters.push(eq(LINK.sourceId, input.sourceId));
    if (input.cursor) filters.push(gt(LINK.id, input.cursor));
    const rows = await tx
      .select({
        id: LINK.id,
        sourceType: LINK.sourceType,
        sourceId: LINK.sourceId,
        sourceHash: LINK.sourceHash,
        targetType: LINK.targetType,
        targetId: LINK.targetId,
        sourceUrl: LINK.sourceUrl,
        lastSeenAt: LINK.lastSeenAt,
        targetKey: schema.workItemTable.key,
        targetProjectId: schema.workItemTable.projectId,
      })
      .from(LINK)
      .leftJoin(
        schema.workItemTable,
        and(
          eq(schema.workItemTable.id, LINK.targetId),
          eq(schema.workItemTable.workspaceId, LINK.workspaceId),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.workItemTable.archivedAt),
        ),
      )
      .where(and(...filters))
      .orderBy(asc(LINK.id))
      .limit(input.limit + 1);
    const visible = [];
    for (const row of rows.slice(0, input.limit)) {
      // This endpoint only exposes targets inside the authorized run project. A stale or
      // cross-project link is represented without a target identifier.
      if (row.targetProjectId !== run.projectId || !row.targetKey) {
        visible.push({
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          targetType: row.targetType,
          reachable: false,
          lastSeenAt: row.lastSeenAt.toISOString(),
        });
      } else {
        visible.push({
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          targetType: row.targetType,
          targetId: row.targetId,
          targetKey: row.targetKey,
          sourceHash: row.sourceHash,
          sourceUrl: row.sourceUrl,
          reachable: true,
          lastSeenAt: row.lastSeenAt.toISOString(),
        });
      }
    }
    return {
      runId: run.id,
      links: visible,
      nextCursor:
        rows.length > input.limit ? (rows[input.limit - 1]?.id ?? null) : null,
    };
  });
}
