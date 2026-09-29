import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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

const INSERT_BARRIER_NAMESPACE = 4_005;
const INSERT_BARRIER_KEY = "taskdesk_bulk_label_rename_race";
const recordedEvents: Array<{ taskId?: string }> = [];

async function waitForBlockedPid(
  client: Client,
  blockerPid: number,
): Promise<number> {
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

describe("API integration: bulk label name-family locking", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordedEvents.length = 0;
    await subscribeToEvent("task.label_assigned", async (data) => {
      const event = data as { taskId?: string };
      recordedEvents.push(event);
    });
  });

  it("bulk add serializes with a workspace-label rename before task locks", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Bulk label race task",
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
          name: "Bulk race label",
          color: "red",
        })
        .returning(),
      "workspace label",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const triggerSuffix = randomUUID().replaceAll("-", "");
    const triggerName = `pause_bulk_label_${triggerSuffix}`;
    const functionName = `${triggerName}_fn`;
    let barrierHeld = false;
    let bulkRequest: Promise<Response> | undefined;
    let renameRequest: Promise<Response> | undefined;

    await client.connect();
    try {
      await client.query(
        `SELECT pg_advisory_lock(${INSERT_BARRIER_NAMESPACE}, hashtext('${INSERT_BARRIER_KEY}'))`,
      );
      barrierHeld = true;
      const barrierPidResult = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const barrierPid = barrierPidResult.rows[0]?.pid;
      if (barrierPid === undefined) {
        throw new Error("Could not read label insert barrier pid");
      }

      await client.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.task_id IS NOT NULL AND NEW.name = 'Bulk race label' THEN
            PERFORM pg_advisory_xact_lock(
              ${INSERT_BARRIER_NAMESPACE}, hashtext('${INSERT_BARRIER_KEY}')
            );
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON label
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `);

      const bulkPending = Promise.resolve(
        app.request("/api/task/bulk", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskIds: [task.id],
            operation: "addLabel",
            value: label.id,
          }),
        }),
      );
      bulkRequest = bulkPending;
      const bulkPid = await waitForBlockedPid(client, barrierPid);

      const renamePending = Promise.resolve(
        app.request(`/api/label/${label.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Bulk race renamed", color: "blue" }),
        }),
      );
      renameRequest = renamePending;
      await waitForBlockedPid(client, bulkPid);

      await client.query(
        `SELECT pg_advisory_unlock(${INSERT_BARRIER_NAMESPACE}, hashtext('${INSERT_BARRIER_KEY}'))`,
      );
      barrierHeld = false;

      const [bulkResponse, renameResponse] = await Promise.all([
        bulkPending,
        renamePending,
      ]);
      expect(bulkResponse.status).toBe(200);
      expect(renameResponse.status).toBe(200);

      const [copy] = await db
        .select()
        .from(schema.labelTable)
        .where(
          and(
            eq(schema.labelTable.workspaceId, member.workspace.id),
            eq(schema.labelTable.taskId, task.id),
          ),
        );
      expect(copy).toMatchObject({
        name: "Bulk race renamed",
        color: "blue",
      });
      expect(
        recordedEvents.filter((event) => event.taskId === task.id),
      ).toHaveLength(1);
    } finally {
      if (barrierHeld) {
        await client.query(
          `SELECT pg_advisory_unlock(${INSERT_BARRIER_NAMESPACE}, hashtext('${INSERT_BARRIER_KEY}'))`,
        );
      }
      await Promise.allSettled(
        [bulkRequest, renameRequest].filter(
          (request): request is Promise<Response> => request !== undefined,
        ),
      );
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON label`);
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
    }
  });
});
