import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { createCalendar } from "../../apps/api/src/service-calendar/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const windows = { mon: [{ from: 540, to: 1020 }] };
const AUDIT_FAILURE_TRIGGER = "td_calendar_delete_audit_failure";

async function armCalendarDeleteAuditFailure() {
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION ${AUDIT_FAILURE_TRIGGER}() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = 'service_calendar.deleted' THEN
        RAISE EXCEPTION 'calendar deletion audit failure fixture';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `),
  );
  await db.execute(
    sql.raw(`
    CREATE TRIGGER ${AUDIT_FAILURE_TRIGGER}
    BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION ${AUDIT_FAILURE_TRIGGER}();
  `),
  );
}

async function disarmCalendarDeleteAuditFailure() {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${AUDIT_FAILURE_TRIGGER} ON audit_log`),
  );
  await db.execute(
    sql.raw(`DROP FUNCTION IF EXISTS ${AUDIT_FAILURE_TRIGGER}()`),
  );
}

afterEach(async () => disarmCalendarDeleteAuditFailure());

async function makeCalendar(workspaceId: string, actorId: string) {
  return createCalendar({
    workspaceId,
    name: "Unused calendar",
    timezone: "UTC",
    windows,
    holidays: [],
    actor: { actorId, actorType: "person", apiKeyId: null },
  });
}

