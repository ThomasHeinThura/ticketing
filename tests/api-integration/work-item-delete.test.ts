/**
 * `DELETE /api/work-items/{key}` (`docs/03-features/work-items.md` `WI-21`-`WI-23`) --
 * #23's fourth slice.
 *
 * KNOWN DEVIATION covered here explicitly, not silently: this route does a plain,
 * immediate soft-delete rather than `pending-actions.md`'s `202`/browser-approval flow.
 * See `delete-work-item.ts`'s own doc comment and issue #428 for the full reasoning.
 * These tests assert the ACTUAL behaviour (immediate 200 + `deleted_at` set), not the
 * spec's aspirational one.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!stateTemplate) throw new Error("makeDefaultState: state_template");
  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state");
  return state;
}

async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "Integration Test User",
    })
    .returning();
  if (!user) throw new Error("addWorkspaceMember: user");

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  if (role !== "owner") {
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role,
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return user;
}

async function setupProjectWithDefaultState(
  role: "member" | "admin" | "viewer" = "admin",
) {
  const creator = await createWorkspaceMember({ role });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  return { creator, project, type, state };
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
) {
  return app.request(`/api/work-items/${key}`, { method: "DELETE" });
}

describe("API integration: work item delete (#23 fourth slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("WI-21: soft-deletes -- 200, deletedAt set, row still exists", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Delete me",
    });
    const { key } = (await created.json()) as { key: string };

    const response = await deleteWorkItemRequest(app, key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { key: string; deletedAt: string };
    expect(body.key).toBe(key);
    expect(body.deletedAt).toBeTruthy();

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row).toBeDefined();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("a deleted item's deletedAt is visible on a direct GET (get-work-item.ts does not filter deletedAt today -- pre-existing, out of this slice's scope: the default LIST/board filters already exclude it, WI-21)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Gone after delete",
    });
    const { key } = (await created.json()) as { key: string };

    await deleteWorkItemRequest(app, key);

    const getResponse = await app.request(`/api/work-items/${key}`);
    expect(getResponse.status).toBe(200);
    const body = (await getResponse.json()) as { deletedAt: string | null };
    expect(body.deletedAt).toBeTruthy();
  });

  it("idempotency: deleting an already-deleted item is a 404, not a 200", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Delete twice",
    });
    const { key } = (await created.json()) as { key: string };

    const first = await deleteWorkItemRequest(app, key);
    expect(first.status).toBe(200);

    const second = await deleteWorkItemRequest(app, key);
    expect(second.status).toBe(404);
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await deleteWorkItemRequest(app, `${project.slug}-999999`);
    expect(response.status).toBe(404);
  });

  it("cross-workspace 404: a key that exists but belongs to another workspace", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Not yours",
    });
    const { key } = (await created.json()) as { key: string };

    const stranger = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(stranger.user);

    const response = await deleteWorkItemRequest(app, key);
    expect(response.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.deletedAt).toBeNull();
  });

  it("permissions: a caller without work_item:delete is refused 403, and the row is unchanged", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Viewer should not delete this",
    });
    const { key } = (await created.json()) as { key: string };

    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await deleteWorkItemRequest(app, key);
    expect(response.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.deletedAt).toBeNull();
  });

  it("writes a work_item.deleted audit row", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Audited delete",
    });
    const { key } = (await created.json()) as { key: string };

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));

    const response = await deleteWorkItemRequest(app, key);
    expect(response.status).toBe(200);

    const auditRows = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, row?.id ?? ""));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("work_item.deleted");
    expect(auditRows[0]?.entityType).toBe("work_item");
  });
});
