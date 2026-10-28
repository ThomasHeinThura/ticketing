import type { ResolvedIdentity } from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import db from "../database";
import type { pendingActionTable } from "../database/schema";
import { isRegisteredDeletion } from "./deletion-targets";
import { evaluateActionRequiredAccess } from "./required-access";

type PendingActionRow = typeof pendingActionTable.$inferSelect;

/**
 * Resolve current workspace context for a pending-action reader. This is deliberately a read
 * path: it uses registered nonlocking projections and the same route/reach evaluator as approval,
 * but does not validate a deletion fingerprint, run blockers, spend proof, or write audit data.
 */
export async function readPendingActionTargetWorkspace(
  row: PendingActionRow,
  viewer: ResolvedIdentity,
): Promise<string | null> {
  if (
    row.action !== "delete" ||
    !row.workspaceId ||
    viewer.side !== "staff" ||
    viewer.personId !== row.requestedByPersonId
  )
    return null;

  const input = {
    requestedByPersonId: row.requestedByPersonId,
    credentialType: row.credentialType,
    credentialId: row.credentialId,
    origin: row.origin,
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
  };
  const workspaceDeletion =
    (row.targetType === "service_calendar" &&
      row.routeKey === "DELETE /api/service-calendars/{id}") ||
    (row.targetType === "saved_view" &&
      row.routeKey === "DELETE /api/views/{id}");
  if (!isRegisteredDeletion(input) && !workspaceDeletion) return null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const access = await evaluateActionRequiredAccess(tx, input, {
      existingPendingAction: true,
      readOnly: true,
    });
    return access.allowed ? row.workspaceId : null;
  });
}
