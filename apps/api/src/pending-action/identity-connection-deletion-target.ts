import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import type db from "../database";
import { schema } from "../database";
import { IDENTITY_CONNECTION_DELETION_ROUTE } from "../identity/connection-deletion-policy";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  type RegisteredDeletionLoaded,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "./click-deletion-executor";
import { lockAndInvalidateConnectionSessions } from "./credential-invalidation";
import { reportPendingActionAuditFailures } from "./lifecycle-invalidation";
import {
  captureWorkspaceDeletionAccessForWorkspaces,
  invalidateWorkspaceDeletionAccessLosses,
} from "./workspace-access-invalidation";

type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type IdentityConnectionDeletionLoaded = RegisteredDeletionLoaded<null>;

async function lockConnectionDomainBindings(tx: PendingActionTransaction) {
  await tx.execute(
    // Same serialization key used by connection create/configure: deletion releases its
    // domains atomically with the tombstone, so a concurrent configuration cannot claim them.
    sql`SELECT pg_advisory_xact_lock(hashtext('taskdesk:identity-domain-bindings'), 0)`,
  );
}

async function loadConnection(tx: PendingActionTransaction, id: string) {
  const { lockScimGrantClosure } = await import(
    "../identity/membership-projection"
  );
  await lockScimGrantClosure(tx, {
    connectionId: id,
    sourceKinds: ["jit_default", "oidc_group", "scim_group"],
  });
  return tx
    .select({
      id: schema.identityConnectionTable.id,
      displayName: schema.identityConnectionTable.displayName,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      enabled: schema.identityConnectionTable.enabled,
      configVersion: schema.identityConnectionTable.configVersion,
      deletedAt: schema.identityConnectionTable.deletedAt,
    })
    .from(schema.identityConnectionTable)
    .where(
      and(
        eq(schema.identityConnectionTable.id, id),
        isNull(schema.identityConnectionTable.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
}

/**
 * The identity-connection row and every source grant are retained as history. Deletion is a
 * tombstone transition; physical deletion would either be blocked by RESTRICT references or
 * cascade session/SCIM rows without running the required revocation and authority projection.
 */
export const identityConnectionDeletionTarget: RegisteredDeletionTarget<IdentityConnectionDeletionLoaded> =
  {
    targetType: "identity_connection",
    routeKey: IDENTITY_CONNECTION_DELETION_ROUTE,
    confirmation: "typed_name_step_up",
    sessionOnly: true,
    notFound: "Connection unavailable",
    async load(tx, id) {
      await lockConnectionDomainBindings(tx);
      const [row] = await loadConnection(tx, id);
      if (!row) return undefined;
      const version = registeredDeletionFingerprint({
        id: row.id,
        displayName: row.displayName,
        portalScope: row.portalScope,
        organisationId: row.organisationId,
        enabled: row.enabled,
        configVersion: row.configVersion,
      });
      return {
        id,
        workspaceId: null,
        projectId: null,
        // This is an instance-admin operation even for a customer connection. Do not bind the
        // pending action to a customer organisation or make its approval depend on customer reach.
        organisationId: null,
        name: row.displayName,
        summary: {
          id: row.id,
          name: row.displayName,
          portalScope: row.portalScope,
          enabled: row.enabled,
        },
        version,
      };
    },
    async execute(tx, { loaded, input }) {
      const [current] = await loadConnection(tx, loaded.id);
      if (!current)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      const currentVersion = registeredDeletionFingerprint({
        id: current.id,
        displayName: current.displayName,
        portalScope: current.portalScope,
        organisationId: current.organisationId,
        enabled: current.enabled,
        configVersion: current.configVersion,
      });
      if (currentVersion !== loaded.version)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });

      const { lockScimGrantClosure, retireConnectionGrantSources } =
        await import("../identity/membership-projection");
      const grantClosure = await lockScimGrantClosure(tx, {
        connectionId: current.id,
        sourceKinds: ["jit_default", "oidc_group", "scim_group"],
      });
      const pendingActionAccess =
        await captureWorkspaceDeletionAccessForWorkspaces(
          tx,
          grantClosure
            .filter((key) => key.scope === "workspace")
            .map((key) => key.scopeId),
        );
      const now = new Date();
      const [updated] = await tx
        .update(schema.identityConnectionTable)
        .set({
          enabled: false,
          clientSecret: Buffer.alloc(0),
          deletedAt: now,
          configVersion: current.configVersion + 1,
          updatedAt: now,
          updatedBy: input.requesterPersonId,
        })
        .where(
          and(
            eq(schema.identityConnectionTable.id, current.id),
            eq(
              schema.identityConnectionTable.configVersion,
              current.configVersion,
            ),
            isNull(schema.identityConnectionTable.deletedAt),
          ),
        )
        .returning({
          configVersion: schema.identityConnectionTable.configVersion,
        });
      if (!updated)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });

      const retired = await retireConnectionGrantSources(tx, current.id);
      const invalidation = await lockAndInvalidateConnectionSessions(
        tx,
        current.id,
      );
      await tx
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.identityConnectionId, current.id));
      await tx
        .update(schema.scimConnectionTable)
        .set({ enabled: false, tokenHash: null, tokenPrefix: null })
        .where(eq(schema.scimConnectionTable.identityConnectionId, current.id));
      await tx
        .update(schema.oidcGroupMappingTable)
        .set({ enabled: false, updatedAt: now })
        .where(
          eq(schema.oidcGroupMappingTable.identityConnectionId, current.id),
        );
      await tx
        .update(schema.scimGroupMappingTable)
        .set({ enabled: false, updatedAt: now })
        .where(eq(schema.scimGroupMappingTable.scimConnectionId, current.id));
      await tx
        .update(schema.externalIdentityTable)
        .set({ orphanedAt: now })
        .where(
          and(
            eq(schema.externalIdentityTable.identityConnectionId, current.id),
            isNull(schema.externalIdentityTable.orphanedAt),
          ),
        );
      const pendingActionAuditFailures =
        invalidation.auditFailures +
        (await invalidateWorkspaceDeletionAccessLosses(
          tx,
          pendingActionAccess,
        ));

      let auditFailure = false;
      try {
        await tx.transaction((auditTx) =>
          appendAuditLog(auditTx, {
            actorId: input.requesterPersonId,
            actorType: "person",
            traceId: input.traceId,
            action: "identity_connection.changed",
            entityType: "identity_connection",
            entityId: current.id,
            before: {
              displayName: current.displayName,
              enabled: current.enabled,
              configVersion: current.configVersion,
            },
            after: {
              change: "deleted",
              enabled: false,
              configVersion: updated.configVersion,
            },
          }),
        );
      } catch {
        auditFailure = true;
      }
      await tx.insert(schema.provisioningEventTable).values({
        identityConnectionId: current.id,
        kind: "connection.changed",
        outcome: "succeeded",
        detail: { change: "deleted", configVersion: updated.configVersion },
        actorType: "person",
        traceId: input.traceId,
      });

      const personIds = [
        ...new Set([
          ...grantClosure.map((key) => key.personId),
          ...retired.projectionKeys.map((key) => key.personId),
        ]),
      ];
      const affectedUsers = personIds.length
        ? await tx
            .select({ userId: schema.personTable.userId })
            .from(schema.personTable)
            .where(inArray(schema.personTable.id, personIds))
        : [];
      const affectedUserIds = [
        ...new Set(
          affectedUsers.flatMap((person) =>
            person.userId ? [person.userId] : [],
          ),
        ),
      ];

      return {
        afterCommit: async () => {
          if (auditFailure) {
            recordAuditWriteFailure("mutation");
            await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
          }
          await reportPendingActionAuditFailures(pendingActionAuditFailures);
          const { invalidateNativeAuthorization } = await import("../ws");
          for (const userId of affectedUserIds)
            await invalidateNativeAuthorization({ userId });
        },
      };
    },
  };
