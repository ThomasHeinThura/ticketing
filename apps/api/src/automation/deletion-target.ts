import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { automationTable, projectTable } from "../database/schema";
import {
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";

export const AUTOMATION_DELETION_ROUTE =
  "DELETE /api/automations/{id}" as const;

/**
 * `DELETE /api/automations/{id}` (feature-contracts-p4.md "Automations" API, PA-1): a click-level
 * pending action. Approval removes the rule and, by the `automation_run.automation_id` cascade,
 * its run history; the pending action and the `automation.deleted` audit row remain the record.
 * The fingerprint binds the whole rule, so an edit between request and approval fails closed.
 *
 * AM-* contract: `project:manage_settings | workspace:manage_settings`. A workspace rule is
 * governed by the route's workspace policy (`workspace:manage_settings`); a project rule loads
 * with its `projectId` and is governed by the project-scoped manage policy named in
 * `projectPolicyRouteKey`, at request and again at approval, so a project manager may delete
 * their own project's rules.
 */
export const automationDeletionTarget: RegisteredDeletionTarget = {
  targetType: "automation",
  routeKey: AUTOMATION_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Automation not found",
  projectPolicyRouteKey: "POST /api/projects/{key}/automations",
  load: async (tx, id) => {
    const [row] = await tx
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, id))
      .for("update")
      .limit(1);
    if (!row) return undefined;
    let organisationId: string | null = null;
    if (row.projectId) {
      const [project] = await tx
        .select({ organisationId: projectTable.organisationId })
        .from(projectTable)
        .where(eq(projectTable.id, row.projectId))
        .limit(1);
      organisationId = project?.organisationId ?? null;
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      organisationId,
      name: row.name,
      summary: {
        automationId: row.id,
        name: row.name,
        trigger: row.trigger,
        enabled: row.enabled,
        projectId: row.projectId,
      },
      version: registeredDeletionFingerprint(row),
    };
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [row] = await tx
      .select({
        id: automationTable.id,
        workspaceId: automationTable.workspaceId,
        projectId: automationTable.projectId,
      })
      .from(automationTable)
      .where(eq(automationTable.id, id))
      .limit(1);
    if (!row) return undefined;
    let organisationId: string | null = null;
    if (row.projectId) {
      const [project] = await tx
        .select({ organisationId: projectTable.organisationId })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, row.projectId),
            eq(projectTable.workspaceId, row.workspaceId),
          ),
        )
        .limit(1);
      if (!project) return undefined;
      organisationId = project.organisationId;
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      organisationId,
    };
  },
  execute: async (tx, { loaded, identity }) => {
    const deleted = await tx
      .delete(automationTable)
      .where(
        and(
          eq(automationTable.id, loaded.id),
          eq(automationTable.workspaceId, loaded.workspaceId),
        ),
      )
      .returning({ id: automationTable.id });
    if (deleted.length !== 1)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    await appendAuditLog(tx, {
      actorId: identity.userId,
      actorType: "person",
      workspaceId: loaded.workspaceId,
      projectId:
        typeof loaded.summary.projectId === "string"
          ? loaded.summary.projectId
          : null,
      action: "automation.deleted",
      entityType: "automation",
      entityId: loaded.id,
      before: { name: loaded.name },
      after: { deleted: true },
    });
    return {};
  },
};
