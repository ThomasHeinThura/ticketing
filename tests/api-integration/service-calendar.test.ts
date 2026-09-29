import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
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

describe("API integration: service calendars (CAL-1–CAL-9)", () => {
  beforeEach(async () => resetTestDatabase());

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
    const deleted = await app.request(`/api/service-calendars/${calendar.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
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
    const { app } = createApp();
    const readHeaders = { Authorization: `Bearer ${readKey}` };
    const manageHeaders = { Authorization: `Bearer ${manageKey}` };
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
