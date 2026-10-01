import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function setupRequester() {
  const { user, workspace } = await createWorkspaceMember();
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: user.id,
        organisationId: workspace.organisationId,
        side: "staff",
      })
      .returning(),
    "pending-action requester",
  );
  return { user, workspace, person };
}

async function insertPendingAction(
  personId: string,
  workspaceId: string,
  overrides: Partial<typeof schema.pendingActionTable.$inferInsert> = {},
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.pendingActionTable)
      .values({
        id: `pa-${randomUUID()}`,
        requestedByPersonId: personId,
        credentialType: "session",
        credentialId: null,
        origin: "web",
        action: "delete",
        targetType: "work_item",
        targetIds: ["SUP-1"],
        targetVersions: null,
        payload: { action: "delete" },
        routeKey: "DELETE /api/work-items/{key}",
        payloadHash: "a".repeat(64),
        payloadSummary: { key: "SUP-1" },
        workspaceId,
        projectId: null,
        organisationId: null,
        confirmationRequired: "click",
        state: "pending",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        traceId: `trace-${randomUUID()}`,
        ...overrides,
      })
      .returning(),
    "pending action",
  );
}

async function insertApiKey(userId: string) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const row = requireRow(
    await db
      .insert(schema.apikeyTable)
      .values({
        referenceId: userId,
        userId,
        key: hashApiKeyForTest(rawKey),
        name: "decision-test-key",
        start: rawKey.slice(0, 12),
        prefix: "taskdesk",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.apikeyTable.id }),
    "API key",
  );
  return { rawKey, id: row.id };
}

