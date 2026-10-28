import { can } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { dashboardTable } from "../database/schema-p5-reports";
import {
  type RegisteredDeletionReadScope,
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
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [row] = await tx
      .select({
        id: dashboardTable.id,
        workspaceId: dashboardTable.workspaceId,
      })
      .from(dashboardTable)
      .where(eq(dashboardTable.id, id))
      .limit(1);
    return row
      ? {
          id: row.id,
          workspaceId: row.workspaceId,
          projectId: null,
          organisationId: null,
        }
      : undefined;
  },
  execute: async (tx, { loaded, identity }) => {
    const row = await lockDashboard(tx, loaded.id);
    if (!row)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    // The approval may happen later than the request: a workspace dashboard is deleted only by
    // someone who holds workspace:manage_settings NOW (RP-14), not by whoever had it when asking.
    if (
      row.scope === "workspace" &&
      !can(identity, "workspace:manage_settings", "workspace", {
        workspaceId: row.workspaceId,
      })
    )
      throw new HTTPException(403, { message: "Insufficient permissions" });
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
