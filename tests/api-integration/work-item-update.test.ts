/**
 * `PATCH /api/work-items/{key}` (`docs/03-features/work-items.md`, `WI-7`/`WI-8`) --
 * #23's second slice. WI-6 (activity logging) is out of scope -- see this PR's body --
 * and this file asserts nothing about `activity` rows.
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
  if (!stateTemplate) {
    throw new Error("makeDefaultState: state_template insert returned no row");
  }

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
  if (!state) throw new Error("makeDefaultState: state insert returned no row");
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
  if (!user) throw new Error("addWorkspaceMember: user insert returned no row");

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  return user;
}

async function setupProjectWithDefaultState(
  role: "member" | "admin" | "viewer" = "member",
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

function updateWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
  ifMatch: string | number,
) {
  return app.request(`/api/work-items/${key}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": `"${ifMatch}"`,
    },
    body: JSON.stringify(body),
  });
}

describe("API integration: work item update (#23 second slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("WI-8: updates title/description/priority/dates and increments version by exactly 1", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Original title",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };
    expect(createdBody.version).toBe(1);

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      {
        title: "Updated title",
        description: { type: "doc", content: [] },
        priority: "high",
        startDate: "2026-01-01T00:00:00.000Z",
        dueDate: "2026-02-01T00:00:00.000Z",
      },
      1,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.title).toBe("Updated title");
    expect(body.priority).toBe("high");
    expect(body.version).toBe(2);
    expect(body.description).toEqual({ type: "doc", content: [] });

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.version).toBe(2);
    expect(row?.title).toBe("Updated title");
  });

  it("WI-8: a partial update changes only the supplied fields", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Keep this title",
      priority: "low",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { priority: "urgent" },
      createdBody.version,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.title).toBe("Keep this title");
    expect(body.priority).toBe("urgent");
    expect(body.version).toBe(2);
  });

  it("rejects a body with no fields supplied", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Empty patch",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      {},
      createdBody.version,
    );
    expect(response.status).toBe(400);
  });

  it("rejects a request with no If-Match header", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "No If-Match",
    });
    const createdBody = (await created.json()) as { key: string };

    const response = await app.request(`/api/work-items/${createdBody.key}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Should be rejected" }),
    });
    expect(response.status).toBe(400);
  });

  it("WI-7: a stale If-Match returns 409 with both the asserted and current versions", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Will be edited",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    // A real update, moving the row to version 2.
    const first = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "First edit" },
      createdBody.version,
    );
    expect(first.status).toBe(200);

    // Same asserted version (1) again -- now stale.
    const stale = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Stale edit" },
      createdBody.version,
    );
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as {
      assertedVersion: number;
      currentVersion: number;
    };
    expect(staleBody.assertedVersion).toBe(1);
    expect(staleBody.currentVersion).toBe(2);

    // The stale write did not apply.
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.title).toBe("First edit");
    expect(row?.version).toBe(2);
  });

  it("cross-workspace 404: a key that exists but belongs to a workspace the caller isn't a member of", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Not yours",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const stranger = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(stranger.user);

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should not reach this" },
      createdBody.version,
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toBe("Work item not found");
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await updateWorkItemRequest(
      app,
      `${project.slug}-999999`,
      { title: "Nope" },
      1,
    );
    expect(response.status).toBe(404);
  });

  it("permissions: a caller without work_item:update on the project is refused (403)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Viewer should not edit this",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should be refused" },
      createdBody.version,
    );
    expect(response.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.title).toBe("Viewer should not edit this");
  });

  it("WI-7: a concurrent-update race asserting the same starting version resolves to exactly one 200 and one 409, never both or neither", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Race target",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };
    expect(createdBody.version).toBe(1);

    const [responseA, responseB] = await Promise.all([
      updateWorkItemRequest(app, createdBody.key, { title: "Writer A" }, 1),
      updateWorkItemRequest(app, createdBody.key, { title: "Writer B" }, 1),
    ]);

    const statuses = [responseA.status, responseB.status].sort();
    expect(statuses).toEqual([200, 409]);

    // The row itself ends up at version 2, with exactly one writer's title -- the CAS
    // genuinely serialised the two concurrent writers rather than both applying (which
    // would silently double-increment or corrupt the row) or both being rejected.
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.version).toBe(2);
    expect(["Writer A", "Writer B"]).toContain(row?.title);

    const winner = responseA.status === 200 ? responseA : responseB;
    const loser = responseA.status === 409 ? responseA : responseB;
    const winnerBody = (await winner.json()) as { title: string };
    expect(winnerBody.title).toBe(row?.title);
    const loserBody = (await loser.json()) as {
      assertedVersion: number;
      currentVersion: number;
    };
    expect(loserBody.assertedVersion).toBe(1);
    expect(loserBody.currentVersion).toBe(2);
  });
});
