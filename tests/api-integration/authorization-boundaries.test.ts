import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import * as eventBus from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { lockTaskAndAssertProjectLive } from "../../apps/api/src/task/assert-task-project-live";
import { assertAssignableUserAndLockMembership } from "../../apps/api/src/utils/assert-assignable-user";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function pauseAfterFirstSelectResult(
  executor: DbOrTx,
  afterResult: () => Promise<void>,
): DbOrTx {
  let paused = false;

  const wrapQuery = (query: unknown): unknown =>
    new Proxy(query as object, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;

        if (property === "then" && !paused) {
          return (onFulfilled: unknown, onRejected: unknown) => {
            const result = new Promise<unknown>((resolve, reject) => {
              Reflect.apply(value, target, [resolve, reject]);
            });
            return result
              .then(async (rows) => {
                paused = true;
                await afterResult();
                return rows;
              })
              .then(
                onFulfilled as (rows: unknown) => unknown,
                onRejected as (error: unknown) => unknown,
              );
          };
        }

        return (...args: unknown[]) =>
          wrapQuery(Reflect.apply(value, target, args));
      },
    });

  return new Proxy(executor as object, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "select" && typeof value === "function") {
        return (...args: unknown[]) =>
          wrapQuery(Reflect.apply(value, target, args));
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DbOrTx;
}

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

  it("keeps global admins assignable without workspace membership", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const globalAdmin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, globalAdmin.user.id));
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Global admin assignment task",
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

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request("/api/task/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskIds: [task.id],
        operation: "updateAssignee",
        value: globalAdmin.user.id,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      updatedCount: 1,
      results: [{ taskId: task.id, success: true }],
    });
    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    expect(persistedTask?.userId).toBe(globalAdmin.user.id);
  });

  it("fails closed when a member is inserted and removed after the membership check", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const assignee = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Membership insertion race task",
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

    let signalMembershipCheck!: () => void;
    const membershipCheckReached = new Promise<void>((resolve) => {
      signalMembershipCheck = resolve;
    });
    let resumeMembershipCheck!: () => void;
    const membershipCheckGate = new Promise<void>((resolve) => {
      resumeMembershipCheck = resolve;
    });
    let signalAuthorizationPassed!: () => void;
    const authorizationPassed = new Promise<void>((resolve) => {
      signalAuthorizationPassed = resolve;
    });
    let resumeTaskWrite!: () => void;
    const taskWriteGate = new Promise<void>((resolve) => {
      resumeTaskWrite = resolve;
    });

    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await client.connect();
    const assignmentPromise = db.transaction(async (tx) => {
      await lockTaskAndAssertProjectLive(tx, task.id);
      const synchronizedExecutor = pauseAfterFirstSelectResult(tx, async () => {
        signalMembershipCheck();
        await membershipCheckGate;
      });
      await assertAssignableUserAndLockMembership(
        assignee.user.id,
        member.workspace.id,
        synchronizedExecutor,
      );
      signalAuthorizationPassed();
      await taskWriteGate;
      await tx
        .update(schema.taskTable)
        .set({ userId: assignee.user.id })
        .where(eq(schema.taskTable.id, task.id));
    });
    const assignmentOutcome = assignmentPromise.then(
      () => ({ kind: "success" as const }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );

    try {
      await membershipCheckReached;
      await client.query(
        `INSERT INTO workspace_member (id, workspace_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, 'member', now())`,
        [randomUUID(), member.workspace.id, assignee.user.id],
      );
      resumeMembershipCheck();

      const interleaving = await Promise.race([
        authorizationPassed.then(() => ({ kind: "authorized" as const })),
        assignmentOutcome.then((outcome) => ({
          kind: "settled" as const,
          outcome,
        })),
      ]);
      let outcome: Awaited<typeof assignmentOutcome>;
      if (interleaving.kind === "authorized") {
        // This is the vulnerable old path: an unlocked second membership read
        // sees the insert, then removal wins before the task write.
        await client.query(
          "DELETE FROM workspace_member WHERE workspace_id = $1 AND user_id = $2",
          [member.workspace.id, assignee.user.id],
        );
        resumeTaskWrite();
        outcome = await assignmentOutcome;
      } else {
        outcome = interleaving.outcome;
        resumeTaskWrite();
        await client.query(
          "DELETE FROM workspace_member WHERE workspace_id = $1 AND user_id = $2",
          [member.workspace.id, assignee.user.id],
        );
      }

      expect(outcome).toMatchObject({ kind: "error", error: { status: 403 } });
      const persistedTask = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persistedTask?.userId).toBeNull();
    } finally {
      resumeMembershipCheck();
      resumeTaskWrite();
      await assignmentOutcome;
      await client.end();
    }
  });

  it("publishes one bulk status relation refresh per affected project", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const tasks = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: project.id,
          title: "First status task",
          description: "",
          priority: "low",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        },
        {
          projectId: project.id,
          title: "Second status task",
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
    const statusTaskIds: string[] = [];
    const relationProjectIds: string[] = [];
    const publishSpy = vi
      .spyOn(eventBus, "publishEvent")
      .mockImplementation(async (eventType, data) => {
        if (typeof data !== "object" || data === null) return;
        if (
          eventType === "task.status_changed" &&
          "taskId" in data &&
          typeof data.taskId === "string"
        ) {
          statusTaskIds.push(data.taskId);
        }
        if (
          eventType === "task-relation.refresh" &&
          "projectId" in data &&
          typeof data.projectId === "string"
        ) {
          relationProjectIds.push(data.projectId);
        }
      });

    try {
      const response = await app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskIds: tasks.map((task) => task.id),
          operation: "updateStatus",
          value: "done",
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        updatedCount: 2,
        results: tasks.map((task) => ({ taskId: task.id, success: true })),
      });
      expect(statusTaskIds).toEqual(tasks.map((task) => task.id));
      expect(relationProjectIds).toEqual([project.id]);
    } finally {
      publishSpy.mockRestore();
    }
  });

  it("rechecks assignee membership for each item after per-item commits", async () => {
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
    const firstTask = requireRow([tasks[0]], "first bulk task");
    const secondTask = requireRow([tasks[1]], "second bulk task");

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
        updatedCount: 1,
        results: [
          { taskId: firstTask.id, success: true },
          {
            taskId: secondTask.id,
            success: false,
            error: "Assignee is not a member of this workspace",
          },
        ],
      });

      const persistedTasks = await db
        .select({ id: schema.taskTable.id, userId: schema.taskTable.userId })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.projectId, project.id))
        .orderBy(schema.taskTable.number);
      expect(persistedTasks).toEqual([
        { id: firstTask.id, userId: assignee.user.id },
        { id: secondTask.id, userId: null },
      ]);
      expect(publishedTaskIds).toEqual([firstTask.id]);
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

  it("publishes item one before a deterministic database failure on item two", async () => {
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
    const firstTask = requireRow([tasks[0]], "first bulk task");
    const secondTask = requireRow([tasks[1]], "second bulk task");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const suffix = randomUUID().replaceAll("-", "");
    const triggerName = `fail_second_bulk_task_${suffix}`;
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
          IF NEW.id = '${secondTask.id}' THEN
            RAISE EXCEPTION 'deterministic second-item failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE OF assignee_id ON task
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

      expect(response.status).toBe(500);
      expect(publishedTaskIds).toEqual([firstTask.id]);
      const persistedTasks = await db
        .select({ id: schema.taskTable.id, userId: schema.taskTable.userId })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.projectId, project.id))
        .orderBy(schema.taskTable.number);
      expect(persistedTasks).toEqual([
        { id: firstTask.id, userId: assignee.user.id },
        { id: secondTask.id, userId: null },
      ]);
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON task`);
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
      publishSpy.mockRestore();
    }
  });
});
