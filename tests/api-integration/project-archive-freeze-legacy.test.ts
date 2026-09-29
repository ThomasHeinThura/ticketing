import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import {
  raceProjectArchive,
  raceProjectSoftDelete,
} from "./helpers/race-soft-delete";

async function request(
  path: string,
  method: "post" | "put" | "patch" | "delete",
  body?: unknown,
) {
  const { app } = createApp();
  return await app.request(`/api${path}`, {
    method: method.toUpperCase(),
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

async function createLegacyTask(
  projectId: string,
  columnId: string,
  number: number,
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Legacy task ${number}`,
      description: "Original description",
      status: "to-do",
      columnId,
      priority: "medium",
      number,
      position: number,
    })
    .returning();
  return requireRow([task], "legacy task");
}

describe("API integration: legacy task writes respect PR-15 project archive freeze", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.stubEnv("S3_ENDPOINT", "https://storage.example.test");
    vi.stubEnv("S3_BUCKET", "test-bucket");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", "s3");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses every legacy task write family after archive without changing child data", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const destination = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await createLegacyTask(project.id, columns.todo.id, 1);
    const targetTask = await createLegacyTask(project.id, columns.todo.id, 2);
    const comment = requireRow(
      await db
        .insert(schema.taskActivityTable)
        .values({
          taskId: task.id,
          type: "comment",
          userId: member.user.id,
          content: "Before archive",
        })
        .returning(),
      "comment",
    );
    const relation = requireRow(
      await db
        .insert(schema.taskRelationTable)
        .values({
          sourceTaskId: task.id,
          targetTaskId: targetTask.id,
          relationType: "related",
        })
        .returning(),
      "task relation",
    );
    const timeEntry = requireRow(
      await db
        .insert(schema.timeEntryTable)
        .values({
          taskId: task.id,
          userId: member.user.id,
          description: "Before archive",
          startTime: new Date("2026-09-28T09:00:00Z"),
        })
        .returning(),
      "time entry",
    );
    const workspaceLabel = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: member.workspace.id,
          name: "Urgent",
          color: "red",
        })
        .returning(),
      "workspace label",
    );
    const taskLabel = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: member.workspace.id,
          taskId: task.id,
          name: "Urgent",
          color: "red",
        })
        .returning(),
      "task label",
    );
    mockAuthenticatedSession(member.user);
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const cases: Array<[string, () => Promise<Response>]> = [
      [
        "create task",
        () =>
          request(`/task/${project.id}`, "post", {
            title: "must not create",
            description: "",
            priority: "medium",
            status: "to-do",
          }),
      ],
      [
        "import tasks",
        () =>
          request(`/task/import/${project.id}`, "post", {
            tasks: [{ title: "must not import", status: "to-do" }],
          }),
      ],
      [
        "bulk update",
        () =>
          request("/task/bulk", "patch", {
            taskIds: [task.id],
            operation: "updatePriority",
            value: "high",
          }),
      ],
      [
        "full task update",
        () =>
          request(`/task/${task.id}`, "put", {
            title: "must not update",
            description: "changed",
            priority: "high",
            status: "to-do",
            projectId: project.id,
            position: 9,
          }),
      ],
      [
        "status update",
        () => request(`/task/status/${task.id}`, "put", { status: "done" }),
      ],
      [
        "priority update",
        () => request(`/task/priority/${task.id}`, "put", { priority: "high" }),
      ],
      [
        "assignee update",
        () => request(`/task/assignee/${task.id}`, "put", { userId: null }),
      ],
      [
        "due-date update",
        () =>
          request(`/task/due-date/${task.id}`, "put", {
            dueDate: "2026-10-01T00:00:00.000Z",
          }),
      ],
      [
        "title update",
        () => request(`/task/title/${task.id}`, "put", { title: "changed" }),
      ],
      [
        "description update",
        () =>
          request(`/task/description/${task.id}`, "put", {
            description: "changed",
          }),
      ],
      [
        "task move",
        () =>
          request(`/task/move/${task.id}`, "put", {
            destinationProjectId: destination.project.id,
          }),
      ],
      ["task delete", () => request(`/task/${task.id}`, "delete")],
      [
        "comment create",
        () =>
          request(`/comment/${task.id}`, "post", { content: "new comment" }),
      ],
      [
        "activity create",
        () =>
          request("/activity/create", "post", {
            taskId: task.id,
            message: "new activity",
            type: "external_event",
          }),
      ],
      [
        "comment update",
        () =>
          request(`/comment/${comment.id}`, "put", {
            content: "edited after archive",
          }),
      ],
      ["comment delete", () => request(`/comment/${comment.id}`, "delete")],
      [
        "relation create",
        () =>
          request("/task-relation/", "post", {
            sourceTaskId: task.id,
            targetTaskId: targetTask.id,
            relationType: "blocks",
          }),
      ],
      [
        "relation delete",
        () => request(`/task-relation/${relation.id}`, "delete"),
      ],
      [
        "time entry create",
        () =>
          request("/time-entry/", "post", {
            taskId: task.id,
            startTime: "2026-09-29T09:00:00Z",
            description: "new entry",
          }),
      ],
      [
        "time entry update",
        () =>
          request(`/time-entry/${timeEntry.id}`, "put", {
            startTime: "2026-09-28T10:00:00Z",
            description: "edited after archive",
          }),
      ],
      [
        "task label create",
        () =>
          request("/label/", "post", {
            workspaceId: member.workspace.id,
            taskId: task.id,
            name: "New label",
            color: "blue",
          }),
      ],
      [
        "label attach",
        () =>
          request(`/label/${workspaceLabel.id}/task`, "put", {
            taskId: task.id,
          }),
      ],
      ["label detach", () => request(`/label/${taskLabel.id}/task`, "delete")],
      [
        "task label update",
        () =>
          request(`/label/${taskLabel.id}`, "put", {
            name: "Changed",
            color: "blue",
          }),
      ],
      ["task label delete", () => request(`/label/${taskLabel.id}`, "delete")],
      [
        "workspace label cascade update",
        () =>
          request(`/label/${workspaceLabel.id}`, "put", {
            name: "Changed",
            color: "blue",
          }),
      ],
      [
        "workspace label cascade delete",
        () => request(`/label/${workspaceLabel.id}`, "delete"),
      ],
      [
        "image upload URL",
        () =>
          request(`/task/image-upload/${task.id}`, "put", {
            filename: "frozen.png",
            contentType: "image/png",
            size: 123,
            surface: "description",
          }),
      ],
      [
        "image finalize",
        () =>
          request(`/task/image-upload/${task.id}/finalize`, "post", {
            key: `workspace/${member.workspace.id}/project/${project.id}/task/${task.id}/descriptions/frozen.png`,
            filename: "frozen.png",
            contentType: "image/png",
            size: 123,
            surface: "description",
          }),
      ],
    ];

    for (const [name, send] of cases) {
      const response = await send();
      expect(response.status, name).toBe(404);
    }

    const [taskAfter] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(taskAfter?.title).toBe(task.title);
    expect(taskAfter?.description).toBe(task.description);
    expect(
      await db
        .select()
        .from(schema.taskActivityTable)
        .where(eq(schema.taskActivityTable.taskId, task.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.taskRelationTable)
        .where(
          and(
            eq(schema.taskRelationTable.sourceTaskId, task.id),
            eq(schema.taskRelationTable.targetTaskId, targetTask.id),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.timeEntryTable)
        .where(eq(schema.timeEntryTable.id, timeEntry.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.taskId, task.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.assetTable)
        .where(eq(schema.assetTable.taskId, task.id)),
    ).toHaveLength(0);
  });

  it("waits behind an archive that wins, then refuses the legacy write", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await createLegacyTask(project.id, columns.todo.id, 1);
    mockAuthenticatedSession(member.user);

    const race = await raceProjectArchive(project.id, () =>
      request(`/task/title/${task.id}`, "put", { title: "must not persist" }),
    );

    expect(race.blockedOnRowLock).toBe(true);
    expect(race.operation.status).toBe("fulfilled");
    if (race.operation.status !== "fulfilled") {
      throw new Error("legacy title update should return an HTTP response");
    }
    expect(race.operation.value.status).toBe(404);
    const [after] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(after?.title).toBe(task.title);
  });

  it("archive loses cleanly when project soft-delete wins the lifecycle race", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const race = await raceProjectSoftDelete(project.id, () =>
      request(`/project/${project.id}/archive`, "put"),
    );

    expect(race.blockedOnRowLock).toBe(true);
    expect(race.operation.status).toBe("fulfilled");
    if (race.operation.status !== "fulfilled") {
      throw new Error("archive should return an HTTP response");
    }
    expect(race.operation.value.status).toBe(404);
    const [after] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, project.id));
    expect(after?.deletedAt).not.toBeNull();
    expect(after?.archivedAt).toBeNull();
  });

  it("serializes label detach with task deletion in task-first lock order", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await createLegacyTask(project.id, columns.todo.id, 1);
    const taskLabel = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: member.workspace.id,
          taskId: task.id,
          name: "Concurrent detach",
          color: "red",
        })
        .returning(),
      "task label",
    );
    mockAuthenticatedSession(member.user);

    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `task_delete_barrier_${suffix}`;
    const triggerName = `task_delete_barrier_${suffix}`;
    const advisoryKey = Number.parseInt(suffix.slice(0, 7), 16);
    const escapedTaskId = task.id.replaceAll("'", "''");
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await client.connect();

    let deleteRequest: Promise<Response> | undefined;
    let detachRequest: Promise<Response> | undefined;
    let advisoryLockHeld = false;
    try {
      await client.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.id = '${escapedTaskId}' THEN
            PERFORM pg_advisory_lock(${advisoryKey});
            PERFORM pg_advisory_unlock(${advisoryKey});
          END IF;
          RETURN OLD;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE DELETE ON task
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `);
      await client.query("SELECT pg_advisory_lock($1::bigint)", [advisoryKey]);
      advisoryLockHeld = true;
      const lockOwner = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const barrierPid = lockOwner.rows[0]?.pid;
      if (barrierPid === undefined) {
        throw new Error("could not read lock barrier backend pid");
      }

      deleteRequest = request(`/task/${task.id}`, "delete");

      let deleteBackendPid: number | undefined;
      const deleteDeadline = Date.now() + 5_000;
      while (!deleteBackendPid && Date.now() < deleteDeadline) {
        const blockedDelete = await client.query<{ pid: number }>(
          `
            SELECT pid
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND $1 = ANY(pg_blocking_pids(pid))
            LIMIT 1
          `,
          [barrierPid],
        );
        deleteBackendPid = blockedDelete.rows[0]?.pid;
        if (!deleteBackendPid) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      expect(
        deleteBackendPid,
        "task delete reached its deterministic barrier",
      ).toBeDefined();

      detachRequest = request(`/label/${taskLabel.id}/task`, "delete");
      let detachBlockedByDelete = false;
      const detachDeadline = Date.now() + 5_000;
      while (!detachBlockedByDelete && Date.now() < detachDeadline) {
        const blockedDetach = await client.query<{ waiting: boolean }>(
          `
            SELECT EXISTS (
              SELECT 1
              FROM pg_stat_activity
              WHERE datname = current_database()
                AND pid <> pg_backend_pid()
                AND wait_event_type = 'Lock'
                AND $1 = ANY(pg_blocking_pids(pid))
            ) AS waiting
          `,
          [deleteBackendPid],
        );
        detachBlockedByDelete = blockedDetach.rows[0]?.waiting === true;
        if (!detachBlockedByDelete) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      expect(
        detachBlockedByDelete,
        "label detach waits on the task lock without holding the label row",
      ).toBe(true);

      await client.query("SELECT pg_advisory_unlock($1::bigint)", [
        advisoryKey,
      ]);
      advisoryLockHeld = false;
      const [deleteResponse, detachResponse] = await Promise.all([
        deleteRequest,
        detachRequest,
      ]);
      expect(deleteResponse.status).toBe(200);
      expect(detachResponse.status).toBe(404);
      expect(
        await db
          .select()
          .from(schema.taskTable)
          .where(eq(schema.taskTable.id, task.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.labelTable)
          .where(eq(schema.labelTable.id, taskLabel.id)),
      ).toHaveLength(0);
    } finally {
      if (advisoryLockHeld) {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [
          advisoryKey,
        ]);
      }
      await Promise.allSettled([deleteRequest, detachRequest].filter(Boolean));
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON task`);
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
    }
  });
});
