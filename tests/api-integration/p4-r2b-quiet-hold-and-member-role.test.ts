/**
 * P4 round-2 (R2-M3, R2-L1, R2-L7).
 *
 * R2-M3: a legacy-path delivery held for quiet hours must survive a process restart. The hold is
 * persisted on the notification row; nothing here uses a timer, so "restart" is simply calling
 * the release job later with no in-process state carried over.
 * R2-L1: the member-role rank guard runs against EVERY duplicate row of the person.
 * R2-L7: every workspace member role change is audited with before/after.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { deliverNotification } from "../../apps/api/src/notification-preferences/delivery";
import { QUIET_HOURS_HOLD_KEY } from "../../apps/api/src/notification-preferences/delivery.repository";
import { releaseHeldNotifications } from "../../apps/api/src/scheduler/notification-digest-release";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const emailProvider = vi.hoisted(() => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));
vi.mock("@taskdesk/email", () => emailProvider);

beforeEach(async () => {
  emailProvider.sendNotificationEmail.mockClear();
  await resetTestDatabase();
});

async function heldFixture(kind: string | null = null) {
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
  // A window that contains "now": 2h before to 2h after, UTC.
  const hour = new Date().getUTCHours();
  const clock = (h: number) => `${String((h + 24) % 24).padStart(2, "0")}:00`;
  await db
    .update(schema.personTable)
    .set({
      quietHoursStart: clock(hour - 2),
      quietHoursEnd: clock(hour + 2),
      quietHoursTimezone: "UTC",
    })
    .where(eq(schema.personTable.userId, user.id));
  const notification = requireRow(
    await db
      .insert(schema.notificationTable)
      .values({
        userId: user.id,
        title: "Notice",
        content: "Content",
        type: "info",
        kind,
        eventData: { taskTitle: "T" },
        resourceId: workspace.id,
        resourceType: "workspace",
      })
      .returning(),
    "notification",
  );
  return { user, notification };
}

async function storedHold(id: string) {
  const [row] = await db
    .select({ eventData: schema.notificationTable.eventData })
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.id, id));
  return (row?.eventData as Record<string, unknown> | null)?.[
    QUIET_HOURS_HOLD_KEY
  ];
}

describe("R2-M3 durable quiet-hours hold (legacy path)", () => {
  it("persists the hold with no timer, and a later release run (a restart) delivers it once", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const { notification } = await heldFixture();

    await deliverNotification(notification.id);
    expect(emailProvider.sendNotificationEmail).not.toHaveBeenCalled();
    const heldUntil = await storedHold(notification.id);
    expect(typeof heldUntil).toBe("string");
    // No deferral timer of the old kind (up to 24h) was armed.
    expect(
      timers.mock.calls.some(
        ([, delay]) => typeof delay === "number" && delay >= 60_000,
      ),
    ).toBe(false);
    timers.mockRestore();

    // Still inside the window: a release run changes nothing and does not lose the hold.
    expect(await releaseHeldNotifications(new Date())).toMatchObject({
      released: 0,
    });
    expect(emailProvider.sendNotificationEmail).not.toHaveBeenCalled();

    // "Restart": fresh call, window over.
    const after = new Date(new Date(heldUntil as string).getTime() + 60_000);
    // The release re-evaluates quiet hours against the real clock; move the person's window out.
    await db
      .update(schema.personTable)
      .set({ quietHoursStart: null, quietHoursEnd: null });
    const outcome = await releaseHeldNotifications(after);
    expect(outcome).toEqual({ released: 1, degraded: false });
    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(await storedHold(notification.id)).toBeUndefined();

    // Released rows are not delivered twice.
    await releaseHeldNotifications(after);
    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("re-holds instead of sending when the person is still quiet at release time", async () => {
    const { notification } = await heldFixture();
    await deliverNotification(notification.id);
    const heldUntil = new Date((await storedHold(notification.id)) as string);

    // Due per the marker, but the person's window still covers the real clock.
    const outcome = await releaseHeldNotifications(
      new Date(heldUntil.getTime() + 1_000),
    );
    expect(outcome.released).toBe(1);
    expect(emailProvider.sendNotificationEmail).not.toHaveBeenCalled();
    expect(typeof (await storedHold(notification.id))).toBe("string");
  });

  it("an SLA-breach notification bypasses quiet hours and is not held", async () => {
    const { notification } = await heldFixture("sla.breached");
    await deliverNotification(notification.id);
    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(await storedHold(notification.id)).toBeUndefined();
  });
});

async function memberRoleRows(workspaceId: string, userId: string) {
  const rows = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  return rows.map((row) => row.role).sort();
}

describe("R2-L1 / R2-L7 workspace member role change", () => {
  async function setup(actorRole: string) {
    const actor = await createWorkspaceMember({ role: actorRole });
    const target = await createWorkspaceMember({ role: "viewer" });
    const workspaceId = actor.workspace.id;
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: target.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();
    const patch = (role: string) =>
      app.request(
        `/api/workspace/${workspaceId}/members/${target.user.id}/role`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
    return { actor, target, workspaceId, patch };
  }

  it("L1: refuses when ANY duplicate row of the person outranks the actor, whatever the row order", async () => {
    const { target, workspaceId, patch } = await setup("manager");
    // The higher-ranked duplicate is inserted last: an unordered read may return the viewer first.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: target.user.id,
      role: "admin",
      joinedAt: new Date(),
    });

    const response = await patch("member");
    expect(
      response.status,
      await response.clone().text(),
    ).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await memberRoleRows(workspaceId, target.user.id)).toEqual([
      "admin",
      "viewer",
    ]);
  });

  it("L7: every role change is audited with before and after, even one that moves no admin reach", async () => {
    const { actor, target, workspaceId, patch } = await setup("admin");
    const response = await patch("member");
    expect(response.status, await response.clone().text()).toBe(200);

    const rows = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.workspaceId, workspaceId),
          eq(schema.auditLogTable.entityType, "workspace_member"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "membership.changed",
      entityId: target.user.id,
      actorId: actor.user.id,
      before: { role: "viewer" },
      after: { kind: "member_role_changed", role: "member" },
    });
  });
});
