import { and, count, eq, sql } from "drizzle-orm";
import db, { schema } from "../database";

export async function isBootstrapMfaPending(userId: string): Promise<boolean> {
  const [setting] = await db
    .select({ completedAt: schema.instanceSettingTable.setupCompletedAt })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
  if (!setting || setting.completedAt) return false;

  const [users] = await db.select({ value: count() }).from(schema.userTable);
  if ((users?.value ?? 0) < 1) return false;

  const [admin] = await db
    .select({ id: schema.userTable.id, role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return admin?.role === "admin";
}

export async function completeBootstrapMfaEnrollment(
  userId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(2026)`);

    const [setting] = await tx
      .select({ completedAt: schema.instanceSettingTable.setupCompletedAt })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"))
      .for("update")
      .limit(1);
    if (!setting || setting.completedAt) return false;

    const [users] = await tx.select({ value: count() }).from(schema.userTable);
    if (users?.value !== 1) return false;

    const [admin] = await tx
      .select({
        id: schema.userTable.id,
        role: schema.userTable.role,
        twoFactorEnabled: schema.userTable.twoFactorEnabled,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId))
      .for("update")
      .limit(1);
    if (admin?.role !== "admin" || admin.twoFactorEnabled !== true) {
      return false;
    }

    const activeStaff = await tx
      .select({ id: schema.personTable.id, side: schema.personTable.side })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.active, true),
        ),
      )
      .for("update");
    if (activeStaff.length !== 1 || activeStaff[0]?.side !== "staff") {
      return false;
    }

    const updated = await tx
      .update(schema.instanceSettingTable)
      .set({
        setupCompletedAt: new Date(),
        setupTokenHash: null,
        setupTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.instanceSettingTable.id, "singleton"))
      .returning({ id: schema.instanceSettingTable.id });
    return updated.length === 1;
  });
}
