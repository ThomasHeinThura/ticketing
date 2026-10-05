import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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
  });

  it("rejects deletion requests while any project still references the calendar", async () => {
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
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.id)),
    ).toHaveLength(1);
  });
});
