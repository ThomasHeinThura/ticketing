import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { createServiceApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveServicePrincipal } from "../../apps/api/src/permissions/service-principal";
import createTimeEntry from "../../apps/api/src/time-entry/controllers/create-time-entry";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessToWorkspaceMembers,
  requireRow,
} from "./helpers/fixtures";
import { setProjectTimeFlag, setTimeFlags } from "./helpers/p5-time";
import { makeApiKey } from "./helpers/reach-world";

const START = "2026-01-01T09:00:00.000Z";
const END = "2026-01-01T10:00:00.000Z";
type User = Parameters<typeof mockAuthenticatedSession>[0];

function call(method: string, path: string, body?: unknown, apiKey?: string) {
  const { app } = createApp();
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function world() {
  const a = await createWorkspaceMember({ role: "member" });
  const b = await createWorkspaceMember({ role: "member" });
  const admin = await createWorkspaceMember({ role: "admin" });
  for (const actor of [b, admin])
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: a.workspace.id,
      userId: actor.user.id,
      role: actor === b ? "member" : "admin",
      joinedAt: new Date(),
    });
  const { project, columns } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  await grantProjectAccessToWorkspaceMembers(a.workspace.id, project.id);
  const task = requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Tracked",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning(),
    "task",
  );
  await setTimeFlags(a.workspace.id);
  return { a, b, admin, project, task };
}

async function createEntry(user: User, taskId: string) {
  mockAuthenticatedSession(user);
  const response = await call("POST", "/api/time-entry", {
    taskId,
    startTime: START,
    endTime: END,
    description: "original",
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; userId: string };
}

async function stored(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.taskTimeEntryTable)
      .where(eq(schema.taskTimeEntryTable.id, id)),
    "legacy time entry",
  );
}

function update(id: string, description: string, apiKey?: string) {
  return call(
    "PUT",
    `/api/time-entry/${id}`,
    { startTime: START, endTime: END, description },
    apiKey,
  );
}

/** Wait for the request's write transaction to queue on our locked task row. */
async function waitForTaskLockWait(client: Client, blockerPid: number) {
  const deadline = Date.now() + 10_000;
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
    if (result.rows[0]?.pid !== undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Legacy time-entry write did not reach the task-row barrier");
}

/**
 * Admission runs before the controller locks the task. Holding that row forces the exact
 * interleaving: admission succeeds, another transaction changes authority/owner/flag, then
 * the controller resumes and must recheck before writing. The wait observes pg_blocking_pids;
 * no elapsed-time guess decides when to change the database.
 */
async function afterAdmissionBeforeWrite(
  taskId: string,
  request: () => Promise<Response>,
  change: (client: Client) => Promise<void>,
) {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  await client.connect();
  let transactionOpen = false;
  let pending: Promise<Response> | undefined;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const locked = await client.query(
      "SELECT id FROM task WHERE id = $1 FOR UPDATE",
      [taskId],
    );
    expect(locked.rowCount).toBe(1);
    const backend = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const blockerPid = backend.rows[0]?.pid;
    if (blockerPid === undefined)
      throw new Error("Task barrier PID unavailable");

    pending = request();
    await waitForTaskLockWait(client, blockerPid);
    await change(client);
    await client.query("COMMIT");
    transactionOpen = false;
    return await pending;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    if (pending) await Promise.allSettled([pending]);
    await client.end();
  }
}

