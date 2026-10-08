import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import clearNotifications from "../../apps/api/src/notification/controllers/clear-notifications";
import createNotification from "../../apps/api/src/notification/controllers/create-notification";
import getNotifications from "../../apps/api/src/notification/controllers/get-notifications";
import markAllNotificationsAsRead from "../../apps/api/src/notification/controllers/mark-all-notifications-as-read";
import markNotificationAsRead from "../../apps/api/src/notification/controllers/mark-notification-as-read";
import { userCanReachTask } from "../../apps/api/src/notification/task-reach";
import { deliverNotification } from "../../apps/api/src/notification-preferences/delivery";
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
const destinationCheck = vi.hoisted(() => ({
  assertPublicWebhookDestination: vi.fn(async () => undefined),
}));
vi.mock(
  "../../apps/api/src/utils/assert-public-destination",
  () => destinationCheck,
);

beforeEach(async () => {
  emailProvider.sendNotificationEmail.mockClear();
  destinationCheck.assertPublicWebhookDestination.mockReset();
  destinationCheck.assertPublicWebhookDestination.mockResolvedValue(undefined);
  await resetTestDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fixture() {
  const { user, workspace } = await createWorkspaceMember();
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await grantProjectRole(user.id, project.id, ["work_item:update"]);
  const task = requireRow(
    await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title: "Reachable task" })
      .returning(),
    "notification reach task",
  );
  return { user, workspace, project, task };
}

async function plantTaskNotification(input: {
  userId: string;
  taskId: string;
  title?: string;
  createdAt?: Date;
}) {
  return requireRow(
    await db
      .insert(schema.notificationTable)
      .values({
        userId: input.userId,
        title: input.title ?? "Private task title",
        content: "Private task content",
        type: "task_status_changed",
        resourceId: input.taskId,
        resourceType: "task",
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      })
      .returning(),
    "notification reach row",
  );
}

async function revokeProjectReach(userId: string, projectId: string) {
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (!person) throw new Error("Expected seeded person");
  await db
    .delete(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, person.id),
        eq(schema.membershipTable.scope, "project"),
        eq(schema.membershipTable.scopeId, projectId),
      ),
    );
}

