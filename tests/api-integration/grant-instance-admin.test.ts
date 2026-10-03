import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as auditWriter from "../../apps/api/src/audit/audit-writer";
import { grantInstanceAdmin } from "../../apps/api/src/cli/grant-instance-admin";
import db, { schema } from "../../apps/api/src/database";
import { isCurrentInstanceAdmin } from "../../apps/api/src/instance/observability/audit-failure-notifier";
import clearNotifications from "../../apps/api/src/notification/controllers/clear-notifications";
import getNotifications from "../../apps/api/src/notification/controllers/get-notifications";
import markAllNotificationsAsRead from "../../apps/api/src/notification/controllers/mark-all-notifications-as-read";
import markNotificationAsRead from "../../apps/api/src/notification/controllers/mark-notification-as-read";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";

const sendBreakGlassAlertEmail = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/email")>()),
  sendBreakGlassAlertEmail,
}));

const operator = { uid: 10_001, passwdName: "taskdesk" };

function createIO(answers: string[]) {
  const writes: string[] = [];
  return {
    io: {
      isTTY: true,
      write: (value: string) => writes.push(value),
      ask: async () => answers.shift() ?? "",
    },
    writes,
  };
}

async function createUser(
  id: string,
  role: string | null,
  email = `${id}@example.test`,
) {
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: id, email, role })
    .returning();
  if (!user) throw new Error("test user insert returned no row");
  await ensureStaffPersonForUser(user.id);
  return user;
}

