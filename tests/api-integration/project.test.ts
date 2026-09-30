import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createApiKeyFor(
  userId: string,
  permissions: Record<string, string[]> | null,
): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "project settings scope test",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: permissions === null ? null : JSON.stringify(permissions),
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

describe("API integration: project creation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated project creation requests", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request("/api/project", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "workspace-missing",
        name: "Unauthorized Project",
        icon: "Folder",
        slug: "unauthorized-project",
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Unauthorized");
  });

  it("creates a project for a workspace member and seeds default columns", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/project", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Roadmap",
        icon: "FolderKanban",
        slug: "roadmap",
      }),
    });

    expect(response.status).toBe(200);
    const payload =
      (await response.json()) as typeof schema.projectTable.$inferSelect;

    expect(payload).toMatchObject({
      workspaceId: member.workspace.id,
      name: "Roadmap",
      icon: "FolderKanban",
      slug: "roadmap",
      defaultCommentVisibility: "internal",
    });

    const persistedProject = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, payload.id),
    });

    expect(persistedProject).toMatchObject({
      id: payload.id,
      workspaceId: member.workspace.id,
      name: "Roadmap",
      slug: "roadmap",
      defaultCommentVisibility: "internal",
    });

    const columns = await db.query.columnTable.findMany({
      where: eq(schema.columnTable.projectId, payload.id),
      orderBy: (column, { asc }) => [asc(column.position)],
    });

    expect(columns).toHaveLength(4);
    expect(columns.map((column) => column.slug)).toEqual([
      "to-do",
      "in-progress",
      "in-review",
      "done",
    ]);
    expect(columns.map((column) => column.isFinal)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("returns the configured default comment visibility from project detail", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const updateResponse = await app.request(`/api/project/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: project.name,
        icon: project.icon ?? "Layout",
        slug: project.slug,
        description: project.description ?? "",
        defaultCommentVisibility: "public",
      }),
    });

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      id: project.id,
      defaultCommentVisibility: "public",
    });

    const response = await app.request(`/api/project/${project.id}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: project.id,
      defaultCommentVisibility: "public",
    });
  });

  it("requires project:manage_settings for the default comment visibility field only", async () => {
    const lead = await createWorkspaceMember({ role: "lead" });
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: lead.workspace.id,
      role: "lead",
      permission: JSON.stringify({
        project: ["create", "read", "update", "delete", "share"],
      }),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    const { project } = await createProjectFixture({
      workspaceId: lead.workspace.id,
    });
    mockAuthenticatedSession(lead.user);
    const { app } = createApp();

    const settingResponse = await app.request(`/api/project/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: project.name,
        icon: project.icon ?? "Layout",
        slug: project.slug,
        description: project.description ?? "",
        defaultCommentVisibility: "public",
      }),
    });
    expect(settingResponse.status).toBe(403);

    const ordinaryUpdateResponse = await app.request(
      `/api/project/${project.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Lead may update the project name",
          icon: project.icon ?? "Layout",
          slug: project.slug,
          description: project.description ?? "",
        }),
      },
    );
    expect(ordinaryUpdateResponse.status).toBe(200);
  });

  it("intersects default visibility updates with API-key project scopes", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { app } = createApp();
    const updateBody = {
      name: project.name,
      icon: project.icon ?? "Layout",
      slug: project.slug,
      description: project.description ?? "",
      defaultCommentVisibility: "public",
    };

    const restrictedKey = await createApiKeyFor(member.user.id, {
      project: ["update"],
    });
    const restrictedResponse = await app.request(`/api/project/${project.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-api-key": restrictedKey,
      },
      body: JSON.stringify(updateBody),
    });
    expect(restrictedResponse.status).toBe(403);

    const scopedKey = await createApiKeyFor(member.user.id, {
      project: ["update", "manage_settings"],
    });
    const scopedResponse = await app.request(`/api/project/${project.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-api-key": scopedKey,
      },
      body: JSON.stringify(updateBody),
    });
    expect(scopedResponse.status).toBe(200);
    await expect(scopedResponse.json()).resolves.toMatchObject({
      defaultCommentVisibility: "public",
    });
  });

  it("fails closed when an API key has no stored permission map", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const rawKey = await createApiKeyFor(member.user.id, null);
    const { app } = createApp();

    const response = await app.request(`/api/project/${project.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-api-key": rawKey,
      },
      body: JSON.stringify({
        name: project.name,
        icon: project.icon ?? "Layout",
        slug: project.slug,
        description: project.description ?? "",
        defaultCommentVisibility: "public",
      }),
    });

    expect(response.status).toBe(403);
    const persistedProject = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });
    expect(persistedProject?.defaultCommentVisibility).toBe("internal");
  });

  it("rejects project creation for users outside the workspace", async () => {
    const member = await createWorkspaceMember();
    const outsiderId = "user-outsider";

    const outsider = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: outsiderId,
          email: `${outsiderId}@example.com`,
          emailVerified: true,
          name: "Outsider",
        })
        .returning(),
      "outsider",
    );

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await app.request("/api/project", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Forbidden Project",
        icon: "Folder",
        slug: "forbidden-project",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe(
      "You don't have access to this workspace",
    );
  });
});
