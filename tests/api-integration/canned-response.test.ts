/**
 * `docs/03-features/comments-and-activity.md` `CA-19`/`CA-20`: canned-response CRUD.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

describe("API integration: canned responses (#27)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("CA-19: an admin creates, lists, updates and deletes a canned response", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Thanks for reaching out",
        body: { type: "doc", content: [] },
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { id: string };
    expect(createdBody).toMatchObject({
      name: "Thanks for reaching out",
      visibilityDefault: "internal",
    });

    const list = await app.request(
      `/api/canned-responses?workspaceId=${creator.workspace.id}`,
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as unknown[];
    expect(listBody).toHaveLength(1);

    const updated = await app.request(
      `/api/canned-responses/${createdBody.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      },
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { name: string }).name).toBe("Renamed");

    const deleted = await app.request(
      `/api/canned-responses/${createdBody.id}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.cannedResponseTable)
      .where(eq(schema.cannedResponseTable.id, createdBody.id));
    expect(row).toBeUndefined();
  });

  it("403s a member without workspace:manage_settings", async () => {
    const creator = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Nope",
        body: { type: "doc", content: [] },
      }),
    });
    expect(response.status).toBe(403);
    await response.text();
  });

  it("409s a duplicate name within the same workspace", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const body = {
      workspaceId: creator.workspace.id,
      name: "Duplicate",
      body: { type: "doc", content: [] },
    };
    const first = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    await first.text();

    const second = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(second.status).toBe(409);
    await second.text();
  });

  it("404s a PATCH against another tenant's canned response", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Mine",
        body: { type: "doc", content: [] },
      }),
    });
    const { id } = (await created.json()) as { id: string };

    const otherTenant = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(otherTenant.user);
    const { app: otherApp } = createApp();

    const response = await otherApp.request(`/api/canned-responses/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(response.status).toBe(404);
  });
});
