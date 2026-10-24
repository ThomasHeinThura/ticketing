import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { callerReachesOrganisation } from "../customer-invitation/repository";
import { schema } from "../database";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { InvitationNotPendingError } from "./controllers/invitation-action-errors";

export const INVITATION_DELETION_ROUTE = "DELETE /api/invitation/{id}" as const;

/**
 * `DELETE /api/invitation/{id}` (cancel): click-confirmed, browser session only. Execution is
 * the same conditional `pending → canceled` transition as `controllers/cancel-invitation.ts`;
 * the invitation row is kept, as it always was.
 */
export const invitationDeletionTarget: RegisteredDeletionTarget = {
  targetType: "invitation",
  routeKey: INVITATION_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: true,
  notFound: "Invitation not found",
  load: async (tx, id) => {
    const [row] = await tx
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, id))
      .for("update")
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: null,
      organisationId: row.organisationId,
      name: row.email,
      summary: {
        invitationId: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        scope: row.scope,
      },
      version: registeredDeletionFingerprint(row),
    };
  },
  // CP-20: a customer invitation is revoked only by a caller who reaches its organisation.
  callerReaches: async (tx, loaded, identity) =>
    loaded.summary.scope !== "customer" ||
    (loaded.organisationId !== null &&
      (await callerReachesOrganisation(
        tx,
        loaded.workspaceId,
        loaded.organisationId,
        identity,
      ))),
  assertDeletable: async (_tx, loaded) => {
    if (loaded.summary.status !== "pending")
      throw new HTTPException(400, {
        message: new InvitationNotPendingError().message,
      });
  },
  execute: async (tx, { loaded, identity }) => {
    const [updated] = await tx
      .update(schema.invitationTable)
      // CP-22: revoking a customer invitation also invalidates its accept credential.
      .set({ status: "canceled", credentialHash: null })
      .where(
        and(
          eq(schema.invitationTable.id, loaded.id),
          eq(schema.invitationTable.workspaceId, loaded.workspaceId),
          eq(schema.invitationTable.status, "pending"),
        ),
      )
      .returning({ id: schema.invitationTable.id });
    if (!updated)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    if (loaded.summary.scope === "customer")
      await appendAuditLog(tx, {
        actorId: identity.userId,
        actorType: "person",
        workspaceId: loaded.workspaceId,
        organisationId: loaded.organisationId,
        action: "invitation.revoked",
        entityType: "invitation",
        entityId: loaded.id,
        before: null,
        after: { scope: "customer" },
      });
    return {};
  },
};
