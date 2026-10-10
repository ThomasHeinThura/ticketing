import { SLA_METRICS } from "@taskdesk/domain";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { slaPauseTable } from "../../database/migration-schema";

/** Open the two manual SLA intervals atomically (SLA-11). */
export async function pauseWorkItemSla(
  key: string,
  workspaceId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(
        and(
          eq(schema.workItemTable.key, key),
          eq(schema.workItemTable.workspaceId, workspaceId),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.workItemTable.archivedAt),
        ),
      )
      .for("update");
    if (!item) throw new HTTPException(404, { message: "Work item not found" });

    const [existing] = await tx
      .select({ metric: slaPauseTable.metric })
      .from(slaPauseTable)
      .where(
        and(
          eq(slaPauseTable.workItemId, item.id),
          isNull(slaPauseTable.endedAt),
        ),
      )
      .limit(1);
    if (existing) {
      throw new HTTPException(409, {
        message: "An SLA pause is already open for this work item",
      });
    }

    const now = new Date();
    await tx.insert(slaPauseTable).values(
      SLA_METRICS.map((metric) => ({
        workItemId: item.id,
        metric,
        startedAt: now,
        reason: "manual" as const,
      })),
    );
  });
}
