/**
 * `POST /api/work-items/{key}/rank` (`docs/03-features/work-items.md` `WI-11`-`WI-13`)
 * -- #23's fourth slice. See `rank-work-item.ts`'s own doc comment for the body-shape
 * judgment call (`beforeId`/`afterId`) and the `WI-13` (customer-organisation scoping)
 * deferral.
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

function rankWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/work-items/${key}/rank`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: work item rank (#23 fourth slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("WI-11: ranking between two neighbours lands strictly in between and bumps version", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string; version: number };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { id: string; key: string };
    const c = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "C",
      })
    ).json()) as { id: string; key: string };

    // `create-work-item.ts` does not assign an increasing `position` (every item
    // defaults to `0`) -- pre-existing, out of this slice's own scope. Seeding distinct
    // positions directly is what makes "strictly between two neighbours" a real,
    // observable midpoint rather than three ties at `0`.
    await db
      .update(schema.workItemTable)
      .set({ position: "1" })
      .where(eq(schema.workItemTable.id, a.id));
    await db
      .update(schema.workItemTable)
      .set({ position: "3" })
      .where(eq(schema.workItemTable.id, c.id));

    const response = await rankWorkItemRequest(app, b.key, {
      beforeId: a.id,
      afterId: c.id,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      key: string;
      position: string;
      version: number;
    };
    expect(body.version).toBe(2);

    const rows = await db
      .select({
        key: schema.workItemTable.key,
        position: schema.workItemTable.position,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    const byKey = new Map(rows.map((r) => [r.key, Number(r.position)]));
    expect(byKey.get(b.key)).toBeGreaterThan(byKey.get(a.key) ?? Number.NaN);
    expect(byKey.get(b.key)).toBeLessThan(byKey.get(c.key) ?? Number.NaN);
  });

  it("ranking with only beforeId places it after that neighbour", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { id: string; key: string };

    const response = await rankWorkItemRequest(app, b.key, { beforeId: a.id });
    expect(response.status).toBe(200);

    const rows = await db
      .select({
        key: schema.workItemTable.key,
        position: schema.workItemTable.position,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    const byKey = new Map(rows.map((r) => [r.key, Number(r.position)]));
    expect(byKey.get(b.key)).toBeGreaterThan(byKey.get(a.key) ?? Number.NaN);
  });

  it("an empty body (neither beforeId nor afterId) is a 400", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Solo",
      })
    ).json()) as { key: string };

    const response = await rankWorkItemRequest(app, created.key, {});
    expect(response.status).toBe(400);
  });

  it("a neighbour id from a different project is refused 400", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const item = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Mine",
      })
    ).json()) as { id: string; key: string };

    const { project: otherProject } = await createProjectFixture({
      workspaceId: creator.workspace.id,
    });
    const otherType = await makeWorkItemType(creator.workspace.id);
    await makeDefaultState(creator.workspace.id, otherProject.id);
    const foreign = (await (
      await createWorkItemRequest(app, otherProject.id, {
        typeId: otherType.id,
        title: "Foreign",
      })
    ).json()) as { id: string; key: string };

    const response = await rankWorkItemRequest(app, item.key, {
      beforeId: foreign.id,
    });
    expect(response.status).toBe(400);
  });

  it("re-ranking an already-ranked item again (idempotent-ish repeat) succeeds and keeps bumping version", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { id: string; key: string };

    const first = await rankWorkItemRequest(app, b.key, { afterId: a.id });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { version: number };
    expect(firstBody.version).toBe(2);

    const second = await rankWorkItemRequest(app, b.key, { afterId: a.id });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { version: number };
    expect(secondBody.version).toBe(3);
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await rankWorkItemRequest(app, `${project.slug}-999999`, {
      afterId: `${project.slug}-1`,
    });
    expect(response.status).toBe(404);
  });

  it("permissions: a caller without work_item:rank is refused 403", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { id: string; key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { id: string; key: string };

    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await rankWorkItemRequest(app, b.key, { afterId: a.id });
    expect(response.status).toBe(403);
  });
});