describe("notification task reach (security-model §2; NO edge cases)", () => {
  it("filters hidden rows before the 50-row limit and rejects create/read mutations after revocation", async () => {
    const { user, project, task } = await fixture();
    const { project: hiddenProject } = await createProjectFixture({
      workspaceId: project.workspaceId,
      name: "Unreachable project",
    });
    const hiddenTask = requireRow(
      await db
        .insert(schema.taskTable)
        .values({ projectId: hiddenProject.id, title: "Unreachable task" })
        .returning(),
      "unreachable notification task",
    );
    const visible = await plantTaskNotification({
      userId: user.id,
      taskId: task.id,
      title: "Older visible task",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    });
    for (let index = 0; index < 55; index += 1) {
      await plantTaskNotification({ userId: user.id, taskId: hiddenTask.id });
    }

    expect(await userCanReachTask(user.id, task.id)).toBe(true);
    expect(await userCanReachTask(user.id, hiddenTask.id)).toBe(false);
    const listed = await getNotifications(user.id);
    expect(listed.map((row) => row.id)).toEqual([visible.id]);

    await revokeProjectReach(user.id, project.id);
    expect(await userCanReachTask(user.id, task.id)).toBe(false);
    const beforeDeniedCreate = await db
      .select({ id: schema.notificationTable.id })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, user.id));
    expect(
      await createNotification({
        userId: user.id,
        type: "task_status_changed",
        resourceId: task.id,
        resourceType: "task",
      }),
    ).toBeNull();
    expect(
      await db
        .select({ id: schema.notificationTable.id })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, user.id)),
    ).toHaveLength(beforeDeniedCreate.length);

    const hidden = requireRow(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.id, visible.id)),
      "hidden notification",
    );
    const auditBefore = await db.select().from(schema.auditLogTable);
    await expect(
      markNotificationAsRead(hidden.id, user.id),
    ).rejects.toMatchObject({
      status: 404,
    });
    await markAllNotificationsAsRead(user.id);
    await clearNotifications(user.id);
    const after = await db
      .select({
        id: schema.notificationTable.id,
        isRead: schema.notificationTable.isRead,
      })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, user.id));
    expect(after).toHaveLength(56);
    expect(after.every((row) => row.isRead === false)).toBe(true);
    expect(after.map((row) => row.id)).toContain(hidden.id);
    const otherRecipient = await createWorkspaceMember();
    await expect(
      markNotificationAsRead(hidden.id, otherRecipient.user.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(schema.auditLogTable)).toHaveLength(
      auditBefore.length,
    );
  });

  it("allows project members and fails closed for missing tasks and deleted projects", async () => {
    const { user, task } = await fixture();
    expect(await userCanReachTask(user.id, task.id)).toBe(true);
    await db
      .update(schema.userTable)
      .set({ banned: null })
      .where(eq(schema.userTable.id, user.id));
    expect(await userCanReachTask(user.id, task.id)).toBe(true);
    await db
      .update(schema.userTable)
      .set({ banned: false })
      .where(eq(schema.userTable.id, user.id));
    const inserted = await createNotification({
      userId: user.id,
      type: "task_status_changed",
      resourceId: task.id,
      resourceType: "task",
    });
    expect(inserted).not.toBeNull();
    expect((await getNotifications(user.id)).map((row) => row.id)).toContain(
      inserted?.id,
    );

    expect(await userCanReachTask(user.id, randomUUID())).toBe(false);
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    expect(await userCanReachTask(user.id, task.id)).toBe(false);
    expect(
      (await getNotifications(user.id)).map((row) => row.id),
    ).not.toContain(inserted?.id);

    const second = await fixture();
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, second.project.id));
    expect(await userCanReachTask(second.user.id, second.task.id)).toBe(false);
  });

  it("fails closed without throwing when a persisted role has malformed capabilities", async () => {
    const { user, project, task } = await fixture();
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1);
    if (!person) throw new Error("Expected seeded person");
    const [membership] = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      )
      .limit(1);
    if (!membership) throw new Error("Expected project membership");
    await db
      .update(schema.roleTable)
      .set({ capabilities: sql`'{}'::jsonb` })
      .where(eq(schema.roleTable.id, membership.roleId));

    const row = await plantTaskNotification({
      userId: user.id,
      taskId: task.id,
    });
    expect(await userCanReachTask(user.id, task.id)).toBe(false);
    expect(await getNotifications(user.id)).toHaveLength(0);
    expect(
      await createNotification({
        userId: user.id,
        type: "task_status_changed",
        resourceId: task.id,
        resourceType: "task",
      }),
    ).toBeNull();
    await expect(markNotificationAsRead(row.id, user.id)).rejects.toMatchObject(
      { status: 404 },
    );
    const [unchanged] = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, row.id));
    expect(unchanged?.isRead).toBe(false);
  });

  it("requires effective work_item:read, including project override and capability implications", async () => {
    const { user, workspace, project, task } = await fixture();
    // work_item:update is not itself the required capability; the canonical evaluator's
    // implication expansion grants work_item:read.
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1);
    if (!person) throw new Error("Expected seeded person");
    expect(await userCanReachTask(user.id, task.id)).toBe(true);

    const [membership] = await db
      .select()
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      )
      .limit(1);
    if (!membership) throw new Error("Expected project membership");
    const workspaceRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: workspace.id,
          key: "notification-read-inherited",
          name: "Notification read inherited",
          rank: 1,
          capabilities: ["work_item:update"],
        })
        .returning(),
      "workspace notification role",
    );
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.id, membership.id));
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "workspace",
      scopeId: workspace.id,
      roleId: workspaceRole.id,
      seesAll: true,
    });
    expect(await userCanReachTask(user.id, task.id)).toBe(true);

    await db
      .update(schema.roleTable)
      .set({ capabilities: [] })
      .where(eq(schema.roleTable.id, membership.roleId));
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: membership.scope,
      scopeId: membership.scopeId,
      roleId: membership.roleId,
      seesAll: membership.seesAll,
      inheritedFrom: membership.inheritedFrom,
      derivedFrom: membership.derivedFrom,
    });
    expect(await userCanReachTask(user.id, task.id)).toBe(false);
    const notification = await plantTaskNotification({
      userId: user.id,
      taskId: task.id,
    });
    expect(await getNotifications(user.id)).toHaveLength(0);
    expect(
      await createNotification({
        userId: user.id,
        type: "task_status_changed",
        resourceId: task.id,
        resourceType: "task",
      }),
    ).toBeNull();
    await expect(
      markNotificationAsRead(notification.id, user.id),
    ).rejects.toMatchObject({ status: 404 });
    const [unchanged] = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, notification.id));
    expect(unchanged?.isRead).toBe(false);
  });

  it("does not infer legacy customer task visibility from same-organisation membership", async () => {
    const { user, workspace, task } = await fixture();
    const organisationId = randomUUID();
    await db.insert(schema.organisationTable).values({
      id: organisationId,
      key: `customer-${organisationId}`,
      name: "Same organisation",
    });
    await db
      .update(schema.workspaceTable)
      .set({ organisationId })
      .where(eq(schema.workspaceTable.id, workspace.id));
    await db
      .update(schema.personTable)
      .set({ side: "customer", organisationId })
      .where(eq(schema.personTable.userId, user.id));
    expect(await userCanReachTask(user.id, task.id)).toBe(false);
    const row = await plantTaskNotification({
      userId: user.id,
      taskId: task.id,
    });
    expect(await getNotifications(user.id)).toHaveLength(0);
    expect(
      await createNotification({
        userId: user.id,
        type: "task_status_changed",
        resourceId: task.id,
        resourceType: "task",
      }),
    ).toBeNull();
    await expect(markNotificationAsRead(row.id, user.id)).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("rechecks recipient reach immediately before the controlled email provider seam", async () => {
    const { user, workspace, project, task } = await fixture();
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: user.id,
      emailEnabled: true,
    });
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: user.id,
      workspaceId: workspace.id,
      emailEnabled: true,
    });
    const reachableNotification = await plantTaskNotification({
      userId: user.id,
      taskId: task.id,
    });
    await deliverNotification(reachableNotification.id);
    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);

    const revokedNotification = await plantTaskNotification({
      userId: user.id,
      taskId: task.id,
    });
    await revokeProjectReach(user.id, project.id);

    await deliverNotification(revokedNotification.id);

    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("rechecks independently after every async network-provider preflight", async () => {
    const { user, workspace, project, task } = await fixture();
    const fetchProvider = vi.fn(
      async () => new Response("ok", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchProvider);
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: user.id,
      ntfyEnabled: true,
      ntfyServerUrl: "https://notify.example",
      ntfyTopic: "topic",
      webhookEnabled: true,
      webhookUrl: "https://hooks.example/notify",
    });
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: user.id,
      workspaceId: workspace.id,
      ntfyEnabled: true,
      webhookEnabled: true,
    });
    const notification = await plantTaskNotification({
      userId: user.id,
      taskId: task.id,
    });
    let revoke: Promise<void> | undefined;
    destinationCheck.assertPublicWebhookDestination.mockImplementation(
      async () => {
        revoke ??= revokeProjectReach(user.id, project.id);
        await revoke;
      },
    );

    await deliverNotification(notification.id);

    expect(
      destinationCheck.assertPublicWebhookDestination,
    ).toHaveBeenCalledTimes(2);
    expect(fetchProvider).not.toHaveBeenCalled();
  });
});
