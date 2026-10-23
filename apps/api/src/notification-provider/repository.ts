import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import type { Executor, Transaction } from "../database/executor";
import { instancePluginConfigTable } from "../database/schema";
export const EMAIL_PLUGIN_ID = "notify.email";
const INSTANCE_KEY = "default";
export async function readEmailProvider(executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(instancePluginConfigTable)
    .where(
      and(
        eq(instancePluginConfigTable.pluginId, EMAIL_PLUGIN_ID),
        eq(instancePluginConfigTable.instanceKey, INSTANCE_KEY),
      ),
    )
    .limit(1);
  return row;
}
export async function lockEmailProvider(tx: Transaction) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(782023, 1)`);
  const [row] = await tx
    .select()
    .from(instancePluginConfigTable)
    .where(
      and(
        eq(instancePluginConfigTable.pluginId, EMAIL_PLUGIN_ID),
        eq(instancePluginConfigTable.instanceKey, INSTANCE_KEY),
      ),
    )
    .for("update");
  return row;
}
export async function saveEmailProvider(
  tx: Transaction,
  input: typeof instancePluginConfigTable.$inferInsert,
  expectedVersion: number,
) {
  if (expectedVersion === 0)
    return (
      await tx
        .insert(instancePluginConfigTable)
        .values(input)
        .onConflictDoNothing()
        .returning()
    )[0];
  return (
    await tx
      .update(instancePluginConfigTable)
      .set({
        enabled: input.enabled,
        config: input.config,
        secrets: input.secrets,
        configVersion: input.configVersion,
        updatedAt: input.updatedAt,
        updatedBy: input.updatedBy,
      })
      .where(
        and(
          eq(instancePluginConfigTable.id, input.id),
          eq(instancePluginConfigTable.configVersion, expectedVersion),
        ),
      )
      .returning()
  )[0];
}
