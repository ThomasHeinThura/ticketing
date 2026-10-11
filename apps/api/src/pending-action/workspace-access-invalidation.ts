import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import { pendingActionTable } from "../database/schema";
import { invalidatePendingActionForReason } from "./credential-invalidation";
import {
  lockPendingActionLifecycle,
  reportPendingActionAuditFailures,
} from "./lifecycle-invalidation";
import { evaluateActionRequiredAccess } from "./required-access";

type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const WORKSPACE_DELETION_TARGETS = ["service_calendar", "saved_view"] as const;

type AccessSnapshot = {
  row: typeof pendingActionTable.$inferSelect;
  allowedBefore: boolean;
};

/**
 * Capture canonical access for current calendar/view deletion requests before a workspace
 * authority writer changes membership or role data. Call only after the global pending-action
 * lifecycle gate and before the workspace membership/role locks.
 */
export async function captureWorkspaceDeletionAccess(
  tx: PendingActionTransaction,
  workspaceId: string,
): Promise<AccessSnapshot[]> {
  return captureWorkspaceDeletionAccessForWorkspaces(tx, [workspaceId]);
}

/** Capture only requests belonging to a known set of workspace projections. */
export async function captureWorkspaceDeletionAccessForWorkspaces(
  tx: PendingActionTransaction,
  workspaceIds: readonly string[],
): Promise<AccessSnapshot[]> {
  const uniqueWorkspaceIds = [...new Set(workspaceIds)].sort();
  if (uniqueWorkspaceIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(pendingActionTable)
    .where(
      and(
        inArray(pendingActionTable.workspaceId, uniqueWorkspaceIds),
        eq(pendingActionTable.state, "pending"),
        inArray(pendingActionTable.targetType, [...WORKSPACE_DELETION_TARGETS]),
      ),
    )
    .orderBy(pendingActionTable.id);

  const snapshots: AccessSnapshot[] = [];
  for (const row of rows) {
    const decision = await evaluateActionRequiredAccess(
      tx,
      {
        requestedByPersonId: row.requestedByPersonId,
        credentialType: row.credentialType,
        credentialId: row.credentialId,
        action: row.action,
        targetType: row.targetType,
        targetIds: row.targetIds,
        routeKey: row.routeKey,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        organisationId: row.organisationId,
        confirmationRequired: row.confirmationRequired,
        payload: row.payload,
        payloadHash: row.payloadHash,
        targetVersions: row.targetVersions,
      },
      { existingPendingAction: true },
    );
    snapshots.push({ row, allowedBefore: decision.allowed });
  }
  return snapshots;
}

/**
 * Re-evaluate a captured set after an actual workspace authority mutation. Only a canonical
 * allowed→denied transition is terminal; unrelated edits and alternate winning grants stay
 * untouched. The caller reports returned AU-14 failures after its outer transaction commits.
 */
export async function invalidateWorkspaceDeletionAccessLosses(
  tx: PendingActionTransaction,
  snapshots: readonly AccessSnapshot[],
  occurredAt = new Date(),
): Promise<number> {
  let auditFailures = 0;
  for (const snapshot of snapshots) {
    if (!snapshot.allowedBefore) continue;
    const { row } = snapshot;
    const decision = await evaluateActionRequiredAccess(
      tx,
      {
        requestedByPersonId: row.requestedByPersonId,
        credentialType: row.credentialType,
        credentialId: row.credentialId,
        action: row.action,
        targetType: row.targetType,
        targetIds: row.targetIds,
        routeKey: row.routeKey,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        organisationId: row.organisationId,
        confirmationRequired: row.confirmationRequired,
        payload: row.payload,
        payloadHash: row.payloadHash,
        targetVersions: row.targetVersions,
      },
      { existingPendingAction: true },
    );
    if (decision.allowed) continue;
    const reason:
      | "reach_lost"
      | "capability_removed"
      | "version_changed"
      | "scope_changed"
      | undefined =
      decision.failure === "reach"
        ? "reach_lost"
        : decision.failure === "capability"
          ? "capability_removed"
          : decision.failure === "target_version"
            ? "version_changed"
            : decision.failure === "target_scope"
              ? "scope_changed"
              : undefined;
    if (!reason) continue;
    auditFailures += await invalidatePendingActionForReason(
      tx,
      row.id,
      reason,
      occurredAt,
    );
  }
  return auditFailures;
}

/** Serialize the full before→mutation→after projection under the PA lifecycle gate. */
export async function withWorkspaceDeletionAccessLifecycle<T>(
  workspaceId: string,
  mutate: (tx: PendingActionTransaction) => Promise<T>,
): Promise<T> {
  const outcome = await db.transaction(async (tx) => {
    await lockPendingActionLifecycle(tx);
    const before = await captureWorkspaceDeletionAccess(tx, workspaceId);
    const value = await mutate(tx);
    const auditFailures = await invalidateWorkspaceDeletionAccessLosses(
      tx,
      before,
    );
    return { value, auditFailures };
  });
  await reportPendingActionAuditFailures(outcome.auditFailures);
  return outcome.value;
}
