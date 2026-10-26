import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import {
  apiKeyExtensionTable,
  apikeyTable,
  personTable,
} from "../database/schema";
import {
  type RegisteredDeletionLoaded,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { invalidatePendingActionsForCredential } from "../pending-action/credential-invalidation";

export const PERSONAL_KEY_DELETION_ROUTE =
  "DELETE /api/me/api-keys/{id}" as const;

/**
 * AK-11 personal-key deletion. A browser session belonging to the same staff person must
 * type the key's current name and pass step-up; key/MCP credentials cannot request or approve.
 * Revocation remains the separate immediate AK-6 operation.
 */
export const personalKeyDeletionTarget: RegisteredDeletionTarget<
  RegisteredDeletionLoaded<null>
> = {
  targetType: "api_key",
  routeKey: PERSONAL_KEY_DELETION_ROUTE,
  confirmation: "typed_name_step_up",
  sessionOnly: true,
  notFound: "API key not found",
  load: async (tx, id) => {
    const [row] = await tx
      .select({
        id: apikeyTable.id,
        name: apikeyTable.name,
        enabled: apikeyTable.enabled,
        expiresAt: apikeyTable.expiresAt,
        permissions: apikeyTable.permissions,
        userId: apikeyTable.userId,
        referenceId: apikeyTable.referenceId,
        extensionId: apiKeyExtensionTable.apikeyId,
        workspaceId: apiKeyExtensionTable.workspaceId,
        personId: apiKeyExtensionTable.personId,
        isMcp: apiKeyExtensionTable.isMcp,
        capabilities: apiKeyExtensionTable.capabilities,
        ipAllowlist: apiKeyExtensionTable.ipAllowlist,
        rateLimitPerMinute: apiKeyExtensionTable.rateLimitPerMinute,
      })
      .from(apikeyTable)
      .leftJoin(
        apiKeyExtensionTable,
        eq(apiKeyExtensionTable.apikeyId, apikeyTable.id),
      )
      .where(eq(apikeyTable.id, id))
      .for("update", { of: apikeyTable })
      .limit(1);
    if (!row || row.workspaceId !== null) return undefined;

    // New rows carry the person id in the extension. Legacy Better Auth rows predate that
    // extension, so resolve their owner through the existing user/reference id fields.
    let ownerPersonId = row.extensionId ? row.personId : null;
    if (!row.extensionId) {
      const ownerUserId = row.userId ?? row.referenceId;
      if (!ownerUserId) return undefined;
      const [owner] = await tx
        .select({ id: personTable.id, side: personTable.side })
        .from(personTable)
        .where(eq(personTable.userId, ownerUserId))
        .limit(1);
      if (owner?.side !== "staff") return undefined;
      ownerPersonId = owner.id;
    }
    if (!ownerPersonId) return undefined;
    const [owner] = await tx
      .select({ id: personTable.id, side: personTable.side })
      .from(personTable)
      .where(eq(personTable.id, ownerPersonId))
      .limit(1);
    if (owner?.side !== "staff") return undefined;

    const name = row.name ?? row.id;
    return {
      id: row.id,
      workspaceId: null,
      projectId: null,
      organisationId: null,
      name,
      rowFacts: { personId: owner.id },
      summary: {
        name,
        kind: "personal",
        isMcp: row.isMcp ?? false,
        enabled: row.enabled ?? false,
      },
      // Usage metadata is intentionally excluded so normal key use cannot stale approval.
      version: registeredDeletionFingerprint({
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        expiresAt: row.expiresAt,
        permissions: row.permissions,
        personId: owner.id,
        isMcp: row.isMcp,
        capabilities: row.capabilities,
        ipAllowlist: row.ipAllowlist,
        rateLimitPerMinute: row.rateLimitPerMinute,
      }),
    };
  },
  execute: async (tx, { loaded, identity }) => {
    await invalidatePendingActionsForCredential(tx, {
      type: "api_key",
      id: loaded.id,
    });
    const [deleted] = await tx
      .delete(apikeyTable)
      .where(eq(apikeyTable.id, loaded.id))
      .returning({ id: apikeyTable.id });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    await appendAuditLog(tx, {
      actorId: identity.userId,
      actorType: "person",
      action: "api_key.revoked",
      entityType: "api_key",
      entityId: loaded.id,
      before: { enabled: loaded.summary.enabled === true },
      after: {
        enabled: false,
        deleted: true,
        kind: "personal",
        isMcp: loaded.summary.isMcp === true,
      },
    });
    return {};
  },
};
