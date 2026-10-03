import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  isCurrentInstanceAdmin,
  notifyCurrentInstanceAdminsOfAuditFailure,
} from "../../apps/api/src/instance/observability/audit-failure-notifier";
import getNotifications from "../../apps/api/src/notification/controllers/get-notifications";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

describe("AU-14 durable audit-failure notification", () => {
  it("delivers only to active instance administrators and hides alerts after authority is revoked", async () => {
    const [activeAdmin, inactiveAdmin, laterRevokedAdmin, ordinaryUser] =
      await db
        .insert(schema.userTable)
        .values([
          {
            id: "au14-active-admin",
            name: "Active Admin",
            email: "active-admin@example.test",
            role: "admin",
          },
          {
            id: "au14-inactive-admin",
            name: "Inactive Admin",
            email: "inactive-admin@example.test",
            role: "admin",
          },
          {
            id: "au14-revoked-admin",
            name: "Revoked Admin",
            email: "revoked-admin@example.test",
            role: "admin",
          },
          {
            id: "au14-user",
            name: "Ordinary User",
            email: "ordinary@example.test",
            role: "member",
          },
        ])
        .returning();
    if (!activeAdmin || !inactiveAdmin || !laterRevokedAdmin || !ordinaryUser) {
      throw new Error("AU-14 fixture users were not created");
    }
    for (const user of [
      activeAdmin,
      inactiveAdmin,
      laterRevokedAdmin,
      ordinaryUser,
    ]) {
      await ensureStaffPersonForUser(user.id);
    }
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, inactiveAdmin.id));

    await notifyCurrentInstanceAdminsOfAuditFailure(
      "mutation",
      new Date("2026-10-03T00:00:00.000Z"),
    );

    const alerts = await db
      .select({
        userId: schema.notificationTable.userId,
        type: schema.notificationTable.type,
        eventData: schema.notificationTable.eventData,
      })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "audit_write_failed"));
    expect(alerts.map(({ userId }) => userId).sort()).toEqual(
      [activeAdmin.id, laterRevokedAdmin.id].sort(),
    );
    expect(
      alerts.every(
        ({ eventData }) =>
          eventData &&
          typeof eventData === "object" &&
          !Array.isArray(eventData) &&
          Object.keys(eventData).sort().join(",") === "occurredAt,operation",
      ),
    ).toBe(true);
    expect(await getNotifications(activeAdmin.id)).toHaveLength(1);
    expect(await isCurrentInstanceAdmin(laterRevokedAdmin.id)).toBe(true);

    await db
      .update(schema.userTable)
      .set({ role: "member" })
      .where(eq(schema.userTable.id, laterRevokedAdmin.id));
    expect(await isCurrentInstanceAdmin(laterRevokedAdmin.id)).toBe(false);
    expect(await getNotifications(laterRevokedAdmin.id)).toHaveLength(0);
    expect(await getNotifications(inactiveAdmin.id)).toHaveLength(0);
    expect(await getNotifications(ordinaryUser.id)).toHaveLength(0);
  });
});