describe("legacy time-entry canonical boundary", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets a member edit their own entry, denies another member, and lets an admin edit it", async () => {
    const w = await world();
    const entry = await createEntry(w.b.user, w.task.id);
    expect(entry.userId).toBe(w.b.user.id);

    const own = await update(entry.id, "own edit");
    expect(own.status).toBe(200);
    expect((await stored(entry.id)).description).toBe("own edit");

    mockAuthenticatedSession(w.a.user);
    const before = await stored(entry.id);
    const foreign = await update(entry.id, "cross-owner edit");
    expect(foreign.status).toBe(403);
    expect(await stored(entry.id)).toEqual(before);

    mockAuthenticatedSession(w.admin.user);
    const any = await update(entry.id, "admin edit");
    expect(any.status).toBe(200);
    expect((await stored(entry.id)).description).toBe("admin edit");
  });

  it("intersects personal API-key scope with own/any authority", async () => {
    const w = await world();
    const entry = await createEntry(w.a.user, w.task.id);
    const before = await stored(entry.id);
    const readKey = await makeApiKey(w.a.user.id, {
      project: ["read"],
      work_item: ["read"],
      time_entry: ["read_any"],
    });
    const ownKey = await makeApiKey(w.a.user.id, {
      project: ["read"],
      work_item: ["read"],
      time_entry: ["update_own"],
    });
    const adminReadKey = await makeApiKey(w.admin.user.id, {
      project: ["read"],
      work_item: ["read"],
      time_entry: ["read_any"],
    });
    mockAnonymousSession();

    expect((await update(entry.id, "read key edit", readKey)).status).toBe(403);
    expect(await stored(entry.id)).toEqual(before);
    expect(
      (await update(entry.id, "admin read key edit", adminReadKey)).status,
    ).toBe(403);
    expect(await stored(entry.id)).toEqual(before);
    expect((await update(entry.id, "own key edit", ownKey)).status).toBe(200);
    expect((await stored(entry.id)).description).toBe("own key edit");
    const createWithReadKey = await call(
      "POST",
      "/api/time-entry",
      { taskId: w.task.id, startTime: START, endTime: END },
      readKey,
    );
    expect(createWithReadKey.status).toBe(403);
  });

  it("masks a real service key at the project lookup and refuses its personless direct write", async () => {
    const w = await world();
    const existing = await createEntry(w.a.user, w.task.id);
    const before = await stored(existing.id);
    const created = await createServiceApiKey(
      { userId: w.admin.user.id },
      w.a.workspace.id,
      {
        name: "time-entry-service-probe",
        capabilities: [
          "work_item:read",
          "time_entry:create",
          "time_entry:update_any",
        ],
      },
    );
    mockAnonymousSession();
    const post = await call(
      "POST",
      "/api/time-entry",
      { taskId: w.task.id, startTime: START, endTime: END },
      created.key,
    );
    const put = await update(existing.id, "service key edit", created.key);
    // Lookup-backed routes mask missing project reach as 404 before the person check.
    expect(post.status).toBe(404);
    expect(put.status).toBe(404);
    expect(await stored(existing.id)).toEqual(before);
    const entries = await db
      .select({ id: schema.taskTimeEntryTable.id })
      .from(schema.taskTimeEntryTable)
      .where(eq(schema.taskTimeEntryTable.taskId, w.task.id));
    expect(entries).toHaveLength(1);

    const principal = await resolveServicePrincipal({
      apiKeyId: created.id,
      workspaceId: w.a.workspace.id,
      capabilities: ["time_entry:create", "time_entry:update_any"],
    });
    expect(principal).not.toBeNull();
    if (!principal) throw new Error("Service principal unavailable");
    await expect(
      createTimeEntry({
        taskId: w.task.id,
        identity: principal,
        credential: {
          kind: "api_key",
          scope: { permissions: { time_entry: ["create", "update_any"] } },
        },
        startTime: new Date(START),
        endTime: new Date(END),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await db
        .select({ id: schema.taskTimeEntryTable.id })
        .from(schema.taskTimeEntryTable)
        .where(eq(schema.taskTimeEntryTable.taskId, w.task.id)),
    ).toHaveLength(1);
  });

  it("lets an update_any admin edit an entry whose former owner has no linked user", async () => {
    const w = await world();
    const entry = await createEntry(w.b.user, w.task.id);
    await db
      .update(schema.taskTimeEntryTable)
      .set({ userId: null })
      .where(eq(schema.taskTimeEntryTable.id, entry.id));

    mockAuthenticatedSession(w.a.user);
    expect((await update(entry.id, "member edit")).status).toBe(403);
    mockAuthenticatedSession(w.admin.user);
    expect((await update(entry.id, "admin edit")).status).toBe(200);
    const after = await stored(entry.id);
    expect(after.userId).toBeNull();
    expect(after.description).toBe("admin edit");
  });

  it("denies a mutation after the member loses project reach", async () => {
    const w = await world();
    const entry = await createEntry(w.b.user, w.task.id);
    const before = await stored(entry.id);
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, w.b.user.id))
      .limit(1);
    expect(person).toBeDefined();
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person?.id ?? ""),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, w.project.id),
        ),
      );
    const response = await update(entry.id, "after reach revoked");
    expect(response.status).toBe(404);
    expect(await stored(entry.id)).toEqual(before);
  });

  it("blocks create and update while time tracking is off at workspace or project level", async () => {
    const w = await world();
    const entry = await createEntry(w.a.user, w.task.id);
    const before = await stored(entry.id);
    await setTimeFlags(w.a.workspace.id, { time: false });
    const workspaceOffCreate = await call("POST", "/api/time-entry", {
      taskId: w.task.id,
      startTime: START,
      endTime: END,
    });
    expect(workspaceOffCreate.status).toBe(409);
    expect((await update(entry.id, "workspace-off edit")).status).toBe(409);
    expect(await stored(entry.id)).toEqual(before);

    await setTimeFlags(w.a.workspace.id, { time: true });
    await setProjectTimeFlag(w.project.id, "feature.time_tracking", false);
    const projectOffCreate = await call("POST", "/api/time-entry", {
      taskId: w.task.id,
      startTime: START,
      endTime: END,
    });
    expect(projectOffCreate.status).toBe(409);
    expect((await update(entry.id, "project-off edit")).status).toBe(409);
    expect(await stored(entry.id)).toEqual(before);
    const entries = await db
      .select({ id: schema.taskTimeEntryTable.id })
      .from(schema.taskTimeEntryTable)
      .where(eq(schema.taskTimeEntryTable.taskId, w.task.id));
    expect(entries).toHaveLength(1);
  });

  it("rechecks a changed persisted owner after admission and leaves the entry body unchanged", async () => {
    const w = await world();
    const entry = await createEntry(w.b.user, w.task.id);
    const response = await afterAdmissionBeforeWrite(
      w.task.id,
      () => update(entry.id, "stale owner edit"),
      async (client) => {
        await client.query(
          "UPDATE task_time_entry SET user_id = $1 WHERE id = $2",
          [w.a.user.id, entry.id],
        );
      },
    );
    expect(response.status).toBe(403);
    const after = await stored(entry.id);
    expect(after.userId).toBe(w.a.user.id);
    expect(after.description).toBe("original");
  });

  it("rechecks a changed workspace role after admission and leaves the entry unchanged", async () => {
    const w = await world();
    const entry = await createEntry(w.b.user, w.task.id);
    const before = await stored(entry.id);
    const response = await afterAdmissionBeforeWrite(
      w.task.id,
      () => update(entry.id, "stale authority edit"),
      async (client) => {
        await client.query(
          "UPDATE workspace_member SET role = 'viewer' WHERE workspace_id = $1 AND user_id = $2",
          [w.a.workspace.id, w.b.user.id],
        );
      },
    );
    expect(response.status).toBe(403);
    expect(await stored(entry.id)).toEqual(before);
  });

  it("rechecks a changed project flag after admission and does not create an entry", async () => {
    const w = await world();
    mockAuthenticatedSession(w.a.user);
    const response = await afterAdmissionBeforeWrite(
      w.task.id,
      () =>
        call("POST", "/api/time-entry", {
          taskId: w.task.id,
          startTime: START,
          endTime: END,
        }),
      async (client) => {
        await client.query(
          `INSERT INTO project_feature_flag (project_id, feature_key, enabled)
           VALUES ($1, 'feature.time_tracking', false)
           ON CONFLICT (project_id, feature_key)
           DO UPDATE SET enabled = false`,
          [w.project.id],
        );
      },
    );
    expect(response.status).toBe(409);
    const entries = await db
      .select({ id: schema.taskTimeEntryTable.id })
      .from(schema.taskTimeEntryTable)
      .where(eq(schema.taskTimeEntryTable.taskId, w.task.id));
    expect(entries).toHaveLength(0);
  });
});