describe("POST /api/me/pending-actions/{id}/deny and /cancel", () => {
  it.each([
    ["deny", "denied"],
    ["cancel", "cancelled"],
  ] as const)(
    "AU-14: succeeds with the %s transition when its audit insert fails",
    async (route, outcome) => {
      const { user, workspace, person } = await setupRequester();
      const pending = await insertPendingAction(person.id, workspace.id);
      mockAuthenticatedSession(user);
      const { app } = createApp();
      const auditFailure = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      await db.execute(
        sql.raw(`
          CREATE OR REPLACE FUNCTION fail_pending_action_decision_http_audit_insert()
          RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.action = 'pending_action.decided' THEN
              RAISE EXCEPTION 'test decision audit failure';
            END IF;
            RETURN NEW;
          END;
          $$
        `),
      );
      await db.execute(
        sql.raw(`
          CREATE TRIGGER fail_pending_action_decision_http_audit_insert
          BEFORE INSERT ON audit_log
          FOR EACH ROW EXECUTE FUNCTION fail_pending_action_decision_http_audit_insert()
        `),
      );

      try {
        const response = await app.request(
          `/api/me/pending-actions/${pending.id}/${route}`,
          { method: "POST" },
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ state: outcome });

        const [row] = await db
          .select({ state: schema.pendingActionTable.state })
          .from(schema.pendingActionTable)
          .where(eq(schema.pendingActionTable.id, pending.id));
        const events = await db
          .select({
            eventId: schema.outboxTable.eventId,
            payload: schema.outboxTable.payload,
          })
          .from(schema.outboxTable)
          .where(eq(schema.outboxTable.kind, "pending_action.decided"));
        const audits = await db
          .select({ id: schema.auditLogTable.id })
          .from(schema.auditLogTable)
          .where(
            and(
              eq(schema.auditLogTable.action, "pending_action.decided"),
              eq(schema.auditLogTable.entityId, pending.id),
            ),
          );
        expect(row?.state).toBe(outcome);
        expect(events).toHaveLength(1);
        expect(events[0]?.payload).toMatchObject({ payload: { outcome } });
        expect(audits).toHaveLength(0);
        expect(auditFailure).toHaveBeenCalledWith(
          "AU-14: pending-action decision audit write failed",
          expect.anything(),
        );
      } finally {
        auditFailure.mockRestore();
        await db.execute(
          sql.raw(
            "DROP TRIGGER IF EXISTS fail_pending_action_decision_http_audit_insert ON audit_log",
          ),
        );
        await db.execute(
          sql.raw(
            "DROP FUNCTION IF EXISTS fail_pending_action_decision_http_audit_insert()",
          ),
        );
      }
    },
  );

  it("PA-9/PA-11: denies in a session, records audit and event, and cannot repeat", async () => {
    const { user, workspace, person } = await setupRequester();
    const pending = await insertPendingAction(person.id, workspace.id);
    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(
      `/api/me/pending-actions/${pending.id}/deny`,
      { method: "POST", headers: { "x-request-id": "deny-http-test" } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: pending.id,
      state: "denied",
    });

    const duplicate = await app.request(
      `/api/me/pending-actions/${pending.id}/deny`,
      { method: "POST" },
    );
    expect(duplicate.status).toBe(409);

    const [row] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.id));
    const audit = await db
      .select({
        actorId: schema.auditLogTable.actorId,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "pending_action.decided"),
          eq(schema.auditLogTable.entityId, pending.id),
        ),
      );
    const events = await db
      .select({ payload: schema.outboxTable.payload })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "pending_action.decided"));

    expect(row?.state).toBe("denied");
    expect(audit).toEqual([{ actorId: person.id, after: { state: "denied" } }]);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      payload: { outcome: "denied" },
    });

    const racing = await insertPendingAction(person.id, workspace.id, {
      targetIds: ["SUP-race"],
    });
    const concurrent = await Promise.all([
      app.request(`/api/me/pending-actions/${racing.id}/cancel`, {
        method: "POST",
      }),
      app.request(`/api/me/pending-actions/${racing.id}/cancel`, {
        method: "POST",
      }),
    ]);
    expect(concurrent.map((item) => item.status).sort()).toEqual([200, 409]);
  });

  it("PA-9: allows a current API-key owner to cancel, while deny rejects that key", async () => {
    const { user, workspace, person } = await setupRequester();
    const key = await insertApiKey(user.id);
    const denied = await insertPendingAction(person.id, workspace.id, {
      targetIds: ["SUP-deny"],
    });
    const cancelled = await insertPendingAction(person.id, workspace.id, {
      targetIds: ["SUP-cancel"],
    });
    const { app } = createApp();

    const denyResponse = await app.request(
      `/api/me/pending-actions/${denied.id}/deny`,
      { method: "POST", headers: { "x-api-key": key.rawKey } },
    );
    expect(denyResponse.status).toBe(403);
    expect(await denyResponse.text()).toContain("session_required");

    mockAuthenticatedSession(user, { impersonatedBy: "admin-user" });
    const impersonatedDeny = await app.request(
      `/api/me/pending-actions/${denied.id}/deny`,
      { method: "POST" },
    );
    expect(impersonatedDeny.status).toBe(403);
    expect(await impersonatedDeny.text()).toContain("session_required");

    mockAuthenticatedSession(user);
    const cancelResponse = await app.request(
      `/api/me/pending-actions/${cancelled.id}/cancel`,
      { method: "POST", headers: { "x-api-key": key.rawKey } },
    );
    expect(cancelResponse.status).toBe(200);
    expect(await cancelResponse.json()).toMatchObject({
      id: cancelled.id,
      state: "cancelled",
    });

    const rows = await db
      .select({
        id: schema.pendingActionTable.id,
        state: schema.pendingActionTable.state,
      })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.requestedByPersonId, person.id));
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: denied.id, state: "pending" },
        { id: cancelled.id, state: "cancelled" },
      ]),
    );
    const cancelAudit = await db
      .select({
        actorId: schema.auditLogTable.actorId,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "pending_action.decided"),
          eq(schema.auditLogTable.entityId, cancelled.id),
        ),
      );
    const cancelEvents = await db
      .select({ payload: schema.outboxTable.payload })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "pending_action.decided"));
    expect(cancelAudit).toEqual([
      { actorId: person.id, after: { state: "cancelled" } },
    ]);
    expect(cancelEvents).toHaveLength(1);
    expect(cancelEvents[0]?.payload).toMatchObject({
      payload: { pendingActionId: cancelled.id, outcome: "cancelled" },
    });
    const denyAudits = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "pending_action.decided"),
          eq(schema.auditLogTable.entityId, denied.id),
        ),
      );
    expect(denyAudits).toHaveLength(0);
  });

  it("PA-9: hides a foreign id and rejects a revoked current identity before lookup", async () => {
    const owner = await setupRequester();
    const other = await setupRequester();
    const ownerKey = await insertApiKey(owner.user.id);
    const pending = await insertPendingAction(
      owner.person.id,
      owner.workspace.id,
    );
    mockAuthenticatedSession(other.user);
    const { app } = createApp();

    const foreign = await app.request(
      `/api/me/pending-actions/${pending.id}/cancel`,
      { method: "POST" },
    );
    expect(foreign.status).toBe(404);

    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, owner.person.id));
    const revoked = await app.request(
      `/api/me/pending-actions/${pending.id}/cancel`,
      { method: "POST", headers: { "x-api-key": ownerKey.rawKey } },
    );
    expect(revoked.status).toBe(401);
    const [row] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.id));
    expect(row?.state).toBe("pending");
  });
});
