/**
 * Run operations shared by the engine service (request handlers) and the setup job (background):
 * authorisation of a run, audit rows, and the invalidation applied when a mapping change or a fresh
 * dry run makes the previous dry run and approval stale.
 */
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import {
  type ImportActor,
  importOrigin,
  requireImportInstanceAdmin,
  requireImportProjectCapability,
} from "../access";
import { appendImportAudit } from "../service";
import { type EngineRun, loadEngineRun, RUN } from "./store";

export type RouteKey = `${"GET" | "POST"} /api/${string}`;
export const conflict = (message: string) =>
  new HTTPException(409, { message });

export async function authorizedRun(
  tx: Transaction,
  actor: ImportActor,
  runId: string,
  routeKey: RouteKey,
  capability: "work_item:read" | "work_item:create",
  lock: "share" | "update",
) {
  await requireImportInstanceAdmin(tx, actor, routeKey);
  const run = await loadEngineRun(tx, runId, lock);
  await requireImportProjectCapability(
    tx,
    actor,
    run.workspaceId,
    run.projectId,
    capability,
  );
  return run;
}

export async function audit(
  tx: Transaction,
  actor: ImportActor,
  run: Pick<EngineRun, "id" | "workspaceId" | "projectId">,
  operation: string,
  extra: Record<string, unknown> = {},
) {
  const origin = await importOrigin(tx, actor);
  return appendImportAudit(tx, {
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
      operation,
      runId: run.id,
      ...extra,
      ...(origin ? { origin } : {}),
    },
  });
}

/** Mapping change or a fresh dry run invalidates the dry run, the approval and any pending request. */
export const INVALIDATE = {
  engineDryRunDigest: null,
  engineDryRunMappingVersion: null,
  engineDryRunReport: null,
  engineDryRunAt: null,
  approvedDigest: null,
  approvedCount: null,
  approvedMappingVersion: null,
  approvalPendingActionId: null,
} as const;

/**
 * Whoever applies `INVALIDATE` also makes the run's outstanding approval request terminal. Clearing
 * only the run's pointer would leave the `pending_action` row pending, and the unique
 * pending-target index would then refuse the next request for the same run.
 */
export async function invalidateOutstandingApproval(
  tx: Transaction,
  run: Pick<EngineRun, "approvalPendingActionId">,
) {
  if (!run.approvalPendingActionId) return;
  await tx
    .update(schema.pendingActionTable)
    .set({
      state: "invalidated",
      invalidationReason: "version_changed",
      decidedByPersonId: null,
      decisionSessionId: null,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(schema.pendingActionTable.id, run.approvalPendingActionId),
        eq(schema.pendingActionTable.state, "pending"),
      ),
    );
}

export { RUN };
