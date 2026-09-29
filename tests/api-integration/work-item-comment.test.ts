/**
 * `docs/03-features/comments-and-activity.md` (issue #27): comment CRUD --
 * `POST /api/work-items/{key}/comments`, `PATCH /api/comments/{id}`,
 * `DELETE /api/comments/{id}`. `GET /api/work-items/{key}/activity` and the portal read
 * route are NOT covered here -- see this PR's own body.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  raceProjectArchive,
  raceProjectSoftDelete,
  raceWorkItemSoftDelete,
} from "./helpers/race-soft-delete";

type RecordedEvent = { type: string; data: unknown };
let recordedEvents: RecordedEvent[] = [];
let eventSubscribersInitialized = false;

function initEventSubscribers() {
  if (eventSubscribersInitialized) return;
  eventSubscribersInitialized = true;
  subscribeToEvent("work_item.commented", async (data) => {
    recordedEvents.push({ type: "work_item.commented", data });
  });
}

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
  if (!stateTemplate)
    throw new Error("makeDefaultState: no state_template row");

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
  if (!state) throw new Error("makeDefaultState: no state row");
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
  if (!user) throw new Error("addWorkspaceMember: no user row");

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  if (role !== "owner") {
    const now = new Date();
    await db
      .insert(schema.workspaceRoleTable)
      .values({
        workspaceId,
        role,
        permission: JSON.stringify({}),
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  return user;
}

async function setupWorkItem(role: "member" | "admin" | "viewer" = "member") {
  const creator = await createWorkspaceMember({ role });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  await makeDefaultState(creator.workspace.id, project.id);

  mockAuthenticatedSession(creator.user);
  const { app } = createApp();

  const created = await app.request(`/api/projects/${project.id}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId: type.id, title: "Work item" }),
  });
  const workItem = (await created.json()) as { key: string; id: string };
  return { creator, project, app, workItem };
}

function postComment(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/work-items/${key}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchComment(
  app: ReturnType<typeof createApp>["app"],
  id: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/comments/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteComment(app: ReturnType<typeof createApp>["app"], id: string) {
  return app.request(`/api/comments/${id}`, { method: "DELETE" });
}

describe("API integration: work-item comments (#27)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordedEvents = [];
    initEventSubscribers();
  });

  it("CA-1: posts an internal comment and publishes work_item.commented", async () => {
    const { app, workItem } = await setupWorkItem("member");

    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });

    expect(response.status).toBe(200);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created.visibility).toBe("internal");
    expect(created.workItemId).toBe(workItem.id);
    expect(created.deletedAt).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recordedEvents).toHaveLength(1);
    const event = recordedEvents[0];
    if (!event) throw new Error("expected one recorded event");
    expect(event.type).toBe("work_item.commented");
    expect((event.data as { visibility: string }).visibility).toBe("internal");
  });

  it("posts a public comment when the caller holds comment:create", async () => {
    const { app, workItem } = await setupWorkItem("member");

    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "public",
    });

    expect(response.status).toBe(200);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created.visibility).toBe("public");
  });

  it("#499: project deletion cannot race a comment onto a work item", async () => {
    const { app, project, workItem } = await setupWorkItem("member");

    const race = await raceProjectSoftDelete(
      project.id,
      async () =>
        await postComment(app, workItem.key, {
          body: { type: "doc", content: [] },
          visibility: "public",
        }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const comments = await db
      .select({ id: schema.commentTable.id })
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, workItem.id));
    expect(comments).toHaveLength(0);
    expect(recordedEvents).toHaveLength(0);
  });

  it("403s a caller with no comment:create/comment:create_internal capability", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });

    expect(response.status).toBe(403);
    await response.text();
  });

  it("404s a comment posted to a nonexistent work item key", async () => {
    const { app } = await setupWorkItem("member");
    const response = await postComment(app, "NOPE-999", {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    expect(response.status).toBe(404);
  });

  it("issue #276: 404s a comment posted to a soft-deleted work item, via the shared requireWorkItemReach guard", async () => {
    const { app, workItem } = await setupWorkItem("member");

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, workItem.key));

    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    expect(response.status).toBe(404);
  });

  it("#493: a concurrent soft-delete landing after the reach check cannot slip past this route's own transaction and insert a comment on a dead item", async () => {
    const { app, workItem } = await setupWorkItem("member");

    const race = await raceWorkItemSoftDelete(
      workItem.id,
      async () =>
        await postComment(app, workItem.key, {
          body: { type: "doc", content: [] },
          visibility: "internal",
        }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    const response = race.operation.value;
    // Pre-fix: this route had no in-transaction liveness re-check at all, so the insert
    // landed anyway. Post-fix: the locked re-read sees the now-committed soft-delete and
    // refuses with the same 404 `requireWorkItemReach()` itself would give.
    expect(response.status).toBe(404);

    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, workItem.id));
    expect(comments).toHaveLength(0);
    expect(recordedEvents).toHaveLength(0);
  });

  it("400s a body containing a NUL byte", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [{ type: "text", text: "a\u0000b" }] },
      visibility: "internal",
    });
    expect(response.status).toBe(400);
  });

  it("CA-11: 400s a body over the 256 KiB cap", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const response = await postComment(app, workItem.key, {
      body: {
        type: "doc",
        content: [{ type: "text", text: "x".repeat(300 * 1024) }],
      },
      visibility: "internal",
    });
    expect(response.status).toBe(400);
  });

  it("CA-17: the author may edit their own comment within the 15-minute window", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const response = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });

    expect(response.status).toBe(200);
    const updated = (await response.json()) as Record<string, unknown>;
    expect(updated.editedAt).not.toBeNull();

    const [version] = await db
      .select()
      .from(schema.commentVersionTable)
      .where(eq(schema.commentVersionTable.commentId, id));
    expect(version?.number).toBe(1);
  });

  it("CA-17: refuses an edit outside the 15-minute window for comment:update_own", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    await db
      .update(schema.commentTable)
      .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(schema.commentTable.id, id));

    const response = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(response.status).toBe(403);
  });

  it("refuses an edit by a non-author holding only comment:update_own", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const otherUser = await addWorkspaceMember(creator.workspace.id, "member");
    mockAuthenticatedSession(otherUser);

    const response = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(response.status).toBe(403);
  });

  it("comment:update_any edits anyone's comment, any time", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    await db
      .update(schema.commentTable)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.commentTable.id, id));

    const admin = await addWorkspaceMember(creator.workspace.id, "admin");
    mockAuthenticatedSession(admin);

    const response = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(response.status).toBe(200);
  });

  it("CA-18: the author may delete their own comment; it tombstones, body cleared", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const response = await deleteComment(app, id);
    expect(response.status).toBe(200);
    const deleted = (await response.json()) as Record<string, unknown>;
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.body).toBeNull();

    // Idempotent: deleting again re-returns the same tombstoned row, not an error.
    const again = await deleteComment(app, id);
    expect(again.status).toBe(200);
  });

  it("does not return a tombstoned comment to a member without delete authority", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const ownerDelete = await deleteComment(app, id);
    expect(ownerDelete.status).toBe(200);
    await ownerDelete.text();

    const otherMember = await addWorkspaceMember(
      creator.workspace.id,
      "member",
    );
    mockAuthenticatedSession(otherMember);
    const unauthorizedDelete = await deleteComment(app, id);
    expect(unauthorizedDelete.status).toBe(403);
    await unauthorizedDelete.text();
  });

  it("refuses a delete by a non-author holding only comment:delete_own", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const otherUser = await addWorkspaceMember(creator.workspace.id, "member");
    mockAuthenticatedSession(otherUser);

    const response = await deleteComment(app, id);
    expect(response.status).toBe(403);
  });

  it("404s an update/delete against a comment id from a different tenant", async () => {
    const { app: appA, workItem } = await setupWorkItem("member");
    const created = await postComment(appA, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const otherTenant = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(otherTenant.user);
    const { app: appB } = createApp();

    const patchResponse = await patchComment(appB, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await deleteComment(appB, id);
    expect(deleteResponse.status).toBe(404);
  });

  it("#202's freeze invariant: 404s update/delete against a comment whose project is soft-deleted, row unchanged", async () => {
    const { app, workItem, project } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const [before] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    if (!before) throw new Error("expected comment row before soft delete");

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const patchResponse = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await deleteComment(app, id);
    expect(deleteResponse.status).toBe(404);

    const [after] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(after).toEqual(before);
  });

  it("issue #480: 404s update/delete against a comment whose work item is soft-deleted, row unchanged", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const [before] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    if (!before) throw new Error("expected comment row before soft delete");

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, workItem.key));

    const patchResponse = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await deleteComment(app, id);
    expect(deleteResponse.status).toBe(404);

    const [after] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(after).toEqual(before);
  });

  it("issue #480: 404s update/delete against a comment whose work item is archived, row unchanged", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const [before] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    if (!before) throw new Error("expected comment row before archiving");

    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.key, workItem.key));

    const patchResponse = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await deleteComment(app, id);
    expect(deleteResponse.status).toBe(404);

    const [after] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(after).toEqual(before);
  });

  it("#499: comment edit and delete wait for project archive and leave the comment unchanged", async () => {
    const { app, project, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };
    const [before] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    if (!before) throw new Error("expected comment row before project archive");

    const race = await raceProjectArchive(project.id, async () =>
      patchComment(app, id, {
        body: {
          type: "doc",
          content: [{ type: "paragraph", text: "changed" }],
        },
      }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const deleteResponse = await deleteComment(app, id);
    expect(deleteResponse.status).toBe(404);
    const [after] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(after).toEqual(before);
    const versions = await db
      .select()
      .from(schema.commentVersionTable)
      .where(eq(schema.commentVersionTable.commentId, id));
    expect(versions).toHaveLength(0);
  });
});
