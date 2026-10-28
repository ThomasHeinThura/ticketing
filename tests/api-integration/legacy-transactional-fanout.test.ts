import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import createComment from "../../apps/api/src/activity/controllers/create-comment";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  notificationDeliveryTable,
  notificationDigestTable,
  notificationPreferenceTable,
  projectTable,
} from "../../apps/api/src/database/schema";
import {
  insertLegacyMarkedNotificationForRecovery,
  insertLegacyTaskNotification,
} from "../../apps/api/src/events/legacy-task-effects";
import { processNextParentEvent } from "../../apps/api/src/events/outbox-consumer";
import { createApp } from "../../apps/api/src/index";
import { NotificationProviderOutcomeAmbiguous } from "../../apps/api/src/notification/delivery-errors";
import { legacyTaskNotificationRuntime } from "../../apps/api/src/notification/legacy-task-runtime";
import { processNextNotificationDelivery } from "../../apps/api/src/notification/outbox-drain";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import createTask from "../../apps/api/src/task/controllers/create-task";
import updateTaskAssignee from "../../apps/api/src/task/controllers/update-task-assignee";
import updateTaskStatus from "../../apps/api/src/task/controllers/update-task-status";
import createTaskRelation from "../../apps/api/src/task-relation/controllers/create-task-relation";
import createTimeEntry from "../../apps/api/src/time-entry/controllers/create-time-entry";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

async function fixture() {
  const member = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantWorkItemProjectAccess(member.user.id, project.id);
  const recipientId = `legacy-fanout-recipient-${randomUUID()}`;
  const recipient = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: recipientId,
        email: `${recipientId}@example.com`,
        emailVerified: true,
        name: "Legacy fanout recipient",
      })
      .returning(),
    "legacy fanout recipient",
  );
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: member.workspace.id,
    userId: recipient.id,
    role: "member",
    joinedAt: new Date(),
  });
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: recipient.id,
        organisationId: member.workspace.organisationId,
        side: "staff",
        displayName: recipient.name,
      })
      .returning(),
    "legacy fanout staff person",
  );
  await grantWorkItemProjectAccess(recipient.id, project.id);
  const identity = await resolveIdentity({
    userId: member.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("Expected a staff mutation identity");
  const task = requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        userId: recipient.id,
        title: "Legacy fanout task",
        status: "to-do",
      })
      .returning(),
    "legacy fanout task",
  );
  await db.insert(schema.userNotificationPreferenceTable).values({
    userId: recipient.id,
    emailEnabled: true,
  });
  await db.insert(schema.userNotificationWorkspaceRuleTable).values({
    userId: recipient.id,
    workspaceId: member.workspace.id,
    isActive: true,
    emailEnabled: true,
    projectMode: "all",
  });
  return { identity, member, project, recipient, person, task };
}

async function emitAssigneeComment(input: Awaited<ReturnType<typeof fixture>>) {
  await createComment(
    input.identity,
    input.task.id,
    input.member.user.id,
    "A comment with a persisted legacy recipient",
  );
  return await db
    .select()
    .from(notificationDeliveryTable)
    .where(eq(notificationDeliveryTable.recipientPersonId, input.person.id));
}

async function enableHourlyLegacyCommentDigest(
  input: Awaited<ReturnType<typeof fixture>>,
) {
  await db.insert(notificationPreferenceTable).values({
    personId: input.person.id,
    scope: "global",
    scopeId: null,
    channel: "notify.email",
    eventKind: "comment.created",
    enabled: true,
    digest: "hourly",
  });
}

