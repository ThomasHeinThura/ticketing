import { SLA_METRICS } from "@taskdesk/domain";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { assertProjectStillLive } from "../assert-work-item-live";

/** Open the two manual SLA intervals atomically (SLA-11). */
export async function pauseWorkItemSla(
  key: string,
  workspaceId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
      })
      .from(schema.workItemTable)
      .where(
        and(
          eq(schema.workItemTable.key, key),
          eq(schema.workItemTable.workspaceId, workspaceId),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.workItemTable.archivedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!item) throw new HTTPException(404, { message: "Work item not found" });

    // Reach middleware ran before this transaction and cannot serialize a concurrent
    // project freeze. Lock/check the parent project inside the write transaction so a
    // project deletion that wins first prevents inserting pause rows; if this check wins,
    // its FOR SHARE lock holds the project live until both metrics commit.
    await assertProjectStillLive(tx, item.projectId);

    const [existing] = await tx
      .select({ id: schema.slaPauseTable.id })
      .from(schema.slaPauseTable)
      .where(
        and(
          eq(schema.slaPauseTable.workItemId, item.id),
          isNull(schema.slaPauseTable.endedAt),
        ),
      )
      .limit(1);
    if (existing) {
      throw new HTTPException(409, {
        message: "An SLA pause is already open for this work item",
      });
    }

    const now = new Date();
    await tx.insert(schema.slaPauseTable).values(
      SLA_METRICS.map((metric) => ({
        workItemId: item.id,
        metric,
        startedAt: now,
        reason: "manual" as const,
      })),
    );
  });
}
