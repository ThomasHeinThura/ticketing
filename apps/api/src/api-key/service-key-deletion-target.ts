import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { invalidatePendingActionsForCredential } from "../pending-action/credential-invalidation";
import { deleteApiKeyRow, loadServiceKeyForDeletion } from "./repository";

export const SERVICE_KEY_DELETION_ROUTE =
  "DELETE /api/workspaces/{id}/api-keys/{keyId}" as const;

/**
 * `DELETE /api/workspaces/{id}/api-keys/{keyId}` (AK-11, PA-5): typed exact name + step-up,
 * browser session only (`403 session_required` from any key; a service key requesting a
 * deletion is `403 no_approver`, PA-5a). Approval removes the credential row; the pending
 * action, its audit rows and the `api_key.revoked` row remain the record.
 *
 * The fingerprint deliberately excludes `last_used_*`: a key in use must still be approvable.
 */
export const serviceKeyDeletionTarget: RegisteredDeletionTarget = {
  targetType: "api_key",
  routeKey: SERVICE_KEY_DELETION_ROUTE,
  confirmation: "typed_name_step_up",
  sessionOnly: true,
  notFound: "API key not found",
  load: async (tx, id) => {
    const row = await loadServiceKeyForDeletion(tx, id);
    if (!row?.workspaceId) return undefined;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: null,
      organisationId: null,
      name: row.name ?? row.id,
      summary: {
        apiKeyId: row.id,
        name: row.name,
        kind: "service",
        capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
      },
      version: registeredDeletionFingerprint({
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        expiresAt: row.expiresAt,
        workspaceId: row.workspaceId,
        capabilities: row.capabilities,
        ipAllowlist: row.ipAllowlist,
        disabledAt: row.disabledAt,
      }),
    };
  },
  execute: async (tx, { loaded, identity }) => {
    await invalidatePendingActionsForCredential(tx, {
      type: "api_key",
      id: loaded.id,
    });
    if (!(await deleteApiKeyRow(tx, loaded.id)))
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    await appendAuditLog(tx, {
      actorId: identity.userId,
      actorType: "person",
      workspaceId: loaded.workspaceId,
      action: "api_key.revoked",
      entityType: "api_key",
      entityId: loaded.id,
      before: { enabled: true },
      after: { enabled: false, deleted: true, kind: "service" },
    });
    return {};
  },
};
