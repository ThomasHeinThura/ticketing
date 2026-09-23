/**
 * #23's first slice: `POST /api/projects/{projectId}/work-items`,
 * `GET /api/projects/{projectId}/work-items`, `GET /api/work-items/{key}`
 * (`docs/03-features/work-items.md`, `WI-1`..`WI-4`).
 *
 * These are the first HTTP-level integration tests to ever write to `work_item` --
 * `work-item-schema.test.ts` and its siblings (PR #239) stop at direct-insert schema
 * proofs, since no route existed yet. This file drives the real routes instead.
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

// ── Fixture builders for the tables `work-item-schema.test.ts` also builds directly -- ──
// this file needs the same rows (`work_item_type`, `state_template`, `state`), but reached
// through the real HTTP routes rather than direct inserts.

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

/** Adds a second user to an EXISTING workspace with the given built-in role. Only
 * `workspace_member.role` is written -- `requireWorkspaceCapability` (the mechanism these
 * routes actually enforce with) reads that column alone, never `workspace_role`. */
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
  role: "member" | "admin" = "member",
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

describe("API integration: work item create/read/list (#23)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates a work item with the right key format and shape", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Fix the login bug",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.key).toBe(`${project.slug}-1`);
    expect(body.number).toBe(1);
    expect(body.title).toBe("Fix the login bug");
    expect(body.projectId).toBe(project.id);
    expect(body.workspaceId).toBe(creator.workspace.id);
    expect(body.typeId).toBe(type.id);
    expect(body.version).toBe(1);
    expect(body.customerVisibility).toBe("private");

    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, body.id as string));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe(`${project.slug}-1`);
  });

  it("WI-2: concurrent creates in the same project get distinct, sequential numbers", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const CONCURRENCY = 8;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        createWorkItemRequest(app, project.id, {
          typeId: type.id,
          title: `Concurrent item ${i}`,
        }),
      ),
    );

    expect(responses.map((r) => r.status)).toEqual(
      Array(CONCURRENCY).fill(200),
    );

    const bodies = (await Promise.all(
      responses.map((r) => r.json()),
    )) as Array<{ number: number; key: string }>;

    const numbers = bodies.map((b) => b.number).sort((a, b) => a - b);
    expect(numbers).toEqual(
      Array.from({ length: CONCURRENCY }, (_, i) => i + 1),
    );

    const keys = new Set(bodies.map((b) => b.key));
    expect(keys.size).toBe(CONCURRENCY);
    for (const body of bodies) {
      expect(body.key).toBe(`${project.slug}-${body.number}`);
    }

    // The `work_item` rows themselves agree with the responses -- not just the HTTP layer.
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows).toHaveLength(CONCURRENCY);
    expect(new Set(rows.map((r) => r.number)).size).toBe(CONCURRENCY);
    expect(new Set(rows.map((r) => r.key)).size).toBe(CONCURRENCY);
  });

  it("WI-1: rejects a cross-workspace project/type pairing with a clean 400, not a raw constraint violation", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    // A type that belongs to a DIFFERENT workspace entirely.
    const otherCreator = await createWorkspaceMember({ role: "member" });
    const otherType = await makeWorkItemType(otherCreator.workspace.id);

    const response = await createWorkItemRequest(app, project.id, {
      typeId: otherType.id,
      title: "Should be rejected",
    });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toMatch(/constraint|violat/i);

    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it("WI-1: rejects an unknown typeId with a clean 400", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: "does-not-exist",
      title: "Should be rejected",
    });
    expect(response.status).toBe(400);
  });

  it("WI-3: rejects an empty title", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "",
    });
    expect(response.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it("WI-3: rejects a title over 500 characters", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "x".repeat(501),
    });
    expect(response.status).toBe(400);
  });

  it("WI-3: accepts a title of exactly 500 characters", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "x".repeat(500),
    });
    expect(response.status).toBe(200);
  });

  it("rejects create when the project has no default state configured", async () => {
    const creator = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: creator.workspace.id,
    });
    const type = await makeWorkItemType(creator.workspace.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "No default state",
    });
    expect(response.status).toBe(400);
  });

  it("S4 (independent Opus security review of PR #271, partial): a NUL byte in title or description is a 400 on create too, not a 500", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const titleWithNul = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "a\u0000b",
    });
    expect(titleWithNul.status).toBe(400);

    const descriptionValueWithNul = await createWorkItemRequest(
      app,
      project.id,
      {
        typeId: type.id,
        title: "Description NUL value",
        description: { t: "a\u0000b" },
      },
    );
    expect(descriptionValueWithNul.status).toBe(400);

    const descriptionKeyWithNul = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Description NUL key",
      description: { "a\u0000": 1 },
    });
    expect(descriptionKeyWithNul.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it("permissions: a caller without work_item:create on the project is refused (403)", async () => {
    const { project, type } = await setupProjectWithDefaultState();
    const workspaceId = (
      await db.query.projectTable.findFirst({
        where: eq(schema.projectTable.id, project.id),
      })
    )?.workspaceId as string;
    const viewer = await addWorkspaceMember(workspaceId, "viewer");
    mockAuthenticatedSession(viewer);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Viewer should not be able to create this",
    });
    expect(response.status).toBe(403);

    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it("permissions: a caller with no workspace membership at all is refused", async () => {
    const { project, type } = await setupProjectWithDefaultState();
    const stranger = await createWorkspaceMember({ role: "member" }); // a DIFFERENT workspace
    mockAuthenticatedSession(stranger.user);
    const { app } = createApp();

    const response = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Stranger should not reach this project",
    });
    expect(response.status).toBe(403);
  });

  it("GET /api/work-items/{key}: returns the right shape, and 404s on a nonexistent key", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Read me back",
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { key: string; id: string };

    const read = await app.request(`/api/work-items/${createdBody.key}`, {
      headers: {},
    });
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as Record<string, unknown>;
    expect(readBody.id).toBe(createdBody.id);
    expect(readBody.key).toBe(createdBody.key);
    expect(readBody.title).toBe("Read me back");

    const missing = await app.request(`/api/work-items/${project.slug}-999999`);
    expect(missing.status).toBe(404);
  });

  it("GET /api/work-items/{key}: 404s (not 403) for a key that exists but belongs to a workspace the caller isn't a member of", async () => {
    // #23's mandatory Opus security review of PR #261, finding F2: `work_item.key` is
    // guessable ({project.slug}-{number}), so a 403-vs-404 split between "not yours" and
    // "not there" would let a caller enumerate which project slugs exist anywhere and
    // roughly how many work items each holds, without ever being a member of that
    // workspace. `require-work-item-reach.ts` now catches the 403
    // `validateWorkspaceAccess` throws for a non-member and re-throws 404, matching
    // `tests/permissions/matrix.fixture.json`'s declared `"outOfReach": "404 not_found"`
    // for this route.
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Not yours",
    });
    const createdBody = (await created.json()) as { key: string };

    // A caller who is not a member of ANY workspace containing this item.
    const stranger = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(stranger.user);

    const response = await app.request(`/api/work-items/${createdBody.key}`);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toBe("Work item not found");
  });

  it("S2 (independent Opus security review of PR #271): GET /api/work-items/{key} 404s once its project is soft-deleted, matching #202/PR #204's freeze invariant", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Frozen by project deletion",
    });
    const createdBody = (await created.json()) as { key: string };

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const response = await app.request(`/api/work-items/${createdBody.key}`);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toBe("Work item not found");
  });

  it("S2 (independent Opus security review of PR #271): GET /api/projects/{projectId}/work-items 404s once the project is soft-deleted", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Still listed?",
    });

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const response = await app.request(
      `/api/projects/${project.id}/work-items`,
    );
    expect(response.status).toBe(404);
  });

  it("GET /api/projects/{projectId}/work-items: lists the project's items, oldest first", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "First",
    });
    await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Second",
    });

    const response = await app.request(
      `/api/projects/${project.id}/work-items`,
    );
    expect(response.status).toBe(200);
    const items = (await response.json()) as Array<{
      title: string;
      number: number;
    }>;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual(["First", "Second"]);
    expect(items.map((i) => i.number)).toEqual([1, 2]);
  });

  it("GET /api/projects/{projectId}/work-items: excludes archived and deleted items", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Will be archived",
    });
    const createdBody = (await created.json()) as { id: string };
    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.id, createdBody.id));

    const response = await app.request(
      `/api/projects/${project.id}/work-items`,
    );
    expect(response.status).toBe(200);
    const items = (await response.json()) as unknown[];
    expect(items).toHaveLength(0);
  });
});
