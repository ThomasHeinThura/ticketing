/** #230: the `grant-instance-admin` break-glass command shares the God Mode grant rules. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  breakGlassGrantInstanceAdmin,
  parseCliArgs,
} from "../../apps/api/src/instance/users/break-glass";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
});

async function seedUser(
  id: string,
  extra: Partial<typeof schema.userTable.$inferInsert> = {},
  staff = true,
) {
  await db
    .insert(schema.userTable)
    .values({ id, name: id, email: `${id}@Example.test`, ...extra });
  if (staff) await ensureStaffPersonForUser(id);
}

const roleOf = async (id: string) =>
  (
    await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, id))
  )[0]?.role;

describe("break-glass grant-instance-admin (#230)", () => {
  it("grants, audits as a system actor with the OS user, and alerts every admin and the target", async () => {
    await seedUser("existing-admin", { role: "admin" });
    await seedUser("locked-out");
    expect(
      await breakGlassGrantInstanceAdmin("LOCKED-OUT@example.test", "ops"),
    ).toBe("granted");
    expect(await roleOf("locked-out")).toBe("admin");
    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        eq(schema.auditLogTable.action, "auth.instance_admin_break_glass"),
      );
    expect(audit).toMatchObject({
      actorType: "system",
      actorId: null,
      entityId: "locked-out",
      after: { outcome: "granted", osUser: "ops" },
    });
    const alerts = await db.select().from(schema.notificationTable);
    expect(alerts.map((n) => n.userId).sort()).toEqual([
      "existing-admin",
      "locked-out",
    ]);
    expect(alerts.every((n) => n.type === "security_alert")).toBe(true);
  });

  it("reports already_admin without changing the role", async () => {
    await seedUser("admin-a", { role: "admin" });
    expect(await breakGlassGrantInstanceAdmin("admin-a@example.test")).toBe(
      "already_admin",
    );
    expect(await roleOf("admin-a")).toBe("admin");
  });

  it("refuses an unknown email, and banned, anonymous and non-staff targets, without writing", async () => {
    await seedUser("banned", { banned: true });
    await seedUser("anon", { isAnonymous: true });
    await seedUser("nostaff", {}, false);
    await expect(
      breakGlassGrantInstanceAdmin("nobody@example.test"),
    ).rejects.toThrow("No user with that email");
    for (const id of ["banned", "anon", "nostaff"]) {
      await expect(
        breakGlassGrantInstanceAdmin(`${id}@example.test`),
      ).rejects.toMatchObject({ status: 409 });
      expect(await roleOf(id)).not.toBe("admin");
    }
    expect(await db.select().from(schema.auditLogTable)).toHaveLength(0);
    expect(await db.select().from(schema.notificationTable)).toHaveLength(0);
  });

  it("refuses while instance setup is incomplete", async () => {
    await seedUser("early");
    await db
      .update(schema.instanceSettingTable)
      .set({ setupCompletedAt: null });
    await expect(
      breakGlassGrantInstanceAdmin("early@example.test"),
    ).rejects.toMatchObject({ status: 409 });
    expect(await roleOf("early")).not.toBe("admin");
  });
});

describe("cli argument parsing (#230)", () => {
  it("accepts only grant-instance-admin with one email", () => {
    expect(parseCliArgs(["grant-instance-admin", "a@b.c"])).toEqual({
      email: "a@b.c",
    });
    for (const argv of [
      [],
      ["grant-instance-admin"],
      ["grant-instance-admin", "a@b.c", "extra"],
      ["disable-auth-plugin", "x"],
    ])
      expect(parseCliArgs(argv)).toHaveProperty("error");
  });
});
