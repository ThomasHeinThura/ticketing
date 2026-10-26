/**
 * Import reconciliation service (P6, IM-4, IM-8): compares source enumeration totals against what
 * the run created, updated, skipped, rejected and linked, lists losses, stale links, dangling
 * hierarchy and relation references, draws a reproducible 20-item spot-check and persists one
 * snapshot per run. GET never computes; only POST recomputes (and audits).
 */
import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Transaction } from "../../database/executor";
import { importReconciliationTable } from "../../database/schema-import-reconciliation";
import {
  type ImportActor,
  importActor,
  importOrigin,
  requireImportInstanceAdmin,
  requireImportProjectCapability,
} from "../access";
import { RUN } from "../engine/store";
import { appendImportAudit, reportImportAuditWriteFailure } from "../service";
import { evaluateReconciliation } from "./evaluate";
import { type EngineRun, gatherFacts, newSpotCheckSeed } from "./facts";

type RouteKey = `${"GET" | "POST"} /api/${string}`;

async function loadRun(tx: Transaction, runId: string): Promise<EngineRun> {
  const [run] = await tx
    .select()
    .from(RUN)
    .where(eq(RUN.id, runId))
    .for("share")
    .limit(1);
  if (!run?.projectId)
    throw new HTTPException(404, { message: "Import run not found" });
  return { ...run, projectId: run.projectId };
}

async function authorizedRun(
  tx: Transaction,
  actor: ImportActor,
  runId: string,
  routeKey: RouteKey,
) {
  await requireImportInstanceAdmin(tx, actor, routeKey);
  const run = await loadRun(tx, runId);
  await requireImportProjectCapability(
    tx,
    actor,
    run.workspaceId,
    run.projectId,
    "work_item:read",
  );
  return run;
}

/** The persisted body: everything a reader needs, in the shapes the wizard and operators use. */
export type ReconciliationBody = ReturnType<typeof buildBody>;

function buildBody(
  facts: Awaited<ReturnType<typeof gatherFacts>>,
  evaluated: ReturnType<typeof evaluateReconciliation>,
) {
  return {
    /** Wizard ReconcileStep summary: equal source and target is a match. */
    rows: evaluated.rows,
    checks: evaluated.checks,
    run: {
      state: facts.run.state,
      stats: facts.run.stats,
      touchedByRun: facts.target.touchedByRun,
    },
    source: {
      available: facts.source.available,
      counts: facts.source.counts,
      discoveryTotal: facts.source.discoveryTotal,
      byType: facts.source.byType,
    },
    target: {
      linkedTotal: facts.target.linkedTotal,
      bySourceType: facts.target.linkedBySourceType,
      byStateGroup: facts.target.linkedByStateGroup,
    },
    losses: {
      total: facts.losses.reduce((n, g) => n + g.count, 0),
      byCode: facts.losses,
      samples: facts.lossSamples,
    },
    rejections: facts.rejections,
    staleLinks: facts.stale,
    hierarchy: {
      danglingParents: facts.dangling.parents,
      unresolved: facts.dangling.unresolved,
    },
    relations: {
      danglingRelations: facts.dangling.relations,
      danglingRelationLinks: facts.dangling.relationLinks.count,
    },
    danglingLinks: facts.dangling.links,
    spotCheck: facts.spotCheck,
  };
}

export type ReconciliationDto = ReconciliationBody & {
  runId: string;
  workspaceId: string;
  status: "pass" | "attention" | "fail";
  sourceAvailable: boolean;
  version: number;
  computedAt: string;
};

type SnapshotRow = typeof importReconciliationTable.$inferSelect;
export const reconciliationDto = (row: SnapshotRow): ReconciliationDto => ({
  ...(row.snapshot as ReconciliationBody),
  runId: row.importRunId,
  workspaceId: row.workspaceId,
  status: row.status,
  sourceAvailable: row.sourceAvailable,
  version: row.version,
  computedAt: row.computedAt.toISOString(),
});

export async function getReconciliation(c: Context, runId: string) {
  const actor = importActor(c);
  return db.transaction(async (tx) => {
    const run = await authorizedRun(
      tx,
      actor,
      runId,
      "GET /api/imports/{id}/reconciliation",
    );
    const [row] = await tx
      .select()
      .from(importReconciliationTable)
      .where(eq(importReconciliationTable.importRunId, run.id))
      .limit(1);
    return {
      runId: run.id,
      reconciliation: row ? reconciliationDto(row) : null,
    };
  });
}

export async function computeAndStoreReconciliation(
  tx: Transaction,
  run: EngineRun,
  computedBy: string | null,
) {
  const seed = newSpotCheckSeed();
  const facts = await gatherFacts(tx, run, seed);
  const evaluated = evaluateReconciliation(facts);
  const body = buildBody(facts, evaluated);
  const [row] = await tx
    .insert(importReconciliationTable)
    .values({
      workspaceId: run.workspaceId,
      importRunId: run.id,
      pluginId: run.pluginId,
      sourceRef: run.sourceRef,
      status: evaluated.status,
      sourceAvailable: facts.source.available,
      seed,
      snapshot: body,
      computedBy,
    })
    .onConflictDoUpdate({
      target: importReconciliationTable.importRunId,
      set: {
        status: evaluated.status,
        sourceAvailable: facts.source.available,
        version: sql`${importReconciliationTable.version} + 1`,
        seed,
        snapshot: body,
        computedBy,
        computedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new HTTPException(500, { message: "Snapshot not stored" });
  return row;
}

export async function recomputeReconciliation(c: Context, runId: string) {
  const actor = importActor(c);
  const outcome = await db.transaction(
    async (tx) => {
      const run = await authorizedRun(
        tx,
        actor,
        runId,
        "POST /api/imports/{id}/reconciliation",
      );
      const row = await computeAndStoreReconciliation(tx, run, actor.userId);
      const origin = await importOrigin(tx, actor);
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
          operation: "reconciled",
          runId: run.id,
          status: row.status,
          version: row.version,
          ...(origin ? { origin } : {}),
        },
      });
      return { row, auditFailure };
    },
    { isolationLevel: "repeatable read" },
  );
  await reportImportAuditWriteFailure(outcome.auditFailure);
  return { runId, reconciliation: reconciliationDto(outcome.row) };
}