async function insertInitializedMarker(
  setupCompletedAt: Date | null = new Date(),
) {
  await db.insert(schema.instanceSettingTable).values({
    id: "singleton",
    setupCompletedAt,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  sendBreakGlassAlertEmail.mockResolvedValue({ success: true });
  await resetTestDatabase();
  await insertInitializedMarker();
});

describe("P4 break-glass recovery CLI service", () => {
  it("grants only an eligible staff user and commits audit plus deduplicated admin alerts atomically", async () => {
    const admin = await createUser("breakglass-admin", "admin");
    const target = await createUser("breakglass-target", "member");
    const { io, writes } = createIO(["YES", "GRANT INSTANCE ADMIN"]);

    const result = await grantInstanceAdmin(db, target.email, operator, io);

    expect(result).toMatchObject({
      outcome: "granted",
      emailSucceeded: 2,
      emailFailed: 0,
    });
    expect(writes).toContain(`Target: ${target.name} <${target.email}>`);
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("admin");
    const audit = await db
      .select({
        actorId: schema.auditLogTable.actorId,
        actorType: schema.auditLogTable.actorType,
        action: schema.auditLogTable.action,
        entityId: schema.auditLogTable.entityId,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.break_glass_used"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: null,
      actorType: "system",
      entityId: target.id,
      after: {
        outcome: "granted",
        effectiveUid: 10001,
        passwdName: "taskdesk",
      },
    });
    expect(JSON.stringify(audit[0])).not.toContain(target.email);
    const alerts = await db
      .select({
        userId: schema.notificationTable.userId,
        resourceType: schema.notificationTable.resourceType,
        resourceId: schema.notificationTable.resourceId,
        eventData: schema.notificationTable.eventData,
      })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "security_alert"));
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.userId).sort()).toEqual(
      [admin.id, target.id].sort(),
    );
    expect(
      alerts.every(
        (alert) =>
          alert.resourceType === "instance" && alert.resourceId === "singleton",
      ),
    ).toBe(true);
    expect(alerts[0]?.eventData).toEqual({
      kind: "break_glass_used",
      outcome: "granted",
    });
    expect(sendBreakGlassAlertEmail).toHaveBeenCalledTimes(2);
    expect(await isCurrentInstanceAdmin(target.id)).toBe(true);
    expect(await getNotifications(target.id)).toHaveLength(1);
  });

  it("is authority-idempotent while auditing and alerting an already-admin invocation", async () => {
    const target = await createUser("breakglass-existing", "admin");
    const { io } = createIO(["YES", "GRANT INSTANCE ADMIN"]);

    const result = await grantInstanceAdmin(db, target.email, operator, io);

    expect(result.outcome).toBe("already_admin");
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "auth.break_glass_used")),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "security_alert")),
    ).toHaveLength(1);
  });

  it("keeps committed grant, audit, and in-app alerts when SMTP delivery fails", async () => {
    const target = await createUser("breakglass-email-failure", "member");
    sendBreakGlassAlertEmail.mockResolvedValue({
      success: false,
      reason: "SMTP_NOT_CONFIGURED",
    });
    const { io } = createIO(["YES", "GRANT INSTANCE ADMIN"]);

    const result = await grantInstanceAdmin(db, target.email, operator, io);

    expect(result).toMatchObject({
      outcome: "granted",
      emailSucceeded: 0,
      emailFailed: 1,
    });
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("admin");
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "auth.break_glass_used")),
    ).toHaveLength(1);
    expect(await db.select().from(schema.notificationTable)).toHaveLength(1);
  });

  it("audits and refuses an ineligible identity without changing authority", async () => {
    const target = await createUser("breakglass-customer", "member");
    await db
      .update(schema.personTable)
      .set({ side: "customer" })
      .where(eq(schema.personTable.userId, target.id));
    const { io } = createIO([]);

    await expect(
      grantInstanceAdmin(db, target.email, operator, io),
    ).rejects.toThrow("eligible active staff identity");

    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("member");
    const [audit] = await db
      .select({
        entityType: schema.auditLogTable.entityType,
        entityId: schema.auditLogTable.entityId,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.break_glass_used"));
    expect(audit).toMatchObject({
      entityType: "user",
      entityId: target.id,
      after: { outcome: "refused", reason: "target_ineligible" },
    });
    expect(await db.select().from(schema.notificationTable)).toHaveLength(0);
  });

  it("audits and refuses an inactive staff identity", async () => {
    const target = await createUser("breakglass-inactive", "member");
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, target.id));
    const { io } = createIO([]);

    await expect(
      grantInstanceAdmin(db, target.email, operator, io),
    ).rejects.toThrow("eligible active staff identity");
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("member");
    const [audit] = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.break_glass_used"));
    expect(audit?.after).toMatchObject({
      outcome: "refused",
      reason: "target_ineligible",
    });
  });

  it.each([
    ["anonymous", { isAnonymous: true }],
    ["banned", { banned: true }],
  ] as const)("refuses a %s account", async (label, update) => {
    const target = await createUser(`breakglass-${label}`, "member");
    await db
      .update(schema.userTable)
      .set(update)
      .where(eq(schema.userTable.id, target.id));
    const { io } = createIO([]);

    await expect(
      grantInstanceAdmin(db, target.email, operator, io),
    ).rejects.toThrow("eligible active staff identity");
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("member");
    const [audit] = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.break_glass_used"));
    expect(audit?.after).toMatchObject({
      outcome: "refused",
      reason: "target_ineligible",
    });
  });

  it("audits an incomplete-instance refusal without elevating the target", async () => {
    await db
      .update(schema.instanceSettingTable)
      .set({ setupCompletedAt: null })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const target = await createUser("breakglass-uninitialized", "member");
    const { io } = createIO([]);

    await expect(
      grantInstanceAdmin(db, target.email, operator, io),
    ).rejects.toThrow("setup is complete");
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("member");
    const [audit] = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.break_glass_used"));
    expect(audit?.after).toMatchObject({
      outcome: "refused",
      reason: "setup_incomplete",
    });
  });

  it("audits an unresolved email without storing the supplied address", async () => {
    const { io } = createIO([]);
    const supplied = "not-found-private@example.test";

    await expect(
      grantInstanceAdmin(db, supplied, operator, io),
    ).rejects.toThrow("did not resolve");

    const [audit] = await db
      .select({
        entityType: schema.auditLogTable.entityType,
        entityId: schema.auditLogTable.entityId,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.break_glass_used"));
    expect(audit).toMatchObject({
      entityType: "instance_setting",
      entityId: "singleton",
      after: { outcome: "refused", reason: "target_unresolved" },
    });
    expect(JSON.stringify(audit)).not.toContain(supplied);
  });

  it("records cancellation without grant or alert", async () => {
    const target = await createUser("breakglass-cancelled", "member");
    const { io } = createIO(["NO"]);

    await expect(
      grantInstanceAdmin(db, target.email, operator, io),
    ).resolves.toMatchObject({ outcome: "cancelled" });
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("member");
    const [audit] = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.break_glass_used"));
    expect(audit?.after).toMatchObject({ outcome: "cancelled" });
    expect(await db.select().from(schema.notificationTable)).toHaveLength(0);
  });

  it("hides instance security alerts and preserves them after admin authority is revoked", async () => {
    const user = await createUser("breakglass-alert-demoted", "member");
    const [alert] = await db
      .insert(schema.notificationTable)
      .values({
        userId: user.id,
        type: "security_alert",
        title: "An instance administrator recovery command was used",
        eventData: { kind: "break_glass_used", outcome: "granted" },
        resourceId: "singleton",
        resourceType: "instance",
      })
      .returning();
    if (!alert) throw new Error("test security alert insert returned no row");

    expect(await getNotifications(user.id)).toHaveLength(0);
    await expect(
      markNotificationAsRead(alert.id, user.id),
    ).rejects.toMatchObject({
      status: 404,
    });
    await markAllNotificationsAsRead(user.id);
    expect(
      (
        await db
          .select({ isRead: schema.notificationTable.isRead })
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.id, alert.id))
      )[0]?.isRead,
    ).toBe(false);
    await clearNotifications(user.id);
    expect(
      await db
        .select({ id: schema.notificationTable.id })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.id, alert.id)),
    ).toHaveLength(1);
  });

  it("rolls back the role and notices when the audit append fails", async () => {
    const target = await createUser("breakglass-audit-failure", "member");
    vi.spyOn(auditWriter, "appendAuditLog").mockRejectedValueOnce(
      new Error("private audit failure"),
    );
    const { io } = createIO(["YES", "GRANT INSTANCE ADMIN"]);

    await expect(
      grantInstanceAdmin(db, target.email, operator, io),
    ).rejects.toThrow();
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("member");
    expect(await db.select().from(schema.notificationTable)).toHaveLength(0);
  });

  it("requires a TTY before reading or mutating", async () => {
    const target = await createUser("breakglass-notty", "member");
    const io = { ...createIO([]).io, isTTY: false };

    await expect(
      grantInstanceAdmin(db, target.email, operator, io),
    ).rejects.toThrow("interactive TTY");
    expect(await db.select().from(schema.auditLogTable)).toHaveLength(0);
  });

  it("rejects concurrent stale confirmation and records the changed display state", async () => {
    const target = await createUser("breakglass-concurrent", "member");
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const bothAtPrompt = new Promise<void>((resolve) => {
      let waiting = 0;
      const arrive = () => {
        waiting += 1;
        if (waiting === 2) resolve();
      };
      releaseFirst = arrive;
      releaseSecond = arrive;
    });
    const gatedIO = () => ({
      isTTY: true,
      write() {},
      async ask() {
        if (answers === 0) {
          answers += 1;
          releaseFirst();
          await bothAtPrompt;
          return "YES";
        }
        if (answers === 1) {
          answers += 1;
          releaseSecond();
          await bothAtPrompt;
          return "YES";
        }
        return "GRANT INSTANCE ADMIN";
      },
    });
    let answers = 0;
    const first = grantInstanceAdmin(db, target.email, operator, gatedIO());
    const second = grantInstanceAdmin(db, target.email, operator, gatedIO());
    const settled = await Promise.allSettled([first, second]);

    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(settled.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "auth.break_glass_used")),
    ).toHaveLength(2);
    const refused = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.break_glass_used"));
    expect(
      refused.some((row) =>
        JSON.stringify(row.after).includes("displayed_state_changed"),
      ),
    ).toBe(true);
  });
});
