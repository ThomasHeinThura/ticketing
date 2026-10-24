import { HTTPException } from "hono/http-exception";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { deleteDashboardRow, lockDashboard } from "./dashboard.repository";

export const DASHBOARD_DELETION_ROUTE = "DELETE /api/dashboards/{id}" as const;

/**
 * Deleting a dashboard is a click-level pending action. Its widgets go with it; the reports and
 * saved views they pointed at are untouched.
 *
 * Registered in `registeredDeletionTargets()` (pending-action/deletion-targets.ts).
 */
export const dashboardDeletionTarget: RegisteredDeletionTarget = {
  targetType: "dashboard",
  routeKey: DASHBOARD_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Dashboard not found",
  load: async (tx, id) => {
    const row = await lockDashboard(tx, id);
    if (!row) return undefined;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: null,
      organisationId: null,
      name: row.name,
      summary: { dashboardId: row.id, name: row.name, scope: row.scope },
      version: registeredDeletionFingerprint(row),
    };
  },
  execute: async (tx, { loaded, identity }) => {
    const row = await lockDashboard(tx, loaded.id);
    if (!row)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    const deleted = await deleteDashboardRow(tx, row, {
      userId: identity.userId,
      actorType: "person",
    });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};
