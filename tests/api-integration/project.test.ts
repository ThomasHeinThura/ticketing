import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";

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
    });

    const persistedProject = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, payload.id),
    });

    expect(persistedProject).toMatchObject({
      id: payload.id,
      workspaceId: member.workspace.id,
      name: "Roadmap",
      slug: "roadmap",
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

    await prepareAuthenticatedApiFixture(outsider.id);
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

describe("API integration: GET /api/projects/{projectId}/states (VW-8)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function addState(
    workspaceId: string,
    projectId: string,
    options: {
      name: string;
      group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
      position: number;
      isDefault?: boolean;
      templateArchived?: boolean;
      stateArchived?: boolean;
    },
  ) {
    const now = new Date();
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId,
          key: `state-${randomUUID()}`,
          name: options.name,
          group: options.group,
          archivedAt: options.templateArchived ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "addState: template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId,
          stateTemplateId: template.id,
          position: options.position,
          isDefault: options.isDefault ?? false,
          archivedAt: options.stateArchived ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "addState: state",
    );
    return { template, state };
  }

  async function reachableProject(role: "member" | "viewer" = "member") {
    const actor = await createWorkspaceMember({ role });
    const { project } = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    await grantProjectRole(actor.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    return { actor, project };
  }

  it("returns the project's active states in position order, including empty columns and an archived template that is still adopted", async () => {
    const { actor, project } = await reachableProject();
    const wsId = actor.workspace.id;
    // Inserted out of order on purpose: the response order is the stored position, not
    // insertion order or name.
    const done = await addState(wsId, project.id, {
      name: "Done",
      group: "completed",
      position: 3,
    });
    const backlog = await addState(wsId, project.id, {
      name: "Backlog",
      group: "backlog",
      position: 0,
      isDefault: true,
    });
    const inProgress = await addState(wsId, project.id, {
      name: "In progress",
      group: "started",
      position: 2,
      templateArchived: true,
    });
    // An adopted state with no work items at all: an empty board column.
    const ready = await addState(wsId, project.id, {
      name: "Ready",
      group: "unstarted",
      position: 1,
    });

    mockAuthenticatedSession(actor.user);
    const { app } = createApp();
    const response = await app.request(`/api/projects/${project.id}/states`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: backlog.state.id,
        stateTemplateId: backlog.template.id,
        name: "Backlog",
        group: "backlog",
        position: 0,
        isDefault: true,
      },
      {
        id: ready.state.id,
        stateTemplateId: ready.template.id,
        name: "Ready",
        group: "unstarted",
        position: 1,
        isDefault: false,
      },
      {
        id: inProgress.state.id,
        stateTemplateId: inProgress.template.id,
        name: "In progress",
        group: "started",
        position: 2,
        isDefault: false,
      },
      {
        id: done.state.id,
        stateTemplateId: done.template.id,
        name: "Done",
        group: "completed",
        position: 3,
        isDefault: false,
      },
    ]);
  });

  it("omits archived concrete states and returns an empty array for a project with none", async () => {
    const { actor, project } = await reachableProject();
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const none = await app.request(`/api/projects/${project.id}/states`);
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual([]);

    await addState(actor.workspace.id, project.id, {
      name: "Retired",
      group: "started",
      position: 0,
      stateArchived: true,
    });
    const kept = await addState(actor.workspace.id, project.id, {
      name: "Live",
      group: "unstarted",
      position: 1,
    });
    const response = await app.request(`/api/projects/${project.id}/states`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ id: string }>;
    expect(body.map((s) => s.id)).toEqual([kept.state.id]);
  });

  it("does not disclose a project the caller cannot reach (no project membership), or one in another workspace", async () => {
    const { actor, project } = await reachableProject();
    await addState(actor.workspace.id, project.id, {
      name: "Secret",
      group: "backlog",
      position: 0,
      isDefault: true,
    });

    // Same workspace, but explicit project reach was never granted.
    const noReach = await createWorkspaceMember({ role: "member" });
    const sameWorkspaceProject = await createProjectFixture({
      workspaceId: noReach.workspace.id,
    });
    mockAuthenticatedSession(noReach.user);
    const { app } = createApp();
    const unreachable = await app.request(
      `/api/projects/${sameWorkspaceProject.project.id}/states`,
    );
    expect(unreachable.status).toBe(404);
    expect(await unreachable.text()).not.toContain("Secret");

    // A reachable member of another workspace asking for this workspace's project.
    mockAuthenticatedSession(noReach.user);
    const foreign = await app.request(`/api/projects/${project.id}/states`);
    expect([403, 404]).toContain(foreign.status);
    expect(await foreign.text()).not.toContain("Secret");

    const missing = await app.request(`/api/projects/${randomUUID()}/states`);
    expect([400, 404]).toContain(missing.status);
  });

  // Strict `project:read` (canonical built-in roles), not the legacy statement map (#708).
  it.each([
    ["viewer", 200],
    ["member", 200],
    ["lead", 200],
    ["admin", 200],
    ["customer", 403],
  ])(
    "the %s role gets %i under the strict project:read check, with project reach granted",
    async (role, expected) => {
      const actor = await createWorkspaceMember({ role });
      const now = new Date();
      if (role === "lead" || role === "customer") {
        await db.insert(schema.workspaceRoleTable).values({
          workspaceId: actor.workspace.id,
          role,
          permission: JSON.stringify({}),
          isSystem: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      const { project } = await createProjectFixture({
        workspaceId: actor.workspace.id,
      });
      await grantProjectRole(actor.user.id, project.id, [
        "project:read",
        "work_item:read",
      ]);
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();

      const response = await app.request(`/api/projects/${project.id}/states`);
      expect(response.status).toBe(expected);
    },
  );

  it("denies a customer-side identity whose stored legacy map claims project read", async () => {
    // The legacy statement map would say yes; the canonical customer role holds no
    // project:read, so the strict gate must still answer 403.
    const customer = await createWorkspaceMember({ role: "customer" });
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: customer.workspace.id,
      role: "customer",
      permission: JSON.stringify({ project: ["read"] }),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    const { project } = await createProjectFixture({
      workspaceId: customer.workspace.id,
    });
    await grantProjectRole(customer.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(customer.user);
    const { app } = createApp();

    const response = await app.request(`/api/projects/${project.id}/states`);
    expect(response.status).toBe(403);
  });

  it("allows a viewer whose stored legacy map is empty, because the canonical viewer role holds project:read", async () => {
    const viewer = await createWorkspaceMember({ role: "viewer" });
    await db
      .update(schema.workspaceRoleTable)
      .set({ permission: JSON.stringify({}) })
      .where(eq(schema.workspaceRoleTable.workspaceId, viewer.workspace.id));
    const { project } = await createProjectFixture({
      workspaceId: viewer.workspace.id,
    });
    await grantProjectRole(viewer.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(viewer.user);
    const { app } = createApp();

    const response = await app.request(`/api/projects/${project.id}/states`);
    expect(response.status).toBe(200);
  });

  it("requires authentication", async () => {
    const { project } = await reachableProject();
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request(`/api/projects/${project.id}/states`);
    expect(response.status).toBe(401);
  });

  it("does not list states of a soft-deleted project", async () => {
    const { actor, project } = await reachableProject();
    await addState(actor.workspace.id, project.id, {
      name: "Backlog",
      group: "backlog",
      position: 0,
      isDefault: true,
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await app.request(`/api/projects/${project.id}/states`);
    expect(response.status).toBe(404);
  });
});
