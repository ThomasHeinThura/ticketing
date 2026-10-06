import { and, eq } from "drizzle-orm";
import db, { schema } from "../../database";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getObservabilityLevels() {
  return db
    .select({
      version: schema.instanceSettingTable.observabilityConfigVersion,
      levels: schema.instanceSettingTable.observabilityLogLevels,
    })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
}

export function getMetricsTokenDigest() {
  return db
    .select({ digest: schema.instanceSettingTable.metricsTokenHash })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
}

export function getObservabilitySettings() {
  return db
    .select({
      version: schema.instanceSettingTable.observabilityConfigVersion,
      levels: schema.instanceSettingTable.observabilityLogLevels,
      tokenHash: schema.instanceSettingTable.metricsTokenHash,
      rotatedAt: schema.instanceSettingTable.metricsTokenRotatedAt,
    })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
}

export function getObservabilityVersion(executor: Executor = db) {
  return executor
    .select({ version: schema.instanceSettingTable.observabilityConfigVersion })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
}

export function getCurrentInstanceAdmin(userId: string) {
  return db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .innerJoin(
      schema.personTable,
      and(
        eq(schema.personTable.userId, schema.userTable.id),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .where(
      and(eq(schema.userTable.id, userId), eq(schema.userTable.role, "admin")),
    )
    .limit(1);
}

export function listInstanceAdminUsers(executor: Executor) {
  return executor
    .selectDistinct({ userId: schema.userTable.id })
    .from(schema.userTable)
    .innerJoin(
      schema.personTable,
      and(
        eq(schema.personTable.userId, schema.userTable.id),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .where(eq(schema.userTable.role, "admin"));
}
