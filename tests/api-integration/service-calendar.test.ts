import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { createCalendar } from "../../apps/api/src/service-calendar/repository";
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
const FAIL_OUTBOX_FUNCTION = "td_calendar_outbox_probe_fail";

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

async function armOutboxInsertFailure(
  kind: "service_calendar.created" | "service_calendar.updated",
) {
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION ${FAIL_OUTBOX_FUNCTION}() RETURNS trigger AS $$
    BEGIN
      IF NEW.kind = '${kind}' THEN
        RAISE EXCEPTION 'service-calendar probe: injected outbox insert failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `),
  );
  await db.execute(
    sql.raw(`
    CREATE TRIGGER ${FAIL_OUTBOX_FUNCTION}
    BEFORE INSERT ON "outbox"
    FOR EACH ROW EXECUTE FUNCTION ${FAIL_OUTBOX_FUNCTION}();
  `),
  );
}

async function disarmOutboxInsertFailure() {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${FAIL_OUTBOX_FUNCTION} ON "outbox"`),
  );
  await db.execute(
    sql.raw(`DROP FUNCTION IF EXISTS ${FAIL_OUTBOX_FUNCTION}()`),
  );
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
  permissions: Record<string, string[]> | null,
): Promise<{ rawKey: string; id: string; name: string }> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const name = "service calendar permission test key";
  const now = new Date();
  const [apiKey] = await db
    .insert(schema.apikeyTable)
    .values({
      referenceId: userId,
      userId,
      key: hashApiKeyForTest(rawKey),
      name,
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: permissions === null ? null : JSON.stringify(permissions),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.apikeyTable.id });
  if (!apiKey) throw new Error("API-key test fixture insert returned no row");
  return { rawKey, id: apiKey.id, name };
}

describe("API integration: service calendars (CAL-1–CAL-16)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordedEvents.length = 0;
    initEventSubscriber();
  });
  afterEach(async () => {
    await disarmAuditInsertFailure();
    await disarmOutboxInsertFailure();
    vi.restoreAllMocks();
  });

  it("CAL-16: traverses 52 forward and backward pages across duplicate names", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    await db.insert(schema.serviceCalendarTable).values(
      Array.from({ length: 2551 }, () => ({
        workspaceId: owner.workspace.id,
        name: "Repeated calendar name",
        timezone: "UTC",
        windows: weekdayWindows,
        holidays: [],
      })),
    );
    const otherWorkspace = await createWorkspaceMember({ role: "admin" });
    await db.insert(schema.serviceCalendarTable).values({
      workspaceId: otherWorkspace.workspace.id,
      name: "Not in the requested workspace",
      timezone: "UTC",
      windows: weekdayWindows,
      holidays: [],
    });
    const all = await db
      .select({ id: schema.serviceCalendarTable.id })
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.workspaceId, owner.workspace.id))
      .orderBy(
        asc(schema.serviceCalendarTable.name),
        asc(schema.serviceCalendarTable.id),
      );
    type CalendarPage = {
      data: Array<{ id: string }>;
      page: {
        previousCursor: string | null;
        nextCursor: string | null;
        hasMore: boolean;
      };
      meta: { total: number };
    };
    const fetchPage = async (cursor?: string): Promise<CalendarPage> => {
      const query = new URLSearchParams({
        workspaceId: owner.workspace.id,
        limit: "50",
      });
      if (cursor) query.set("cursor", cursor);
      const response = await app.request(`/api/service-calendars?${query}`);
      expect(response.status).toBe(200);
      return (await response.json()) as CalendarPage;
    };

    const forwardPages: CalendarPage[] = [];
    let cursor: string | undefined;
    do {
      const page = await fetchPage(cursor);
      forwardPages.push(page);
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor);

    expect(forwardPages).toHaveLength(52);
    expect(forwardPages.map(({ data }) => data.length)).toEqual([
      ...Array.from({ length: 51 }, () => 50),
      1,
    ]);
    expect(forwardPages[0]?.page.previousCursor).toBeNull();
    expect(forwardPages.at(-1)?.page.nextCursor).toBeNull();
    expect(forwardPages.every(({ meta }) => meta.total === 2551)).toBe(true);
    expect(
      forwardPages.flatMap(({ data }) => data.map(({ id }) => id)),
    ).toEqual(all.map(({ id }) => id));
    const cursorSizes = forwardPages.flatMap(({ page }) =>
      [page.previousCursor, page.nextCursor]
        .filter((value): value is string => value !== null)
        .map((value) => value.length),
    );
    expect(Math.max(...cursorSizes)).toBeLessThan(512);
    expect(
      Math.max(...cursorSizes) - Math.min(...cursorSizes),
    ).toBeLessThanOrEqual(2);

    const backwardPages = [forwardPages.at(-1) as CalendarPage];
    cursor = backwardPages[0]?.page.previousCursor ?? undefined;
    while (cursor) {
      const page = await fetchPage(cursor);
      backwardPages.push(page);
      cursor = page.page.previousCursor ?? undefined;
    }
    expect(backwardPages).toHaveLength(52);
    expect(backwardPages.at(-1)?.page.previousCursor).toBeNull();
    const expectedBackward = Array.from({ length: 52 }, (_, pageIndex) =>
      all
        .slice(pageIndex * 50, Math.min((pageIndex + 1) * 50, all.length))
        .map(({ id }) => id),
    )
      .reverse()
      .flat();
    expect(
      backwardPages.flatMap(({ data }) => data.map(({ id }) => id)),
    ).toEqual(expectedBackward);

    const one = await app.request(
      `/api/service-calendars?workspaceId=${owner.workspace.id}&limit=1`,
    );
    const oneResult = (await one.json()) as CalendarPage;
    expect(oneResult.data).toHaveLength(1);
    expect(oneResult.page.hasMore).toBe(true);
    expect(oneResult.meta.total).toBe(2551);
    const defaultLimit = await app.request(
      `/api/service-calendars?workspaceId=${owner.workspace.id}`,
    );
    expect(((await defaultLimit.json()) as CalendarPage).data).toHaveLength(50);
    const maximum = await app.request(
      `/api/service-calendars?workspaceId=${owner.workspace.id}&limit=200`,
    );
    expect(((await maximum.json()) as CalendarPage).data).toHaveLength(200);

    for (const cursorPayload of [
      {
        v: 2,
        workspaceId: owner.workspace.id,
        name: "Repeated calendar name",
        id: "x",
        direction: "after",
      },
      {
        v: 1,
        workspaceId: owner.workspace.id,
        name: "Repeated calendar name",
        id: "x",
        direction: "sideways",
      },
      {
        v: 1,
        workspaceId: "other-workspace",
        name: "Repeated calendar name",
        id: "x",
        direction: "after",
      },
    ]) {
      const invalidCursor = Buffer.from(JSON.stringify(cursorPayload)).toString(
        "base64url",
      );
      expect(
        (
          await app.request(
            `/api/service-calendars?workspaceId=${owner.workspace.id}&cursor=${invalidCursor}`,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await app.request(
          `/api/service-calendars?workspaceId=${owner.workspace.id}&limit=201`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/api/service-calendars?workspaceId=${owner.workspace.id}&cursor=${"a".repeat(2049)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/api/service-calendars?workspaceId=${owner.workspace.id}&cursor=not-a-cursor`,
        )
      ).status,
    ).toBe(400);

    const nextFromFirst = forwardPages[0]?.page.nextCursor;
    expect(nextFromFirst).toBeTruthy();
    await db
      .delete(schema.serviceCalendarTable)
      .where(
        and(
          eq(schema.serviceCalendarTable.workspaceId, owner.workspace.id),
          notInArray(
            schema.serviceCalendarTable.id,
            forwardPages[0]?.data.map(({ id }) => id) ?? [],
          ),
        ),
      );
    const staleBoundary = await fetchPage(nextFromFirst ?? undefined);
    expect(staleBoundary.data).toHaveLength(0);
    expect(staleBoundary.page).toEqual({
      previousCursor: null,
      nextCursor: null,
      hasMore: false,
    });
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
    const [createdEvent] = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "service_calendar.created"));
    expect(createdEvent?.state).toBe("pending");
    expect(createdEvent?.payload).toMatchObject({
      kind: "service_calendar.created",
      actor: {
        type: "person",
        id: creator.user.id,
        name: creator.user.name,
      },
      scope: {
        workspaceId: creator.workspace.id,
        organisationId: creator.workspace.organisationId,
      },
      payload: {
        key: calendar.id,
        url: `/agent/settings/calendars/${calendar.id}`,
        calendarId: calendar.id,
        workspaceId: creator.workspace.id,
        name: "Business hours",
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });

    const listed = await app.request(
      `/api/service-calendars?workspaceId=${creator.workspace.id}`,
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).data).toHaveLength(1);
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
    const [updatedEvent] = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "service_calendar.updated"));
    expect(updatedEvent?.state).toBe("pending");
    expect(updatedEvent?.payload).toMatchObject({
      kind: "service_calendar.updated",
      payload: {
        key: calendar.id,
        calendarId: calendar.id,
        name: "Updated hours",
        changedFields: ["name"],
      },
    });
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

  it("records the API key as the outbox actor and its owner in the audit row", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    const apiKey = await createApiKeyFor(creator.user.id, {
      sla_policy: ["manage"],
    });
    const { app } = createApp();
    const response = await app.request("/api/service-calendars", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey.rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "API key calendar",
        timezone: "UTC",
        windows: weekdayWindows,
        holidays: [],
      }),
    });
    expect(response.status).toBe(200);
    const calendar = (await response.json()) as { id: string };

    const [event] = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "service_calendar.created"));
    expect(event?.payload).toMatchObject({
      actor: {
        type: "api_key",
        id: apiKey.id,
        name: apiKey.name,
      },
      payload: { calendarId: calendar.id },
    });

    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "service_calendar"),
          eq(schema.auditLogTable.entityId, calendar.id),
          eq(schema.auditLogTable.action, "service_calendar.created"),
        ),
      );
    expect(audit).toMatchObject({
      actorId: creator.user.id,
      actorType: "api_key",
      apiKeyId: apiKey.id,
    });
  });

  it("fails closed when the API-key event actor is missing or belongs to another user", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const otherUser = await createWorkspaceMember({ role: "admin" });
    const apiKey = await createApiKeyFor(owner.user.id, {
      sla_policy: ["manage"],
    });
    const invalidActors = [
      { actorId: owner.user.id, apiKeyId: "missing-api-key" },
      { actorId: otherUser.user.id, apiKeyId: apiKey.id },
    ];

    for (const actor of invalidActors) {
      await expect(
        createCalendar({
          workspaceId: owner.workspace.id,
          name: "Rejected API key calendar",
          timezone: "UTC",
          windows: weekdayWindows,
          holidays: [],
          actor: { ...actor, actorType: "api_key" },
        }),
      ).rejects.toThrow("Could not resolve service-calendar API-key actor");
    }

    expect(await db.select().from(schema.serviceCalendarTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "service_calendar.created")),
    ).toHaveLength(0);
  });

  it.each(["+05:00", "-03:30", "+05", "+0500", "-0330"])(
    "CAL-6: rejects fixed UTC offset timezone %s",
    async (timezone) => {
      const creator = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(creator.user);
      const { app } = createApp();
      const response = await app.request("/api/service-calendars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: creator.workspace.id,
          name: "Fixed offset calendar",
          timezone,
          windows: weekdayWindows,
          holidays: [],
        }),
      });

      expect(response.status).toBe(400);
      expect(await db.select().from(schema.serviceCalendarTable)).toHaveLength(
        0,
      );
    },
  );

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
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.workspaceId, creator.workspace.id)),
    ).toHaveLength(2);

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

  it("EV-1: rolls calendar mutations and audits back when outbox writes fail", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const body = {
      workspaceId: creator.workspace.id,
      name: "Atomic outbox hours",
      timezone: "UTC",
      windows: weekdayWindows,
      holidays: [],
    };

    await armOutboxInsertFailure("service_calendar.created");
    const failedCreate = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(failedCreate.status).toBe(500);
    expect(await db.select().from(schema.serviceCalendarTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.entityType, "service_calendar")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.workspaceId, creator.workspace.id)),
    ).toHaveLength(0);
    await disarmOutboxInsertFailure();

    const successfulCreate = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(successfulCreate.status).toBe(200);
    const { id } = (await successfulCreate.json()) as { id: string };

    await armOutboxInsertFailure("service_calendar.updated");
    const failedUpdate = await app.request(`/api/service-calendars/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Outbox failure must roll back" }),
    });
    expect(failedUpdate.status).toBe(500);
    await disarmOutboxInsertFailure();

    const [calendar] = await db
      .select()
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.id, id));
    expect(calendar?.name).toBe("Atomic outbox hours");
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.entityType, "service_calendar")),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.workspaceId, creator.workspace.id)),
    ).toHaveLength(1);
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

  it("CAL-15: rejects stale concurrent updates and preserves lifecycle timestamps", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Versioned hours",
        timezone: "UTC",
        windows: weekdayWindows,
        holidays: [],
      }),
    });
    expect(created.status).toBe(200);
    const calendar = (await created.json()) as {
      id: string;
      version: number;
      createdAt: string;
      updatedAt: string;
    };
    expect(calendar.version).toBe(1);
    expect(Number.isNaN(Date.parse(calendar.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(calendar.updatedAt))).toBe(false);
    const lifecycleColumnTypes = await db.execute<{
      column_name: string;
      data_type: string;
    }>(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'service_calendar'
        AND column_name IN ('created_at', 'updated_at')
      ORDER BY column_name
    `);
    expect(lifecycleColumnTypes.rows).toEqual([
      { column_name: "created_at", data_type: "timestamp with time zone" },
      { column_name: "updated_at", data_type: "timestamp with time zone" },
    ]);

    const fixedCreatedAt = new Date("2020-01-01T00:00:00.000Z");
    await db
      .update(schema.serviceCalendarTable)
      .set({ createdAt: fixedCreatedAt, updatedAt: fixedCreatedAt })
      .where(eq(schema.serviceCalendarTable.id, calendar.id));

    const timezoneRoundTrip = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL TIME ZONE 'America/Los_Angeles'`);
      const rendered = await tx.execute<{
        created_at: string;
        updated_at: string;
      }>(sql`
        SELECT created_at::text, updated_at::text
        FROM service_calendar
        WHERE id = ${calendar.id}
      `);
      const loaded = await tx
        .select({
          createdAt: schema.serviceCalendarTable.createdAt,
          updatedAt: schema.serviceCalendarTable.updatedAt,
        })
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id));
      return { rendered: rendered.rows[0], loaded: loaded[0] };
    });
    expect(timezoneRoundTrip.rendered).toEqual({
      created_at: "2019-12-31 16:00:00-08",
      updated_at: "2019-12-31 16:00:00-08",
    });
    expect(timezoneRoundTrip.loaded?.createdAt.toISOString()).toBe(
      "2020-01-01T00:00:00.000Z",
    );
    expect(timezoneRoundTrip.loaded?.updatedAt.toISOString()).toBe(
      "2020-01-01T00:00:00.000Z",
    );

    let signalLockAcquired: (() => void) | undefined;
    let releaseLock: (() => void) | undefined;
    const lockAcquired = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holdingTransaction = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM service_calendar WHERE id = ${calendar.id} FOR UPDATE`,
      );
      signalLockAcquired?.();
      await lockReleased;
    });
    await lockAcquired;
    try {
      const patch = (name: string) =>
        app.request(`/api/service-calendars/${calendar.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "if-match": '"1"' },
          body: JSON.stringify({ name }),
        });
      const firstPatch = patch("First versioned update");
      await waitForBlockedCalendarRequests(1);
      const secondPatch = patch("Second versioned update");
      await waitForBlockedCalendarRequests(2);
      releaseLock?.();
      const responses = await Promise.all([firstPatch, secondPatch]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const conflictResponse = responses.find(
        (response) => response.status === 409,
      );
      expect(conflictResponse).toBeDefined();
      expect(await conflictResponse?.json()).toMatchObject({
        assertedVersion: 1,
        currentVersion: 2,
      });
    } finally {
      releaseLock?.();
      await holdingTransaction;
    }

    const [stored] = await db
      .select()
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.id, calendar.id));
    expect(stored?.version).toBe(2);
    expect(stored?.createdAt.toISOString()).toBe(fixedCreatedAt.toISOString());
    expect(stored?.updatedAt.getTime()).toBeGreaterThan(
      fixedCreatedAt.getTime(),
    );
    const updates = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "service_calendar"),
          eq(schema.auditLogTable.entityId, calendar.id),
          eq(schema.auditLogTable.action, "service_calendar.updated"),
        ),
      );
    expect(updates).toHaveLength(1);
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
    const readHeaders = { Authorization: `Bearer ${readKey.rawKey}` };
    const manageHeaders = { Authorization: `Bearer ${manageKey.rawKey}` };
    const viewerManageHeaders = {
      Authorization: `Bearer ${viewerManageKey.rawKey}`,
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

  it("AK-3/AK-9: denies a SQL-NULL API-key scope without calendar side effects", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const nullScopeKey = await createApiKeyFor(owner.user.id, null);
    const [storedKey] = await db
      .select({ permissions: schema.apikeyTable.permissions })
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, nullScopeKey.id));
    expect(storedKey?.permissions).toBeNull();
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const body = {
      workspaceId: owner.workspace.id,
      name: "Session calendar",
      timezone: "UTC",
      windows: weekdayWindows,
      holidays: [],
    };

    const sessionCreate = await app.request("/api/service-calendars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(sessionCreate.status).toBe(200);
    const calendar = (await sessionCreate.json()) as { id: string };
    const beforeCalendar = await db
      .select()
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.id, calendar.id));
    const beforeAudit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "service_calendar"),
          eq(schema.auditLogTable.entityId, calendar.id),
        ),
      );
    const beforeOutbox = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.workspaceId, owner.workspace.id));
    const beforeRecordedEvents = [...recordedEvents];
    const keyHeaders = {
      authorization: `Bearer ${nullScopeKey.rawKey}`,
      "content-type": "application/json",
    };

    const deniedCreate = await app.request("/api/service-calendars", {
      method: "POST",
      headers: keyHeaders,
      body: JSON.stringify({ ...body, name: "Must not be created" }),
    });
    const deniedUpdate = await app.request(
      `/api/service-calendars/${calendar.id}`,
      {
        method: "PATCH",
        headers: keyHeaders,
        body: JSON.stringify({ name: "Must not be updated" }),
      },
    );

    expect.soft(deniedCreate.status).toBe(403);
    expect.soft(deniedUpdate.status).toBe(403);
    expect
      .soft(await db.select().from(schema.serviceCalendarTable))
      .toHaveLength(1);
    expect
      .soft(
        await db
          .select()
          .from(schema.serviceCalendarTable)
          .where(eq(schema.serviceCalendarTable.id, calendar.id)),
      )
      .toEqual(beforeCalendar);
    expect
      .soft(
        await db
          .select()
          .from(schema.auditLogTable)
          .where(
            and(
              eq(schema.auditLogTable.entityType, "service_calendar"),
              eq(schema.auditLogTable.entityId, calendar.id),
            ),
          ),
      )
      .toEqual(beforeAudit);
    expect
      .soft(
        await db
          .select()
          .from(schema.outboxTable)
          .where(eq(schema.outboxTable.workspaceId, owner.workspace.id)),
      )
      .toEqual(beforeOutbox);
    expect.soft(recordedEvents).toEqual(beforeRecordedEvents);
  });
});
