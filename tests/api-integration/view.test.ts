import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

/** `saved_view.created_by`/`user_preference.person_id` need a real `person` row for the
 * member's own `user_id` -- `createWorkspaceMember` seeds `workspace_member`, not
 * `person`. */
async function addPerson(userId: string) {
  const organisation = await ensureInternalOrganisation();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({ userId, organisationId: organisation.id, side: "staff" })
      .returning(),
    "addPerson: person",
  );
}

describe("API integration: saved views", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated access", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request("/api/views?workspaceId=whatever");
    expect(response.status).toBe(401);
  });

  it("creates a private saved view and returns it in the owner's list", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "My triage queue",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item", filter: { state: "started" } },
      }),
    });

    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      id: string;
      visibility: string;
    };
    expect(created.visibility).toBe("private");

    const listResponse = await app.request(
      `/api/views?workspaceId=${member.workspace.id}`,
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { id: string }[];
    expect(list.map((v) => v.id)).toContain(created.id);

    const persisted = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(persisted).toMatchObject({
      workspaceId: member.workspace.id,
      name: "My triage queue",
      visibility: "private",
    });
  });

  it("rejects a scopeId naming a project outside the workspace", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Bad scope",
        scope: "project",
        scopeId: "project-does-not-exist",
        layout: "board",
        query: { entity: "work_item" },
      }),
    });

    expect(response.status).toBe(400);
  });

  it("hides a private view from another workspace member, and 404s the direct read", async () => {
    const owner = await createWorkspaceMember();
    await addPerson(owner.user.id);
    const otherUserId = "user-view-other";
    const other = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: otherUserId,
          email: `${otherUserId}@example.com`,
          emailVerified: true,
          name: "Other Member",
        })
        .returning(),
      "other user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: other.id,
      role: "member",
      joinedAt: new Date(),
    });
    // `owner` already seeded the "member" `workspace_role` row via `createWorkspaceMember`
    // (default role); a second row for the same (workspaceId, role) pair would violate
    // its own unique constraint.
    await addPerson(other.id);

    mockAuthenticatedSession(owner.user);
    const { app: ownerApp } = createApp();
    const createResponse = await ownerApp.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        name: "Private queue",
        scope: "workspace",
        scopeId: owner.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    mockAuthenticatedSession(other);
    const { app: otherApp } = createApp();

    const listResponse = await otherApp.request(
      `/api/views?workspaceId=${owner.workspace.id}`,
    );
    const list = (await listResponse.json()) as { id: string }[];
    expect(list.map((v) => v.id)).not.toContain(created.id);

    const getResponse = await otherApp.request(`/api/views/${created.id}`);
    expect(getResponse.status).toBe(404);
  });

  it("refuses an edit from a non-owner without workspace:manage_settings", async () => {
    const owner = await createWorkspaceMember();
    await addPerson(owner.user.id);
    const editorUserId = "user-view-editor";
    const editor = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: editorUserId,
          email: `${editorUserId}@example.com`,
          emailVerified: true,
          name: "Editor",
        })
        .returning(),
      "editor user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: editor.id,
      role: "member",
      joinedAt: new Date(),
    });
    await addPerson(editor.id);

    mockAuthenticatedSession(owner.user);
    const { app: ownerApp } = createApp();
    const createResponse = await ownerApp.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        name: "Owner's view",
        scope: "workspace",
        scopeId: owner.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    mockAuthenticatedSession(editor);
    const { app: editorApp } = createApp();
    const updateResponse = await editorApp.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hijacked name" }),
    });
    expect(updateResponse.status).toBe(403);
  });

  it("lets the owner update and delete their own view (delete answers 202)", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Original name",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    const updateResponse = await app.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()) as { name: string }).toMatchObject({
      name: "Renamed",
    });

    const deleteResponse = await app.request(`/api/views/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(202);

    const persisted = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(persisted).toBeUndefined();
  });

  it("toggles a view's pin state, persisted per person per workspace", async () => {
    const member = await createWorkspaceMember();
    const person = await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Pin me",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    const pinResponse = await app.request(`/api/views/${created.id}/pin`, {
      method: "POST",
    });
    expect(pinResponse.status).toBe(200);
    expect(
      (await pinResponse.json()) as { pinnedViewIds: string[] },
    ).toMatchObject({ pinnedViewIds: [created.id] });

    const persisted = await db.query.userPreferenceTable.findFirst({
      where: (row, { eq }) => eq(row.personId, person.id),
    });
    expect(persisted?.value).toEqual([created.id]);

    const unpinResponse = await app.request(`/api/views/${created.id}/pin`, {
      method: "POST",
    });
    expect(
      (await unpinResponse.json()) as { pinnedViewIds: string[] },
    ).toMatchObject({ pinnedViewIds: [] });
  });
});
