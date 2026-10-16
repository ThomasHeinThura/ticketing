import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import bulkUpdateTasks from "../../apps/api/src/task/controllers/bulk-update-tasks";
import createTask from "../../apps/api/src/task/controllers/create-task";
import importTasks from "../../apps/api/src/task/controllers/import-tasks";
import moveTask from "../../apps/api/src/task/controllers/move-task";
import updateTaskAssignee from "../../apps/api/src/task/controllers/update-task-assignee";
import updateTaskDueDate from "../../apps/api/src/task/controllers/update-task-due-date";
import updateTaskPriority from "../../apps/api/src/task/controllers/update-task-priority";
import updateTaskStatus from "../../apps/api/src/task/controllers/update-task-status";
import updateTaskTitle from "../../apps/api/src/task/controllers/update-task-title";
import * as taskRepository from "../../apps/api/src/task/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

const capturedEvents: string[] = [];
const mutationEvents = [
  "task.title_changed",
  "task.due_date_changed",
  "task.status_changed",
  "task.priority_changed",
  "task.assignee_changed",
  "task.unassigned",
  "task.deleted",
  "task.label_assigned",
  "task.label_unassigned",
  "task-relation.refresh",
] as const;
let eventCaptureInstalled = false;

function quoteSql(value: string) {
  return value.replaceAll("'", "''");
}

async function waitForBlockedPid(client: Client, blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND $1 = ANY(pg_blocking_pids(pid))
       LIMIT 1`,
      [blockerPid],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No PostgreSQL session blocked by pid ${blockerPid}`);
}

async function createTriggerBarrier({
  table,
  timing,
  operation,
  predicate,
}: {
  table: "task" | "task_reminder_sent";
  timing: "AFTER" | "BEFORE";
  operation: "UPDATE" | "DELETE";
  predicate: string;
}) {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `q580_scope_${suffix}_fn`;
  const triggerName = `q580_scope_${suffix}`;
  const barrierKey = `q580-scope-${suffix}`;
  const namespace = 4_012;
  let held = false;
  let functionCreated = false;
  let triggerCreated = false;

  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [
      namespace,
      barrierKey,
    ]);
    held = true;
    const { rows } = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const blockerPid = rows[0]?.pid;
    if (blockerPid === undefined) throw new Error("trigger barrier pid");
    await client.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ${predicate} THEN
          PERFORM pg_advisory_xact_lock(${namespace}, hashtext('${barrierKey}'));
        END IF;
        RETURN ${operation === "DELETE" ? "OLD" : "NEW"};
      END;
      $$
    `);
    functionCreated = true;
    await client.query(`CREATE TRIGGER ${triggerName}
      ${timing} ${operation} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    triggerCreated = true;

    return {
      wait: () => waitForBlockedPid(client, blockerPid),
      release: async () => {
        if (!held) return;
        await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
          namespace,
          barrierKey,
        ]);
        held = false;
      },
      close: async () => {
        if (held) {
          await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
            namespace,
            barrierKey,
          ]);
          held = false;
        }
        if (triggerCreated)
          await client.query(
            `DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`,
          );
        if (functionCreated)
          await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
        await client.end();
      },
    };
  } catch (error) {
    if (held) {
      await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
        namespace,
        barrierKey,
      ]);
    }
    if (triggerCreated)
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
    if (functionCreated)
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await client.end();
    throw error;
  }
}

async function revokeProjectGrant(personId: string, projectId: string) {
  const revoked = await db
    .delete(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, personId),
        eq(schema.membershipTable.scope, "project"),
        eq(schema.membershipTable.scopeId, projectId),
      ),
    )
    .returning({ id: schema.membershipTable.id });
  expect(revoked).toHaveLength(1);
  const remaining = await db
    .select({ id: schema.membershipTable.id })
    .from(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, personId),
        eq(schema.membershipTable.scope, "project"),
        eq(schema.membershipTable.scopeId, projectId),
      ),
    );
  expect(remaining).toHaveLength(0);
}

