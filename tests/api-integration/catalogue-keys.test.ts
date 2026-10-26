import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const windows = {
  mon: [{ from: 540, to: 1020 }],
  tue: [{ from: 540, to: 1020 }],
  wed: [{ from: 540, to: 1020 }],
  thu: [{ from: 540, to: 1020 }],
  fri: [{ from: 540, to: 1020 }],
};

async function prepareSessionCookie(userId: string) {
  const now = new Date();
  const token = `catalogue-keys-${randomUUID()}`;
  await db.insert(schema.sessionTable).values({
    id: `session-${userId}`,
    token,
    userId,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  return `__Host-tdk_agent_session=${token}`;
}

describe("API integration: stable catalogue keys", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates, lists, and reads workspace labels with immutable stable keys", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(owner.user);
    const sessionCookie = await prepareSessionCookie(owner.user.id);
    const { app } = createApp();

    const create = async (name: string, key?: string) =>
      csrfRequest(
        app,
        "/api/label",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
          },
          body: JSON.stringify({
            name,
            color: "#3b82f6",
            workspaceId: owner.workspace.id,
            ...(key ? { key } : {}),
          }),
        },
        sessionCookie,
      );

    const createdResponse = await create(
      "Customer visible",
      "customer-visible",
    );
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()) as {
      id: string;
      key: string;
    };
    expect(created.key).toBe("customer-visible");

    const duplicate = await create("Another label", "customer-visible");
    expect(duplicate.status).toBe(409);
    const invalid = await create("Invalid key", "Customer Visible");
    expect(invalid.status).toBe(400);

    const list = await app.request(
      `/api/label/workspace/${owner.workspace.id}`,
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, key: "customer-visible" }),
      ]),
    );
    const detail = await app.request(`/api/label/${created.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).key).toBe("customer-visible");

    const renameWithKey = await csrfRequest(
      app,
      `/api/label/${created.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          name: "Customer facing",
          color: "#3b82f6",
          key: "renamed",
        }),
      },
      sessionCookie,
    );
    expect(renameWithKey.status).toBe(400);
    const rename = await csrfRequest(
      app,
      `/api/label/${created.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({ name: "Customer facing", color: "#3b82f6" }),
      },
      sessionCookie,
    );
    expect(rename.status).toBe(200);
    expect((await rename.json()).key).toBe("customer-visible");
    const persisted = await db.query.labelTable.findFirst({
      where: and(
        eq(schema.labelTable.id, created.id),
        eq(schema.labelTable.workspaceId, owner.workspace.id),
      ),
    });
    expect(persisted?.key).toBe("customer-visible");
  });

  it("creates and lists SLA policy and calendar keys, rejecting duplicates and rename attempts", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(owner.user);
    const sessionCookie = await prepareSessionCookie(owner.user.id);
    const { app } = createApp();
    const createCalendar = (name: string, key?: string) =>
      csrfRequest(
        app,
        "/api/service-calendars",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
          },
          body: JSON.stringify({
            workspaceId: owner.workspace.id,
            name,
            ...(key ? { key } : {}),
            timezone: "UTC",
            windows,
            holidays: [],
          }),
        },
        sessionCookie,
      );
    const calendarResponse = await createCalendar(
      "Weekday support",
      "weekday-support",
    );
    expect(calendarResponse.status).toBe(200);
    const calendar = (await calendarResponse.json()) as {
      id: string;
      key: string;
    };
    expect(calendar.key).toBe("weekday-support");
    expect(
      (await createCalendar("Other calendar", "weekday-support")).status,
    ).toBe(409);

    const calendarList = await app.request(
      `/api/service-calendars?workspaceId=${owner.workspace.id}`,
    );
    expect(calendarList.status).toBe(200);
    expect((await calendarList.json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: calendar.id, key: "weekday-support" }),
      ]),
    );
    const calendarKeyChange = await csrfRequest(
      app,
      `/api/service-calendars/${calendar.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "if-match": '"1"',
        },
        body: JSON.stringify({ key: "renamed-calendar" }),
      },
      sessionCookie,
    );
    expect(calendarKeyChange.status).toBe(400);
    const calendarRename = await csrfRequest(
      app,
      `/api/service-calendars/${calendar.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "if-match": '"1"',
        },
        body: JSON.stringify({ name: "Weekdays" }),
      },
      sessionCookie,
    );
    expect(calendarRename.status).toBe(200);
    expect((await calendarRename.json()).key).toBe("weekday-support");

    const createPolicy = (name: string, key?: string) =>
      csrfRequest(
        app,
        `/api/sla-policies?workspaceId=${owner.workspace.id}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
          },
          body: JSON.stringify({
            name,
            calendarId: calendar.id,
            atRiskThresholdPct: 75,
            goals: [],
            ...(key ? { key } : {}),
          }),
        },
        sessionCookie,
      );
    const policyResponse = await createPolicy("Standard", "standard-support");
    expect(policyResponse.status).toBe(200);
    const policy = (await policyResponse.json()) as {
      id: string;
      key: string;
      version: number;
    };
    expect(policy.key).toBe("standard-support");
    expect(
      (await createPolicy("Another policy", "standard-support")).status,
    ).toBe(409);

    const policyList = await app.request(
      `/api/sla-policies?workspaceId=${owner.workspace.id}`,
    );
    expect(policyList.status).toBe(200);
    expect((await policyList.json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: policy.id, key: "standard-support" }),
      ]),
    );
    const policyKeyChange = await csrfRequest(
      app,
      `/api/sla-policies/${policy.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "if-match": `"${policy.version}"`,
        },
        body: JSON.stringify({ key: "renamed-policy" }),
      },
      sessionCookie,
    );
    expect(policyKeyChange.status).toBe(400);
    const policyRename = await csrfRequest(
      app,
      `/api/sla-policies/${policy.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "if-match": `"${policy.version}"`,
        },
        body: JSON.stringify({ name: "Standard response" }),
      },
      sessionCookie,
    );
    expect(policyRename.status).toBe(200);
    expect((await policyRename.json()).key).toBe("standard-support");
  });
});
