import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  dispatchLegacyTaskNotification,
  insertLegacyMarkedNotificationForRecovery,
} from "../../apps/api/src/events/legacy-task-effects";
import createNotification from "../../apps/api/src/notification/controllers/create-notification";
import { QUIET_HOURS_HOLD_KEY } from "../../apps/api/src/notification-preferences/delivery.repository";
import { releaseHeldNotifications } from "../../apps/api/src/scheduler/notification-digest-release";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

const emailProvider = vi.hoisted(() => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));
vi.mock("@taskdesk/email", () => emailProvider);

beforeEach(async () => {
  emailProvider.sendNotificationEmail.mockReset();
  emailProvider.sendNotificationEmail.mockResolvedValue(undefined);
  await resetTestDatabase();
});

async function fixture() {
  const { user, workspace } = await createWorkspaceMember();
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await grantProjectRole(user.id, project.id, ["work_item:update"]);
  const task = requireRow(
    await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title: "Queued notification task" })
      .returning(),
    "queued notification task",
  );
  await db.insert(schema.userNotificationPreferenceTable).values({
    userId: user.id,
    emailEnabled: true,
    taskStatusChangeEnabled: true,
  });
  await db.insert(schema.userNotificationWorkspaceRuleTable).values({
    userId: user.id,
    workspaceId: workspace.id,
    emailEnabled: true,
  });
  return { user, workspace, project, task };
}

async function enqueueTaskNotification(input: {
  userId: string;
  taskId: string;
  projectId: string;
}) {
  return db.transaction((tx) =>
    insertLegacyMarkedNotificationForRecovery(tx, {
      userId: input.userId,
      type: "task_status_changed",
      taskId: input.taskId,
      projectId: input.projectId,
      eventData: { taskTitle: "Queued notification task" },
    }),
  );
}

async function holdMarker(id: string): Promise<unknown> {
  const [row] = await db
    .select({ eventData: schema.notificationTable.eventData })
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.id, id));
  const eventData = row?.eventData;
  return eventData && typeof eventData === "object" && !Array.isArray(eventData)
    ? (eventData as Record<string, unknown>)[QUIET_HOURS_HOLD_KEY]
    : undefined;
}

describe("durable legacy notification delivery", () => {
  it("queues task notifications in the mutation transaction and leaves dispatch to the worker", async () => {
    const { user, project, task } = await fixture();
    const notification = await enqueueTaskNotification({
      userId: user.id,
      projectId: project.id,
      taskId: task.id,
    });
    expect(notification).not.toBeNull();
    if (!notification) throw new Error("Expected a reachable notification");

    await dispatchLegacyTaskNotification(notification);

    expect(emailProvider.sendNotificationEmail).not.toHaveBeenCalled();
    expect(typeof (await holdMarker(notification.id))).toBe("string");
  });

  it("recovers a committed queued notification on a fresh worker run and clears it after success", async () => {
    const { user, project, task } = await fixture();
    const notification = await enqueueTaskNotification({
      userId: user.id,
      projectId: project.id,
      taskId: task.id,
    });
    if (!notification) throw new Error("Expected a reachable notification");

    const outcome = await releaseHeldNotifications(
      new Date(Date.now() + 1_000),
    );

    expect(outcome).toEqual({ released: 1, degraded: false });
    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(await holdMarker(notification.id)).toBeUndefined();
  });

  it("retains a failed provider delivery for a later lease retry", async () => {
    const { user, project, task } = await fixture();
    const notification = await enqueueTaskNotification({
      userId: user.id,
      projectId: project.id,
      taskId: task.id,
    });
    if (!notification) throw new Error("Expected a reachable notification");
    emailProvider.sendNotificationEmail.mockRejectedValueOnce(
      new Error("temporary provider failure"),
    );

    const first = await releaseHeldNotifications(new Date(Date.now() + 1_000));
    const lease = await holdMarker(notification.id);
    expect(first).toEqual({ released: 1, degraded: true });
    expect(typeof lease).toBe("string");

    const second = await releaseHeldNotifications(
      new Date(new Date(lease as string).getTime() + 1_000),
    );

    expect(second).toEqual({ released: 1, degraded: false });
    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(2);
    expect(await holdMarker(notification.id)).toBeUndefined();
  });

  it("does not let concurrent worker runs send the same queued row twice", async () => {
    const { user, project, task } = await fixture();
    const notification = await enqueueTaskNotification({
      userId: user.id,
      projectId: project.id,
      taskId: task.id,
    });
    if (!notification) throw new Error("Expected a reachable notification");
    emailProvider.sendNotificationEmail.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const now = new Date(Date.now() + 1_000);
    const outcomes = await Promise.all([
      releaseHeldNotifications(now),
      releaseHeldNotifications(now),
    ]);

    expect(outcomes.reduce((sum, outcome) => sum + outcome.released, 0)).toBe(
      1,
    );
    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(await holdMarker(notification.id)).toBeUndefined();
  });

  it("rolls back the notification and its delivery marker together", async () => {
    const { user, project, task } = await fixture();

    await expect(
      db.transaction(async (tx) => {
        await insertLegacyMarkedNotificationForRecovery(tx, {
          userId: user.id,
          type: "task_status_changed",
          taskId: task.id,
          projectId: project.id,
          eventData: { taskTitle: "Queued notification task" },
        });
        throw new Error("rollback producer transaction");
      }),
    ).rejects.toThrow("rollback producer transaction");

    const rows = await db
      .select({ id: schema.notificationTable.id })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.resourceId, task.id));
    expect(rows).toEqual([]);
    expect(emailProvider.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it("queues generic notification-controller sends without dispatching directly", async () => {
    const { user, workspace } = await createWorkspaceMember();
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: user.id,
      emailEnabled: true,
    });
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: user.id,
      workspaceId: workspace.id,
      emailEnabled: true,
    });

    const notification = await createNotification({
      userId: user.id,
      type: "info",
      eventData: { message: "Compatibility delivery" },
      resourceId: workspace.id,
      resourceType: "workspace",
    });

    expect(notification).not.toBeNull();
    expect(emailProvider.sendNotificationEmail).not.toHaveBeenCalled();
    if (!notification) throw new Error("Expected workspace notification");
    expect(notification.eventData).not.toHaveProperty(QUIET_HOURS_HOLD_KEY);
    expect(typeof (await holdMarker(notification.id))).toBe("string");
  });
});