function makePauseGate() {
  let releaseGate: () => void = () => {};
  let reachedGate: () => void = () => {};
  let timeout: ReturnType<typeof setTimeout>;
  const released = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const reached = new Promise<void>((resolve, reject) => {
    reachedGate = resolve;
    timeout = setTimeout(
      () => reject(new Error("Repository barrier timeout")),
      5_000,
    );
  });
  return {
    reached,
    release: releaseGate,
    pause: async () => {
      clearTimeout(timeout);
      reachedGate();
      await released;
    },
  };
}

function pauseAfterProjectContext(projectId: string) {
  const original = taskRepository.findProjectWorkspaceContext;
  const gate = makePauseGate();
  let paused = false;
  const spy = vi
    .spyOn(taskRepository, "findProjectWorkspaceContext")
    .mockImplementation(async (executor, identity, scopedProjectId) => {
      const context = await original(executor, identity, scopedProjectId);
      if (scopedProjectId === projectId && !paused) {
        paused = true;
        expect(context).toBeDefined();
        await gate.pause();
      }
      return context;
    });
  return {
    ...gate,
    restore: () => spy.mockRestore(),
  };
}

function pauseAfterTaskColumnLookup(projectId: string, slug: string) {
  const original = taskRepository.findColumnBySlugForIdentity;
  const gate = makePauseGate();
  let paused = false;
  const spy = vi
    .spyOn(taskRepository, "findColumnBySlugForIdentity")
    .mockImplementation(async (executor, identity, scopedProjectId, status) => {
      const column = await original(
        executor,
        identity,
        scopedProjectId,
        status,
      );
      if (scopedProjectId === projectId && status === slug && !paused) {
        paused = true;
        expect(column).toBeDefined();
        await gate.pause();
      }
      return column;
    });
  return { ...gate, restore: () => spy.mockRestore() };
}

function pauseAfterAssigneeName(identityUserId: string, projectId: string) {
  const original = taskRepository.findUserName;
  const gate = makePauseGate();
  let paused = false;
  const spy = vi
    .spyOn(taskRepository, "findUserName")
    .mockImplementation(async (identity, userId, scopedProjectId, executor) => {
      const user = await original(identity, userId, scopedProjectId, executor);
      if (
        identity.userId === identityUserId &&
        userId === identityUserId &&
        scopedProjectId === projectId &&
        !paused
      ) {
        paused = true;
        expect(user).toBeDefined();
        await gate.pause();
      }
      return user;
    });
  return { ...gate, restore: () => spy.mockRestore() };
}

async function createTaskFixture() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantWorkItemProjectAccess(member.user.id, project.id);
  const identity = await resolveIdentity({
    userId: member.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("expected resolved task fixture identity");
  const task = requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Original title",
        description: "Activity test task",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning(),
    "createTaskFixture: task",
  );

  return { member, task, identity };
}

