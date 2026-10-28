import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { processNextParentEvent } from "../../apps/api/src/events/outbox-consumer";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import updateTaskStatus from "../../apps/api/src/task/controllers/update-task-status";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

async function fixture() {
  const member = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantWorkItemProjectAccess(member.user.id, project.id);
  const recipientId = `legacy-bridge-recipient-${randomUUID()}`;
  const recipient = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: recipientId,
        email: `${recipientId}@example.com`,
        emailVerified: true,
        name: "Legacy bridge recipient",
      })
      .returning(),
    "legacy bridge recipient",
  );
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: member.workspace.id,
    userId: recipient.id,
    role: "member",
    joinedAt: new Date(),
  });
  await db.insert(schema.personTable).values({
    userId: recipient.id,
    organisationId: member.workspace.organisationId,
    side: "staff",
    displayName: recipient.name,
  });
  await grantWorkItemProjectAccess(recipient.id, project.id);
  const identity = await resolveIdentity({
    userId: member.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("Expected a task mutation identity");
  const task = requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        userId: recipient.id,
        title: "Bridge task",
        status: "to-do",
      })
      .returning(),
    "legacy bridge task",
  );
  return { identity, member, project, recipient, task };
}

async function failLegacyBridgeInsert() {
  const connectionString = process.env.TASKDESK_DATABASE_URL;
  if (!connectionString) throw new Error("Missing integration DB connection");
  const client = new Client({ connectionString });
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `legacy_bridge_${suffix}_fn`;
  const triggerName = `legacy_bridge_${suffix}`;
  await client.connect();
  try {
    await client.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.kind = 'task.status_changed' THEN
          RAISE EXCEPTION 'forced compatibility event insert failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON outbox
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    return async () => {
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON outbox`);
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
    };
  } catch (error) {
    await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON outbox`);
    await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await client.end();
    throw error;
  }
}

describe("legacy task outbox compatibility bridge", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("writes one workspace-scoped compatibility parent atomically and replay drains it once", async () => {
    const { identity, member, project, recipient, task } = await fixture();
    await updateTaskStatus({
      identity,
      id: task.id,
      status: "in-progress",
      currentUserId: member.user.id,
    });

    const events = await db.query.outboxTable.findMany({
      where: eq(schema.outboxTable.kind, "task.status_changed"),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ workspaceId: member.workspace.id });
    expect(events[0]?.payload).toMatchObject({
      id: events[0]?.eventId,
      kind: "task.status_changed",
      actor: { type: "person", id: identity.personId },
      scope: { workspaceId: member.workspace.id, projectId: project.id },
      payload: {
        taskId: task.id,
        key: task.id,
        projectId: project.id,
        oldStatus: "to-do",
        newStatus: "in-progress",
      },
    });
    expect(identity.personId).not.toBe(member.user.id);
    const notificationsBeforeReplay = await db.query.notificationTable.findMany(
      {
        where: and(
          eq(schema.notificationTable.userId, recipient.id),
          eq(schema.notificationTable.resourceId, task.id),
          eq(schema.notificationTable.type, "task_status_changed"),
        ),
      },
    );
    expect(notificationsBeforeReplay).toHaveLength(1);

    await expect(processNextParentEvent()).resolves.toEqual({
      kind: "delivered",
      eventId: events[0]?.eventId,
    });
    await expect(processNextParentEvent()).resolves.toEqual({ kind: "idle" });
    expect(
      await db.query.outboxTable.findMany({
        where: eq(schema.outboxTable.kind, "task.status_changed"),
      }),
    ).toHaveLength(1);
    const connectionString = process.env.TASKDESK_DATABASE_URL;
    if (!connectionString) throw new Error("Missing integration DB connection");
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const [webhookDeliveries, automationRuns] = await Promise.all([
        client.query(
          "SELECT event_id FROM webhook_delivery WHERE event_id = $1",
          [events[0]?.eventId],
        ),
        client.query(
          "SELECT event_id FROM automation_run WHERE event_id = $1",
          [events[0]?.eventId],
        ),
      ]);
      expect(webhookDeliveries.rowCount).toBe(0);
      expect(automationRuns.rowCount).toBe(0);
    } finally {
      await client.end();
    }
    expect(
      await db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.userId, recipient.id),
          eq(schema.notificationTable.resourceId, task.id),
          eq(schema.notificationTable.type, "task_status_changed"),
        ),
      }),
    ).toEqual(notificationsBeforeReplay);
  });

  it("attributes an HTTP API-key task mutation to the authenticated key id", async () => {
    const { member, task } = await fixture();
    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Expected a task mutation identity");
    const key = await createPersonalApiKey(
      { userId: member.user.id },
      {
        name: "Legacy task bridge attribution",
        capabilities: ["project:read", "work_item:read", "work_item:update"],
      },
    );
    const { app } = createApp();
    const response = await app.request(`/api/task/status/${task.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-api-key": key.key,
      },
      body: JSON.stringify({ status: "in-progress" }),
    });
    expect(response.status).toBe(200);

    const event = await db.query.outboxTable.findFirst({
      where: eq(schema.outboxTable.kind, "task.status_changed"),
    });
    expect(event?.payload).toMatchObject({
      actor: { type: "api_key", id: key.id },
    });
    expect(key.id).not.toBe(identity.personId);
    expect(identity.personId).not.toBe(member.user.id);
  });

  it("does not write a compatibility parent for a status no-op", async () => {
    const { identity, member, task } = await fixture();
    await updateTaskStatus({
      identity,
      id: task.id,
      status: "to-do",
      currentUserId: member.user.id,
    });
    expect(
      await db.query.outboxTable.findMany({
        where: eq(schema.outboxTable.kind, "task.status_changed"),
      }),
    ).toHaveLength(0);
  });

  it("rolls back the task mutation when its transactional compatibility insert fails", async () => {
    const { identity, member, task } = await fixture();
    const closeTrigger = await failLegacyBridgeInsert();
    try {
      await expect(
        updateTaskStatus({
          identity,
          id: task.id,
          status: "in-progress",
          currentUserId: member.user.id,
        }),
      ).rejects.toThrow();
    } finally {
      await closeTrigger();
    }

    expect(
      await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      }),
    ).toMatchObject({ status: "to-do" });
    expect(
      await db.query.taskActivityTable.findMany({
        where: and(
          eq(schema.taskActivityTable.taskId, task.id),
          eq(schema.taskActivityTable.type, "status_changed"),
        ),
      }),
    ).toHaveLength(0);
    expect(
      await db.query.outboxTable.findMany({
        where: eq(schema.outboxTable.kind, "task.status_changed"),
      }),
    ).toHaveLength(0);
  });
});
