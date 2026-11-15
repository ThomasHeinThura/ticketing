import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessToWorkspaceMembers,
  grantWorkItemProjectAccess,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";
import {
  deleteThroughApproval,
  ensureAgentSession,
} from "./helpers/pending-deletion";
import { upsertWorkspaceRoleRows } from "./helpers/workspace-role-rows";

type CreateTaskBody = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  status: string;
};

async function seedTask(
  projectId: string,
  columnId: string | null,
  userId?: string,
  status = "to-do",
) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: "Seeded task",
        description: "Existing",
        priority: "medium",
        status,
        columnId,
        number: 1,
        position: 1,
        ...(userId ? { userId } : {}),
      })
      .returning(),
    "seedTask",
  );
}

async function createWorkspaceRoleRow(
  workspaceId: string,
  role: string,
  permission: Record<string, string[]> | string,
) {
  // Delete-then-insert rather than a blind insert: `createWorkspaceMember` auto-seeds the
  // rows for default role names (issue #66), so a test that overrides one of those roles'
  // permissions (e.g. "viewer") would otherwise leave TWO rows for the same (workspaceId,
  // role) pair. Owner decision, 23 Oct: the helper writes the canonical `role` row too, which
  // is where a custom role's capabilities live.
  await upsertWorkspaceRoleRows(workspaceId, role, permission);
}

async function postCreateTask(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Partial<CreateTaskBody> = {},
) {
  return app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "RBAC probe",
      description: "",
      priority: "low",
      status: "to-do",
      ...body,
    }),
  });
}

