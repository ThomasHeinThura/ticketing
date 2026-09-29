import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const weekdayWindows = {
  mon: [{ from: 540, to: 1020 }],
  tue: [{ from: 540, to: 1020 }],
  wed: [{ from: 540, to: 1020 }],
  thu: [{ from: 540, to: 1020 }],
  fri: [{ from: 540, to: 1020 }],
};

const recordedEvents: string[] = [];
let eventSubscriberInitialized = false;

function initEventSubscriber() {
  if (eventSubscriberInitialized) return;
  eventSubscriberInitialized = true;
  for (const type of [
    "service_calendar.created",
    "service_calendar.updated",
    "service_calendar.deleted",
  ]) {
    subscribeToEvent(type, async () => {
      recordedEvents.push(type);
    });
  }
}

const FAIL_FUNCTION = "td_calendar_audit_probe_fail";

async function armAuditInsertFailure() {
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION ${FAIL_FUNCTION}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'service-calendar probe: injected audit insert failure';
    END;
    $$ LANGUAGE plpgsql;
  `),
  );
  await db.execute(
    sql.raw(`
    CREATE TRIGGER ${FAIL_FUNCTION}
    BEFORE INSERT ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION ${FAIL_FUNCTION}();
  `),
  );
}

async function disarmAuditInsertFailure() {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${FAIL_FUNCTION} ON "audit_log"`),
  );
  await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${FAIL_FUNCTION}()`));
}

async function waitForBlockedCalendarRequests(expected: number) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const result = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%service_calendar%'
    `);
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for ${expected} blocked calendar request(s)`,
  );
}

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createApiKeyFor(
  userId: string,
  permissions: Record<string, string[]>,
): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "service calendar permission test key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: JSON.stringify(permissions),
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

describe("API integration: service calendars (CAL-1–CAL-14)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordedEvents.length = 0;
    initEventSubscriber();
  });
  afterEach(async () => {
    await disarmAuditInsertFailure();
    vi.restoreAllMocks();
  });

  it("CAL-1–CAL-7: persists calendar data and previews weekly and annual cover", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const body = {
      workspaceId: creator.workspace.id,
      name: "Business hours",
      timezone: "Europe/London",
      windows: weekdayWindows,
      holidays: [{ date: "2026-12-25", name: "Christmas" }],
    };
    const created = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(200);
    const calendar = (await created.json()) as { id: string; name: string };
    expect(calendar.name).toBe("Business hours");
    const createAudit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "service_calendar"),
          eq(schema.auditLogTable.entityId, calendar.id),
          eq(schema.auditLogTable.action, "service_calendar.created"),
        ),
      );
    expect(createAudit).toHaveLength(1);
    expect(createAudit[0]?.after).toMatchObject({
      name: "Business hours",
      timezone: "Europe/London",
    });

    const listed = await app.request(
      `/api/service-calendars?workspaceId=${creator.workspace.id}`,
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toHaveLength(1);
    const preview = await app.request(
      `/api/service-calendars/${calendar.id}/preview?year=2026`,
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      weeklyCoverMinutes: 2400,
      year: 2026,
      hasCover: true,
    });

    const updated = await app.request(`/api/service-calendars/${calendar.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated hours" }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { name: string }).name).toBe(
      "Updated hours",
    );
    const updateAudit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "service_calendar"),
          eq(schema.auditLogTable.entityId, calendar.id),
          eq(schema.auditLogTable.action, "service_calendar.updated"),
        ),
      );
    expect(updateAudit).toHaveLength(1);
    expect(updateAudit[0]?.before).toMatchObject({ name: "Business hours" });
    expect(updateAudit[0]?.after).toMatchObject({ name: "Updated hours" });
    expect(recordedEvents).toEqual([]);
    const deletion = await app.request(
      `/api/service-calendars/${calendar.id}`,
      {
        method: "DELETE",
      },
    );
    expect(deletion.status).toBe(404);
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);
  });

  it("CAL-14: keeps calendar writes when audit inserts fail and withholds deletion", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const body = {
      workspaceId: creator.workspace.id,
      name: "Atomic hours",
      timezone: "UTC",
      windows: weekdayWindows,
      holidays: [],
    };

    const auditErrorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await armAuditInsertFailure();
    const createResponse = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { id: string };
    expect(await db.select().from(schema.serviceCalendarTable)).toHaveLength(1);
    expect(auditErrorLog).toHaveBeenCalledWith(
      "AU-14: service-calendar audit write failed",
      expect.objectContaining({
        action: "service_calendar.created",
        entityId: created.id,
      }),
    );
    await disarmAuditInsertFailure();

    const calendar = created;
    const auditCountBefore = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityType, "service_calendar"));

    await armAuditInsertFailure();
    const updateResponse = await app.request(
      `/api/service-calendars/${calendar.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Update survives audit failure" }),
      },
    );
    expect(updateResponse.status).toBe(200);
    await disarmAuditInsertFailure();
    const [afterFailedUpdate] = await db
      .select()
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.id, calendar.id));
    expect(afterFailedUpdate?.name).toBe("Update survives audit failure");
    expect(auditErrorLog).toHaveBeenCalledWith(
      "AU-14: service-calendar audit write failed",
      expect.objectContaining({
        action: "service_calendar.updated",
        entityId: calendar.id,
      }),
    );
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.entityType, "service_calendar")),
    ).toHaveLength(auditCountBefore.length);
    expect(recordedEvents).toEqual([]);

    const deletion = await app.request(
      `/api/service-calendars/${calendar.id}`,
      {
        method: "DELETE",
      },
    );
    expect(deletion.status).toBe(404);
    expect(
      await db
        .select()
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.entityType, "service_calendar")),
    ).toHaveLength(auditCountBefore.length);
  });

  it("CAL-14: serializes concurrent PATCH snapshots with a row lock", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Initial hours",
        timezone: "UTC",
        windows: weekdayWindows,
        holidays: [],
      }),
    });
    expect(created.status).toBe(200);
    const calendar = (await created.json()) as { id: string };

    let signalLockAcquired: (() => void) | undefined;
    let releaseLock: (() => void) | undefined;
    const lockAcquired = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holdingTransaction = db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM service_calendar WHERE id = ${calendar.id} FOR UPDATE
      `);
      signalLockAcquired?.();
      await lockReleased;
    });
    await lockAcquired;

    try {
      const firstPatch = app.request(`/api/service-calendars/${calendar.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "First update" }),
      });
      await waitForBlockedCalendarRequests(1);
      const secondPatch = app.request(`/api/service-calendars/${calendar.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Second update" }),
      });
      await waitForBlockedCalendarRequests(2);

      releaseLock?.();
      const [firstResponse, secondResponse] = await Promise.all([
        firstPatch,
        secondPatch,
      ]);
      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
    } finally {
      releaseLock?.();
      await holdingTransaction;
    }

    const updates = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "service_calendar"),
          eq(schema.auditLogTable.entityId, calendar.id),
          eq(schema.auditLogTable.action, "service_calendar.updated"),
        ),
      )
      .orderBy(asc(schema.auditLogTable.seq));
    expect(updates.map((row) => row.before)).toEqual([
      expect.objectContaining({ name: "Initial hours" }),
      expect.objectContaining({ name: "First update" }),
    ]);
    expect(updates.map((row) => row.after)).toEqual([
      expect.objectContaining({ name: "First update" }),
      expect.objectContaining({ name: "Second update" }),
    ]);
  });

  it("CAL-2: rejects overlapping windows", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const response = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Invalid",
        timezone: "UTC",
        windows: {
          mon: [
            { from: 500, to: 700 },
            { from: 600, to: 800 },
          ],
        },
        holidays: [],
      }),
    });
    expect(response.status).toBe(400);
  });

  it("CAL-12: rejects impossible recurring dates and accepts leap day", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const create = (month: number, day: number) =>
      app.request("/api/service-calendars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: creator.workspace.id,
          name: `Holiday ${month}-${day}`,
          timezone: "UTC",
          windows: {},
          holidays: [
            { recurs: "annually", month, day, name: "Annual holiday" },
          ],
        }),
      });

    expect((await create(2, 30)).status).toBe(400);
    expect((await create(4, 31)).status).toBe(400);
    expect((await create(2, 29)).status).toBe(200);
  });

  it("CAL permissions: hides another workspace's calendar", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Private",
        timezone: "UTC",
        windows: {},
        holidays: [],
      }),
    });
    const { id } = (await created.json()) as { id: string };
    const other = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(other.user);
    const { app: otherApp } = createApp();
    const response = await otherApp.request(`/api/service-calendars/${id}`);
    expect(response.status).toBe(404);
  });

  it("API-key scope narrows calendar authority while retaining the caller's role check", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    const readKey = await createApiKeyFor(creator.user.id, {
      sla_policy: ["read"],
    });
    const manageKey = await createApiKeyFor(creator.user.id, {
      sla_policy: ["read", "manage"],
    });
    const viewer = await createWorkspaceMember({ role: "viewer" });
    const viewerManageKey = await createApiKeyFor(viewer.user.id, {
      sla_policy: ["read", "manage"],
    });
    const { app } = createApp();
    const readHeaders = { Authorization: `Bearer ${readKey}` };
    const manageHeaders = { Authorization: `Bearer ${manageKey}` };
    const viewerManageHeaders = {
      Authorization: `Bearer ${viewerManageKey}`,
    };
    const body = {
      workspaceId: creator.workspace.id,
      name: "API key scoped calendar",
      timezone: "UTC",
      windows: weekdayWindows,
      holidays: [],
    };

    const listed = await app.request(
      `/api/service-calendars?workspaceId=${creator.workspace.id}`,
      { headers: readHeaders },
    );
    expect(listed.status).toBe(200);

    const deniedCreate = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { ...readHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(deniedCreate.status).toBe(403);

    const viewerList = await app.request(
      `/api/service-calendars?workspaceId=${viewer.workspace.id}`,
      { headers: viewerManageHeaders },
    );
    expect(viewerList.status).toBe(200);
    const deniedRoleCreate = await app.request("/api/service-calendars", {
      method: "POST",
      headers: {
        ...viewerManageHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        workspaceId: viewer.workspace.id,
      }),
    });
    expect(deniedRoleCreate.status).toBe(403);

    const created = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { ...manageHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(200);
    const calendar = (await created.json()) as { id: string };

    const detail = await app.request(`/api/service-calendars/${calendar.id}`, {
      headers: readHeaders,
    });
    expect(detail.status).toBe(200);
  });
});
