import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { createCalendar } from "../../apps/api/src/service-calendar/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";

const windows = {
  mon: [{ from: 540, to: 1020 }],
  tue: [{ from: 540, to: 1020 }],
  wed: [{ from: 540, to: 1020 }],
  thu: [{ from: 540, to: 1020 }],
  fri: [{ from: 540, to: 1020 }],
};

async function makeCalendar(workspaceId: string, actorId: string) {
  return createCalendar({
    workspaceId,
    name: "Support coverage",
    timezone: "UTC",
    windows,
    holidays: [],
    actor: { actorId, actorType: "person", apiKeyId: null },
  });
}

async function createProjectRequest(
  workspaceId: string,
  body: Record<string, unknown>,
) {
  const { app } = createApp();
  return app.request("/api/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      name: "Managed support",
      icon: "Folder",
      slug: "managed-support",
      kind: "managed_service",
      ...body,
    }),
  });
}

describe("API integration: managed-service project configuration", () => {
  beforeEach(async () => resetTestDatabase());

  it("enforces PR-9 and same-workspace calendar binding on create", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const foreign = await createWorkspaceMember({ role: "admin" });
    const calendar = await makeCalendar(owner.workspace.id, owner.user.id);
    const foreignCalendar = await makeCalendar(
      foreign.workspace.id,
      foreign.user.id,
    );
    mockAuthenticatedSession(owner.user);

    const missing = await createProjectRequest(owner.workspace.id, {});
    expect(missing.status).toBe(422);
    await expect(missing.text()).resolves.toContain("PR-9");

    const wrongWorkspace = await createProjectRequest(owner.workspace.id, {
      supportLevel: "L1",
      serviceCalendarId: foreignCalendar.id,
    });
    expect(wrongWorkspace.status).toBe(422);

    const created = await createProjectRequest(owner.workspace.id, {
      supportLevel: "L2",
      serviceCalendarId: calendar.id,
    });
    expect(created.status).toBe(200);
    const result =
      (await created.json()) as typeof schema.projectTable.$inferSelect;
    expect(result).toMatchObject({
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: calendar.id,
      health: null,
    });
    const persisted = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, result.id),
    });
    expect(persisted).toMatchObject({
      workspaceId: owner.workspace.id,
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: calendar.id,
    });
  });

  it("exposes nullable RAG health through project read/update routes", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const update = await app.request(`/api/project/${project.id}/health`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ health: "amber" }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toEqual({ health: "amber" });

    const read = await app.request(`/api/project/${project.id}/health`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({ health: "amber" });

    const clear = await app.request(`/api/project/${project.id}/health`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ health: null }),
    });
    expect(clear.status).toBe(200);
    await expect(clear.json()).resolves.toEqual({ health: null });
  });
});
