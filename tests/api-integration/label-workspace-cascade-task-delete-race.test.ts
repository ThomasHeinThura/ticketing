import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

const DELETE_BARRIER_NAMESPACE = 4_006;
const DELETE_BARRIER_KEY = "taskdesk_workspace_label_task_delete_race";
const deletedLabelEvents: Array<{ taskId?: string }> = [];
let hasEventSubscriber = false;

async function waitForBlockedPid(client: Client, blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ pid: number }>(
      `
        SELECT pid
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND $1 = ANY(pg_blocking_pids(pid))
        LIMIT 1
      `,
      [blockerPid],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No PostgreSQL session blocked by pid ${blockerPid}`);
}

async function raceWorkspaceLabelOperationWithTaskDelete(
  app: ReturnType<typeof createApp>["app"],
  taskId: string,
  labelId: string,
  operation: "rename" | "delete",
) {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `label_task_delete_race_${suffix}_fn`;
  const triggerName = `label_task_delete_race_${suffix}`;
  const escapedTaskId = taskId.replaceAll("'", "''");
  let barrierHeld = false;
  let deleteRequest: Promise<Response> | undefined;
  let labelRequest: Promise<Response> | undefined;

  await client.connect();
  try {
    await client.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.id = '${escapedTaskId}' THEN
          PERFORM pg_advisory_lock(
            ${DELETE_BARRIER_NAMESPACE}, hashtext('${DELETE_BARRIER_KEY}')
          );
          PERFORM pg_advisory_unlock(
            ${DELETE_BARRIER_NAMESPACE}, hashtext('${DELETE_BARRIER_KEY}')
          );
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
    await client.query(
      `SELECT pg_advisory_lock(${DELETE_BARRIER_NAMESPACE}, hashtext('${DELETE_BARRIER_KEY}'))`,
    );
    barrierHeld = true;
    const barrierPidResult = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const barrierPid = barrierPidResult.rows[0]?.pid;
    if (barrierPid === undefined) {
      throw new Error("Could not read task-delete barrier pid");
    }

    deleteRequest = Promise.resolve(
      app.request(`/api/task/${taskId}`, { method: "DELETE" }),
    );
    const deletePid = await waitForBlockedPid(client, barrierPid);

    labelRequest = Promise.resolve(
      operation === "rename"
        ? app.request(`/api/label/${labelId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "After task delete", color: "blue" }),
          })
        : app.request(`/api/label/${labelId}`, { method: "DELETE" }),
    );
    await waitForBlockedPid(client, deletePid);

    await client.query(
      `SELECT pg_advisory_unlock(${DELETE_BARRIER_NAMESPACE}, hashtext('${DELETE_BARRIER_KEY}'))`,
    );
    barrierHeld = false;
    const [deleteResponse, labelResponse] = await Promise.all([
      deleteRequest,
      labelRequest,
    ]);
    return { deleteResponse, labelResponse };
  } finally {
    if (barrierHeld) {
      await client.query(
        `SELECT pg_advisory_unlock(${DELETE_BARRIER_NAMESPACE}, hashtext('${DELETE_BARRIER_KEY}'))`,
      );
    }
    await Promise.allSettled(
      [deleteRequest, labelRequest].filter(
        (request): request is Promise<Response> => request !== undefined,
      ),
    );
    await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON task`);
    await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await client.end();
  }
}

describe("API integration: workspace-label cascade vs task deletion", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    deletedLabelEvents.length = 0;
    if (!hasEventSubscriber) {
      hasEventSubscriber = true;
      await subscribeToEvent("task.label_deleted", async (data) => {
        const event = data as { taskId?: string };
        deletedLabelEvents.push(event);
      });
    }
  });

  it("workspace-label rename tolerates a copy removed while waiting for its task", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Rename race task",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );
    const label = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: member.workspace.id,
          taskId: null,
          name: "Before task delete",
          color: "red",
        })
        .returning(),
      "workspace label",
    );
    await db.insert(schema.labelTable).values({
      workspaceId: member.workspace.id,
      taskId: task.id,
      name: label.name,
      color: label.color,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const { deleteResponse, labelResponse } =
      await raceWorkspaceLabelOperationWithTaskDelete(
        app,
        task.id,
        label.id,
        "rename",
      );
    expect(deleteResponse.status).toBe(200);
    expect(labelResponse.status).toBe(200);

    const [renamedLabel] = await db
      .select()
      .from(schema.labelTable)
      .where(eq(schema.labelTable.id, label.id));
    expect(renamedLabel).toMatchObject({
      name: "After task delete",
      color: "blue",
    });
    expect(
      await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.taskId, task.id)),
    ).toHaveLength(0);
    expect(deletedLabelEvents).toHaveLength(0);
  });

  it("workspace-label delete emits only events for copies it actually deletes", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Delete race task",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );
    const label = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: member.workspace.id,
          taskId: null,
          name: "Delete race label",
          color: "red",
        })
        .returning(),
      "workspace label",
    );
    await db.insert(schema.labelTable).values({
      workspaceId: member.workspace.id,
      taskId: task.id,
      name: label.name,
      color: label.color,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const { deleteResponse, labelResponse } =
      await raceWorkspaceLabelOperationWithTaskDelete(
        app,
        task.id,
        label.id,
        "delete",
      );
    expect(deleteResponse.status).toBe(200);
    expect(labelResponse.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.workspaceId, member.workspace.id)),
    ).toHaveLength(0);
    expect(
      deletedLabelEvents.filter((event) => event.taskId === task.id),
    ).toHaveLength(0);
  });
});
