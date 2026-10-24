import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { webhookTable } from "../database/schema";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";

export const WEBHOOK_DELETION_ROUTE = "DELETE /api/webhooks/{id}" as const;

/**
 * `DELETE /api/webhooks/{id}` (AK-11, PA-5): typed exact name + step-up, browser session only.
 * Approval removes the webhook and, by the `webhook_delivery.webhook_id` cascade, its delivery
 * history; the pending action and the `webhook.deleted` audit row remain the record. The
 * fingerprint binds the row so an edit between request and approval fails closed.
 */
export const webhookDeletionTarget: RegisteredDeletionTarget = {
  targetType: "webhook",
  routeKey: WEBHOOK_DELETION_ROUTE,
  confirmation: "typed_name_step_up",
  sessionOnly: true,
  notFound: "Webhook not found",
  load: async (tx, id) => {
    const [row] = await tx
      .select()
      .from(webhookTable)
      .where(eq(webhookTable.id, id))
      .for("update")
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: null,
      organisationId: null,
      name: row.name,
      summary: { webhookId: row.id, name: row.name, url: row.url },
      version: registeredDeletionFingerprint({
        id: row.id,
        name: row.name,
        url: row.url,
        events: row.events,
        active: row.active,
        version: row.version,
        workspaceId: row.workspaceId,
      }),
    };
  },
  execute: async (tx, { loaded, identity }) => {
    const deleted = await tx
      .delete(webhookTable)
      .where(
        and(
          eq(webhookTable.id, loaded.id),
          eq(webhookTable.workspaceId, loaded.workspaceId),
        ),
      )
      .returning({ id: webhookTable.id });
    if (deleted.length !== 1)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    await appendAuditLog(tx, {
      actorId: identity.userId,
      actorType: "person",
      workspaceId: loaded.workspaceId,
      action: "webhook.deleted",
      entityType: "webhook",
      entityId: loaded.id,
      before: { name: loaded.name },
      after: { deleted: true },
    });
    return {};
  },
};
