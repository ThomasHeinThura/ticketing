import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { retryIdentityGrantClosure } from "./membership-projection";
import { transitionPersonLifecycleInTransaction } from "./person-lifecycle";

/** SCIM source wrapper: the shared transition owns person-wide state and grants. */
export async function setScimIdentityActive(
  identityId: string,
  connectionId: string,
  active: boolean,
  lifecyclePolicy: "end_memberships" | "keep_memberships",
) {
  return retryIdentityGrantClosure(async () =>
    db.transaction((tx) =>
      setScimIdentityActiveInTransaction(
        tx,
        identityId,
        connectionId,
        active,
        lifecyclePolicy,
      ),
    ),
  );
}

export async function setScimIdentityActiveInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  identityId: string,
  connectionId: string,
  active: boolean,
  lifecyclePolicy: "end_memberships" | "keep_memberships",
) {
  const [identity] = await tx
    .select({ personId: schema.externalIdentityTable.personId })
    .from(schema.externalIdentityTable)
    .where(
      and(
        eq(schema.externalIdentityTable.id, identityId),
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
        eq(schema.externalIdentityTable.provisionedVia, "scim"),
      ),
    )
    .limit(1);
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
  return true;
}