describe("API integration: workspace RBAC enforcement", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("built-in roles", () => {
    it("allows a member to create a task (member role grants work_item:create)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("blocks a viewer from creating a task (viewer role lacks work_item:create)", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe("Insufficient permissions");

      const persisted = await db.query.taskTable.findFirst({
        where: and(
          eq(schema.taskTable.projectId, project.id),
          eq(schema.taskTable.title, "RBAC probe"),
        ),
      });
      expect(persisted).toBeUndefined();
    });

    it("blocks a member from deleting a task (member role lacks work_item:delete)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);

      const stillThere = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(stillThere).toBeDefined();
    });

    it("lets an admin through to the retired task delete, which answers 410 (admin role grants work_item:delete)", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      // Legacy `DELETE /api/task/{id}` is retired (410 Gone). An admin still passes the
      // work_item:delete authority check (a member gets 403 above), reaches the Gone
      // handler, and nothing is deleted.
      const response = await app.request(`/api/task/${task.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(410);

      const kept = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(kept).toBeDefined();
    });

    it.each([
      ["To Do", "to-do", "todo"],
      ["In Progress", "in-progress", "inProgress"],
      ["In Review", "in-review", "inReview"],
      ["Done", "done", "done"],
    ] as const)(
      "lets an owner through to the retired task delete (410) from %s",
      async (_label, status, columnKey) => {
        const member = await createWorkspaceMember({ role: "owner" });
        const { project, columns } = await createProjectFixture({
          workspaceId: member.workspace.id,
        });
        await grantProjectAccessToWorkspaceMembers(
          member.workspace.id,
          project.id,
        );
        const task = await seedTask(
          project.id,
          columns[columnKey].id,
          undefined,
          status,
        );

        mockAuthenticatedSession(member.user);
        const { app } = createApp();

        const response = await app.request(`/api/task/${task.id}`, {
          method: "DELETE",
        });
        // Retired legacy route: the owner passes authorization, the answer is 410 Gone,
        // and the task (in every column) is left untouched.
        expect(response.status).toBe(410);

        const keptTask = await db.query.taskTable.findFirst({
          where: eq(schema.taskTable.id, task.id),
        });
        expect(keptTask).toMatchObject({ id: task.id, status });
      },
    );

    it("issue #290: returns the same 400 an unknown project gets when the user has no row in workspace_member for the workspace, not a distinguishing 403", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );

      const outsiderId = `user-${randomUUID()}`;
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

      const response = await postCreateTask(app, project.id);
      // Before #290, `workspaceAccess.fromProject` answered 403 here ("reachable
      // resource, wrong tenant") but 400 for an outright unknown project id -- letting
      // a caller tell the two apart. Since #720 the route requires project reach, so it
      // answers this exactly like the unknown-id case (404, `api-design.md`), never a 403.
      expect(response.status).toBe(404);
      const unknown = await postCreateTask(app, "no-such-project-id");
      expect(unknown.status).toBe(404);
      await expect(response.text()).resolves.toBe(await unknown.text());
    });

    it("issue #290: does not distinguish a project reached through a conflicting workspaceId query from an unknown one", async () => {
      const attacker = await createWorkspaceMember({ role: "admin" });
      const victim = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        victim.workspace.id,
        project.id,
      );

      mockAuthenticatedSession(attacker.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/task/${project.id}?workspaceId=${attacker.workspace.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Cross-workspace probe",
            description: "",
            priority: "low",
            status: "to-do",
          }),
        },
      );

      // `?workspaceId=` was never consulted for a `lookup` source (that's #256); #290
      // additionally means the resolved-but-out-of-reach project doesn't leak a 403, and
      // since #720 it answers the same 404 a missing project does.
      expect(response.status).toBe(404);
      const unknown = await app.request(
        `/api/task/no-such-project-id?workspaceId=${attacker.workspace.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Cross-workspace probe",
            description: "",
            priority: "low",
            status: "to-do",
          }),
        },
      );
      expect(unknown.status).toBe(404);
      await expect(response.text()).resolves.toBe(await unknown.text());
    });
  });

  describe("custom workspace roles", () => {
    it("blocks a custom role that only grants work_item:read from creating a task", async () => {
      const member = await createWorkspaceMember({ role: "readonly" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      await createWorkspaceRoleRow(member.workspace.id, "readonly", {
        work_item: ["read"],
        project: ["read"],
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });

    it("allows a custom role that grants work_item:create to create a task", async () => {
      const member = await createWorkspaceMember({ role: "creator" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      await createWorkspaceRoleRow(member.workspace.id, "creator", {
        work_item: ["create", "read"],
        project: ["read"],
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("lets a workspace_role row override the built-in viewer permissions", async () => {
      // viewer's compiled-in statements have no work_item:create. A workspace_role
      // row for "viewer" with work_item:create should override and grant access.
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      // The custom workspace role is what lets this viewer create; the project-level role
      // the fixture gives a viewer is read-only (and overrides workspace roles on the
      // project), so lift it to the item set the custom role declares.
      await grantWorkItemProjectAccess(member.user.id, project.id);
      await createWorkspaceRoleRow(member.workspace.id, "viewer", {
        work_item: ["create", "read", "update"],
        project: ["read"],
        workspace: ["read"],
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("returns 403 when the workspace_role permission JSON is malformed", async () => {
      const member = await createWorkspaceMember({ role: "broken" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      // Malformed permission payload. The middleware should refuse rather than
      // crash; with no built-in fallback for "broken", access is denied.
      await createWorkspaceRoleRow(member.workspace.id, "broken", "not-json");

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });

    it("drops malformed permission entries instead of throwing", async () => {
      const member = await createWorkspaceMember({ role: "partial" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      // Some entries are valid string arrays, others are objects/strings/etc.
      // Middleware keeps the valid ones and ignores the rest.
      await createWorkspaceRoleRow(
        member.workspace.id,
        "partial",
        JSON.stringify({
          work_item: ["create"],
          project: "not-an-array",
          weird: { nested: true },
        }),
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(200);
    });

    it("issue #66: denies (does not fall back to the compiled built-in role) when no workspace_role row exists for a non-owner name", async () => {
      // No workspace_role row for "admin", and "admin" is not "owner" -- so
      // this must DENY, not silently grant the compiled-in admin's full
      // privileges. Before #66 closed, this fell back to the compiled
      // definition and returned 200; every real creation path now
      // guarantees this row exists, so its absence here is deliberately
      // constructed (seedDefaultRoleRow: false), not a realistic steady
      // state -- but the evaluator must still refuse it.
      const member = await createWorkspaceMember({
        role: "admin",
        seedDefaultRoleRow: false,
      });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });
  });

  describe("resource coverage: work_item:update", () => {
    it("allows a member to update a task", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${task.version}"`,
        },
        body: JSON.stringify({
          title: "Updated by member",
          description: "edit",
          priority: "high",
          status: "to-do",
          projectId: project.id,
          position: 1,
        }),
      });
      expect(response.status).toBe(200);
    });

    it("allows a member to update an assigned task without changing its assignee", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id, member.user.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${task.version}"`,
        },
        body: JSON.stringify({
          title: "Updated by member",
          description: "edit",
          priority: "high",
          status: "to-do",
          projectId: project.id,
          position: 1,
          userId: member.user.id,
        }),
      });
      expect(response.status).toBe(200);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.title).toBe("Updated by member");
      expect(persisted?.userId).toBe(member.user.id);
    });

    it("blocks a member from assigning an unassigned task through full update", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${task.version}"`,
        },
        body: JSON.stringify({
          title: "Member attempt",
          description: "nope",
          priority: "low",
          status: "to-do",
          projectId: project.id,
          position: 1,
          userId: member.user.id,
        }),
      });
      expect(response.status).toBe(403);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.userId).toBeNull();
    });

    it("blocks a member from unassigning a task through full update", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id, member.user.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${task.version}"`,
        },
        body: JSON.stringify({
          title: "Member attempt",
          description: "nope",
          priority: "low",
          status: "to-do",
          projectId: project.id,
          position: 1,
          userId: "",
        }),
      });
      expect(response.status).toBe(403);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.userId).toBe(member.user.id);
    });

    it("allows an admin to assign a task through full update", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: admin.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        admin.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${task.version}"`,
        },
        body: JSON.stringify({
          title: "Assigned by admin",
          description: "",
          priority: "medium",
          status: "to-do",
          projectId: project.id,
          position: 1,
          userId: admin.user.id,
        }),
      });
      expect(response.status).toBe(200);

      const persisted = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persisted?.userId).toBe(admin.user.id);
    });

    it("blocks a viewer from updating a task", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/${task.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${task.version}"`,
        },
        body: JSON.stringify({
          title: "Viewer attempt",
          description: "nope",
          priority: "low",
          status: "to-do",
          projectId: project.id,
          position: 1,
        }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe("resource coverage: work_item:assign", () => {
    it("blocks a member from assigning a task (assign is admin-tier)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/assignee/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: member.user.id }),
      });
      expect(response.status).toBe(403);
    });

    it("allows an admin to assign a task", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/task/assignee/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: member.user.id }),
      });
      expect(response.status).toBe(200);
    });
  });

  describe("resource coverage: project:create / update / delete", () => {
    it("blocks a member from creating a project and allows an admin (#708)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const denied = await app.request("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Member-made",
          workspaceId: member.workspace.id,
          slug: "MEM",
          icon: "Folder",
        }),
      });
      expect(denied.status).toBe(403);

      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const allowed = await app.request("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Admin-made",
          workspaceId: admin.workspace.id,
          slug: "ADM",
          icon: "Folder",
        }),
      });
      expect(allowed.status).toBe(200);
    });

    it("blocks a viewer from creating a project", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Viewer attempt",
          workspaceId: member.workspace.id,
          slug: "VWR",
          icon: "Folder",
        }),
      });
      expect(response.status).toBe(403);
    });

    it("blocks a member from updating a project (project:update is admin-tier)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/project/${project.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Member-rename",
          icon: "Folder",
          slug: project.slug,
          description: "",
          isPublic: false,
        }),
      });
      expect(response.status).toBe(403);
    });

    it("allows an admin to update a project", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/project/${project.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Admin-rename",
          icon: "Folder",
          slug: project.slug,
          description: "",
          isPublic: false,
        }),
      });
      expect(response.status).toBe(200);
    });

    it("blocks a member from deleting a project (project:delete is admin-tier)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/project/${project.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);
    });

    it("allows an admin to delete a project", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      mockAuthenticatedSession(member.user);
      await ensureAgentSession(member.user.id);
      const { app } = createApp();

      // The admin's request is accepted (202); the soft delete happens on approval.
      await deleteThroughApproval(
        app,
        member.user,
        `/api/project/${project.id}`,
        {
          typedName: project.slug,
        },
      );
    });
  });

  describe("resource coverage: label:create / delete", () => {
    it("allows a member to create a label", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "bug",
          color: "#ff0000",
          workspaceId: member.workspace.id,
        }),
      });
      expect(response.status).toBe(200);
    });

    it("blocks a viewer from creating a label", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "nope",
          color: "#000000",
          workspaceId: member.workspace.id,
        }),
      });
      expect(response.status).toBe(403);
    });

    it("allows an admin to delete a label (label:manage is admin-tier)", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);
      // deleteLabel requires the label to be attached to a task; without a
      // taskId the controller rejects with 400 before checking permissions.
      const label = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            name: "scratch",
            color: "#abcdef",
            workspaceId: member.workspace.id,
            taskId: task.id,
          })
          .returning(),
        "label",
      );

      mockAuthenticatedSession(member.user);
      await ensureAgentSession(member.user.id);
      const { app } = createApp();

      // The admin's request is accepted (202); the label is removed on approval.
      await deleteThroughApproval(app, member.user, `/api/label/${label.id}`);
    });

    it("blocks a member from deleting a label (label:manage is admin-tier)", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);
      // deleteLabel requires the label to be attached to a task; without a
      // taskId the controller rejects with 400 before checking permissions.
      const label = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            name: "scratch",
            color: "#abcdef",
            workspaceId: member.workspace.id,
            taskId: task.id,
          })
          .returning(),
        "label",
      );

      mockAuthenticatedSession(member.user);
      await ensureAgentSession(member.user.id);
      const { app } = createApp();

      // The durable request is evaluated against label:manage, which `member` lacks.
      const response = await app.request(`/api/label/${label.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);
      expect(
        await db.query.labelTable.findFirst({
          where: eq(schema.labelTable.id, label.id),
        }),
      ).toBeDefined();
    });

    it("blocks a viewer from deleting a label", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );
      const task = await seedTask(project.id, columns.todo.id);
      const label = requireRow(
        await db
          .insert(schema.labelTable)
          .values({
            name: "scratch",
            color: "#abcdef",
            workspaceId: member.workspace.id,
            taskId: task.id,
          })
          .returning(),
        "label",
      );

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/label/${label.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);
    });
  });

  describe("instance admin reach and workspace capability", () => {
    it("does not bypass the caller's workspace role when user.role === 'admin'", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      // Promote the user to instance admin
      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, member.user.id));

      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );

      // Reload the user so the mocked session reflects the admin role.
      const refreshedUser = await db.query.userTable.findFirst({
        where: eq(schema.userTable.id, member.user.id),
      });
      if (!refreshedUser) throw new Error("user vanished after update");

      mockAuthenticatedSession(refreshedUser);
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });

    it("does not bypass for users with no role set", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      // Explicitly null role on the user table; should NOT bypass.
      await db
        .update(schema.userTable)
        .set({ role: null })
        .where(eq(schema.userTable.id, member.user.id));

      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        member.workspace.id,
        project.id,
      );

      mockAuthenticatedSession({ ...member.user, role: null });
      const { app } = createApp();

      const response = await postCreateTask(app, project.id);
      expect(response.status).toBe(403);
    });
  });

  // Negative guard for issue #6, replacing the three cases that used Slack as
  // the canonical `workspace:manage_settings` surface.
  //
  // All six inherited integration routers (GitHub, Gitea, Slack, Discord,
  // Telegram, generic webhook) are deleted, so there is no longer a route to
  // assert RBAC against — and that is worth asserting directly: these paths
  // must be ABSENT, not merely permission-checked.
  //
  // NOTE for #7/#8: `workspace:manage_settings` is now required by NO route in
  // the application. The integration routers were its only consumers. The
  // capability still exists in packages/permissions; re-attaching it to the
  // God Mode / instance settings surface is that work's job, and the route
  // coverage test should notice a capability nothing enforces.
  describe("the removed integration routers", () => {
    const removedRoutes = [
      "/api/github-integration",
      "/api/gitea-integration",
      "/api/slack-integration",
      "/api/discord-integration",
      "/api/telegram-integration",
      "/api/generic-webhook-integration",
    ];

    it("no longer mounts any inherited integration router", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      await grantProjectAccessToWorkspaceMembers(
        owner.workspace.id,
        project.id,
      );
      mockAuthenticatedSession(owner.user);
      const { app } = createApp();

      for (const route of removedRoutes) {
        const response = await app.request(`${route}/project/${project.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });

        // 404 — the router is gone. An owner is used deliberately: a 403 would
        // only prove the caller lacked permission, which would still mean the
        // route existed.
        expect(response.status).toBe(404);
      }
    });
  });
});
