import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";

export async function createCredentialBoundPendingAction(input: {
  requesterPersonId: string;
  workspaceId: string;
  organisationId: string;
  credentialType: "session" | "api_key";
  credentialId: string;
}) {
  const now = new Date();
  const id = `pa-${randomUUID()}`;
  await db.insert(schema.pendingActionTable).values({
    id,
    requestedByPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
    origin: "web",
    action: "delete",
    targetType: "work_item",
    targetIds: [`WI-${randomUUID()}`],
    targetVersions: null,
    payload: { action: "delete" },
    routeKey: "DELETE /api/work-items/{key}",
    payloadHash: "a".repeat(64),
    payloadSummary: { key: "redacted" },
    workspaceId: input.workspaceId,
    projectId: null,
    organisationId: input.organisationId,
    confirmationRequired: "click",
    state: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    traceId: `trace-${randomUUID()}`,
  });
  return id;
}

export async function expectCredentialInvalidationPersisted(id: string) {
  const [pending] = await db
    .select({
      workspaceId: schema.pendingActionTable.workspaceId,
      organisationId: schema.pendingActionTable.organisationId,
      traceId: schema.pendingActionTable.traceId,
    })
    .from(schema.pendingActionTable)
    .where(eq(schema.pendingActionTable.id, id));
  expect(pending).toBeDefined();
  if (!pending) throw new Error(`pending action ${id} was not found`);

  const events = await db
    .select({
      workspaceId: schema.outboxTable.workspaceId,
      organisationId: schema.outboxTable.organisationId,
      payload: schema.outboxTable.payload,
    })
    .from(schema.outboxTable)
    .where(
      and(
        eq(schema.outboxTable.kind, "pending_action.decided"),
        sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${id}`,
      ),
    );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    workspaceId: pending.workspaceId,
    organisationId: pending.organisationId,
    payload: {
      payload: {
        pendingActionId: id,
        outcome: "invalidated",
        invalidationReason: "credential_revoked",
      },
    },
  });

  const audits = await db
    .select({
      traceId: schema.auditLogTable.traceId,
      workspaceId: schema.auditLogTable.workspaceId,
      organisationId: schema.auditLogTable.organisationId,
      entityId: schema.auditLogTable.entityId,
      after: schema.auditLogTable.after,
    })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "pending_action.decided"),
        eq(schema.auditLogTable.entityId, id),
      ),
    );
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    traceId: pending.traceId,
    workspaceId: pending.workspaceId,
    organisationId: pending.organisationId,
    entityId: id,
    after: {
      state: "invalidated",
      invalidationReason: "credential_revoked",
    },
  });
}
