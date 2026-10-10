import { asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { slaPauseTable } from "../../database/migration-schema";
import { evaluatePinnedWorkItemSla } from "../../sla-policy/evaluation";
import { getWorkItemSlaSourceQuery } from "../../sla-policy/repository";

export async function getWorkItemSla(key: string, workspaceId: string) {
  const [item] = await getWorkItemSlaSourceQuery(db, key, workspaceId);

  if (!item) throw new HTTPException(404, { message: "Work item not found" });

  const pauses = await db
    .select({
      metric: slaPauseTable.metric,
      startedAt: slaPauseTable.startedAt,
      endedAt: slaPauseTable.endedAt,
      reason: slaPauseTable.reason,
    })
    .from(slaPauseTable)
    .where(eq(slaPauseTable.workItemId, item.id))
    .orderBy(asc(slaPauseTable.startedAt));

  const now = new Date();
  const startedAt = item.slaStartedAt ?? item.createdAt;
  const metrics = await evaluatePinnedWorkItemSla({
    policyVersionId: item.slaPolicyVersionId,
    workspaceId: item.workspaceId,
    workItemTypeId: item.typeId,
    priority: item.priority,
    facts: {
      startedAt,
      firstResponseAt: item.firstResponseAt,
      resolvedAt: item.resolvedAt,
      pauses: pauses.map((pause) => ({
        metric: pause.metric as "first_response" | "resolution",
        startedAt: pause.startedAt,
        endedAt: pause.endedAt,
        reason: pause.reason,
      })),
    },
    now,
  });

  return { key: item.key, startedAt, evaluatedAt: now, metrics };
}
