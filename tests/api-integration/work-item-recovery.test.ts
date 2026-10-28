import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { seedWorkspaceBuiltInRoles } from "../../apps/api/src/workspace/built-in-roles.repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantProjectRole,
  grantWorkItemProjectAccess,
} from "./helpers/fixtures";
import { ensureCreationWorkflow } from "./helpers/workflow";

async function setup() {
  const creator = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  await grantWorkItemProjectAccess(creator.user.id, project.id);
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId: creator.workspace.id,
      key: `recovery-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("work-item recovery type fixture missing");
  const [template] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId: creator.workspace.id,
      key: `recovery-state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!template) throw new Error("work-item recovery state template missing");
  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId: project.id,
      stateTemplateId: template.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("work-item recovery state missing");
  await ensureCreationWorkflow({
    workspaceId: creator.workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  mockAuthenticatedSession(creator.user);
  const { app } = createApp();
  const response = await app.request(`/api/projects/${project.id}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId: type.id, title: "Recoverable item" }),
  });
  expect(response.status).toBe(200);
  const item = (await response.json()) as {
    id: string;
    key: string;
    version: number;
  };
  return { app, creator, project, item };
}

describe("API integration: work-item lifecycle recovery", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("hides deleted rows by default, restores with version check, and retains archive state", async () => {
    const f = await setup();
    const archivedAt = new Date(Date.now() - 60_000);
    const deletedAt = new Date();
    await db
      .update(schema.workItemTable)
      .set({ archivedAt, deletedAt, version: 2 })
      .where(eq(schema.workItemTable.id, f.item.id));

    const hiddenDetail = await f.app.request(`/api/work-items/${f.item.key}`);
    expect(hiddenDetail.status).toBe(404);
    const active = await f.app.request(
      `/api/projects/${f.project.id}/work-items`,
    );
    expect(active.status).toBe(200);
    expect(await active.json()).toMatchObject({ data: [] });

    const deleted = await f.app.request(
      `/api/projects/${f.project.id}/work-items?lifecycle=deleted`,
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      data: [
        { id: f.item.id, key: f.item.key, deletedAt: deletedAt.toISOString() },
      ],
    });

    const restored = await f.app.request(
      `/api/v2/work-items/${f.item.key}/restore`,
      {
        method: "POST",
        headers: { "If-Match": '"2"' },
      },
    );
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      id: f.item.id,
      deletedAt: null,
      archivedAt: archivedAt.toISOString(),
      version: 3,
    });

    const archivedRead = await f.app.request(`/api/work-items/${f.item.key}`);
    expect(archivedRead.status).toBe(200);
    const archivedRows = await f.app.request(
      `/api/projects/${f.project.id}/work-items?lifecycle=archived`,
    );
    expect(await archivedRows.json()).toMatchObject({
      data: [
        {
          id: f.item.id,
          archivedAt: archivedAt.toISOString(),
          deletedAt: null,
        },
      ],
    });
    const write = await f.app.request(`/api/work-items/${f.item.key}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "If-Match": '"3"',
      },
      body: JSON.stringify({ title: "Must remain read-only" }),
    });
    expect(write.status).toBe(404);
  });

  it("keeps archived detail read-only subresources visible to current project readers", async () => {
    const f = await setup();
    const archivedAt = new Date(Date.now() - 60_000);
    await db
      .update(schema.workItemTable)
      .set({ archivedAt })
      .where(eq(schema.workItemTable.id, f.item.id));

    const archivedReadPaths = [
      `/api/work-items/${f.item.key}/labels`,
      `/api/work-items/${f.item.key}/sla`,
      `/api/work-items/${f.item.key}/children`,
      `/api/work-items/${f.item.key}/relations`,
      `/api/work-items/${f.item.key}/activity`,
      `/api/work-items/${f.item.key}/comments/mention-candidates?visibility=internal`,
      `/api/work-items/${f.item.key}/attachments`,
    ];
    for (const path of archivedReadPaths) {
      const response = await f.app.request(path);
      expect(response.status, path).toBe(200);
    }

    const archivedWrite = await f.app.request(
      `/api/work-items/${f.item.key}/comments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: "must remain read-only",
          visibility: "internal",
        }),
      },
    );
    expect(archivedWrite.status).toBe(404);
    const mentionPreflight = await f.app.request(
      `/api/work-items/${f.item.key}/comments/mention-preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(mentionPreflight.status).toBe(404);

    const stranger = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(stranger.user);
    const strangerApp = createApp().app;
    const outOfReach = await strangerApp.request(
      `/api/work-items/${f.item.key}/activity`,
    );
    expect(outOfReach.status).toBe(404);

    mockAuthenticatedSession(f.creator.user);
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, f.item.id));
    for (const path of [
      `/api/work-items/${f.item.key}`,
      ...archivedReadPaths,
    ]) {
      const response = await f.app.request(path);
      expect(response.status, path).toBe(404);
    }
  });

  it("rejects stale versions and does not alter the deleted row", async () => {
    const f = await setup();
    const deletedAt = new Date();
    await db
      .update(schema.workItemTable)
      .set({ deletedAt, version: 4 })
      .where(eq(schema.workItemTable.id, f.item.id));
    const response = await f.app.request(
      `/api/v2/work-items/${f.item.key}/restore`,
      { method: "POST", headers: { "If-Match": '"3"' } },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      assertedVersion: 3,
      currentVersion: 4,
    });
    const saved = await db.query.workItemTable.findFirst({
      where: eq(schema.workItemTable.id, f.item.id),
    });
    expect(saved).toMatchObject({ deletedAt, version: 4 });
  });

  it("requires project recovery before restoring a work item under that project", async () => {
    const f = await setup();
    await grantProjectManageAccess(f.creator.user.id, f.project.id);
    const deletedAt = new Date();
    await db
      .update(schema.workItemTable)
      .set({ deletedAt, version: 2 })
      .where(eq(schema.workItemTable.id, f.item.id));
    await db
      .update(schema.projectTable)
      .set({
        deletedAt,
        purgeAfter: new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      })
      .where(eq(schema.projectTable.id, f.project.id));

    const blocked = await f.app.request(
      `/api/v2/work-items/${f.item.key}/restore`,
      { method: "POST", headers: { "If-Match": '"2"' } },
    );
    expect(blocked.status).toBe(404);

    const projectRestored = await f.app.request(
      `/api/project/${f.project.id}/restore`,
      { method: "PUT" },
    );
    expect(projectRestored.status).toBe(200);
    const itemRestored = await f.app.request(
      `/api/v2/work-items/${f.item.key}/restore`,
      { method: "POST", headers: { "If-Match": '"2"' } },
    );
    expect(itemRestored.status).toBe(200);
    expect(await itemRestored.json()).toMatchObject({
      id: f.item.id,
      deletedAt: null,
      projectId: f.project.id,
    });
  });

  it("masks out-of-reach restore targets and denies an in-reach viewer without work_item:update", async () => {
    const f = await setup();
    const deletedAt = new Date();
    await db
      .update(schema.workItemTable)
      .set({ deletedAt, version: 2 })
      .where(eq(schema.workItemTable.id, f.item.id));

    const viewer = await createWorkspaceMember({ role: "viewer" });
    await seedWorkspaceBuiltInRoles(db, f.creator.workspace.id);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: f.creator.workspace.id,
      userId: viewer.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(viewer.user);
    const { app } = createApp();

    const outOfReach = await app.request(
      `/api/v2/work-items/${f.item.key}/restore`,
      { method: "POST", headers: { "If-Match": '"2"' } },
    );
    expect(outOfReach.status).toBe(404);

    await grantProjectRole(viewer.user.id, f.project.id, [
      "project:read",
      "work_item:read",
    ]);
    const inReachWithoutUpdate = await app.request(
      `/api/v2/work-items/${f.item.key}/restore`,
      { method: "POST", headers: { "If-Match": '"2"' } },
    );
    expect(inReachWithoutUpdate.status).toBe(403);
    const saved = await db.query.workItemTable.findFirst({
      where: eq(schema.workItemTable.id, f.item.id),
    });
    expect(saved).toMatchObject({ deletedAt, version: 2 });
  });
});