async function failLegacyDigestInsert() {
  const connectionString = process.env.TASKDESK_DATABASE_URL;
  if (!connectionString) throw new Error("Missing integration DB connection");
  const client = new Client({ connectionString });
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `legacy_digest_${suffix}_fn`;
  const triggerName = `legacy_digest_${suffix}`;
  await client.connect();
  try {
    await client.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.cadence = 'hourly' THEN
          RAISE EXCEPTION 'forced legacy digest insert failure';
        END IF;
        RETURN NEW;
      END;
    $$`);
    await client.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON notification_digest
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    return async () => {
      await client.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON notification_digest`,
      );
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
    };
  } catch (error) {
    await client.query(
      `DROP TRIGGER IF EXISTS ${triggerName} ON notification_digest`,
    );
    await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await client.end();
    throw error;
  }
}

describe("legacy transactional event fanout", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("writes one same-id comment inbox row and channel child for a mention/assignee overlap", async () => {
    const { identity, member, project, recipient, person, task } =
      await fixture();
    const comment = await createComment(
      identity,
      task.id,
      member.user.id,
      `<taskdesk-mention id="${recipient.id}">recipient</taskdesk-mention>`,
      undefined,
    );
    const parent = await db.query.outboxTable.findFirst({
      where: eq(schema.outboxTable.kind, "comment.created"),
    });
    expect(parent?.payload).toMatchObject({
      id: parent?.eventId,
      kind: "comment.created",
      actor: { type: "person", id: identity.personId },
      scope: { workspaceId: member.workspace.id, projectId: project.id },
      payload: { taskId: task.id, key: task.id, commentId: comment.id },
    });
    const inboxRows = await db.query.notificationTable.findMany({
      where: and(
        eq(schema.notificationTable.eventId, parent?.eventId ?? ""),
        eq(schema.notificationTable.personId, person.id),
      ),
    });
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]).toMatchObject({
      kind: "comment.created",
      type: "task_mention",
      resourceType: "task",
      resourceId: task.id,
    });
    expect(inboxRows[0]?.eventData).not.toHaveProperty("quietHoursHeldUntil");
    const children = await db
      .select()
      .from(notificationDeliveryTable)
      .where(
        and(
          eq(notificationDeliveryTable.eventId, parent?.eventId ?? ""),
          eq(notificationDeliveryTable.recipientPersonId, person.id),
        ),
      );
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      channel: "notify.email",
      workspaceId: member.workspace.id,
      digestId: null,
    });

    await db.transaction((tx) =>
      insertLegacyTaskNotification(tx, {
        eventId: parent?.eventId ?? "",
        eventKind: "comment.created",
        userId: recipient.id,
        type: "task_mention",
        taskId: task.id,
        projectId: project.id,
        eventData: { taskTitle: task.title },
      }),
    );
    expect(
      await db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.eventId, parent?.eventId ?? ""),
          eq(schema.notificationTable.personId, person.id),
        ),
      }),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(notificationDeliveryTable)
        .where(
          and(
            eq(notificationDeliveryTable.eventId, parent?.eventId ?? ""),
            eq(notificationDeliveryTable.recipientPersonId, person.id),
          ),
        ),
    ).toHaveLength(1);

    const legacyMarker = await db.transaction((tx) =>
      insertLegacyMarkedNotificationForRecovery(tx, {
        userId: recipient.id,
        type: "task_status_changed",
        taskId: task.id,
        projectId: project.id,
        eventData: { taskTitle: task.title },
      }),
    );
    expect(legacyMarker).not.toBeNull();
    const child = children[0];
    if (!child) throw new Error("Expected an email child");
    let channelCalls = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async (input) => {
          channelCalls += 1;
          expect(input.channel).toBe("notify.email");
          expect(input.idempotencyKey).toBe(child.id);
        }),
      ),
    ).resolves.toMatchObject({ kind: "delivered" });
    expect(channelCalls).toBe(1);
    const markerRow = await db.query.notificationTable.findFirst({
      where: eq(schema.notificationTable.id, legacyMarker?.id ?? ""),
    });
    expect(markerRow?.eventId).toBeNull();
    expect(markerRow?.eventData).toHaveProperty("quietHoursHeldUntil");
    await expect(processNextParentEvent()).resolves.toMatchObject({
      kind: "delivered",
      eventId: parent?.eventId,
    });
    const connectionString = process.env.TASKDESK_DATABASE_URL;
    if (!connectionString) throw new Error("Missing integration DB connection");
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const [webhookDeliveries, automationRuns] = await Promise.all([
        client.query(
          "SELECT event_id FROM webhook_delivery WHERE event_id = $1",
          [parent?.eventId],
        ),
        client.query(
          "SELECT event_id FROM automation_run WHERE event_id = $1",
          [parent?.eventId],
        ),
      ]);
      expect(webhookDeliveries.rowCount).toBe(0);
      expect(automationRuns.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("attaches an opted-in legacy delivery to the event-time digest and stays idempotent", async () => {
    const input = await fixture();
    await enableHourlyLegacyCommentDigest(input);
    await emitAssigneeComment(input);

    const parent = await db.query.outboxTable.findFirst({
      where: eq(schema.outboxTable.kind, "comment.created"),
    });
    if (!parent) throw new Error("Expected a comment parent event");
    const inboxRows = await db.query.notificationTable.findMany({
      where: and(
        eq(schema.notificationTable.eventId, parent.eventId),
        eq(schema.notificationTable.personId, input.person.id),
      ),
    });
    const deliveries = await db
      .select()
      .from(notificationDeliveryTable)
      .where(
        and(
          eq(notificationDeliveryTable.eventId, parent.eventId),
          eq(notificationDeliveryTable.recipientPersonId, input.person.id),
        ),
      );
    expect(inboxRows).toHaveLength(1);
    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0];
    if (!delivery?.digestId) throw new Error("Expected digest membership");
    const [digest] = await db
      .select()
      .from(notificationDigestTable)
      .where(eq(notificationDigestTable.id, delivery.digestId))
      .limit(1);
    expect(digest).toMatchObject({
      recipientPersonId: input.person.id,
      channel: "notify.email",
      workspaceId: input.member.workspace.id,
      cadence: "hourly",
      state: "collecting",
    });
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toEqual({ kind: "idle" });
    expect(sends).toBe(0);

    await db.transaction((tx) =>
      insertLegacyTaskNotification(tx, {
        eventId: parent.eventId,
        eventKind: "comment.created",
        userId: input.recipient.id,
        type: "task_comment",
        taskId: input.task.id,
        projectId: input.project.id,
        eventData: { taskTitle: input.task.title },
      }),
    );
    expect(
      await db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.eventId, parent.eventId),
          eq(schema.notificationTable.personId, input.person.id),
        ),
      }),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(notificationDeliveryTable)
        .where(eq(notificationDeliveryTable.eventId, parent.eventId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(notificationDigestTable)
        .where(
          and(
            eq(notificationDigestTable.recipientPersonId, input.person.id),
            eq(notificationDigestTable.workspaceId, input.member.workspace.id),
          ),
        ),
    ).toHaveLength(1);
  });

  it("rolls back the comment, parent, inbox and child if digest membership fails", async () => {
    const input = await fixture();
    await enableHourlyLegacyCommentDigest(input);
    const closeTrigger = await failLegacyDigestInsert();
    try {
      await expect(
        createComment(
          input.identity,
          input.task.id,
          input.member.user.id,
          "rollback digest",
        ),
      ).rejects.toThrow();
    } finally {
      await closeTrigger();
    }

    expect(
      await db.query.taskActivityTable.findMany({
        where: eq(schema.taskActivityTable.taskId, input.task.id),
      }),
    ).toHaveLength(0);
    expect(
      await db.query.outboxTable.findMany({
        where: eq(schema.outboxTable.kind, "comment.created"),
      }),
    ).toHaveLength(0);
    expect(
      await db.query.notificationTable.findMany({
        where: eq(schema.notificationTable.resourceId, input.task.id),
      }),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationDeliveryTable)
        .where(
          eq(notificationDeliveryTable.recipientPersonId, input.person.id),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationDigestTable)
        .where(eq(notificationDigestTable.recipientPersonId, input.person.id)),
    ).toHaveLength(0);
  });

  it("commits time-entry and relation parents with their actual source ids", async () => {
    const { identity, member, project, task } = await fixture();
    const target = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          number: 2,
          title: "Relation target",
          status: "to-do",
        })
        .returning(),
      "relation target task",
    );
    const entry = await createTimeEntry({
      taskId: task.id,
      identity,
      userId: member.user.id,
      startTime: new Date("2026-10-25T08:00:00.000Z"),
      endTime: new Date("2026-10-25T08:30:00.000Z"),
    });
    const relation = await createTaskRelation({
      identity,
      sourceTaskId: task.id,
      targetTaskId: target.id,
      relationType: "blocks",
      userId: member.user.id,
      workspaceId: member.workspace.id,
      canReachTarget: async () => true,
    });
    const [timeEvent, relationEvent] = await Promise.all([
      db.query.outboxTable.findFirst({
        where: eq(schema.outboxTable.kind, "time-entry.created"),
      }),
      db.query.outboxTable.findFirst({
        where: eq(schema.outboxTable.kind, "task-relation.created"),
      }),
    ]);
    expect(timeEvent?.payload).toMatchObject({
      scope: { workspaceId: member.workspace.id, projectId: project.id },
      payload: { taskId: task.id, key: task.id, timeEntryId: entry.id },
    });
    expect(relationEvent?.payload).toMatchObject({
      scope: { workspaceId: member.workspace.id, projectId: project.id },
      payload: { taskId: task.id, key: task.id, relationId: relation.id },
    });
  });

  it("suppresses a legacy child when the current recipient is no longer active staff", async () => {
    const input = await fixture();
    const [child] = await emitAssigneeComment(input);
    if (!child) throw new Error("Expected one child delivery");
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, input.person.id));
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toMatchObject({ kind: "suppressed" });
    expect(sends).toBe(0);
    const [current] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, child.id));
    expect(current?.state).toBe("suppressed");
  });

  it("suppresses a legacy child when the current person is not staff", async () => {
    const input = await fixture();
    const [child] = await emitAssigneeComment(input);
    if (!child) throw new Error("Expected one child delivery");
    await db
      .update(schema.personTable)
      .set({ side: "customer" })
      .where(eq(schema.personTable.id, input.person.id));
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toMatchObject({ kind: "suppressed" });
    expect(sends).toBe(0);
    const [current] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, child.id));
    expect(current?.state).toBe("suppressed");
  });

  it("suppresses a legacy child after project reach is revoked", async () => {
    const input = await fixture();
    const [child] = await emitAssigneeComment(input);
    if (!child) throw new Error("Expected one child delivery");
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, input.person.id));
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toMatchObject({ kind: "suppressed" });
    expect(sends).toBe(0);
    const [current] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, child.id));
    expect(current?.state).toBe("suppressed");
  });

  it("suppresses a legacy child after its personal channel preference is revoked", async () => {
    const input = await fixture();
    const [child] = await emitAssigneeComment(input);
    if (!child) throw new Error("Expected one child delivery");
    await db
      .update(schema.userNotificationPreferenceTable)
      .set({ emailEnabled: false })
      .where(
        eq(schema.userNotificationPreferenceTable.userId, input.recipient.id),
      );
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toMatchObject({ kind: "suppressed" });
    expect(sends).toBe(0);
    const [current] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, child.id));
    expect(current?.state).toBe("suppressed");
  });

  it("rechecks the legacy task-comment category before sending", async () => {
    const input = await fixture();
    const [child] = await emitAssigneeComment(input);
    if (!child) throw new Error("Expected one child delivery");
    await db
      .update(schema.userNotificationPreferenceTable)
      .set({ taskCommentEnabled: false })
      .where(
        eq(schema.userNotificationPreferenceTable.userId, input.recipient.id),
      );
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toMatchObject({ kind: "suppressed" });
    expect(sends).toBe(0);
    const [current] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, child.id));
    expect(current?.state).toBe("suppressed");
  });

  it("rechecks the legacy task-status category before sending", async () => {
    const input = await fixture();
    await updateTaskStatus({
      identity: input.identity,
      id: input.task.id,
      status: "in-progress",
      currentUserId: input.member.user.id,
    });
    const [child] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.recipientPersonId, input.person.id));
    if (!child) throw new Error("Expected one status delivery child");
    await db
      .update(schema.userNotificationPreferenceTable)
      .set({ taskStatusChangeEnabled: false })
      .where(
        eq(schema.userNotificationPreferenceTable.userId, input.recipient.id),
      );
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toMatchObject({ kind: "suppressed" });
    expect(sends).toBe(0);
    const [current] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, child.id));
    expect(current?.state).toBe("suppressed");
  });

  it("rechecks the legacy assignment category before sending", async () => {
    const input = await fixture();
    const actorPersonId = input.identity.personId;
    if (!actorPersonId) throw new Error("Expected an actor person id");
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: input.member.user.id,
      emailEnabled: true,
      taskAssignmentEnabled: true,
    });
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: input.member.user.id,
      workspaceId: input.member.workspace.id,
      isActive: true,
      emailEnabled: true,
      projectMode: "all",
    });
    await updateTaskAssignee({
      identity: input.identity,
      id: input.task.id,
      userId: input.member.user.id,
      currentUserId: input.member.user.id,
    });
    const [child] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.recipientPersonId, actorPersonId));
    if (!child) throw new Error("Expected one assignment delivery child");
    await db
      .update(schema.userNotificationPreferenceTable)
      .set({ taskAssignmentEnabled: false })
      .where(
        eq(schema.userNotificationPreferenceTable.userId, input.member.user.id),
      );
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toMatchObject({ kind: "suppressed" });
    expect(sends).toBe(0);
    const [current] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, child.id));
    expect(current?.state).toBe("suppressed");
  });

  it("suppresses a legacy child when the task has moved to another workspace", async () => {
    const input = await fixture();
    const [child] = await emitAssigneeComment(input);
    if (!child) throw new Error("Expected one child delivery");
    const other = await createWorkspaceMember();
    const { project: otherProject } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    await db
      .update(schema.taskTable)
      .set({ projectId: otherProject.id })
      .where(eq(schema.taskTable.id, input.task.id));
    let sends = 0;
    await expect(
      processNextNotificationDelivery(
        legacyTaskNotificationRuntime(async () => {
          sends += 1;
        }),
      ),
    ).resolves.toMatchObject({ kind: "suppressed" });
    expect(sends).toBe(0);
    const [current] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, child.id));
    expect(current?.state).toBe("suppressed");
  });

  it("isolates each channel child and retries an ambiguous send with the same child key", async () => {
    const input = await fixture();
    await db
      .update(schema.userNotificationPreferenceTable)
      .set({
        webhookEnabled: true,
        webhookUrl: "https://notify.example.test/hook",
      })
      .where(
        eq(schema.userNotificationPreferenceTable.userId, input.recipient.id),
      );
    await db
      .update(schema.userNotificationWorkspaceRuleTable)
      .set({ webhookEnabled: true })
      .where(
        eq(
          schema.userNotificationWorkspaceRuleTable.userId,
          input.recipient.id,
        ),
      );
    const children = (await emitAssigneeComment(input)).sort(
      (left, right) =>
        left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime() ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );
    expect(children.map((row) => row.channel).sort()).toEqual([
      "notify.email",
      "notify.webhook",
    ]);
    const first = children[0];
    if (!first) throw new Error("Expected a child delivery");
    const sibling = children.find((row) => row.id !== first.id);
    if (!sibling) throw new Error("Expected a second channel child");
    await db.execute(sql`
      UPDATE notification_delivery
         SET next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute'
       WHERE id = ${first.id}
    `);
    await db.execute(sql`
      UPDATE notification_delivery
         SET next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 hour'
       WHERE id = ${sibling.id}
    `);
    const sentKeys: string[] = [];
    let shouldFailAmbiguously = true;
    const runtime = legacyTaskNotificationRuntime(async (options) => {
      sentKeys.push(options.idempotencyKey);
      if (shouldFailAmbiguously) {
        shouldFailAmbiguously = false;
        throw new NotificationProviderOutcomeAmbiguous();
      }
    });
    await expect(processNextNotificationDelivery(runtime)).resolves.toEqual({
      kind: "retry",
      ambiguous: true,
    });
    expect(sentKeys).toEqual([first.id]);
    const [pendingAfterFailure] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, first.id));
    expect(pendingAfterFailure).toMatchObject({
      state: "pending",
      attempts: 1,
    });
    await db.execute(sql`
      UPDATE notification_delivery
         SET next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second'
       WHERE id = ${sibling.id}
    `);
    await expect(
      processNextNotificationDelivery(runtime),
    ).resolves.toMatchObject({
      kind: "delivered",
    });
    expect(sentKeys).toEqual([first.id, sibling.id]);
    const [siblingAfterSend] = await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.id, sibling.id));
    expect(siblingAfterSend?.state).toBe("delivered");
    await db.execute(sql`
      UPDATE outbox_dedupe_reservation
         SET lease_expires_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second'
       WHERE owner_delivery_id = ${first.id}
    `);
    await db.execute(sql`
      UPDATE notification_delivery
         SET next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second'
       WHERE id = ${first.id}
    `);
    await expect(
      processNextNotificationDelivery(runtime),
    ).resolves.toMatchObject({
      kind: "delivered",
    });
    expect(sentKeys).toEqual([first.id, sibling.id, first.id]);
    const states = await db
      .select({
        id: notificationDeliveryTable.id,
        state: notificationDeliveryTable.state,
      })
      .from(notificationDeliveryTable);
    expect(states.find((row) => row.id === first.id)?.state).toBe("delivered");
    expect(states.find((row) => row.id === sibling.id)?.state).toBe(
      "delivered",
    );
    expect(sentKeys).toHaveLength(3);
    expect(new Set(sentKeys).size).toBe(2);
  });

  it("attributes the comment compatibility envelope to the authenticated API key", async () => {
    const { member, task } = await fixture();
    const key = await createPersonalApiKey(
      { userId: member.user.id },
      {
        name: "Legacy comment fanout attribution",
        capabilities: ["project:read", "work_item:read", "work_item:update"],
      },
    );
    const { app } = createApp();
    const response = await app.request(`/api/comment/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key.key },
      body: JSON.stringify({ content: "API-key comment" }),
    });
    expect(response.status).toBe(200);
    const event = await db.query.outboxTable.findFirst({
      where: eq(schema.outboxTable.kind, "comment.created"),
    });
    expect(event?.payload).toMatchObject({
      actor: { type: "api_key", id: key.id },
      payload: { taskId: task.id, key: task.id },
    });
  });

  it("links task create, status and assignment inbox rows to each parent ID", async () => {
    const { member, project, recipient, person } = await fixture();
    await db
      .update(projectTable)
      .set({ lastTaskNumber: 1 })
      .where(eq(projectTable.id, project.id));
    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Expected a staff mutation identity");
    const createdTask = await createTask({
      identity,
      projectId: project.id,
      currentUserId: member.user.id,
      userId: recipient.id,
      title: "API-created compatibility task",
      description: "",
      priority: "low",
      status: "to-do",
    });
    const createdEvent = await db.query.outboxTable.findFirst({
      where: eq(schema.outboxTable.kind, "task.created"),
    });
    expect(createdEvent?.payload).toMatchObject({
      actor: { type: "person", id: expect.any(String) },
      payload: { taskId: createdTask.id, key: createdTask.id },
    });
    expect(
      await db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.eventId, createdEvent?.eventId ?? ""),
          eq(schema.notificationTable.personId, person.id),
        ),
      }),
    ).toHaveLength(1);

    await updateTaskStatus({
      identity,
      id: createdTask.id,
      status: "in-progress",
      currentUserId: member.user.id,
    });
    const statusEvent = await db.query.outboxTable.findFirst({
      where: eq(schema.outboxTable.kind, "task.status_changed"),
    });
    expect(
      await db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.eventId, statusEvent?.eventId ?? ""),
          eq(schema.notificationTable.personId, person.id),
        ),
      }),
    ).toHaveLength(1);

    await updateTaskAssignee({
      identity,
      id: createdTask.id,
      userId: member.user.id,
      currentUserId: member.user.id,
    });
    const assignmentEvent = await db.query.outboxTable.findFirst({
      where: eq(schema.outboxTable.kind, "task.assignee_changed"),
    });
    expect(assignmentEvent?.payload).toMatchObject({
      actor: { type: "person", id: identity.personId },
      payload: { taskId: createdTask.id, key: createdTask.id },
    });
    expect(
      await db.query.notificationTable.findMany({
        where: eq(
          schema.notificationTable.eventId,
          assignmentEvent?.eventId ?? "",
        ),
      }),
    ).toHaveLength(1);
  });

  it("creates a task through the authenticated HTTP route and commits its event-linked inbox row", async () => {
    const { member, project, recipient, person } = await fixture();
    await grantProjectManageAccess(member.user.id, project.id);
    await db
      .update(projectTable)
      .set({ lastTaskNumber: 1 })
      .where(eq(projectTable.id, project.id));
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "HTTP-created compatibility task",
        description: "Persist event-linked fanout through the route",
        priority: "low",
        status: "to-do",
        userId: recipient.id,
      }),
    });
    expect(response.status).toBe(200);
    const task = (await response.json()) as { id: string };
    const parent = await db.query.outboxTable.findFirst({
      where: eq(schema.outboxTable.kind, "task.created"),
    });
    expect(parent?.payload).toMatchObject({
      scope: { workspaceId: member.workspace.id, projectId: project.id },
      payload: { taskId: task.id, key: task.id },
    });
    expect(
      await db.query.notificationTable.findMany({
        where: and(
          eq(schema.notificationTable.eventId, parent?.eventId ?? ""),
          eq(schema.notificationTable.personId, person.id),
        ),
      }),
    ).toHaveLength(1);
  });

  it("rolls the comment mutation back when its compatibility parent cannot be inserted", async () => {
    const { identity, member, task } = await fixture();
    const connectionString = process.env.TASKDESK_DATABASE_URL;
    if (!connectionString) throw new Error("Missing integration DB connection");
    const client = new Client({ connectionString });
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `legacy_fanout_${suffix}_fn`;
    const triggerName = `legacy_fanout_${suffix}`;
    await client.connect();
    try {
      await client.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'comment.created' THEN
            RAISE EXCEPTION 'forced compatibility event insert failure';
          END IF;
          RETURN NEW;
        END;
      $$`);
      await client.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      await expect(
        createComment(identity, task.id, member.user.id, "rollback me"),
      ).rejects.toThrow();
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON outbox`);
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await client.end();
    }
    expect(
      await db.query.taskActivityTable.findMany({
        where: and(
          eq(schema.taskActivityTable.taskId, task.id),
          eq(schema.taskActivityTable.type, "comment"),
        ),
      }),
    ).toHaveLength(0);
    expect(
      await db.query.outboxTable.findMany({
        where: eq(schema.outboxTable.kind, "comment.created"),
      }),
    ).toHaveLength(0);
  });
});
