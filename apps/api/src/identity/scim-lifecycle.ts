import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  lockPendingActionLifecycle,
  reportPendingActionAuditFailures,
} from "../pending-action/lifecycle-invalidation";
import { invalidateNativeAuthorization } from "../ws";
import { retryIdentityGrantClosure } from "./membership-projection";
import { transitionPersonLifecycleInTransaction } from "./person-lifecycle";
import { getScimExternalIdentity } from "./repository";

/** Write provisioning only after the caller has revalidated its locked SCIM connection. */
export async function enqueueScimIdentityProvisioned(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { connectionId: string; personId: string },
) {
  const [connection] = await tx
    .select({
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      defaultWorkspaceId: schema.identityConnectionTable.defaultWorkspaceId,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, input.connectionId))
    .limit(1);
  const [person] = await tx
    .select({
      organisationId: schema.personTable.organisationId,
      side: schema.personTable.side,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, input.personId))
    .limit(1);
  if (!connection || !person)
    throw new TypeError("SCIM provisioning scope is unavailable");

  let workspaceId: string | null = null;
  if (connection.portalScope === "agent") {
    if (person.side !== "staff")
      throw new TypeError("SCIM agent identity has an invalid person side");
    if (connection.defaultWorkspaceId) {
      const [workspace] = await tx
        .select({
          id: schema.workspaceTable.id,
          organisationId: schema.workspaceTable.organisationId,
        })
        .from(schema.workspaceTable)
        .innerJoin(
          schema.organisationTable,
          eq(schema.organisationTable.id, schema.workspaceTable.organisationId),
        )
        .where(
          and(
            eq(schema.workspaceTable.id, connection.defaultWorkspaceId),
            eq(schema.organisationTable.isInternal, true),
            isNull(schema.workspaceTable.deletedAt),
            isNull(schema.organisationTable.deletedAt),
          ),
        )
        .limit(1);
      if (workspace && workspace.organisationId === person.organisationId)
        workspaceId = workspace.id;
    }
  } else if (
    connection.portalScope === "customer" &&
    (person.side !== "customer" ||
      connection.organisationId !== person.organisationId)
  ) {
    throw new TypeError("SCIM customer identity has an invalid organisation");
  } else if (connection.portalScope !== "customer") {
    throw new TypeError("SCIM connection has an invalid portal scope");
  }

  const now = new Date();
  await enqueueOutboxEvent(tx, {
    id: `evt_${createId()}`,
    kind: "identity.provisioned",
    occurredAt: now.toISOString(),
    actor: { type: "system", id: null, name: "TaskDesk SCIM" },
    scope: eventScope({
      workspaceId,
      organisationId: null,
      projectId: null,
    }),
    payload: {
      identityConnectionId: input.connectionId,
      personId: input.personId,
      via: "scim",
      organisationId: person.organisationId,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
}

/** SCIM source wrapper: the shared transition owns person-wide state and grants. */
export async function setScimIdentityActive(
  identityId: string,
  connectionId: string,
  active: boolean,
  lifecyclePolicy: "end_memberships" | "keep_memberships",
) {
  const changed = await retryIdentityGrantClosure(async () =>
    db.transaction(async (tx) => {
      await lockPendingActionLifecycle(tx);
      return setScimIdentityActiveInTransaction(
        tx,
        identityId,
        connectionId,
        active,
        lifecyclePolicy,
      );
    }),
  );
  if (!changed) return false;
  await reportPendingActionAuditFailures(changed.pendingActionAuditFailures);
  await announceScimDeactivation(changed.revokedUserId);
  return true;
}

/**
 * A SCIM deactivation deletes the person's sessions and disables their keys inside its
 * transaction, which no session hook sees. Announce it once committed so legacy and native
 * sockets recheck at once instead of waiting for the next event or the 60-second floor (#632).
 */
export async function announceScimDeactivation(
  revokedUserId: string | null | undefined,
) {
  if (revokedUserId)
    await invalidateNativeAuthorization({ userId: revokedUserId });
}

/** Caller must take the pending-action lifecycle gate before its first row lock. */
export async function setScimIdentityActiveInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  identityId: string,
  connectionId: string,
  active: boolean,
  lifecyclePolicy: "end_memberships" | "keep_memberships",
) {
  const [identity] = await getScimExternalIdentity(
    tx,
    identityId,
    connectionId,
  );
  if (!identity) return false;

  const changed = await transitionPersonLifecycleInTransaction(
    tx,
    identity.personId,
    active,
    lifecyclePolicy,
    { kind: "scim", identityId, connectionId },
  );
  if (!changed) return false;

  const now = new Date();
  await tx
    .update(schema.externalIdentityTable)
    .set({ active, deactivatedAt: active ? null : now })
    .where(
      and(
        eq(schema.externalIdentityTable.id, identityId),
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
        eq(schema.externalIdentityTable.personId, identity.personId),
      ),
    );
  await tx.insert(schema.provisioningEventTable).values({
    identityConnectionId: connectionId,
    scimConnectionId: connectionId,
    externalIdentityId: identityId,
    kind: active ? "user.reactivated" : "user.deactivated",
    outcome: "success",
    detail: { personId: identity.personId, active, lifecyclePolicy },
    actorType: "scim",
  });
  if (!active) {
    const payload = {
      source: "scim" as const,
      identityConnectionId: connectionId,
      personId: identity.personId,
      sessionsRevoked: changed.sessionsRevoked,
      keysRevoked: changed.keysRevoked,
      membershipsEnded: changed.membershipsEnded,
    };
    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "identity.deprovisioned",
      occurredAt: now.toISOString(),
      actor: { type: "system", id: null, name: "TaskDesk SCIM" },
      scope: eventScope({
        workspaceId: null,
        organisationId: null,
        projectId: null,
      }),
      payload,
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    try {
      await tx.transaction(async (auditTx) =>
        appendAuditLog(auditTx, {
          actorId: null,
          actorType: "system",
          action: "identity.deprovisioned",
          entityType: "person",
          entityId: identity.personId,
          workspaceId: null,
          before: null,
          after: payload,
        }),
      );
    } catch {
      recordAuditWriteFailure("mutation");
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    }
  }
  return {
    pendingActionAuditFailures: changed.pendingActionAuditFailures,
    revokedUserId: changed.revokedUserId,
  };
}
