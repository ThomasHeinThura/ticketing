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

const TASK_UPDATE_BARRIER_NAMESPACE = 4_009;

async function waitForBlockedPid(client: Client, blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await client.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))
       LIMIT 1`,
      [blockerPid],
    );
    if (rows[0]?.pid !== undefined) return rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No PostgreSQL session blocked by pid ${blockerPid}`);
}

async function raceTaskRequestsInLockOrder(
  taskId: string,
  first: () => Response | Promise<Response>,
  second: () => Response | Promise<Response>,
): Promise<[Response, Response]> {
  const blocker = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  const observer = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  const triggerSuffix = randomUUID().replaceAll("-", "");
  const triggerName = `task_version_barrier_${triggerSuffix}`;
  const functionName = `${triggerName}_fn`;
  const barrierKey = `task-version-${triggerSuffix}`;
  let barrierHeld = false;
  let firstRequest: Promise<Response> | undefined;
  let secondRequest: Promise<Response> | undefined;
  await Promise.all([blocker.connect(), observer.connect()]);
  try {
    await blocker.query("SELECT pg_advisory_lock($1, hashtext($2))", [
      TASK_UPDATE_BARRIER_NAMESPACE,
      barrierKey,
    ]);
    barrierHeld = true;
    const { rows } = await blocker.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const blockerPid = rows[0]?.pid;
    if (blockerPid === undefined) throw new Error("Could not read barrier pid");
    await blocker.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.id = '${taskId.replaceAll("'", "''")}' THEN
          PERFORM pg_advisory_xact_lock(
            ${TASK_UPDATE_BARRIER_NAMESPACE}, hashtext('${barrierKey}')
          );
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await blocker.query(`CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);

    const firstResponse = Promise.resolve(first());
    firstRequest = firstResponse;
    const firstPid = await waitForBlockedPid(observer, blockerPid);
    const secondResponse = Promise.resolve(second());
    secondRequest = secondResponse;
    await waitForBlockedPid(observer, firstPid);
    await blocker.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
      TASK_UPDATE_BARRIER_NAMESPACE,
      barrierKey,
    ]);
    barrierHeld = false;
    return await Promise.all([firstResponse, secondResponse]);
  } finally {
    if (barrierHeld) {
      await blocker.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
        TASK_UPDATE_BARRIER_NAMESPACE,
        barrierKey,
      ]);
    }
    await Promise.allSettled([firstRequest, secondRequest]);
    await blocker.query(`DROP TRIGGER IF EXISTS ${triggerName} ON task`);
    await blocker.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await Promise.all([blocker.end(), observer.end()]);
  }
}

describe("API integration: task update concurrency", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("WI-7a: rejects a stale full-task snapshot after a concurrent field update", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Original title",
          description: "Original description",
          priority: "medium",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "task update concurrency fixture",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    let fullUpdateEvents = 0;
    await subscribeToEvent("task.updated", async () => {
      fullUpdateEvents += 1;
    });
    const read = await app.request(`/api/task/${task.id}`);
    expect(read.status).toBe(200);
    const snapshot = (await read.json()) as { version: number };
    expect(snapshot.version).toBe(1);

    const missingRevision = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Must not save",
        description: "",
        priority: "low",
        status: "to-do",
        projectId: project.id,
        position: 1,
      }),
    });
    expect(missingRevision.status).toBe(400);

    const [narrowUpdate, staleUpdate] = await raceTaskRequestsInLockOrder(
      task.id,
      () =>
        app.request(`/api/task/status/${task.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        }),
      () =>
        app.request(`/api/task/${task.id}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "if-match": `"${snapshot.version}"`,
          },
          body: JSON.stringify({
            title: "Stale replacement",
            description: "Stale description",
            priority: "high",
            status: "to-do",
            projectId: project.id,
            position: 1,
          }),
        }),
    );

    expect(narrowUpdate?.status).toBe(200);

    if (!staleUpdate) throw new Error("Full task update did not complete");
    expect(staleUpdate.status).toBe(409);
    await expect(staleUpdate.json()).resolves.toMatchObject({
      assertedVersion: 1,
      currentVersion: 2,
    });

    const persisted = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    expect(persisted).toMatchObject({
      title: "Original title",
      description: "Original description",
      status: "done",
      version: 2,
    });
    expect(fullUpdateEvents).toBe(0);
  });

  it("WI-7a: rejects a stale full-task snapshot after a concurrent assignee update", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "Original title",
          description: "Original description",
          priority: "medium",
          status: "to-do",
          columnId: columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning(),
      "task assignee concurrency fixture",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    let fullUpdateEvents = 0;
    await subscribeToEvent("task.updated", async () => {
      fullUpdateEvents += 1;
    });
    const read = await app.request(`/api/task/${task.id}`);
    expect(read.status).toBe(200);
    const snapshot = (await read.json()) as { version: number };
    expect(snapshot.version).toBe(1);

    const [narrowUpdate, staleUpdate] = await raceTaskRequestsInLockOrder(
      task.id,
      () =>
        app.request(`/api/task/assignee/${task.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: null }),
        }),
      () =>
        app.request(`/api/task/${task.id}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "if-match": `"${snapshot.version}"`,
          },
          body: JSON.stringify({
            title: "Stale replacement",
            description: "Stale description",
            priority: "high",
            status: "to-do",
            projectId: project.id,
            position: 1,
            userId: member.user.id,
          }),
        }),
    );

    expect(narrowUpdate.status).toBe(200);
    expect(staleUpdate.status).toBe(409);
    await expect(staleUpdate.json()).resolves.toMatchObject({
      assertedVersion: 1,
      currentVersion: 2,
    });
    const persisted = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    expect(persisted).toMatchObject({
      title: "Original title",
      description: "Original description",
      userId: null,
      version: 2,
    });
    expect(fullUpdateEvents).toBe(0);
  });
});
