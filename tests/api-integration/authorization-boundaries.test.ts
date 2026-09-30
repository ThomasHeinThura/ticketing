import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import * as eventBus from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

// Negative guard for issue #6. kaneo served project boards anonymously at
// /api/public-project/:id when the project carried `is_public`. The route, its
// controller and the column are all gone.
//
// The expected status is 401, not 404, and that is the point. kaneo registered
// this route BEFORE the `api.use("*")` authentication guard, so it never ran
// the guard at all — that ordering is what made it anonymous. With the route
// removed, the path falls through to the guard, and an unauthenticated caller
// is challenged like any other. A 200 here would mean the route is back; a 403
// would mean something still resolves the path and makes its own decision.
describe("the removed public project route", () => {
  it("no longer bypasses authentication, and leaks nothing about the project", async () => {
    const { workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    const { app } = createApp();
    const response = await app.request(`/api/public-project/${project.id}`);

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(project.name);
  });
});

describe("task assignees stay inside the workspace", () => {
  it("refuses to create a task assigned to a non-member", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Cross-workspace assignment",
        description: "",
        priority: "low",
        status: "to-do",
        userId: outsider.user.id,
      }),
    });

    expect(response.status).toBe(403);
  });

  it("refuses to reassign an existing task to a non-member", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Seeded",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/task/assignee/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: outsider.user.id }),
    });

    expect(response.status).toBe(403);
  });
});

describe("activity attribution", () => {
  it("credits the session user, not a userId supplied in the body", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const impersonated = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Seeded",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request("/api/activity/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        userId: impersonated.user.id,
        message: `note-${randomUUID()}`,
        type: "created",
      }),
    });

    expect(response.status).toBe(200);
    const activity = await response.json();
    expect(activity.userId).toBe(user.id);
    expect(activity.userId).not.toBe(impersonated.user.id);
  });
});

describe("every assignee write path is workspace scoped", () => {
  it("refuses a non-member through the task update endpoint", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Seeded",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Seeded",
        status: "to-do",
        projectId: project.id,
        description: "",
        priority: "low",
        position: 1,
        userId: outsider.user.id,
      }),
    });

    expect(response.status).toBe(403);
  });

  it("imports the valid tasks and fails only the one with a bad assignee", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/task/import/${project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: [
          { title: "Good", status: "to-do", priority: "low" },
          {
            title: "Bad",
            status: "to-do",
            priority: "low",
            userId: outsider.user.id,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const stored = await db
      .select({ title: schema.taskTable.title })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));

    expect(stored.map((t) => t.title)).toEqual(["Good"]);
  });

  it("refuses a non-member through task import", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/task/import/${project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: [
          {
            title: "Imported",
            status: "to-do",
            priority: "low",
            userId: outsider.user.id,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const stored = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));

    expect(stored).toHaveLength(0);
  });

  it("stores a padded assignee id in its normalised form", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/task/import/${project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: [
          {
            title: "Imported",
            status: "to-do",
            priority: "low",
            userId: `  ${user.id}  `,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const stored = requireRow(
      await db
        .select({ userId: schema.taskTable.userId })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.projectId, project.id)),
      "stored",
    );

    expect(stored.userId).toBe(user.id);
  });

  it("treats a whitespace-only assignee as an unassignment", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Seeded",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
          userId: user.id,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/task/assignee/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "   " }),
    });

    expect(response.status).toBe(200);

    const after = requireRow(
      await db
        .select({ userId: schema.taskTable.userId })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, task.id)),
      "after",
    );

    expect(after.userId).toBeNull();
  });

  it("assigns a padded but valid member id", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Seeded",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/task/assignee/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: `  ${user.id}  ` }),
    });

    expect(response.status).toBe(200);

    const after = requireRow(
      await db
        .select({ userId: schema.taskTable.userId })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, task.id)),
      "after",
    );

    expect(after.userId).toBe(user.id);
  });

  it("refuses a non-member through the bulk assignee operation", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Seeded",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request("/api/task/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskIds: [task.id],
        operation: "updateAssignee",
        value: outsider.user.id,
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe(
      "Assignee is not a member of this workspace",
    );

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    expect(persistedTask?.userId).toBeNull();
  });

  it("keeps one authorized assignee decision stable across per-item commits", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: member.workspace.id,
      userId: assignee.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    const tasks = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "First bulk task",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        },
        {
          projectId: project.id,
          title: "Second bulk task",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 2,
          position: 2,
        },
      ])
      .returning();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const suffix = randomUUID().replaceAll("-", "");
    const triggerName = `revoke_bulk_assignee_${suffix}`;
    const functionName = `${triggerName}_fn`;
    const publishedTaskIds: string[] = [];
    const publishSpy = vi
      .spyOn(eventBus, "publishEvent")
      .mockImplementation(async (eventType, data) => {
        if (
          eventType === "task.assignee_changed" &&
          typeof data === "object" &&
          data !== null &&
          "taskId" in data &&
          typeof data.taskId === "string"
        ) {
          publishedTaskIds.push(data.taskId);
        }
      });

    await client.connect();
    try {
      await client.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          DELETE FROM workspace_member AS membership
          USING project AS current_project
          WHERE current_project.id = NEW.project_id
            AND membership.workspace_id = current_project.workspace_id
            AND membership.user_id = NEW.assignee_id;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER ${triggerName}
        AFTER UPDATE OF assignee_id ON task
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `);

      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskIds: tasks.map((task) => task.id),
          operation: "updateAssignee",
          value: assignee.user.id,
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        updatedCount: 2,
        results: tasks.map((task) => ({ taskId: task.id, success: true })),
      });

      const persistedTasks = await db
        .select({ id: schema.taskTable.id, userId: schema.taskTable.userId })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.projectId, project.id))
        .orderBy(schema.taskTable.number);
      expect(persistedTasks).toEqual(
        tasks.map((task) => ({ id: task.id, userId: assignee.user.id })),
      );
      expect(publishedTaskIds).toEqual(tasks.map((task) => task.id));
      expect(
        await db.query.workspaceUserTable.findFirst({
          where: and(
            eq(schema.workspaceUserTable.workspaceId, member.workspace.id),
            eq(schema.workspaceUserTable.userId, assignee.user.id),
          ),
        }),
      ).toBeUndefined();
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON task`);
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
      publishSpy.mockRestore();
    }
  });
});