async function createApiKeyFor(
  userId: string,
  permissions: Record<string, string[]>,
) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const hashed = createHash("sha256")
    .update(rawKey)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const now = new Date();
  const [apiKey] = await db
    .insert(schema.apikeyTable)
    .values({
      referenceId: userId,
      userId,
      key: hashed,
      name: "calendar deletion test key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify(permissions),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.apikeyTable.id });
  if (!apiKey) throw new Error("API-key fixture insert returned no row");
  return { rawKey, id: apiKey.id };
}

describe("API integration: service-calendar usage and CAL-9 deletion", () => {
  beforeEach(async () => resetTestDatabase());

  it("reports project references from the owning workspace only", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const other = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    const foreignCalendar = await makeCalendar(
      other.workspace.id,
      other.user.id,
    );
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({
        kind: "managed_service",
        supportLevel: "L1",
        serviceCalendarId: calendar.id,
      })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/service-calendars/${calendar.id}/usage`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      calendarId: calendar.id,
      counts: {
        projects: 1,
        slaPolicyVersions: 0,
        currentSlaPolicies: 0,
        workItems: 0,
      },
    });

    const hidden = await app.request(
      `/api/service-calendars/${foreignCalendar.id}/usage`,
    );
    expect(hidden.status).toBe(404);
  });

  it("requests deletion and executes only an unused calendar through the pending action", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    mockAuthenticatedSession(owner.user);
    const sessionId = `session-${owner.user.id}`;
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `token-${owner.user.id}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const request = await app.request(`/api/service-calendars/${calendar.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(202);
    const pending = (await request.json()) as {
      pendingActionId: string;
      confirmation: string;
    };
    expect(pending.confirmation).toBe("click");
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);

    const approval = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(approval.status).toBe(200);
    await expect(approval.json()).resolves.toMatchObject({
      id: pending.pendingActionId,
      state: "executed",
    });
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.entityType, "service_calendar"),
            eq(schema.auditLogTable.entityId, calendar.id),
            eq(schema.auditLogTable.action, "service_calendar.deleted"),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "service_calendar.deleted")),
    ).toHaveLength(1);

    const replay = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(replay.status).toBe(409);
    await expect(replay.text()).resolves.toContain(
      "pending_action_not_pending",
    );
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "service_calendar.deleted")),
    ).toHaveLength(1);
  });

  it("CAL-9: rejects deletion requests while any project still references the calendar", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({
        kind: "managed_service",
        supportLevel: "L1",
        serviceCalendarId: calendar.id,
      })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(owner.user);
    const sessionId = `session-${owner.user.id}`;
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `token-${owner.user.id}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const response = await app.request(
      `/api/service-calendars/${calendar.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toContain("service_calendar_in_use");
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.entityType, "pending_action")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);
  });

  it("CAL-9: rechecks project references at approval and allows a later retry after replacement", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    mockAuthenticatedSession(owner.user);
    const sessionId = `session-${owner.user.id}`;
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `token-${owner.user.id}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();
    const request = await app.request(`/api/service-calendars/${calendar.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(202);
    const pending = (await request.json()) as { pendingActionId: string };

    const duplicate = await app.request(
      `/api/service-calendars/${calendar.id}`,
      { method: "DELETE" },
    );
    expect(duplicate.status).toBe(409);
    await expect(duplicate.text()).resolves.toContain("pending_approval");
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(1);

    await db
      .update(schema.projectTable)
      .set({
        kind: "managed_service",
        supportLevel: "L1",
        serviceCalendarId: calendar.id,
      })
      .where(eq(schema.projectTable.id, project.id));
    const blocked = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(blocked.status).toBe(409);
    await expect(blocked.text()).resolves.toContain("service_calendar_in_use");
    const [stillPending] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    expect(stillPending?.state).toBe("pending");

    await db
      .update(schema.projectTable)
      .set({ kind: "project", supportLevel: null, serviceCalendarId: null })
      .where(eq(schema.projectTable.id, project.id));
    const approved = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({ state: "executed" });
  });

  it("CAL-9: invalidates a deletion request when the calendar version changes", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    mockAuthenticatedSession(owner.user);
    const sessionId = `session-${owner.user.id}`;
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `token-${owner.user.id}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();
    const request = await app.request(`/api/service-calendars/${calendar.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(202);
    const pending = (await request.json()) as { pendingActionId: string };

    const update = await app.request(`/api/service-calendars/${calendar.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": `"${calendar.version}"`,
      },
      body: JSON.stringify({ name: "Changed after deletion request" }),
    });
    expect(update.status).toBe(200);

    const approval = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(approval.status).toBe(409);
    // The calendar update invalidates the pending request eagerly (in the
    // same transaction), so approval finds it no longer pending.
    await expect(approval.text()).resolves.toContain(
      "pending_action_not_pending",
    );
    const [invalidated] = await db
      .select({
        state: schema.pendingActionTable.state,
        reason: schema.pendingActionTable.invalidationReason,
      })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    expect(invalidated?.state).toBe("invalidated");
    expect(invalidated?.reason).toBe("version_changed");
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);
  });

  it("CAL-14: commits calendar deletion and events when its audit row fails", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, owner.user.id));
    mockAuthenticatedSession({ ...owner.user, role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    const sessionId = `session-${owner.user.id}`;
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `token-${owner.user.id}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();
    const request = await app.request(`/api/service-calendars/${calendar.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(202);
    const pending = (await request.json()) as { pendingActionId: string };

    await armCalendarDeleteAuditFailure();
    try {
      const approval = await app.request(
        `/api/me/pending-actions/${pending.pendingActionId}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(approval.status).toBe(200);
      await expect(approval.json()).resolves.toMatchObject({
        state: "executed",
      });
      expect(
        await db
          .select()
          .from(schema.serviceCalendarTable)
          .where(eq(schema.serviceCalendarTable.id, calendar.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.outboxTable)
          .where(eq(schema.outboxTable.kind, "service_calendar.deleted")),
      ).toHaveLength(1);
      const [action] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
      expect(action?.state).toBe("executed");
      expect(
        await db
          .select()
          .from(schema.auditLogTable)
          .where(
            and(
              eq(schema.auditLogTable.entityType, "service_calendar"),
              eq(schema.auditLogTable.entityId, calendar.id),
              eq(schema.auditLogTable.action, "service_calendar.deleted"),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      await disarmCalendarDeleteAuditFailure();
    }
  });

  it("CAL-9: scopes deletion requests by credential, role and workspace", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    const readKey = await createApiKeyFor(owner.user.id, {
      sla_policy: ["read"],
    });
    const manageKey = await createApiKeyFor(owner.user.id, {
      sla_policy: ["read", "manage"],
    });
    const { app } = createApp();
    const path = `/api/service-calendars/${calendar.id}`;

    const readUsage = await app.request(`${path}/usage`, {
      headers: { Authorization: `Bearer ${readKey.rawKey}` },
    });
    expect(readUsage.status).toBe(200);

    const readDelete = await app.request(path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${readKey.rawKey}` },
    });
    expect(readDelete.status).toBe(403);
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);

    const viewer = await createWorkspaceMember({ role: "viewer" });
    const viewerCalendar = await makeCalendar(
      viewer.workspace.id,
      viewer.user.id,
    );
    mockAuthenticatedSession(viewer.user);
    const viewerDelete = await createApp().app.request(
      `/api/service-calendars/${viewerCalendar.id}`,
      { method: "DELETE" },
    );
    expect(viewerDelete.status).toBe(403);
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);

    const outsider = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(outsider.user);
    const outsiderApp = createApp().app;
    const outsiderUsage = await outsiderApp.request(`${path}/usage`);
    expect(outsiderUsage.status).toBe(404);
    const outsiderDelete = await outsiderApp.request(path, {
      method: "DELETE",
    });
    expect([403, 404]).toContain(outsiderDelete.status);
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);

    const apiRequest = await app.request(path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${manageKey.rawKey}` },
    });
    expect(apiRequest.status).toBe(202);
    const [pending] = await db.select().from(schema.pendingActionTable);
    expect(pending).toMatchObject({
      credentialType: "api_key",
      credentialId: manageKey.id,
      targetType: "service_calendar",
      state: "pending",
    });
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);
  });

  it("CAL-9: counts SLA policy versions in usage and rejects the deletion request while one references the calendar", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    const [policy] = await db
      .insert(schema.slaPolicyTable)
      .values({ workspaceId: owner.workspace.id, name: "Policy" })
      .returning();
    if (!policy) throw new Error("policy fixture missing");
    const [version] = await db
      .insert(schema.slaPolicyVersionTable)
      .values({
        workspaceId: owner.workspace.id,
        policyId: policy.id,
        number: 1,
        calendarId: calendar.id,
        atRiskThresholdPct: 75,
      })
      .returning();
    if (!version) throw new Error("policy version fixture missing");
    mockAuthenticatedSession(owner.user);
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${owner.user.id}`,
      token: `token-${owner.user.id}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const usage = await app.request(
      `/api/service-calendars/${calendar.id}/usage`,
    );
    expect(usage.status).toBe(200);
    await expect(usage.json()).resolves.toMatchObject({
      counts: { projects: 0, slaPolicyVersions: 1, currentSlaPolicies: 0 },
    });

    const request = await app.request(`/api/service-calendars/${calendar.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(409);
    await expect(request.text()).resolves.toContain("service_calendar_in_use");
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);
  });

  it("CAL-9: a project bound to a different calendar does not block deleting an unreferenced one", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const unused = await makeCalendar(owner.workspace.id, owner.user.id);
    const used = await makeCalendar(owner.workspace.id, owner.user.id);
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({
        kind: "managed_service",
        supportLevel: "L1",
        serviceCalendarId: used.id,
      })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(owner.user);
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${owner.user.id}`,
      token: `token-${owner.user.id}`,
      userId: owner.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const response = await app.request(`/api/service-calendars/${unused.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(202);
    const [pending] = await db.select().from(schema.pendingActionTable);
    expect(pending?.targetIds).toEqual([unused.id]);

    const blocked = await app.request(`/api/service-calendars/${used.id}`, {
      method: "DELETE",
    });
    expect(blocked.status).toBe(409);
  });

  it("CAL-9: an outsider gets 404, never 409, for an in-use calendar in another workspace", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({
        kind: "managed_service",
        supportLevel: "L1",
        serviceCalendarId: calendar.id,
      })
      .where(eq(schema.projectTable.id, project.id));
    const outsider = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(outsider.user);
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${outsider.user.id}`,
      token: `token-${outsider.user.id}`,
      userId: outsider.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const response = await app.request(
      `/api/service-calendars/${calendar.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("service_calendar_in_use");
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.entityType, "pending_action")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);
  });
});
