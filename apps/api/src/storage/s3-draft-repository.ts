import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import type { Executor, Transaction } from "../database/executor";
import { instancePluginConfigTable } from "../database/schema";

export const S3_DRAFT_PLUGIN_ID = "storage.s3";
export const S3_DRAFT_INSTANCE_KEY = "draft";

export async function readS3Draft(executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(instancePluginConfigTable)
    .where(
      and(
        eq(instancePluginConfigTable.pluginId, S3_DRAFT_PLUGIN_ID),
        eq(instancePluginConfigTable.instanceKey, S3_DRAFT_INSTANCE_KEY),
      ),
    )
    .limit(1);
  return row;
}

export async function lockS3Draft(tx: Transaction) {
  // The advisory lock serializes creation as well as updates, including when
  // the row does not yet exist; the unique constraint remains a backstop.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(783181, 1)`);
  const [row] = await tx
    .select()
    .from(instancePluginConfigTable)
    .where(
      and(
        eq(instancePluginConfigTable.pluginId, S3_DRAFT_PLUGIN_ID),
        eq(instancePluginConfigTable.instanceKey, S3_DRAFT_INSTANCE_KEY),
      ),
    )
    .for("update");
  return row;
}

export async function persistS3Draft(
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
        enabled: false,
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
