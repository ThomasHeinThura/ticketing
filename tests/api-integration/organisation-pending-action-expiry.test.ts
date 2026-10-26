import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  canonicalPendingActionPayload,
  hashPendingActionPayload,
} from "../../apps/api/src/pending-action/payload";
import { expirePendingActions } from "../../apps/api/src/scheduler/pending-action-expire";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM job_lease WHERE name = 'pending-action-expire'`,
  );
});

describe("organisation deletion pending-action expiry", () => {
  it("expires only the exact organisation-scoped instance deletion action", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1);
    if (!person) throw new Error("requester fixture has no person");
    const organisationId = workspace.organisationId;
    const payload = canonicalPendingActionPayload({
      action: "delete",
      route_key: "DELETE /api/instance/organisations/{id}",
      target_type: "organisation",
      target_ids: [organisationId],
      workspace_id: null,
      project_id: null,
      organisation_id: organisationId,
      confirmation_required: "typed_name_step_up",
    });
    const actions = await db
      .insert(schema.pendingActionTable)
      .values({
        id: `pa-org-expiry-${randomUUID()}`,
        requestedByPersonId: person.id,
        credentialType: "session",
        credentialId: `session-${randomUUID()}`,
        origin: "web",
        action: "delete",
        targetType: "organisation",
        targetIds: [organisationId],
        targetVersions: {
          [organisationId]: '{"profileEtag":"etag","generation":0}',
        },
        payload,
        routeKey: "DELETE /api/instance/organisations/{id}",
        payloadHash: hashPendingActionPayload(payload),
        payloadSummary: { name: "Fixture organisation" },
        workspaceId: null,
        projectId: null,
        organisationId,
        confirmationRequired: "typed_name_step_up",
        state: "pending",
        expiresAt: new Date(Date.now() - 60_000),
        traceId: `trace-${randomUUID()}`,
      })
      .returning();
    const inserted = requireRow(actions, "organisation pending action");

    expect(await expirePendingActions()).toEqual({
      expired: 1,
      degraded: false,
    });
    const [stored] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, inserted.id));
    expect(stored?.state).toBe("expired");
    const event = await db
      .select({ organisationId: schema.outboxTable.organisationId })
      .from(schema.outboxTable)
      .where(
        sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${inserted.id}`,
      );
    // The pending-action row binds the organisation; its event envelope is instance-scoped.
    expect(event).toEqual([{ organisationId: null }]);
  });

  it("leaves an organisation action with unscoped stored columns pending", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1);
    if (!person) throw new Error("requester fixture has no person");
    const organisationId = workspace.organisationId;
    const payload = canonicalPendingActionPayload({
      action: "delete",
      route_key: "DELETE /api/instance/organisations/{id}",
      target_type: "organisation",
      target_ids: [organisationId],
      workspace_id: null,
      project_id: null,
      organisation_id: null,
      confirmation_required: "typed_name_step_up",
    });
    const actions = await db
      .insert(schema.pendingActionTable)
      .values({
        id: `pa-org-unscoped-${randomUUID()}`,
        requestedByPersonId: person.id,
        credentialType: "session",
        credentialId: `session-${randomUUID()}`,
        origin: "web",
        action: "delete",
        targetType: "organisation",
        targetIds: [organisationId],
        targetVersions: null,
        payload,
        routeKey: "DELETE /api/instance/organisations/{id}",
        payloadHash: hashPendingActionPayload(payload),
        payloadSummary: { name: "Fixture organisation" },
        workspaceId: null,
        projectId: null,
        organisationId: null,
        confirmationRequired: "typed_name_step_up",
        state: "pending",
        expiresAt: new Date(Date.now() - 60_000),
        traceId: `trace-${randomUUID()}`,
      })
      .returning();
    const inserted = requireRow(actions, "unscoped organisation action");

    expect(await expirePendingActions()).toEqual({
      expired: 0,
      degraded: true,
    });
    const [stored] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, inserted.id));
    expect(stored?.state).toBe("pending");
  });

  it("expires the exact manual organisation purge action with an instance-scoped event", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1);
    if (!person) throw new Error("requester fixture has no person");
    const organisationId = workspace.organisationId;
    const payload = canonicalPendingActionPayload({
      action: "purge",
      route_key: "POST /api/instance/purge",
      target_type: "organisation",
      target_ids: [organisationId],
      workspace_id: null,
      project_id: null,
      organisation_id: organisationId,
      confirmation_required: "typed_name_step_up",
    });
    const actions = await db
      .insert(schema.pendingActionTable)
      .values({
        id: `pa-org-purge-expiry-${randomUUID()}`,
        requestedByPersonId: person.id,
        credentialType: "session",
        credentialId: `session-${randomUUID()}`,
        origin: "web",
        action: "purge",
        targetType: "organisation",
        targetIds: [organisationId],
        targetVersions: {
          [organisationId]: JSON.stringify({
            operationId: "delete-op",
            generation: 1,
          }),
        },
        payload,
        routeKey: "POST /api/instance/purge",
        payloadHash: hashPendingActionPayload(payload),
        payloadSummary: { name: "Fixture organisation" },
        workspaceId: null,
        projectId: null,
        organisationId,
        confirmationRequired: "typed_name_step_up",
        state: "pending",
        expiresAt: new Date(Date.now() - 60_000),
        traceId: `trace-${randomUUID()}`,
      })
      .returning();
    const inserted = requireRow(actions, "organisation purge action");

    expect(await expirePendingActions()).toEqual({
      expired: 1,
      degraded: false,
    });
    const [stored] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, inserted.id));
    expect(stored?.state).toBe("expired");
    const [event] = await db
      .select({ organisationId: schema.outboxTable.organisationId })
      .from(schema.outboxTable)
      .where(
        sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${inserted.id}`,
      );
    expect(event?.organisationId).toBeNull();
  });
});