describe("API integration: task title activity", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    capturedEvents.length = 0;
    if (!eventCaptureInstalled) {
      eventCaptureInstalled = true;
      for (const event of mutationEvents) {
        await subscribeToEvent(event, async () => {
          capturedEvents.push(event);
        });
      }
    }
  });

  it("persists the title and its activity before returning", async () => {
    const { member, task } = await createTaskFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/title/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated title" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: task.id,
      title: "Updated title",
    });

    const [persistedTask, activities] = await Promise.all([
      db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      }),
      db
        .select()
        .from(schema.taskActivityTable)
        .where(
          and(
            eq(schema.taskActivityTable.taskId, task.id),
            eq(schema.taskActivityTable.type, "title_changed"),
          ),
        ),
    ]);

    expect(persistedTask?.title).toBe("Updated title");
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      type: "title_changed",
      eventData: {
        oldTitle: "Original title",
        newTitle: "Updated title",
      },
    });
  });

  it("stores the existing create, import, update, bulk, assignee, due-date, and move history mappings once", async () => {
    const { member, task, identity } = await createTaskFixture();
    const created = await createTask({
      identity,
      projectId: task.projectId,
      currentUserId: member.user.id,
      title: "Created task",
      status: "to-do",
    });
    let rows = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "created",
      userId: member.user.id,
      content: null,
      eventData: {},
    });

    const imported = await importTasks(
      identity,
      task.projectId,
      [{ title: "Imported task", status: "to-do" }],
      member.user.id,
    );
    const importedTask = imported.results.tasks[0];
    expect(importedTask?.success).toBe(true);
    const importedTaskId =
      importedTask && "id" in importedTask.task
        ? importedTask.task.id
        : undefined;
    if (!importedTaskId) throw new Error("expected imported task");
    rows = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, importedTaskId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "create",
      userId: member.user.id,
      content: null,
      eventData: {},
    });

    await updateTaskStatus({
      identity,
      id: task.id,
      status: "done",
      currentUserId: member.user.id,
    });
    await updateTaskPriority({
      identity,
      id: task.id,
      priority: "high",
      currentUserId: member.user.id,
    });
    await updateTaskAssignee({
      identity,
      id: task.id,
      userId: member.user.id,
      currentUserId: member.user.id,
    });
    await updateTaskAssignee({
      identity,
      id: task.id,
      userId: null,
      currentUserId: member.user.id,
    });
    await updateTaskDueDate({
      identity,
      id: task.id,
      dueDate: "2026-12-01",
      currentUserId: member.user.id,
    });

    const bulk = await bulkUpdateTasks({
      identity,
      taskIds: [task.id],
      operation: "updateStatus",
      value: "in-progress",
      userId: member.user.id,
      workspaceId: member.workspace.id,
      reach: {
        reaches: async () => true,
        can: async () => true,
        reachableProjectIds: async () => [task.projectId],
      },
    });
    expect(bulk.updatedCount).toBe(1);

    for (const [operation, value] of [
      ["updatePriority", "low"],
      ["updateAssignee", member.user.id],
      ["updateAssignee", null],
      ["updateDueDate", "2026-12-02"],
    ] as const) {
      const bulkResult = await bulkUpdateTasks({
        identity,
        taskIds: [task.id],
        operation,
        value,
        userId: member.user.id,
        workspaceId: member.workspace.id,
        reach: {
          reaches: async () => true,
          can: async () => true,
          reachableProjectIds: async () => [task.projectId],
        },
      });
      expect(bulkResult.updatedCount).toBe(1);
    }

    const destination = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantWorkItemProjectAccess(member.user.id, destination.project.id);
    const currentIdentity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!currentIdentity) throw new Error("expected move identity");
    const moved = await moveTask({
      identity: currentIdentity,
      taskId: task.id,
      destinationProjectId: destination.project.id,
      currentUserId: member.user.id,
    });

    const taskHistory = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, task.id));
    expect(taskHistory.map(({ type }) => type).sort()).toEqual(
      [
        "status_changed",
        "due_date_changed",
        "assignee_changed",
        "unassigned",
        "priority_changed",
        "status_changed",
        "priority_changed",
        "assignee_changed",
        "unassigned",
        "due_date_changed",
        "moved",
      ].sort(),
    );
    expect(taskHistory).toHaveLength(11);
    expect(
      taskHistory.find(
        ({ type, eventData }) =>
          type === "status_changed" &&
          (eventData as { oldStatus?: string }).oldStatus === "to-do",
      ),
    ).toMatchObject({ eventData: { oldStatus: "to-do", newStatus: "done" } });
    expect(
      taskHistory.find(
        ({ type, eventData }) =>
          type === "status_changed" &&
          (eventData as { newStatus?: string }).newStatus === "in-progress",
      ),
    ).toMatchObject({ eventData: { newStatus: "in-progress" } });
    expect(
      taskHistory.find(({ type }) => type === "priority_changed"),
    ).toMatchObject({
      eventData: { oldPriority: "medium", newPriority: "high" },
    });
    expect(
      taskHistory.find(
        ({ type, eventData }) =>
          type === "priority_changed" &&
          (eventData as { newPriority?: string }).newPriority === "low",
      ),
    ).toMatchObject({ eventData: { newPriority: "low" } });
    expect(
      taskHistory.find(({ type }) => type === "assignee_changed"),
    ).toMatchObject({
      eventData: {
        newAssigneeId: member.user.id,
        isSelfAssigned: true,
      },
    });
    expect(taskHistory.find(({ type }) => type === "unassigned")).toMatchObject(
      { eventData: {} },
    );
    expect(
      taskHistory.filter(({ type }) => type === "unassigned"),
    ).toHaveLength(2);
    expect(
      taskHistory.filter(({ type }) => type === "assignee_changed"),
    ).toHaveLength(2);
    expect(
      taskHistory.find(({ type }) => type === "due_date_changed"),
    ).toMatchObject({
      eventData: {
        oldDueDate: null,
        newDueDate: "2026-12-01T00:00:00.000Z",
      },
    });
    expect(
      taskHistory.find(
        ({ type, eventData }) =>
          type === "due_date_changed" &&
          (eventData as { newDueDate?: string }).newDueDate ===
            "2026-12-02T00:00:00.000Z",
      ),
    ).toMatchObject({
      eventData: {
        oldDueDate: "2026-12-01T00:00:00.000Z",
        newDueDate: "2026-12-02T00:00:00.000Z",
      },
    });
    expect(taskHistory.find(({ type }) => type === "moved")).toMatchObject({
      eventData: {
        fromProjectId: task.projectId,
        toProjectId: moved.destinationProjectId,
        oldStatus: "in-progress",
        newStatus: "in-progress",
      },
    });
  });

  it("rolls back a task status change when its required history insert is refused", async () => {
    const { task, identity } = await createTaskFixture();

    await expect(
      updateTaskStatus({
        identity,
        id: task.id,
        status: "done",
        currentUserId: "missing-user",
      }),
    ).rejects.toThrow();

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    const activities = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, task.id));
    expect(persistedTask?.status).toBe("to-do");
    expect(activities).toHaveLength(0);
  });

  it("does not create activity for an unchanged title", async () => {
    const { member, task, identity } = await createTaskFixture();

    const result = await updateTaskTitle({
      identity,
      id: task.id,
      title: task.title,
      currentUserId: member.user.id,
    });

    expect(result.title).toBe(task.title);
    const activities = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, task.id));
    expect(activities).toHaveLength(0);
  });

  it("rolls back the title when the activity insert fails", async () => {
    const { task, identity } = await createTaskFixture();

    await expect(
      updateTaskTitle({
        identity,
        id: task.id,
        title: "Must not persist",
        currentUserId: "missing-user",
      }),
    ).rejects.toThrow();

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    const activities = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, task.id));

    expect(persistedTask?.title).toBe("Original title");
    expect(activities).toHaveLength(0);
  });

  it("rolls back a title when grant revocation makes its required activity insert a zero-row write", async () => {
    const { member, task, identity } = await createTaskFixture();
    const barrier = await createTriggerBarrier({
      table: "task",
      timing: "AFTER",
      operation: "UPDATE",
      predicate: `NEW.id = '${quoteSql(task.id)}' AND NEW.title = 'Revoked title'`,
    });
    let update: Promise<unknown> | undefined;
    try {
      update = updateTaskTitle({
        identity,
        id: task.id,
        title: "Revoked title",
        currentUserId: member.user.id,
      });
      await barrier.wait();
      await revokeProjectGrant(identity.personId, task.projectId);
      await barrier.release();
      await expect(update).rejects.toMatchObject({ status: 500 });
    } finally {
      await barrier.release();
      await Promise.allSettled(update ? [update] : []);
      await barrier.close();
    }

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    const activities = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.taskId, task.id));
    expect(persistedTask).toMatchObject({
      title: "Original title",
      version: task.version,
    });
    expect(activities).toHaveLength(0);
    expect(capturedEvents).toEqual([]);
  });

  it("preserves reminders when grant revocation refuses the due-date update", async () => {
    const { member, task, identity } = await createTaskFixture();
    const originalDueDate = new Date("2026-11-15T12:00:00.000Z");
    await db
      .update(schema.taskTable)
      .set({ dueDate: originalDueDate })
      .where(eq(schema.taskTable.id, task.id));
    const [reminder] = await db
      .insert(schema.taskReminderSentTable)
      .values({ taskId: task.id, reminderType: "due_soon" })
      .returning();
    if (!reminder) throw new Error("expected sent reminder fixture");
    const barrier = await createTriggerBarrier({
      table: "task_reminder_sent",
      timing: "BEFORE",
      operation: "DELETE",
      predicate: `OLD.task_id = '${quoteSql(task.id)}'`,
    });
    let update: Promise<unknown> | undefined;
    try {
      update = updateTaskDueDate({
        identity,
        id: task.id,
        dueDate: "2026-12-15T12:00:00.000Z",
        currentUserId: member.user.id,
      });
      await barrier.wait();
      await revokeProjectGrant(identity.personId, task.projectId);
      await barrier.release();
      await expect(update).rejects.toMatchObject({ status: 500 });
    } finally {
      await barrier.release();
      await Promise.allSettled(update ? [update] : []);
      await barrier.close();
    }

    const persistedTask = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    const reminders = await db
      .select()
      .from(schema.taskReminderSentTable)
      .where(eq(schema.taskReminderSentTable.taskId, task.id));
    expect(persistedTask).toMatchObject({
      dueDate: originalDueDate,
      version: task.version,
    });
    expect(reminders).toEqual([reminder]);
    expect(
      await db
        .select()
        .from(schema.taskActivityTable)
        .where(eq(schema.taskActivityTable.taskId, task.id)),
    ).toHaveLength(0);
    expect(capturedEvents).toEqual([]);
  });

  it.each([
    { operation: "updateStatus", value: "in-progress", field: "status" },
    { operation: "updatePriority", value: "urgent", field: "priority" },
    { operation: "updateAssignee", value: "assignee", field: "userId" },
    {
      operation: "updateDueDate",
      value: "2026-12-15T12:00:00.000Z",
      field: "dueDate",
    },
  ] as const)(
    "bulk $operation reports a refused scoped write without mutation effects after grant revocation",
    async ({ operation, value, field }) => {
      const { member, task, identity } = await createTaskFixture();
      const original = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      if (!original) throw new Error("expected persisted task fixture");
      const gate =
        operation === "updateStatus"
          ? pauseAfterTaskColumnLookup(task.projectId, value)
          : operation === "updateAssignee"
            ? pauseAfterAssigneeName(member.user.id, task.projectId)
            : pauseAfterProjectContext(task.projectId);
      const reach = {
        reaches: async () => true,
        can: async () => true,
        reachableProjectIds: async () => [task.projectId],
      };
      let update:
        | Promise<Awaited<ReturnType<typeof bulkUpdateTasks>>>
        | undefined;
      try {
        update = bulkUpdateTasks({
          identity,
          taskIds: [task.id],
          operation,
          value: operation === "updateAssignee" ? member.user.id : value,
          userId: member.user.id,
          workspaceId: member.workspace.id,
          reach,
        });
        await gate.reached;
        await revokeProjectGrant(identity.personId, task.projectId);
        gate.release();
        const result = await update;
        expect(result).toMatchObject({
          success: true,
          updatedCount: 0,
          results: [
            { taskId: task.id, success: false, error: "Task not found" },
          ],
        });
      } finally {
        gate.release();
        await Promise.allSettled(update ? [update] : []);
        gate.restore();
      }

      const persistedTask = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persistedTask).toMatchObject({ version: original.version });
      expect(persistedTask?.[field]).toEqual(original[field]);
      expect(capturedEvents).toEqual([]);
      expect(
        await db
          .select()
          .from(schema.taskActivityTable)
          .where(eq(schema.taskActivityTable.taskId, task.id)),
      ).toHaveLength(0);
    },
  );

  it.each([
    { operation: "delete", name: "delete-present" },
    { operation: "addLabel", name: "add-missing" },
    { operation: "removeLabel", name: "remove-present" },
  ] as const)(
    "bulk $name reports current-scope refusal after persisted grant revocation",
    async ({ operation, name }) => {
      const { member, task, identity } = await createTaskFixture();
      const labelName = `revoked-${name}`;
      let labelId: string | undefined;
      if (operation === "addLabel") {
        const [label] = await db
          .insert(schema.labelTable)
          .values({
            name: labelName,
            color: "#123456",
            taskId: null,
            workspaceId: member.workspace.id,
          })
          .returning();
        if (!label) throw new Error("expected workspace label fixture");
        labelId = label.id;
      } else if (operation === "removeLabel") {
        const [label] = await db
          .insert(schema.labelTable)
          .values({
            name: labelName,
            color: "#123456",
            taskId: task.id,
            workspaceId: member.workspace.id,
          })
          .returning();
        if (!label) throw new Error("expected attached label fixture");
        labelId = label.id;
      }
      const original = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      if (!original) throw new Error("expected persisted task fixture");
      const gate = pauseAfterProjectContext(task.projectId);
      const reach = {
        reaches: async () => true,
        can: async () => true,
        reachableProjectIds: async () => [task.projectId],
      };
      let update:
        | Promise<Awaited<ReturnType<typeof bulkUpdateTasks>>>
        | undefined;
      try {
        update = bulkUpdateTasks({
          identity,
          taskIds: [task.id],
          operation,
          ...(labelId ? { value: labelId } : {}),
          userId: member.user.id,
          workspaceId: member.workspace.id,
          reach,
        });
        await gate.reached;
        await revokeProjectGrant(identity.personId, task.projectId);
        gate.release();
        await expect(update).resolves.toMatchObject({
          success: true,
          updatedCount: 0,
          results: [
            { taskId: task.id, success: false, error: "Task not found" },
          ],
        });
      } finally {
        gate.release();
        await Promise.allSettled(update ? [update] : []);
        gate.restore();
      }

      const persistedTask = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(persistedTask).toMatchObject({ version: original.version });
      expect(persistedTask?.title).toBe(original.title);
      const labels = await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.taskId, task.id));
      expect(labels.map((label) => label.name)).toEqual(
        operation === "removeLabel" ? [labelName] : [],
      );
      expect(capturedEvents).toEqual([]);
      expect(
        await db
          .select()
          .from(schema.taskActivityTable)
          .where(eq(schema.taskActivityTable.taskId, task.id)),
      ).toHaveLength(0);
    },
  );

  it("keeps bulk label add and remove idempotent for present and absent labels", async () => {
    const { member, task, identity } = await createTaskFixture();
    const [existingSource] = await db
      .insert(schema.labelTable)
      .values({
        name: "already-present",
        color: "#123456",
        taskId: null,
        workspaceId: member.workspace.id,
      })
      .returning();
    const [absentSource] = await db
      .insert(schema.labelTable)
      .values({
        name: "already-absent",
        color: "#654321",
        taskId: null,
        workspaceId: member.workspace.id,
      })
      .returning();
    if (!existingSource || !absentSource)
      throw new Error("expected workspace label fixtures");
    const [attached] = await db
      .insert(schema.labelTable)
      .values({
        name: existingSource.name,
        color: existingSource.color,
        taskId: task.id,
        workspaceId: member.workspace.id,
      })
      .returning();
    if (!attached) throw new Error("expected attached label fixture");
    const reach = {
      reaches: async () => true,
      can: async () => true,
      reachableProjectIds: async () => [task.projectId],
    };

    const addResult = await bulkUpdateTasks({
      identity,
      taskIds: [task.id],
      operation: "addLabel",
      value: existingSource.id,
      userId: member.user.id,
      workspaceId: member.workspace.id,
      reach,
    });
    expect(addResult).toMatchObject({
      updatedCount: 0,
      results: [{ success: true }],
    });
    const removeResult = await bulkUpdateTasks({
      identity,
      taskIds: [task.id],
      operation: "removeLabel",
      value: absentSource.id,
      userId: member.user.id,
      workspaceId: member.workspace.id,
      reach,
    });
    expect(removeResult).toMatchObject({
      updatedCount: 0,
      results: [{ success: true }],
    });
    expect(
      await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.taskId, task.id)),
    ).toEqual([attached]);
    expect(capturedEvents).toEqual([]);
  });
});
