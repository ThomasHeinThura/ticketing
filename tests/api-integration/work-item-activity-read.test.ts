/**
 * `GET /api/work-items/{key}/activity` (`docs/03-features/work-items.md` `WI-6`, issue
 * #292) -- #23's fourth slice, the READ side over the already-merged write path
 * (`activity.ts`, wired into create/update/assign).
 */
import { randomUUID } from "node:crypto";
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

async function setupProjectWithDefaultState() {
  const creator = await createWorkspaceMember({ role: "admin" });
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
    headers: { "content-type": "application/json", "if-match": `"${ifMatch}"` },
    body: JSON.stringify(body),
  });
}

function activityRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  query = "",
) {
  return app.request(`/api/work-items/${key}/activity${query}`);
}

describe("API integration: work item activity read (#23 fourth slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns activity rows already written by update, newest first", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Original",
      })
    ).json()) as { key: string; version: number };

    await updateWorkItemRequest(
      app,
      created.key,
      { title: "First edit" },
      created.version,
    );
    await updateWorkItemRequest(
      app,
      created.key,
      { title: "Second edit" },
      created.version + 1,
    );

    const response = await activityRequest(app, created.key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ verb: string; field: string | null; newValue: unknown }>;
      page: { hasMore: boolean; nextCursor: string | null };
    };
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    // Newest first: the SECOND edit's title-change row comes before the first's.
    const titleRows = body.data.filter((row) => row.field === "title");
    expect(titleRows[0]?.newValue).toBe("Second edit");
    expect(titleRows[1]?.newValue).toBe("First edit");
  });

  it("no seq field is ever exposed on a row", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "No leaking seq",
      })
    ).json()) as { key: string };

    const response = await activityRequest(app, created.key);
    const body = (await response.json()) as {
      data: Array<Record<string, unknown>>;
    };
    for (const row of body.data) {
      expect(row).not.toHaveProperty("seq");
    }
  });

  it("pagination: limit=1 pages through every row without duplicates or gaps", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Paged",
      })
    ).json()) as { key: string; version: number };
    await updateWorkItemRequest(
      app,
      created.key,
      { title: "Edit 1" },
      created.version,
    );
    await updateWorkItemRequest(
      app,
      created.key,
      { title: "Edit 2" },
      created.version + 1,
    );

    const seenIds = new Set<string>();
    let cursor: string | null = null;
    let hasMore = true;
    let pages = 0;
    while (hasMore) {
      pages += 1;
      expect(pages).toBeLessThan(20); // safety valve against an infinite loop
      const query = cursor
        ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "?limit=1";
      const response = await activityRequest(app, created.key, query);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: Array<{ id: string }>;
        page: { hasMore: boolean; nextCursor: string | null };
      };
      expect(body.data).toHaveLength(1);
      for (const row of body.data) {
        expect(seenIds.has(row.id)).toBe(false);
        seenIds.add(row.id);
      }
      hasMore = body.page.hasMore;
      cursor = body.page.nextCursor;
    }
    expect(seenIds.size).toBeGreaterThanOrEqual(3); // created + 2 title edits
  });

  it("a malformed cursor is a 400, not a 500", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Bad cursor",
      })
    ).json()) as { key: string };

    const response = await activityRequest(
      app,
      created.key,
      "?cursor=not-valid-base64url-json",
    );
    expect(response.status).toBe(400);
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await activityRequest(app, `${project.slug}-999999`);
    expect(response.status).toBe(404);
  });

  it("cross-workspace 404: a key that exists but belongs to another workspace", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Not yours",
      })
    ).json()) as { key: string };

    const stranger = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(stranger.user);

    const response = await activityRequest(app, created.key);
    expect(response.status).toBe(404);
  });
});
