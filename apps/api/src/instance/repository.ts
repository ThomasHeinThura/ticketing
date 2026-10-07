import { eq } from "drizzle-orm";
import db from "../database";
import { instanceSettingTable, roleTable, userTable } from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getSetupCompletionRow(singletonId: string) {
  return db
    .select({ setupCompletedAt: instanceSettingTable.setupCompletedAt })
    .from(instanceSettingTable)
    .where(eq(instanceSettingTable.id, singletonId))
    .limit(1);
}

export function getLocalFactorPolicy(executor: Executor = db) {
  return executor
    .select({ policy: instanceSettingTable.localFactorPolicy })
    .from(instanceSettingTable)
    .where(eq(instanceSettingTable.id, "singleton"))
    .limit(1);
}

export function lockLocalFactorRole(executor: Executor, roleId: string) {
  return executor
    .select({ id: roleTable.id })
    .from(roleTable)
    .where(eq(roleTable.id, roleId))
    .for("key share")
    .limit(1);
}

export function lockLocalFactorPolicy(executor: Executor) {
  return executor
    .select({ policy: instanceSettingTable.localFactorPolicy })
    .from(instanceSettingTable)
    .where(eq(instanceSettingTable.id, "singleton"))
    .for("update")
    .limit(1);
}

export function getUserForMfaReset(id: string) {
  return db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      locale: userTable.locale,
    })
    .from(userTable)
    .where(eq(userTable.id, id))
    .limit(1);
}

export function lockUserTwoFactorEnabled(executor: Executor, id: string) {
  return executor
    .select({ enabled: userTable.twoFactorEnabled })
    .from(userTable)
    .where(eq(userTable.id, id))
    .for("update")
    .limit(1);
}
