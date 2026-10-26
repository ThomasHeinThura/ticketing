import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import updateTaskStatus from "../../apps/api/src/task/controllers/update-task-status";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

async function failInsertsFor(
  table: "task_activity" | "notification",
  type: string,
) {
  const connectionString = process.env.TASKDESK_DATABASE_URL;
  if (!connectionString) throw new Error("Missing integration DB connection");
  const client = new Client({ connectionString });
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `legacy_event_atomicity_${suffix}_fn`;
  const triggerName = `legacy_event_atomicity_${suffix}`;
  await client.connect();
  try {
    await client.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = '${type}' THEN
          RAISE EXCEPTION 'forced legacy side effect insert failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    return async () => {
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
    };
  } catch (error) {
    await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
    await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await client.end();
    throw error;
  }
}

async function fixture() {
  const member = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantWorkItemProjectAccess(member.user.id, project.id);

  const recipientId = `legacy-event-recipient-${randomUUID()}`;
  const recipient = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: recipientId,
        email: `${recipientId}@example.com`,
        emailVerified: true,
        name: "Legacy event recipient",
      })
      .returning(),
    "legacy event recipient user",
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
        title: "Atomic status change",
        status: "to-do",
      })
      .returning(),
    "legacy event atomicity task",
  );
  return { identity, member, recipient, task };
}

describe("legacy task event side-effect atomicity", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rolls back a task mutation when its required activity insert fails", async () => {
    const { identity, member, task } = await fixture();
    const closeTrigger = await failInsertsFor(
      "task_activity",
      "status_changed",
    );
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
        where: eq(schema.taskActivityTable.taskId, task.id),
      }),
    ).toHaveLength(0);
    expect(
      await db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.resourceId, task.id),
          eq(schema.notificationTable.type, "task_status_changed"),
        ),
      }),
    ).toHaveLength(0);
  });

  it("rolls back the mutation and activity when its inbox insert fails", async () => {
    const { identity, member, recipient, task } = await fixture();
    const closeTrigger = await failInsertsFor(
      "notification",
      "task_status_changed",
    );
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
        where: eq(schema.taskActivityTable.taskId, task.id),
      }),
    ).toHaveLength(0);
    expect(
      await db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.userId, recipient.id),
          eq(schema.notificationTable.resourceId, task.id),
          eq(schema.notificationTable.type, "task_status_changed"),
        ),
      }),
    ).toHaveLength(0);
  });

  it("commits one activity and the existing reach-scoped notification", async () => {
    const { identity, member, recipient, task } = await fixture();
    const updated = await updateTaskStatus({
      identity,
      id: task.id,
      status: "in-progress",
      currentUserId: member.user.id,
    });
    expect(updated.status).toBe("in-progress");

    const [activities, notifications] = await Promise.all([
      db.query.taskActivityTable.findMany({
        where: and(
          eq(schema.taskActivityTable.taskId, task.id),
          eq(schema.taskActivityTable.type, "status_changed"),
        ),
      }),
      db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.userId, recipient.id),
          eq(schema.notificationTable.resourceId, task.id),
          eq(schema.notificationTable.type, "task_status_changed"),
        ),
      }),
    ]);
    expect(activities).toHaveLength(1);
    expect(activities[0]?.eventData).toMatchObject({
      oldStatus: "to-do",
      newStatus: "in-progress",
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.eventData).toMatchObject({
      taskTitle: "Atomic status change",
      oldStatus: "to-do",
      newStatus: "in-progress",
    });
  });
});
